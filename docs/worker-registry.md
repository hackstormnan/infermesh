# Worker Registry Service

## Role in the assignment pipeline

The worker registry is the bridge between the live worker pool (dynamic health
state) and the routing / assignment engine (placement decisions).

When the routing engine needs to assign a job to a worker, it calls
`workerRegistryService.findEligible(ctx, filter)` instead of querying raw
worker records. The registry service:

1. Loads all registered workers from the repository (`findAll`)
2. Applies multi-dimensional eligibility filtering (see below)
3. Projects each passing worker onto a lean `WorkerCandidate` object
4. Returns candidates sorted by available capacity (most headroom first)

The routing engine receives `WorkerCandidate[]` and applies its own scoring
(load, latency, region affinity) before selecting the target worker for dispatch
(Ticket 15+).

```
Routing / Assignment Engine
      │
      ├─ workerRegistryService.findEligible(ctx, filter) → WorkerCandidate[]
      │         │
      │         ├─ repo.findAll()         ← full pool, no pagination
      │         ├─ applyFilter()          ← eligibility logic (service layer)
      │         └─ toCandidate()          ← lean projection, endpoint excluded
      │                                     availableSlots pre-computed
      │
      └─ score each candidate → dispatch to winner
```

## WorkerAssignmentFilter

All fields are optional. Absent fields are not applied as constraints.
When `statuses` is not provided, defaults to `[Idle, Busy]`.

| Field                    | Type             | Description                                                    |
|--------------------------|------------------|----------------------------------------------------------------|
| `requiredModelId`        | `string`         | Worker must list this model in `supportedModelIds`             |
| `requiredCapabilityTags` | `string[]`       | Worker must have ALL keys present in its `labels` map          |
| `preferredRegion`        | `string`         | Case-insensitive exact region match                            |
| `maxQueueSize`           | `number`         | `capacity.queuedJobs` must be ≤ this value                     |
| `maxLoadScore`           | `number` (0–1)   | `runtimeMetrics.loadScore` must be ≤ this value; undefined passes |
| `minHeartbeatFreshnessMs`| `number`         | `lastHeartbeatAt` must be within this many ms of now           |
| `statuses`               | `WorkerStatus[]` | Defaults to `[Idle, Busy]`                                     |
| `instanceType`           | `string`         | Exact match on `hardware.instanceType`                         |
| `gpuRequired`            | `boolean`        | When true, requires `hardware.gpuModel` to be defined          |

## WorkerCandidate

Assignment-optimised projection of a `Worker` entity. Contains exactly the
fields a placement strategy needs — no `endpoint` (dispatch path only), no
`createdAt`/`updatedAt`.

`availableSlots` is eagerly computed as `max(0, maxConcurrentJobs - activeJobs)`.

```typescript
interface WorkerCandidate {
  id:               string;
  name:             string;
  region:           string;
  status:           WorkerStatus;
  hardware:         WorkerHardware;       // instanceType, gpuModel?
  supportedModelIds: string[];
  labels:           Record<string, string>;
  // Capacity
  activeJobs:       number;
  maxConcurrentJobs: number;
  queuedJobs:       number;
  availableSlots:   number;               // pre-computed headroom
  // Runtime metrics (may be absent if not yet reported)
  loadScore?:       number;               // 0.0 idle – 1.0 saturated
  tokensPerSecond?: number;
  ttftMs?:          number;
  cpuUsagePercent?: number;
  memoryUsagePercent?: number;
  lastHeartbeatAt:  number;               // Unix epoch ms
}
```

## Service API

```typescript
// All Idle + Busy workers (no other filtering)
workerRegistryService.listHealthy(ctx): Promise<WorkerCandidate[]>

// Idle + Busy workers with availableSlots > 0
workerRegistryService.listAssignable(ctx): Promise<WorkerCandidate[]>

// Full multi-dimensional filter
workerRegistryService.findEligible(ctx, filter): Promise<WorkerCandidate[]>
```

## Result ordering

Candidates are sorted in this order so the routing engine can apply a simple
top-K selection without re-sorting:

1. **`availableSlots` descending** — most remaining concurrency headroom first
2. **`loadScore` ascending** — least loaded workers first within the same slot count
3. **`name` ascending** — deterministic tie-break

## HTTP endpoint (internal/debug)

```
GET /api/v1/workers/candidates
```

Exposes the same filtering logic over HTTP. Intended for the routing engine,
integration tests, and internal debugging — not for external callers.

Query parameters mirror `WorkerAssignmentFilter`:

```
?modelId=claude-sonnet-4-6
&region=us-east-1
&status=idle              (single status; omit for default Idle+Busy pool)
&maxQueueSize=3
&maxLoadScore=0.7
&minHeartbeatFreshnessSecs=30
&gpuRequired=true
&instanceType=g4dn.xlarge
```

### Example response

```json
{
  "success": true,
  "data": [
    {
      "id": "a1b2c3d4-...",
      "name": "gpu-worker-01",
      "region": "us-east-1",
      "status": "idle",
      "hardware": { "instanceType": "g4dn.xlarge", "gpuModel": "NVIDIA T4" },
      "supportedModelIds": ["model-uuid-1", "model-uuid-2"],
      "labels": { "vision-enabled": "true" },
      "activeJobs": 1,
      "maxConcurrentJobs": 4,
      "queuedJobs": 0,
      "availableSlots": 3,
      "loadScore": 0.25,
      "tokensPerSecond": 80,
      "ttftMs": 200,
      "lastHeartbeatAt": 1741610000000
    }
  ],
  "meta": { "requestId": "...", "timestamp": "..." }
}
```

## Separation of concerns

| Layer                  | Responsibility                                                     |
|------------------------|--------------------------------------------------------------------|
| `IWorkerRepository`    | Storage, indexed lookups (`findAll`, `findById`, `findByName`)     |
| `WorkersService`       | Admin CRUD + heartbeat processing, name uniqueness, deregistration |
| `WorkerRegistryService`| Eligibility filtering + candidate projection for routing           |
| Route handler          | HTTP boundary only — Zod parse, call service, return envelope      |

All filtering logic lives exclusively in `WorkerRegistryService.applyFilter()`.
Neither the repository nor the route handler contains any eligibility rules.

## Not implemented yet

- Worker assignment (Ticket 15+) — the routing engine will select a
  `WorkerCandidate` and call the dispatch path with the `endpoint`
- Heartbeat eviction — background task to mark stale workers Unhealthy
- Worker capacity increment / decrement on job dispatch / completion
- `requiredCapabilityTags` over label values (currently checks key presence only)
