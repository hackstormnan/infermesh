# Deployment

This document covers how to deploy InferMesh in a real environment, what to be aware of operationally, and what the current in-memory architecture means for production use.

---

## Current state

InferMesh is a **portfolio-stage backend platform**. All domain logic, routing, simulation, and WebSocket infrastructure is fully implemented and tested. The persistence layer uses in-memory repositories — all state is local to the process and lost on restart.

This is a deliberate architectural choice: every repository has a corresponding interface (`IJobRepository`, `IModelRepository`, etc.) that can be swapped for a persistent adapter without changing any service or route code. The path to production persistence is adding an adapter, not refactoring the domain.

---

## Topology

```
                        ┌─────────────────────────────┐
                        │       Reverse proxy          │
                        │   (nginx / Caddy / ALB)      │
                        │                              │
                        │  HTTP  →  :3000              │
                        │  WS    →  :3000  (upgrade)   │
                        └─────────────┬───────────────┘
                                      │
                        ┌─────────────▼───────────────┐
                        │        InferMesh process     │
                        │        (Node.js 22)          │
                        │                              │
                        │  GET  /health                │
                        │  POST /api/v1/intake/...     │
                        │  WS   /api/v1/stream         │
                        │  GET  /api/v1/metrics        │
                        │  POST /api/v1/simulation/... │
                        └─────────────────────────────┘
```

InferMesh is a single-process Node.js application. It does not require any external services at startup.

---

## Running the compiled build

```bash
# Install production dependencies only
npm ci --omit=dev

# Compile
npm run build

# Start
NODE_ENV=production PORT=3000 HOST=0.0.0.0 LOG_LEVEL=info LOG_PRETTY=false \
  node dist/main.js
```

Or with an env file:

```bash
node -r dotenv/config dist/main.js
```

---

## Docker

A minimal Dockerfile:

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

Set environment variables via `--env-file`, `-e`, or your orchestrator's secrets mechanism. Do not bake `.env` into the image.

---

## Reverse proxy

Use nginx, Caddy, or an AWS ALB in front of InferMesh.

**Key requirements:**

- Forward `X-Request-Id` header if your proxy generates correlation IDs
- Set `Host` and `X-Forwarded-For` headers so InferMesh can log the real client IP
- For WebSocket: pass `Upgrade: websocket` and `Connection: Upgrade` headers through

**Caddy example:**

```caddy
infermesh.example.com {
  reverse_proxy localhost:3000 {
    header_up X-Request-Id {uuid}
  }
}
```

**nginx WebSocket snippet:**

```nginx
location /api/v1/stream {
  proxy_pass http://infermesh:3000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "Upgrade";
  proxy_set_header Host $host;
  proxy_read_timeout 3600s;
}
```

---

## WebSocket considerations

- The stream gateway uses `@fastify/websocket` (libwebsockets under the hood) — compatible with standard WebSocket clients and proxies
- Each connected client holds an open TCP connection; set `proxy_read_timeout` accordingly at the proxy level
- `InMemoryStreamBroker` is synchronous and single-process — connections registered in one process cannot receive events published in another. For multi-process deployments, replace `InMemoryStreamBroker` with a Redis pub/sub or Kafka-backed implementation via the `IStreamBroker` interface
- The `ConnectionRegistry` is also in-memory — sticky sessions are required if running behind a load balancer with multiple instances today

---

## Graceful shutdown

InferMesh registers handlers for `SIGINT` and `SIGTERM`. On signal:

1. Stops accepting new connections
2. Waits up to `SHUTDOWN_TIMEOUT_MS` (default 10 s) for in-flight requests to complete
3. Closes the Fastify server
4. Exits cleanly

Set `SHUTDOWN_TIMEOUT_MS=30000` in production to give long-running simulation requests time to drain.

---

## In-memory limitations

All state lives in process memory. Implications:

| Concern | Current behaviour | Production path |
|---|---|---|
| Requests / jobs | Lost on restart | Swap `InMemoryJobRepository` for Postgres/Redis |
| Model registry | Seeded at boot (or via API) | Swap `InMemoryModelRepository` for DB-backed adapter |
| Worker registry | Workers must re-register on restart | Same adapter swap |
| Routing decisions | Lost on restart | Swap `InMemoryDecisionRepository` for append log (Postgres, S3) |
| Job queue | Lost on restart | Swap `InMemoryJobQueue` for Redis Streams / SQS |
| Metrics | Zeroed on restart | Swap `InMemoryMetricsRepository` for InfluxDB / TimescaleDB |
| WebSocket clients | Disconnected on restart | Swap `InMemoryStreamBroker` for Redis pub/sub |

Every repository is accessed through an interface. Swapping the implementation is a one-line change in the module's `index.ts` — no service or route code changes.

---

## Multi-instance deployments

Not supported without persistence layer upgrades (see above). With a shared database and Redis pub/sub broker:

- Replace all `InMemory*` repositories with shared-DB adapters
- Replace `InMemoryStreamBroker` with a Redis-backed broker
- Remove sticky session requirement from the load balancer

---

## Environment separation

Recommended approach:

| Environment | `NODE_ENV` | `LOG_PRETTY` | Notes |
|---|---|---|---|
| Local dev | `development` | `true` | pino-pretty, debug logging |
| CI | `test` | `false` | Quiet logging, ephemeral port |
| Staging | `production` | `false` | JSON logs, full feature parity |
| Production | `production` | `false` | JSON logs, reduced log level, longer shutdown timeout |

Use separate `.env` files per environment, loaded via your secrets management system. Never commit production secrets.

---

## Production checklist

- [ ] `NODE_ENV=production` set
- [ ] `LOG_PRETTY=false` (raw JSON for log aggregator)
- [ ] `LOG_LEVEL=info` or `warn`
- [ ] `SHUTDOWN_TIMEOUT_MS` ≥ 30000 for long-running simulation runs
- [ ] `HOST=0.0.0.0` (or `127.0.0.1` behind a local proxy)
- [ ] Reverse proxy configured with WebSocket upgrade headers
- [ ] Health check (`GET /health`) wired into load balancer / k8s liveness probe
- [ ] `AUTH_ENABLED` and `JWT_SECRET` configured if auth gate is needed
- [ ] Persistent repository adapters in place if state durability is required
