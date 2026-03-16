# InferMesh

![CI](https://github.com/your-org/infermesh/actions/workflows/ci.yml/badge.svg)

**InferMesh** is a policy-driven AI inference routing backend. It accepts incoming inference requests, scores live model and worker candidates against configurable routing policies, selects the optimal placement, and streams real-time status events to connected clients — all without coupling request acceptance to model execution.

Built as a portfolio-quality TypeScript backend targeting Applied AI Engineer / backend systems roles.

---

## What problem does it solve?

A basic AI gateway proxies requests to a single model endpoint. InferMesh is one layer above that — a routing and orchestration plane that makes intelligent placement decisions across multiple models and workers:

| Concern | Basic gateway | InferMesh |
|---|---|---|
| Model selection | Static, per-route | Policy-driven, multi-candidate scoring |
| Worker placement | None | Load- and capability-aware selection |
| Fallback | Manual retry | Structured fallback tracking per decision |
| Observability | Access logs | Structured request + routing + worker event stream |
| Policy testing | None | Offline simulation with synthetic workloads |
| Routing strategy | N/A | Pluggable: cost, latency, capability, affinity |

---

## Key capabilities

- **Policy-driven routing** — pluggable strategies (cost, latency, capability, affinity) select the best (model, worker) pair from live registries
- **Candidate scoring** — multi-dimensional weighted scoring with hard-constraint disqualification; full score breakdown stored in every decision record
- **Intake and queue abstraction** — requests enter through a structured intake flow, are enqueued, and trigger routing asynchronously
- **Model and worker registries** — typed catalog with filtering, capability matching, heartbeat-driven health tracking, and eviction
- **Decision history** — every routing decision is persisted with full candidate evaluation detail for audit and replay
- **WebSocket event stream** — real-time `requests`, `workers`, `routing`, and `decisions` channels over a subscription-based gateway
- **Simulation engine** — runs N synthetic routing evaluations against any policy without touching live records or publishing stream events
- **Policy experiment runner** — compares multiple policies under identical synthetic workloads; ranks by success rate, fallback rate, and evaluation speed
- **Structured observability** — Pino JSON logs with `x-request-id` correlation on every log line, propagated across the full request lifecycle
- **Zod-validated config** — all environment variables parsed and type-checked at startup with a clear diagnostic on misconfiguration

---

## Architecture

```
Clients / dashboards
       │
       ├── POST /api/v1/intake/requests   ← inference request acceptance
       ├── WebSocket /api/v1/stream       ← real-time event subscriptions
       └── GET/POST /api/v1/*             ← registry, routing, metrics, simulation APIs
              │
    ┌─────────▼──────────────────────────────────────────────────────┐
    │                      Fastify HTTP Server                        │
    │  requestId middleware · errorHandler · contextPlugin            │
    └─────────┬──────────────────────────────────────────────────────┘
              │
    ┌─────────▼──────────────┐   ┌───────────────────────────────────┐
    │    IntakeService        │   │       Stream Gateway (WS)         │
    │  validate → persist →  │   │  ConnectionRegistry               │
    │  enqueue → publish     │──▶│  InMemoryStreamBroker             │
    └─────────┬──────────────┘   │  channels: requests/workers/      │
              │                  │           routing/decisions        │
    ┌─────────▼──────────────┐   └───────────────────────────────────┘
    │    InMemoryJobQueue     │              ▲   ▲   ▲
    └─────────┬──────────────┘              │   │   │
              │                       publishes events
    ┌─────────▼──────────────┐              │   │   │
    │  JobRoutingService      │─────────────┘   │   │
    │  JobLifecycleService    │                 │   │
    └─────────┬──────────────┘                 │   │
              │                                │   │
    ┌─────────▼──────────────┐                 │   │
    │  RoutingDecisionService │─────────────────┘   │
    │  · resolvePolicy()      │                     │
    │  · evaluateModels()     │                     │
    │  · evaluateWorkers()    │                     │
    │  · persistDecision()    │                     │
    └─────────┬──────────────┘                     │
              │                                     │
    ┌─────────▼──────────────┐                     │
    │  WorkersService         │─────────────────────┘
    │  · register/heartbeat   │
    │  · health eviction      │
    └────────────────────────┘
```

See [docs/architecture.md](docs/architecture.md) for the full module map, data flows, and dependency conventions.

---

## Frontend dashboard

InferMesh ships with a React + TypeScript admin console at [`frontend/`](frontend/).

The dashboard connects to this backend over REST and WebSocket and provides:
- Live request, routing-decision, and worker-heartbeat streams
- Filterable request log, worker health cards, and model registry grid
- Analytics charts (throughput, latency percentiles, cost breakdown)
- Interactive offline simulation — single-run and multi-policy experiment comparison

See [frontend/README.md](frontend/README.md) for setup instructions, the recommended demo walkthrough, and the frontend architecture overview.

---

## Quick start

**Prerequisites:** Node.js 22+, npm

```bash
# 1. Install dependencies
npm install

# 2. Configure environment (all variables have safe defaults)
cp .env.example .env

# 3. Start with hot reload
npm run dev

# 4. Confirm the server is running
curl http://localhost:3000/health
# → { "success": true, "data": { "status": "ok" } }
```

---

## Recommended demo flow

Get a fully populated local system in under 3 minutes:

```bash
# Terminal 1 — start the server
npm run dev

# Terminal 2 — seed with demo models, workers, policy, and requests
npm run seed
```

The seed script registers 3 models, 3 workers, creates and activates a cost-optimised routing policy, submits 5 inference requests, routes 3 jobs, then prints a state summary.

After seeding, explore the live system:

```bash
# Routing decisions with full candidate score breakdowns
curl http://localhost:3000/api/v1/routing/decisions | jq .

# Cross-module system stats
curl http://localhost:3000/api/v1/stats/summary | jq .

# Registered workers and their capacity
curl http://localhost:3000/api/v1/workers | jq .

# Run an offline policy comparison experiment (no live state changes)
curl -s -X POST http://localhost:3000/api/v1/simulation/experiments \
  -H "Content-Type: application/json" \
  -d '{
    "experimentName": "cost-vs-latency",
    "policies": ["cost-optimised", "latency-optimised"],
    "workloadConfig": { "requestCount": 50, "randomSeed": 42 }
  }' | jq .data.winner
```

See [docs/api-examples.md](docs/api-examples.md) for complete copy-paste examples for every route.

---

## Repository map

```
infermesh/
├── src/
│   ├── main.ts                    # Entry point: boot, listen, shutdown hooks
│   ├── app/
│   │   ├── server.ts              # Fastify factory (plugins, hooks, error handler)
│   │   └── routes.ts              # Central route registry — all module wiring
│   ├── core/                      # Cross-cutting: config, context, errors, logger, shutdown
│   ├── shared/
│   │   ├── contracts/             # All cross-module domain types + Zod schemas
│   │   └── primitives.ts          # Branded IDs, BaseEntity, IsoTimestamp
│   ├── infra/
│   │   └── health/                # GET /health liveness probe
│   ├── stream/                    # WebSocket pub/sub gateway + InMemoryStreamBroker
│   └── modules/
│       ├── intake/                # POST /intake/requests — acceptance + enqueue + publish
│       ├── requests/              # GET /requests — request read model
│       ├── models/                # GET/POST/PATCH/DELETE /models — model registry
│       ├── workers/               # GET/POST/PATCH/DELETE /workers — worker registry + heartbeat
│       ├── jobs/                  # GET /jobs, POST /jobs/:id/route — job lifecycle + routing
│       ├── routing/               # GET/POST/PATCH /routing/policies|decisions — policy engine
│       ├── metrics/               # GET /metrics/* — analytics aggregation
│       ├── stats/                 # GET /stats/summary — cross-module system stats
│       ├── simulation/            # POST /simulation/runs|experiments — offline evaluation
│       └── queue/                 # GET /queue — internal queue inspection
├── docs/                          # Architecture, configuration, API examples, runbooks, …
├── scripts/
│   ├── seed.ts                    # Demo seed script (npm run seed)
│   └── smoke.ts                   # Server startup validation (npm run smoke)
└── test/
    └── builders/                  # Shared test factory functions
```

Each module under `src/modules/` follows the same internal layout: `repository/` → `service/` → `routes/`, with its public surface defined by `index.ts`.

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start with hot reload (tsx watch) |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm start` | Run compiled output |
| `npm run seed` | Seed a running local server with demo data |
| `npm run lint` | ESLint with TypeScript strict rules |
| `npm run lint:fix` | ESLint with auto-fix |
| `npm run typecheck` | Full type check without emitting |
| `npm test` | Vitest full test suite (635 tests, 27 files) |
| `npm run test:unit` | Unit tests only |
| `npm run test:integration` | Integration tests only |
| `npm run test:coverage` | Tests with coverage report |
| `npm run smoke` | Boot server + validate `/health` |

Full CI gate locally:

```bash
npm run lint && npm run typecheck && npm test && npm run build && npm run smoke
```

---

## API surface

All responses use a consistent JSON envelope:

```jsonc
// Success
{ "success": true, "data": { … }, "meta": { "requestId": "uuid", "timestamp": "iso" } }

// Error
{ "success": false, "error": { "code": "NOT_FOUND", "message": "…" }, "meta": { … } }
```

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness probe |
| `POST` | `/api/v1/intake/requests` | Accept an inference request (202) |
| `GET` | `/api/v1/requests` | List inference requests (paginated) |
| `GET` | `/api/v1/requests/:id` | Fetch a single request |
| `GET/POST/PATCH/DELETE` | `/api/v1/models` | Model registry CRUD |
| `GET/POST/DELETE` | `/api/v1/workers` | Worker registry |
| `POST` | `/api/v1/workers/:id/heartbeat` | Worker heartbeat + runtime metrics |
| `GET/POST/PATCH` | `/api/v1/routing/policies` | Routing policy management |
| `GET` | `/api/v1/routing/decisions` | Decision history with score breakdowns |
| `GET` | `/api/v1/jobs` | List jobs (paginated) |
| `POST` | `/api/v1/jobs/:id/route` | Trigger routing for a queued job |
| `GET` | `/api/v1/metrics/summary` | System-wide summary + period-over-period trends |
| `GET` | `/api/v1/metrics/time-series` | Bucketed time-series data |
| `GET` | `/api/v1/metrics/latency-percentiles` | p50/p75/p95/p99 breakdown |
| `GET` | `/api/v1/metrics/cost-breakdown` | Per-model cost allocation |
| `GET` | `/api/v1/stats/summary` | Cross-module system stats |
| `POST` | `/api/v1/simulation/runs` | Run a simulation against a policy |
| `POST` | `/api/v1/simulation/experiments` | Compare multiple policies under identical workload |
| `WS` | `/api/v1/stream` | Real-time event subscriptions |
| `GET` | `/api/v1/queue` | Internal queue inspection |

---

## Documentation

| Document | Contents |
|---|---|
| [docs/api-examples.md](docs/api-examples.md) | Copy-paste curl examples for every route + WebSocket subscription |
| [docs/architecture.md](docs/architecture.md) | Module map, request flow, routing flow, simulation flow, WebSocket flow |
| [docs/configuration.md](docs/configuration.md) | All environment variables with types, defaults, and cross-field rules |
| [docs/simulation.md](docs/simulation.md) | Simulation engine, workload generator, policy experiment runner |
| [docs/deployment.md](docs/deployment.md) | Topology, reverse proxy, WebSocket config, in-memory limitations |
| [docs/testing.md](docs/testing.md) | Test strategy, integration test patterns, isolation approach |
| [docs/ci.md](docs/ci.md) | GitHub Actions pipeline, available commands, smoke test |
| [docs/runbooks.md](docs/runbooks.md) | Troubleshooting for startup, routing, streaming, and CI issues |

---

## Limitations and future work

InferMesh is a backend infrastructure project, intentionally scoped to the routing, orchestration, and evaluation plane. The following are known boundaries:

| Area | Current state | Production path |
|---|---|---|
| **Persistence** | All state is in-memory — restarts clear everything | Swap `InMemory*Repository` implementations for PostgreSQL/Redis behind the existing `I*Repository` interfaces |
| **Authentication** | `AUTH_ENABLED=false` by default; JWT plumbing is stubbed | Enable `AUTH_ENABLED=true`, set `JWT_SECRET`, implement JWT middleware against the existing hook points |
| **Worker execution** | InferMesh routes jobs but does not execute them — workers are external processes | Implement a worker SDK that registers with InferMesh, polls for dispatch events, and reports completions |
| **Metrics ingestion** | Aggregation layer exists; metric records are not yet written by the intake/completion path | Wire `requestsService` and worker completion callbacks to write `RequestMetricRecord` / `WorkerMetricRecord` on each completion |
| **Streaming completions** | WebSocket gateway streams routing events; token-by-token model output streaming is not implemented | Add a `streaming` channel to the stream gateway and pipe worker completion chunks through it |
| **Horizontal scale** | `InMemoryStreamBroker` is single-process | Swap broker for Redis Pub/Sub or Kafka; repository interfaces are already decoupled for this |

---

## Portfolio positioning

InferMesh demonstrates the engineering depth expected of an Applied AI Engineer or backend systems engineer building AI infrastructure:

- **Domain-driven design** — 10+ bounded-context modules with strict dependency boundaries; cross-module access only through shared contracts or injection
- **Pluggable strategy pattern** — routing strategies are swappable (cost, latency, affinity, canary) without modifying the scoring pipeline
- **Repository pattern** — `IJobRepository`, `IModelRepository`, `IWorkerRepository` etc. are interface-first; in-memory now, persistence-ready by design
- **Event-driven architecture** — `IStreamBroker` decouples event producers (intake, routing, workers) from consumers (WebSocket clients); injectable for testing
- **Simulation and offline evaluation** — experiment runner benchmarks policies under seed-deterministic synthetic workloads without polluting live state
- **Integration test coverage** — 78 route-level integration tests with `fastify.inject()` covering success paths, error envelopes, pagination, idempotency, and validation
- **Production-aware engineering** — Zod config validation at boot, graceful SIGINT/SIGTERM shutdown, structured Pino logging with correlation IDs, CI with smoke validation
