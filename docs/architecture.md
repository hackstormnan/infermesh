# InferMesh — Architecture Reference

## Overview

InferMesh is a policy-driven AI inference routing backend. It accepts AI inference
requests, routes them to the most appropriate (model, worker) pair based on
configurable policies, proxies the response back to the caller, and records
telemetry for observability and simulation.

---

## Layer Map

```
┌─────────────────────────────────────────────────────────────┐
│  API Layer  (Fastify routes, request validation, responses) │
├─────────────────────────────────────────────────────────────┤
│  Module Layer  (domain business logic — one module per      │
│  bounded context: requests, workers, models, routing, ...)  │
├─────────────────────────────────────────────────────────────┤
│  Shared Layer  (contracts, primitives, API envelope,        │
│  response helpers — no business logic, no side-effects)     │
├─────────────────────────────────────────────────────────────┤
│  Infra Layer  (health, middleware, future: DB, queue, cache) │
└─────────────────────────────────────────────────────────────┘
```

Dependencies flow **downward only**. Modules depend on `shared/`; they never
import from other modules directly. Cross-module communication happens through
shared contract types and (in future) internal events.

---

## Module Responsibilities

### `modules/requests`
Entry point for all AI inference workloads.
- Validates and persists incoming `InferenceRequest` entities
- Owns the request state machine: `queued → dispatched → streaming → completed | failed | cancelled`
- Calls the routing module to get a `RoutingDecision`, then creates a `Job`
- Updates request state based on `JobCompletedEvent`s

### `modules/workers`
The registry of inference executors.
- Accepts worker self-registration and periodic heartbeats
- Maintains real-time `WorkerCapacity` (activeJobs, queuedJobs, maxConcurrent)
- Marks workers `unhealthy` when heartbeat deadlines are missed
- Exposes worker state to the routing module for placement scoring

### `modules/models`
The catalog of available AI models.
- Maintains model metadata: provider, context window, pricing, latency profile, capabilities
- Supports model aliases (`claude-sonnet` → `claude-sonnet-4-6`)
- Controls model lifecycle (`active → deprecated`)
- Exposes lookup APIs used by the routing engine to score candidates

### `modules/routing`
The policy-driven placement engine — the core differentiator of InferMesh.
- Maintains named `RoutingPolicy` configurations (strategy + constraints)
- On each request, queries workers and models, scores all (model, worker) candidates
- Returns a `RoutingDecision` with the winning candidate and a full audit trail
- Supports pluggable strategies: round-robin, least-loaded, cost-optimised, latency-optimised, affinity, canary

### `modules/metrics`
Observability and aggregated telemetry.
- Consumes `RequestMetricRecord` and `WorkerMetricRecord` write events
- Aggregates them over configurable `MetricWindow`s into `AggregatedMetrics`
- Exposes Prometheus-compatible scrape endpoint and JSON read APIs
- Provides `ModelSnapshot` and `WorkerSnapshot` for dashboards and simulation

### `modules/simulation`
Load testing and policy backtesting without real infrastructure.
- Accepts a `SimulationConfig` (traffic profile + routing policy + virtual workers)
- Generates synthetic requests via a Poisson arrival process, or replays recorded traces
- Runs the routing engine against the virtual worker pool
- Produces `AggregatedMetrics` for comparison across policy configurations

### `modules/stream`
Token-by-token streaming response proxy.
- Establishes connections to model backends that support streaming
- Emits `StreamEvent` payloads (delta, stop, usage, error) to the caller over SSE or WebSocket
- Handles backpressure, client disconnects, and timeout
- Reports `UsageReportEvent` to the metrics module on stream close

---

## Shared Contracts (`src/shared/`)

### Why shared contracts are separate from implementation

Shared contracts define the **domain language** of InferMesh. They are the nouns
and verbs every module speaks — without any business logic attached.

**Separating contracts from implementation provides:**

1. **Stable import targets** — Modules import `InferenceRequest` from `shared/contracts`,
   not from each other. Refactoring one module's internals never breaks another.

2. **Enforced boundaries** — A module that only imports from `shared/` cannot
   accidentally call another module's internal functions, which would create hidden coupling.

3. **Single source of truth** — `RequestStatus.Completed` is defined once and means
   the same thing to the requests module, the routing module, the metrics module, and
   the simulation module.

4. **Testability** — Tests can construct any domain object using contract types
   without importing any implementation — no side-effects, no circular dependencies.

5. **Documentation by design** — The contracts file is the first place a new contributor
   reads to understand a domain concept. Types, enums, and Zod schemas at the top level
   are more discoverable than types scattered across service files.

### What lives in `shared/`

| File / Folder | Contents |
|---|---|
| `types.ts` | API response envelope: `ApiSuccessBody`, `ApiErrorBody`, `ResponseMeta` |
| `response.ts` | Response builder helpers: `successResponse()`, `buildMeta()` |
| `primitives.ts` | Branded ID types, `IsoTimestamp`, `PaginationQuery`, `PaginatedResponse`, `BaseEntity` |
| `contracts/request.ts` | `InferenceRequest`, `RequestStatus`, `CreateInferenceRequestDto`, Zod schemas |
| `contracts/job.ts` | `Job`, `JobStatus`, `JobPriority`, `JobEvent` payloads |
| `contracts/model.ts` | `Model`, `ModelStatus`, `ModelProvider`, `ModelCapability`, `RegisterModelDto` |
| `contracts/worker.ts` | `Worker`, `WorkerStatus`, `RegisterWorkerDto`, `WorkerHeartbeatDto` |
| `contracts/routing.ts` | `RoutingPolicy`, `RoutingDecision`, `RoutingStrategy`, `RoutingConstraints` |
| `contracts/metrics.ts` | `RequestMetricRecord`, `WorkerMetricRecord`, `AggregatedMetrics`, `MetricWindow` |
| `contracts/simulation.ts` | `SimulationConfig`, `SimulationResult`, `TrafficProfile`, `SimulatedWorker` |
| `contracts/stream.ts` | `StreamEvent` discriminated union, `StreamSession`, `StopReason` |

### What does NOT live in `shared/`

- Business logic (service functions, state machines, algorithms)
- Repository / database access
- HTTP route handlers
- Module-private types used only within one module
- Infrastructure concerns (queues, caches, external clients)

---

## Module Dependency Graph

```
                        ┌─────────────┐
                        │   requests  │
                        └──────┬──────┘
                               │ creates Job via
                               ▼
          ┌──────────┐   ┌─────────────┐   ┌─────────┐
          │  models  │◄──│   routing   │──►│ workers │
          └──────────┘   └──────┬──────┘   └────┬────┘
                                │               │
                         decisions          heartbeats
                                │               │
                         ┌──────▼───────────────▼──────┐
                         │           metrics            │
                         └──────────────────────────────┘
                                        │
                                 snapshots for
                                        │
                         ┌──────────────▼──────────────┐
                         │          simulation          │
                         └─────────────────────────────┘

          ┌───────────────────────────────────────────┐
          │                  stream                   │
          │  (reads: requests, workers, models)        │
          │  (writes: UsageReportEvent → metrics)      │
          └───────────────────────────────────────────┘

          ═══════════════════════════════════════════
          All arrows pass through shared/contracts —
          no module imports from another module's src
          ═══════════════════════════════════════════
```

---

## Naming Conventions

| Pattern | Example | Meaning |
|---|---|---|
| `FooEntity` / `Foo` | `InferenceRequest`, `Worker` | Internal domain entity |
| `FooDto` | `InferenceRequestDto`, `WorkerDto` | API response projection |
| `CreateFooDto` | `CreateInferenceRequestDto` | Validated API input (from Zod) |
| `FooEvent` | `JobDispatchedEvent`, `TokenDeltaEvent` | Internal or stream event payload |
| `FooStatus` | `RequestStatus`, `WorkerStatus` | State machine enum |
| `FooSchema` | `createInferenceRequestSchema` | Zod schema for runtime validation |
| `FooId` | `RequestId`, `WorkerId` | Branded ID type |

---

## Requests Module — Internal Structure

```
src/modules/requests/
  queries.ts                         — ListRequestsQuery Zod schema + type
  repository/
    IRequestRepository.ts            — repository port (interface)
    InMemoryRequestRepository.ts     — in-memory adapter (development / tests)
  service/
    requests.service.ts              — service layer; owns business logic
  routes/
    requests.route.ts                — Fastify plugin factory (read-only routes)
  index.ts                           — public barrel; wires repo → service → route
```

### Design decisions

**Repository port pattern** — `RequestsService` depends on `IRequestRepository`, not the
concrete `InMemoryRequestRepository`. Swapping in a Postgres/Redis adapter requires only
changing the binding in `index.ts`.

**Service as the only access point** — Route handlers call `service.getById()` and
`service.list()`; they never import the repository. This keeps HTTP concerns (parsing,
status codes, serialization) fully separate from persistence concerns.

**Zod at the route boundary** — Query string params are coerced and validated by
`listRequestsQuerySchema.parse()` inside the handler. Fastify schema (JSON Schema) is
defined for OpenAPI / fast-json-stringify compatibility; Zod provides the richer enum
validation and `coerce` behaviour for page/limit.

**Mapper function** — `toDto()` is a pure function co-located with the service that
projects the internal `InferenceRequest` entity to the public `InferenceRequestDto`.
Separating entity from DTO means internal fields can be added without affecting the API.

**Future extension points** — `RequestsService.create()` is implemented and ready to be
connected to `POST /requests` in Ticket 6, once the intake pipeline (queueing, routing,
worker dispatch) is in place. The entity model already carries optional `jobId`,
`tokensIn`, `tokensOut`, `firstTokenAt`, and `completedAt` for downstream linkage.

---

## Models Module — Internal Structure

```
src/modules/models/
  queries.ts                         — ListModelsQuery (status, provider, capability, qualityTier, name prefix)
  repository/
    IModelRepository.ts              — repository port (interface)
    InMemoryModelRepository.ts       — dual-index Map adapter (byId + byName)
  service/
    models.service.ts                — service layer; owns business logic + toDto mapper
  routes/
    models.route.ts                  — buildModelsRoute factory (read-only)
  index.ts                           — public barrel; wires repo → service → route
```

### Extended model metadata (added in Ticket 5)

The shared `Model` entity was extended with four routing-relevant fields:

| Field | Type | Purpose |
|---|---|---|
| `version` | `string?` | Provider model version string |
| `maxOutputTokens` | `number` | Max completion tokens; separate from `contextWindow` |
| `qualityTier` | `QualityTier` enum | Frontier / Standard / Economy — used by quality-aware routing strategies |
| `supportedTasks` | `ModelTask[]` | Task types the model excels at — used for task-aware routing |

### Design decisions

**Dual name index** — `InMemoryModelRepository` maintains a secondary `byName` Map alongside the primary `byId` Map. This gives O(1) alias resolution without scanning, which the routing engine will call on every request.

**Name uniqueness enforced in the service** — The repository is kept simple (no deduplication logic). Conflict detection happens in `ModelsService.register()` before the entity is persisted, following the same "service owns business rules" pattern as the requests module.

**`metadata` excluded from ModelDto** — The `metadata` field (provider-specific configuration) is intentionally omitted from the API response. It may contain API keys, internal routing hints, or other fields not safe to expose to callers.

**Write routes deferred** — `register()` and `update()` are implemented in the service and ready to connect. `POST /models` and `PATCH /models/:id` will be wired in a later ticket alongside admin authentication guards.

---

## Workers Module — Internal Structure

```
src/modules/workers/
  queries.ts                         — ListWorkersQuery (status, region, name prefix, id prefix)
  repository/
    IWorkerRepository.ts             — repository port (interface)
    InMemoryWorkerRepository.ts      — dual-index Map adapter (byId + byName)
  service/
    workers.service.ts               — service layer; owns business logic + toDto mapper
  routes/
    workers.route.ts                 — buildWorkersRoute factory (read-only)
  index.ts                           — public barrel; wires repo → service → route
```

### Extended worker metadata (added in Ticket 6)

The shared `Worker` entity was extended with two new value objects:

**`WorkerHardware`** (static, set at registration):
| Field | Type | Purpose |
|---|---|---|
| `instanceType` | `string` | Cloud instance or hardware label (e.g. "g4dn.xlarge", "cpu-only") |
| `gpuModel` | `string?` | GPU model name; absent for CPU-only workers |

**`WorkerRuntimeMetrics`** (dynamic, updated on every heartbeat):
| Field | Type | Purpose |
|---|---|---|
| `tokensPerSecond` | `number?` | Observed throughput |
| `loadScore` | `number?` | 0.0–1.0 composite load; primary routing signal |
| `ttftMs` | `number?` | Observed time-to-first-token |
| `cpuUsagePercent` | `number?` | CPU utilisation (0–100) |
| `memoryUsagePercent` | `number?` | Memory utilisation (0–100) |
| `uptimeSeconds` | `number?` | Worker process uptime |

### Design decisions

**Separate static vs dynamic metadata** — `WorkerHardware` (set at registration, `readonly` on entity) is never mutated. `WorkerRuntimeMetrics` (mutable, updated via heartbeat) is deep-merged in `InMemoryWorkerRepository.update()` so a partial heartbeat doesn't erase previously reported values.

**Heartbeat as a unified update** — `WorkersService.heartbeat()` applies status, capacity, lastHeartbeatAt, and runtimeMetrics in a single repository write. The routing engine always sees a consistent snapshot.

**Name uniqueness enforced in the service** — Same pattern as the models module: conflict detection happens before persistence so the repository stays simple.

**Write routes deferred** — `register()`, `heartbeat()`, and `deregister()` are implemented in the service. `POST /workers`, `POST /workers/:id/heartbeat`, and `DELETE /workers/:id` will be wired in Ticket 8 alongside heartbeat eviction.

---

## Routing Module — Internal Structure

```
src/modules/routing/
  queries.ts                         — ListPoliciesQuery + ListDecisionsQuery
  repository/
    IPolicyRepository.ts             — mutable CRUD port for RoutingPolicy
    IDecisionRepository.ts           — append-only port for RoutingDecision
    InMemoryPolicyRepository.ts      — Map + name index; auto-increments version on update
    InMemoryDecisionRepository.ts    — Map + requestId index; never mutates after save
  service/
    routing.service.ts               — all policy/decision operations + evaluate() stub
  routes/
    routing.route.ts                 — buildRoutingRoute factory (read-only, 4 endpoints)
  index.ts                           — public barrel; wires repos → service → route
```

### Extended routing contracts (added in Ticket 7)

**New enums:**
- `RoutingPolicyStatus` — Active | Inactive | Archived
- `DecisionSource` — Live | Simulation

**New value objects:**
- `StrategyWeights` — {quality, cost, latency, load} coefficients for weighted scoring
- `ScoreBreakdown` — structured per-candidate score ({quality, cost, latency, load, total, rationale})

**Updated `RoutingPolicy`** — promoted from plain value object to a proper entity extending `BaseEntity`:
| Field | Purpose |
|---|---|
| `id: PolicyId` | UUID assigned at creation |
| `weights: StrategyWeights` | Scoring dimension weights for the strategy |
| `priority: number` | Tie-breaking when multiple active policies match |
| `version: number` | Bumped on every update; enables decision ↔ policy version audit |
| `status: RoutingPolicyStatus` | Only Active policies are applied |

**Updated `RoutingDecision`** — promoted to a proper entity:
| Field | Purpose |
|---|---|
| `id: DecisionId` | UUID for the decision record itself |
| `policyId: PolicyId` | Which policy (and version) produced this decision |
| `usedFallback: boolean` | Whether primary strategy failed and fallback was applied |
| `fallbackReason?: string` | Why fallback was triggered |
| `decisionSource: DecisionSource` | Live traffic vs simulation run |

**Updated `RoutingCandidate`** — `scoreBreakdown` replaced from `string` to `ScoreBreakdown` object.

Also added `PolicyId` and `DecisionId` branded types to `shared/primitives.ts`.

### Design decisions

**Two repositories, one service** — `IPolicyRepository` (mutable CRUD) and `IDecisionRepository` (append-only log) are separate ports. This makes the immutability of decisions explicit at the type level and enables them to be independently scaled or persisted to different backends (e.g. policies in Postgres, decisions in S3 / time-series DB).

**requestId secondary index in InMemoryDecisionRepository** — a single inference request may map to multiple decisions (retries, simulation runs). The index maps requestId → [decisionId, ...] for O(1) filtering when requestId is the only query filter.

**version auto-increment in InMemoryPolicyRepository** — the repository bumps `version` on every `update()` call. This means a decision record can always be traced back to the exact policy version that produced it, enabling historical replay.

**evaluate() stub** — `RoutingService.evaluate()` is typed and documented but throws `"not yet implemented"`. Ticket 8 will fill in the placement algorithm: model resolution → worker collection → constraint filtering → weighted scoring → winner selection → decision persistence.
