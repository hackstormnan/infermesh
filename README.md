# InferMesh

![CI](https://github.com/your-org/infermesh/actions/workflows/ci.yml/badge.svg)

**InferMesh** is a policy-driven AI inference routing backend. It accepts incoming AI inference requests, evaluates live model and worker candidates against configurable routing policies, selects the optimal placement, and streams real-time status events to connected dashboards — all without coupling request acceptance to model execution.

---

## What problem does it solve?

A basic AI gateway proxies requests to a single model endpoint. InferMesh is one layer above that:

| Concern | Basic gateway | InferMesh |
|---|---|---|
| Model selection | Static, per-route | Policy-driven, multi-candidate scoring |
| Worker placement | None | Load- and capability-aware worker selection |
| Fallback | Manual retry | Structured fallback tracking per decision |
| Observability | Access logs | Structured request + routing + worker stream |
| Policy testing | None | Offline simulation with synthetic workloads |
| Routing strategy | N/A | Pluggable: cost, latency, capability, affinity |

---

## Major capabilities

- **Policy-driven routing** — pluggable strategies (cost, latency, capability, affinity) select the best (model, worker) pair from live registries
- **Candidate scoring** — multi-dimensional weighted scoring with hard-constraint disqualification and full score breakdown in decision records
- **Intake and queue abstraction** — requests enter through a structured intake flow, are enqueued, and trigger routing asynchronously
- **Model and worker registries** — typed catalog with filtering, capability matching, health eviction, and heartbeat-driven status tracking
- **Decision history** — every routing decision is persisted with full candidate evaluation detail for audit and replay
- **WebSocket event stream** — real-time `requests`, `workers`, `routing`, and `decisions` channels over a subscription-based gateway
- **Simulation engine** — runs N synthetic routing evaluations against any policy without creating live records or publishing stream events
- **Policy experiment runner** — compares multiple policies under identical synthetic workloads; ranks by success rate, fallback rate, and evaluation speed
- **Structured observability** — Pino JSON logs with request-ID correlation on every log line; `x-request-id` header propagated across the full lifecycle
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

## Quick start

**Prerequisites:** Node.js 22, npm

```bash
# 1. Install dependencies
npm install

# 2. Configure environment (all vars have safe defaults)
cp .env.example .env

# 3. Start with hot reload
npm run dev

# 4. Verify the server is up
curl http://localhost:3000/health
```

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start with hot reload (tsx watch) |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm start` | Run compiled output |
| `npm run lint` | ESLint with TypeScript strict rules |
| `npm run lint:fix` | ESLint with auto-fix |
| `npm run typecheck` | Full type check without emitting |
| `npm test` | Vitest test suite |
| `npm run test:coverage` | Tests with coverage report |
| `npm run smoke` | Boot server + validate `/health` |

To replicate the full CI gate locally:

```bash
npm run lint && npm run typecheck && npm test && npm run build && npm run smoke
```

---

## API surface

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness probe |
| `POST` | `/api/v1/intake/requests` | Accept an inference request |
| `GET` | `/api/v1/requests` | List inference requests |
| `GET/POST/PATCH/DELETE` | `/api/v1/models` | Model registry |
| `GET/POST/PATCH/DELETE` | `/api/v1/workers` | Worker registry |
| `GET/POST/PATCH/DELETE` | `/api/v1/routing/policies` | Routing policies |
| `GET` | `/api/v1/routing/decisions` | Decision history |
| `POST` | `/api/v1/jobs/:id/route` | Trigger routing for a queued job |
| `GET` | `/api/v1/metrics` | Aggregated request metrics |
| `GET` | `/api/v1/stats` | Cross-module system stats |
| `POST` | `/api/v1/simulation/runs` | Run a simulation |
| `POST` | `/api/v1/simulation/experiments` | Run a policy experiment |
| `WS` | `/api/v1/stream` | Real-time event stream |

All responses use a consistent JSON envelope:

```jsonc
// Success
{ "success": true, "data": { ... }, "meta": { "requestId": "uuid", "timestamp": "iso" } }

// Error
{ "success": false, "error": { "code": "NOT_FOUND", "message": "..." }, "meta": { ... } }
```

---

## Documentation

| Document | Contents |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Module map, request flow, routing flow, simulation flow, WebSocket flow |
| [docs/configuration.md](docs/configuration.md) | All environment variables with types, defaults, and cross-field rules |
| [docs/deployment.md](docs/deployment.md) | Topology, reverse proxy, WebSocket, in-memory limitations, production guidance |
| [docs/simulation.md](docs/simulation.md) | Simulation engine, workload generator, policy experiment runner |
| [docs/ci.md](docs/ci.md) | CI pipeline, available commands, smoke test |
| [docs/runbooks.md](docs/runbooks.md) | Troubleshooting for startup, routing, streaming, and CI issues |

---

## What this demonstrates

InferMesh is a purpose-built backend platform for applied AI infrastructure. It covers:

- **Domain modelling** — typed contracts and bounded-context isolation across 10+ domain modules
- **Pluggable strategy pattern** — routing strategies are swappable without changing the evaluation pipeline
- **Repository pattern** — `IJobRepository`, `IModelRepository`, `IWorkerRepository` etc. — in-memory now, persistence-ready
- **Event-driven architecture** — stream broker decouples producers (intake, routing, workers) from consumers (WebSocket clients)
- **Simulation and offline evaluation** — experiment runner compares policies under identical synthetic workloads with seed-deterministic generation
- **Production-aware engineering** — Zod config validation at boot, graceful shutdown, structured logging with correlation IDs, CI with smoke validation
