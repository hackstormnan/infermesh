# InferMesh

**InferMesh** is a policy-driven AI inference routing backend that manages high-volume AI requests and dispatches them to the most appropriate model and worker based on configurable routing policies (cost, latency, capability, affinity).

---

## Architecture

### Framework — Fastify

InferMesh uses [Fastify](https://fastify.dev) rather than Express. For a high-throughput inference router, the key reasons are:

- **Performance** — 2-3× faster than Express; structured for low-latency I/O
- **Built-in Pino logging** — structured JSON logs with request ID correlation out of the box
- **Plugin lifecycle** — encapsulated, dependency-injected plugins map cleanly to domain modules
- **Native TypeScript** — first-class types without wrapper packages
- **Active maintenance** — Fastify v5 is the current stable release

### Folder Structure

```
src/
├── main.ts                   # Entry point — boots server, handles signals
│
├── app/
│   ├── server.ts             # Fastify factory: config, hooks, error handler
│   └── routes.ts             # Central route registry for all modules
│
├── core/                     # Cross-cutting infrastructure
│   ├── config.ts             # Zod-validated environment configuration
│   ├── logger.ts             # Standalone Pino logger (startup / background)
│   └── errors.ts             # ApiError class + global Fastify error handler
│
├── shared/                   # Shared contracts — the domain language of InferMesh
│   ├── index.ts              # Top-level barrel (import from '../../shared')
│   ├── types.ts              # API envelope: ApiSuccessBody, ApiErrorBody, ResponseMeta
│   ├── response.ts           # Response builder helpers
│   ├── primitives.ts         # Branded IDs, IsoTimestamp, PaginationQuery, BaseEntity
│   └── contracts/            # Domain contracts by bounded context
│       ├── index.ts          # Contracts barrel
│       ├── request.ts        # InferenceRequest entity, RequestStatus, DTOs, Zod schemas
│       ├── job.ts            # Job entity, JobStatus, JobPriority, JobEvent payloads
│       ├── model.ts          # Model entity, ModelProvider, ModelCapability, DTOs
│       ├── worker.ts         # Worker entity, WorkerStatus, heartbeat DTOs
│       ├── routing.ts        # RoutingPolicy, RoutingDecision, RoutingStrategy
│       ├── metrics.ts        # RequestMetricRecord, AggregatedMetrics, MetricWindow
│       ├── simulation.ts     # SimulationConfig, SimulationResult, TrafficProfile
│       └── stream.ts         # StreamEvent discriminated union, StopReason
│
├── infra/                    # Infrastructure-level routes and middleware config
│   ├── health/
│   │   └── health.route.ts   # GET /health — liveness probe
│   └── middleware/
│       ├── requestId.ts      # Correlation ID strategy (x-request-id header)
│       └── requestLogger.ts  # Pino logger configuration + header redaction
│
└── modules/                  # Domain modules (re-export contracts; impl in future tickets)
    ├── requests/             # Inference request lifecycle management
    ├── workers/              # Worker registry and health tracking
    ├── models/               # Model registry and capability catalog
    ├── routing/              # Policy-driven request placement engine
    ├── metrics/              # Observability and aggregated metrics
    ├── simulation/           # Load simulation and policy testing
    └── stream/               # Streaming response handling (SSE / WebSocket)

docs/
└── architecture.md           # Full module map, dependency graph, naming conventions
```

### API Response Envelope

All endpoints return a consistent JSON envelope:

```jsonc
// Success
{ "success": true, "data": { ... }, "meta": { "requestId": "uuid", "timestamp": "iso" } }

// Error
{ "success": false, "error": { "code": "NOT_FOUND", "message": "..." }, "meta": { ... } }
```

### Request Correlation

Every request is assigned a unique ID via the `x-request-id` header:

- If the caller provides `x-request-id`, that value is adopted (distributed tracing support)
- Otherwise a UUID v4 is generated server-side
- The resolved ID is logged on every Pino line for that request and echoed back as a response header

---

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env

# 3. Run in development (hot reload)
npm run dev

# 4. Check health
curl http://localhost:3000/health
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start with hot reload via tsx watch |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled output |
| `npm run lint` | ESLint (TypeScript strict rules) |
| `npm run lint:fix` | ESLint with auto-fix |
| `npm test` | Run Vitest test suite |
| `npm run typecheck` | Type-check without emitting |

## Environment Variables

See [.env.example](.env.example) for all supported variables. Required at runtime:

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | Runtime environment |
| `PORT` | `3000` | Server port |
| `HOST` | `0.0.0.0` | Bind address |
| `LOG_LEVEL` | `info` | Pino log level |
| `SERVICE_NAME` | `infermesh` | Service name in logs |

### Shared Contracts

All domain types, enums, DTOs, and Zod schemas live in `src/shared/contracts/` — separate
from any implementation. Modules import from `shared/`, never from each other, enforcing
clean boundaries and a stable domain language.

See [docs/architecture.md](docs/architecture.md) for the full module map, dependency graph,
and naming conventions.

---

## Roadmap

- **Ticket 1** ✅ — Server foundation (Fastify, Pino, Zod config, error handling, health endpoint)
- **Ticket 2** ✅ — Shared domain contracts (entities, DTOs, enums, Zod schemas for all modules)
- **Ticket 3** — Model registry implementation (CRUD, alias resolution, capability filtering)
- **Ticket 4** — Worker registry implementation (registration, heartbeats, health eviction)
- **Ticket 5** — Request ingestion and state machine
- **Ticket 6** — Policy-driven routing engine (pluggable strategies, dry-run evaluate endpoint)
- **Ticket 7** — Metrics aggregation and Prometheus endpoint
- **Ticket 8** — Streaming proxy (SSE / WebSocket)
- **Ticket 9** — Load simulation and policy backtesting
