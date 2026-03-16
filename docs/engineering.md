# Engineering Deep Dive

An explanation of the system design and engineering decisions behind InferMesh, written for backend engineers and technical reviewers.

---

## 1. System Overview

InferMesh is a **routing and orchestration plane** for AI inference workloads. It sits one layer above a basic API gateway: rather than forwarding requests to a single model endpoint, it scores live candidates across multiple models and workers under configurable routing policies, then records a structured placement decision.

The system deliberately separates three concerns that are often conflated:

| Concern | InferMesh responsibility | Left to external systems |
|---|---|---|
| **Request acceptance** | Validate, persist, enqueue, ack | — |
| **Placement decision** | Policy resolution, candidate scoring, worker selection | — |
| **Request execution** | — | External worker processes |

This separation is not an incomplete implementation — it is a deliberate boundary. InferMesh is the routing plane; workers are external processes that register themselves and report capacity via heartbeats. The routing engine selects the optimal (model, worker) pair based on live state; it does not issue work or await completions.

The consequence is that the routing engine is fully testable without real AI infrastructure, and simulation (offline evaluation without live state changes) falls out naturally from the same decoupled architecture.

---

## 2. Request Lifecycle

### State machine

Every request in InferMesh moves through a deterministic job state machine:

```
                 ┌─────────────────────────────────────────────────────┐
POST /intake     │                                                     │
─────────────>   Queued ──> Routing ──> Assigned ──> Dispatched ──> Succeeded
                              │                                        │
                              └──> Failed ──> Retrying ──┘         (external)
                                    (terminal if maxAttempts exhausted)
```

**Intake** (`POST /api/v1/intake/requests`) is intentionally minimal. `IntakeService` runs four steps synchronously and returns 202 immediately:

1. Validate request body (Zod schema)
2. Create `InferenceRequest` record
3. Create linked `Job` record in `Queued` status
4. Publish `RequestAcceptedPayload` to the stream broker (best-effort — never blocks acceptance)

The 202 response carries `{ requestId, jobId }`. Routing happens asynchronously; the intake endpoint never waits for placement.

### Why routing is decoupled from acceptance

Coupling intake to routing would mean that slow or failing routing decisions delay request acknowledgement and create back-pressure at the entry point. Decoupling lets InferMesh accept bursts, handle routing capacity constraints independently, and retry routing without re-accepting the request.

The current implementation requires callers to explicitly trigger routing via `POST /api/v1/jobs/:id/route`. The architecture is designed for a queue consumer loop that dequeues job IDs and calls the routing orchestrator — that wiring is a planned extension.

### State guards

Every state transition is enforced by `JobLifecycleService`. Transitions are only valid from specific states:

- `moveToRouting()` — only from `Queued`
- `assignJob()` — only from `Routing`
- `failJob()` — from `Routing` or `Retrying`
- `retryJob()` — only from `Failed`

Attempting a transition from an invalid state throws `InvalidStateTransitionError`. This prevents double-routing races and makes state history inspectable.

---

## 3. Routing Algorithm

### Two-stage evaluation

Routing proceeds in two sequential stages. The stages are ordered this way because worker eligibility is model-dependent — a worker is only a candidate if it supports the selected model. Evaluating workers before selecting a model would require cross-product scoring across all (model, worker) combinations.

```
Stage 1 — Model selection
  findEligible(modelFilter)          → ModelCandidate[]     (registry layer)
  evaluateModels(candidates, profile) → ModelScoreResult[]  (scoring layer)
  select bestModel = first eligible  (score desc, id asc)

Stage 2 — Worker selection (scoped to bestModel)
  findEligible({ requiredModelId: bestModel.id, ...workerFilter })
                                     → WorkerCandidate[]    (registry layer)
  evaluateWorkers(candidates, profile) → WorkerScoreResult[] (scoring layer)
  select bestWorker = first eligible (score desc, id asc)
```

### Disqualification before scoring

Hard constraints are applied before computing scores. A disqualified candidate receives `totalScore = 0` and is sorted to the tail of the result list, but its disqualification reason is recorded verbatim in the decision for audit.

**Model disqualifications:**
- Missing any required capability
- Context window too small for the estimated input

**Worker disqualifications:**
- Status not `Idle` or `Busy`
- Heartbeat age > 2× staleness threshold (default: 2 × 60 s)

The separation of disqualification from scoring matters for debuggability: a decision record always explains why candidates were rejected, not just who won.

### Weighted scoring formula

```
total = Σ(weight_i × score_i) / Σ(weight_i)
```

Dividing by the sum of weights preserves `[0, 1]` range even when weights don't sum to 1 — a useful property because routing policies expose coarse-grained `StrategyWeights` (quality, cost, latency, load) that map to more granular per-dimension weights inside the evaluators.

**Model scoring dimensions** (defaults: quality 0.35, cost 0.25, latency 0.25, capabilityFit 0.15):

| Dimension | Signal | Normalisation |
|---|---|---|
| `quality` | Quality tier (frontier / standard / economy) | Static map: 1.0 / 0.5 / 0.0 |
| `cost` | Estimated request cost in USD | Min-max inverted — lowest cost → 1.0 |
| `latency` | Provider-reported TTFT | Min-max inverted — lowest TTFT → 1.0 |
| `capabilityFit` | Fraction of required capabilities matched | `matchCount / requiredCount` |

**Worker scoring dimensions** (defaults: load 0.30, queueDepth 0.20, throughput 0.15, latency 0.15, healthFitness 0.10, regionFit 0.05, heartbeatFreshness 0.05):

| Dimension | Signal | Normalisation |
|---|---|---|
| `load` | Composite load score from heartbeat | `1 - loadScore` |
| `queueDepth` | Jobs queued vs max concurrency | `max(0, 1 - queuedJobs / maxConcurrentJobs)` |
| `throughput` | Token output rate | Min-max ascending |
| `latency` | Worker-reported TTFT | Min-max inverted |
| `healthFitness` | Worker lifecycle status | Idle=1.0, Busy=0.7 |
| `regionFit` | Preferred region alignment | 1.0 match / 0.3 mismatch |
| `heartbeatFreshness` | Age of last heartbeat | Linear decay over threshold |

### Deterministic tie-breaking

Ties in `totalScore` are broken by `candidateId` ascending. This ensures routing decisions are reproducible under identical registry state — important for simulation replay and debugging. There is no randomisation in the selection path.

### Scoring vs selection separation

`CandidateEvaluatorService` **scores** — it does not select. `RoutingDecisionService` **selects** using the scored list. This allows:
- Simulation to reuse the exact same scoring logic without side effects
- Unit tests to test scoring dimensions in isolation from routing orchestration
- Future A/B analysis tools to inspect score distributions without triggering decisions

### Fallback and recovery

`RoutingRecoveryService` wraps the decision engine with structured failure classification and automatic fallback:

- **`NoEligibleWorker` → fallback**: Re-runs worker evaluation with an empty `workerProfile`, stripping soft preferences (region, freshness threshold) to widen the candidate pool. Model constraints and policy are unchanged. The decision record flags `usedFallback: true` with a reason string.
- **Retryable failures with attempts remaining**: Transitions the job through `Failed → Retrying` and surfaces a `RetryingJobOutcome` to the caller.
- **Terminal failures or exhausted retries**: Marks the job `Failed` permanently and re-throws.

The key design decision: model failures are **not** fallback-eligible. The model evaluator already scores all registered candidates — no relaxation of the model profile can help if every candidate is disqualified by hard capability constraints.

---

## 4. Worker Orchestration

### Three-layer separation

The worker domain is split across three layers with distinct responsibilities:

```
IWorkerRepository        — storage, indexed lookups (findAll, findById, findByName)
WorkersService           — admin CRUD, heartbeat processing, name uniqueness, deregistration
WorkerRegistryService    — eligibility filtering + WorkerCandidate projection for routing
```

All eligibility rules live exclusively in `WorkerRegistryService.applyFilter()`. Neither the repository nor the route handler contains any placement logic.

### Heartbeat model

Workers maintain their position in the candidate pool by sending periodic heartbeats to `POST /api/v1/workers/:id/heartbeat`. Each heartbeat carries runtime metrics:

```ts
interface WorkerHeartbeatInput {
  status:             WorkerStatus;     // Idle | Busy | Unhealthy | Offline
  activeJobs:         number;
  queuedJobs:         number;
  loadScore:          number;           // 0.0 idle, 1.0 saturated
  tokensPerSecond?:   number;
  ttftMs?:            number;
  cpuUsagePercent?:   number;
  memoryUsagePercent?: number;
}
```

`lastHeartbeatAt` is stamped server-side on every heartbeat. The evaluator uses it to compute `heartbeatFreshness` and to hard-disqualify workers whose heartbeat age exceeds 2× the staleness threshold.

### WorkerCandidate projection

The routing layer never sees raw `Worker` entities. `WorkerRegistryService.findEligible()` projects each passing worker onto a lean `WorkerCandidate`:

- `endpoint` is excluded — dispatch path is not the routing engine's concern
- `availableSlots` is pre-computed as `max(0, maxConcurrentJobs - activeJobs)`
- Candidates are pre-sorted by `availableSlots desc, loadScore asc, name asc` so routing can do a simple `find(r => r.eligible)` without re-sorting

This projection boundary is intentional: the routing engine receives only what it needs to make a placement decision, and the projection can evolve independently of the storage schema.

### Multi-dimensional filter

`WorkerAssignmentFilter` allows fine-grained pre-filtering before scoring:

```ts
interface WorkerAssignmentFilter {
  requiredModelId?:         string;       // must support this model
  requiredCapabilityTags?:  string[];     // must have all keys in labels map
  preferredRegion?:         string;       // case-insensitive exact match
  maxQueueSize?:            number;       // queuedJobs ≤ this
  maxLoadScore?:            number;       // 0–1
  minHeartbeatFreshnessMs?: number;       // lastHeartbeatAt within N ms
  statuses?:                WorkerStatus[]; // defaults to [Idle, Busy]
  instanceType?:            string;       // exact hardware match
  gpuRequired?:             boolean;      // must have gpuModel defined
}
```

Filtering here is cheap (O(n) scan over the in-memory pool) and narrows the candidate set before the scoring loop, avoiding unnecessary score computation for candidates that are structurally ineligible.

---

## 5. Simulation and Experiment System

### Isolation by construction

The simulation engine achieves isolation not through mocking, but through **dependency substitution at the service layer**:

```ts
// SimulationEngineService.run():
const scopedRepo    = new InMemoryDecisionRepository()   // fresh per run, discarded after
const scopedService = new RoutingDecisionService(
  ctx,
  scopedRepo,          // sim-scoped decisions — never mixed with live records
  null,                // no IStreamBroker — no WebSocket events published
  modelRegistryService,
  workerRegistryService,
  candidateEvaluatorService,
)
// routeN calls, then scopedRepo is garbage collected
```

This gives four hard isolation guarantees:
1. No `InferenceRequest` or `Job` records created — the live request/job repositories are never touched
2. No `RoutingDecision` records in the live store — the scoped repo is discarded after the run
3. No stream events published — no `IStreamBroker` is injected
4. All decisions carry `DecisionSource.Simulation` — zero audit trail contamination

The model and worker registries are read-only in simulation — candidate lists come from the live registries but no state is written back.

### Workload generator

`WorkloadGeneratorService` produces `SyntheticRequestProfile[]` from a statistical configuration:

```ts
interface WorkloadConfig {
  requestCount:           number;
  taskDistribution?:      { chat?: number; analysis?: number; reasoning?: number };
  inputSizeDistribution?: { small?: number; medium?: number; large?: number };
  complexityDistribution?:{ low?: number;  medium?: number;  high?: number  };
  burstPattern?:          { burstInterval: number; burstSize: number; ... };
  randomSeed?:            number;
}
```

Token counts are sampled from fixed ranges (e.g. medium/high: 3 000–5 000 tokens) using a mulberry32 PRNG seeded by `randomSeed` when provided. The same seed always produces the same profile array — critical for reproducible experiment comparison.

### Experiment runner and shared workload principle

The key design decision in the experiment system is that workload generation happens **once**:

```
ExperimentRunnerService.run()
  │
  ├── generateWorkload(config) → SyntheticRequestProfile[]   (generated once)
  │
  ├── for policy A: simulationEngine.run({ policyId: A, workloadProfiles: profiles })
  ├── for policy B: simulationEngine.run({ policyId: B, workloadProfiles: profiles })
  └── for policy C: simulationEngine.run({ policyId: C, workloadProfiles: profiles })
```

Each policy sees an **identical** request array. Differences in `successRate`, `fallbackRate`, and `averageEvaluationMs` across policies reflect policy behaviour — not sampling variance. Without this, comparing two runs with different seeds would be confounded by workload distribution differences.

### What simulation doesn't cover

- Worker capacity is not decremented between iterations — each request sees the same candidate pool
- No Poisson arrival modelling — requests are evaluated sequentially with equal weight
- HTTP max: 1 000 requests per simulation run; the service layer has no limit
- Results are ephemeral — returned synchronously, not stored

These are documented limitations, not oversights.

---

## 6. Observability

### Structured logging with correlation

Every log line carries a `requestId` field sourced from the HTTP `x-request-id` header (or generated server-side if absent). The ID propagates through every layer:

```
HTTP header: x-request-id: abc-123
  → RequestContext.requestId (Fastify decorator)
  → ctx.log.info({ ... })     (all service logs)
  → InferenceRequest.requestId (persisted)
  → Job.requestId (persisted)
  → RoutingDecision.requestId (persisted)
  → response header: x-request-id: abc-123
```

This allows cross-referencing a request through every log line, every entity, and the full routing decision history using a single ID.

Logging uses Pino with configurable `LOG_LEVEL` and `LOG_PRETTY`. In development, `LOG_PRETTY=true` enables human-readable output; in production, raw JSON is emitted for log aggregator ingestion.

### Real-time event stream

Four WebSocket channels give operational visibility into live system state:

| Channel | Emitted by | Payload |
|---|---|---|
| `requests` | `IntakeService` | New request accepted — requestId, jobId, status |
| `workers` | `WorkersService` | Registration, heartbeat, or deregistration |
| `routing` | `JobRoutingService` | Decision summary — outcome, selected IDs, evaluationMs |
| `decisions` | `RoutingDecisionService` | Full decision — reason, candidate counts, decisionSource |

The `IStreamBroker` interface is the only coupling between domain logic and the transport. Domain services call `broker.publish(channel, payload)` — they have no knowledge of WebSocket, connections, or serialisation. Replacing `InMemoryStreamBroker` with a Redis pub/sub backend is a one-line change in the wire-up, with zero changes to any call sites.

### Analytics metrics

The analytics layer computes dashboard metrics **on-demand** from live in-process state, not from a pre-aggregated time-series store:

```
GET /api/v1/metrics/*
  └── AnalyticsAggregationService
        ├── requestsService.list({ limit: 10_000 })
        ├── jobsService.list({ limit: 10_000 })
        └── modelsService.list({ limit: 10_000 })
              → aggregate in memory → dashboard DTO
```

This design is appropriate for the in-memory, single-process context. It would not scale to production request volumes without a pre-aggregation layer (InfluxDB, TimescaleDB, or a pre-computed rolling window).

Trend indicators compare the current period to the immediately preceding period of equal length (e.g. `24h` compares the last 24 h against the 24 h before that), computed from the same in-memory scan.

### Latency measurement scope

`avgLatencyMs` and percentile metrics measure `Job.completedAt - Job.startedAt` — execution time only. Queue wait time (`Job.queuedAt → Job.startedAt`) is excluded from latency metrics. This is a deliberate boundary: queue latency and execution latency have different causes and require different interventions.

---

## 7. Frontend Console Architecture

### Data layer: hooks as the module boundary

Every page has a corresponding hook that owns all data fetching, state, and transformation:

```
Page component  →  useXxxPage hook  →  apiClient  →  Backend REST API
                                    →  useStreamSocket →  WebSocket
```

Page components are purely presentational — they receive data, loading state, error state, and callbacks from the hook. This mirrors the backend's service-layer boundary: the route handler knows nothing about data fetching, and the page component knows nothing about HTTP.

### DTO → ViewModel adapters

All API responses flow through mapper functions before reaching any component:

```
GET /api/v1/models → ModelDto[] → mapModels() → ModelViewModel[]
```

`ModelDto` matches the backend JSON shape exactly. `ModelViewModel` is the frontend's internal type — it has display-ready strings, derived fields, and no raw API concerns. Pages import only `ModelViewModel`. DTO types never appear in component props.

This boundary means backend API changes are contained to the mapper layer — no component prop types need updating when the API evolves.

### REST: stale-data pattern

All polling hooks (`useModelsPage`, `useRoutingPage`, `useSummaryStats`) distinguish between first-load failures and background-refresh failures:

```ts
const firstLoad = useRef(true)

const load = useCallback((showLoading: boolean) => {
  apiClient.get(...)
    .then(result => {
      setData(...)
      setIsStale(false)
      setLastUpdatedAt(new Date())
      firstLoad.current = false
    })
    .catch(e => {
      if (!firstLoad.current) setIsStale(true)   // background failure — keep data
      else setError(e.message)                    // first-load failure — show error
    })
}, [])
```

**First-load failure** → shows an error state (no data to display anyway).
**Background refresh failure** → sets `isStale: true`; the existing data stays visible with an amber "Stale · Xm ago" badge. The page remains readable and honest rather than collapsing into an error state on a transient network blip.

### WebSocket: connection state machine

`useStreamSocket` manages the full connection lifecycle with backoff reconnection:

```
connecting  →  connected
               │
               └── (socket closes)
                     ├── hasConnectedRef.current = true  →  reconnecting
                     └── hasConnectedRef.current = false →  disconnected
```

The `hasConnectedRef` distinction is important: `reconnecting` appears only after a successful prior connection. A client that has never connected shows `disconnected`, not `reconnecting` — those two states have different meanings and should communicate different things to the user.

`ConnectionStatusBadge` renders all five states (`connecting`, `connected`, `reconnecting`, `disconnected`, `error`) with appropriate colours and pulse animations. Every page with a WebSocket-backed hook renders this badge so stream health is always visible.

### Shared UI primitives without a framework

The entire UI is built from CSS custom properties (design tokens in `index.css`) and inline style objects. No Tailwind, no CSS modules, no external component library. The design token system (`--color-*`, `--font-*`, `--radius-*`) provides consistency without the indirection of a utility class layer.

Shared primitives (`Panel`, `MiniStatCard`, `EmptyState`, `ErrorState`, `StaleBadge`, `RefreshButton`, `ConnectionStatusBadge`, etc.) are small, focused components with no internal state. Each accepts exactly the props it needs. This keeps the component tree legible and prevents prop-drilling through intermediate layout components.

---

## 8. Future Improvements

The following are documented design boundaries, not missing features — each has a clear production path via the existing interface layer.

### Persistent storage

All repositories (`IJobRepository`, `IModelRepository`, `IWorkerRepository`, `IDecisionRepository`, `IJobQueue`) are interface-first. Every `InMemory*` implementation can be replaced with a database adapter at `modules/*/index.ts` with no changes to any service or route handler.

Suggested production adapters:

| Repository | Recommended backend |
|---|---|
| Jobs, Requests, Decisions | PostgreSQL (append-mostly, audit-friendly) |
| Model / Worker registries | PostgreSQL with indexed capability columns |
| Job queue | Redis Streams or AWS SQS |
| Metrics time-series | InfluxDB, TimescaleDB, or ClickHouse |

### Distributed stream broker

`InMemoryStreamBroker` is single-process. To support multiple InferMesh instances behind a load balancer, replace it with a Redis pub/sub broker via the `IStreamBroker` interface. The `ConnectionRegistry` is also in-memory — sticky sessions are required today; with a distributed broker, any instance can fanout events to any connected client.

### Worker execution SDK

InferMesh routes jobs but does not dispatch them. The natural extension is a worker SDK that:
1. Registers the worker with InferMesh (`POST /workers`)
2. Sends periodic heartbeats (`POST /workers/:id/heartbeat`)
3. Polls for dispatch events (or receives them via a `decisions` WebSocket subscription)
4. Reports completion with token counts and latency data (needed to populate the metrics layer)

### Queue consumer loop

`POST /api/v1/jobs/:id/route` currently requires explicit triggering. A background queue consumer service would dequeue job IDs from `IJobQueue` and call `JobRoutingService.routeJob()` in a loop, with configurable concurrency and retry backoff. `RoutingRecoveryService` already handles the retry/fallback logic — the consumer only needs to drive it.

### Async simulation execution

Large simulation runs (`requestCount > 1 000`) are synchronous today, blocking the HTTP response cycle. An async simulation API would:
1. Accept the run request, return `202 { runId }` immediately
2. Execute the simulation in a background worker
3. Allow polling `GET /simulation/runs/:id` for status and results

### Authentication

JWT middleware hooks are stubbed via `AUTH_ENABLED` config flag. Enabling auth requires implementing the middleware against the existing hook points and propagating the caller identity into `RequestContext` for per-request audit logging.

### Metrics ingestion pipeline

The analytics layer computes metrics from live in-memory state on-demand. A production metrics pipeline would:
1. Wire `IntakeService` and worker completion callbacks to write `RequestMetricRecord` / `WorkerMetricRecord` on each event
2. Pre-aggregate rolling windows in a background task
3. Expose pre-computed summaries instead of full-scan aggregation per API request
