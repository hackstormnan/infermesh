# Job Routing — Orchestration Layer

## Purpose

The job routing orchestrator integrates the **routing decision engine** (T16) with
the **job lifecycle** (T9/T11) to move a queued job through selection and into an
assigned state ready for execution.

It is the **application-level sequence** — it does not implement routing logic
itself. All routing intelligence lives in `RoutingDecisionService`; all lifecycle
enforcement lives in `JobLifecycleService`.

```
RouteJobInput { jobId }
      │
      ▼
JobRoutingService.routeJob()
      │
      ├── jobsService.getById()          → load job, guard Queued state
      ├── jobLifecycle.moveToRouting()   → Queued → Routing
      ├── routingDecision.decideRoute()  → DecideRouteResult
      │       └── on failure:
      │           jobLifecycle.failJob() → Routing → Failed, re-throw
      ├── jobLifecycle.assignJob()       → Routing → Assigned
      │       (stamps modelId, workerId, routingDecisionId)
      │
      └── RouteJobResult
            ├── job          — Assigned job with all IDs stamped
            ├── decision     — persisted RoutingDecision record
            ├── modelSummary — scoring summary for the winning model
            ├── workerSummary— scoring summary for the winning worker
            └── evaluationMs — total routing wall-clock time
```

---

## Files

| File | Role |
|------|------|
| `jobs/orchestration/job-routing.contract.ts` | `RouteJobInput`, `RouteJobResult`, `JobNotRoutableError` |
| `jobs/orchestration/job-routing.service.ts` | `JobRoutingService` — routing orchestrator |
| `jobs/orchestration/job-routing.service.test.ts` | 21 unit tests |

---

## API endpoint

```
POST /api/v1/jobs/:id/route
```

**Request body** (all fields optional):
```json
{
  "decisionSource": "Live",
  "policyOverride": "latency-optimised-v2"
}
```

**Response** `200 OK`:
```json
{
  "success": true,
  "data": {
    "job": { "id": "...", "status": "Assigned", "modelId": "...", "workerId": "...", "routingDecisionId": "..." },
    "decision": { "id": "...", "selectedModelId": "...", "selectedWorkerId": "...", "reason": "..." },
    "modelSummary": { "selectedModelId": "...", "topScore": 0.85, "eligibleCount": 3 },
    "workerSummary": { "selectedWorkerId": "...", "topScore": 0.90, "eligibleCount": 1 },
    "evaluationMs": 12
  },
  "meta": { "requestId": "...", "timestamp": "..." }
}
```

**Error responses:**

| Status | Code | When |
|--------|------|------|
| 404 | `NOT_FOUND` | Job ID does not exist |
| 409 | `CONFLICT` | Job is not in `Queued` status |
| 503 | `SERVICE_UNAVAILABLE` | No active routing policy |
| 422 | `VALIDATION_ERROR` | No eligible model or worker candidates |
| 404 | `NOT_FOUND` | `policyOverride` name/ID does not exist |

---

## Failure behavior

When `routingDecision.decideRoute()` fails after the job is already in `Routing`
status, the orchestrator:

1. Calls `jobLifecycle.failJob()` → transitions `Routing → Failed`
2. Stamps a structured `failureCode` on the job (`NO_ELIGIBLE_MODEL`, `NO_ELIGIBLE_WORKER`, `NO_ACTIVE_POLICY`, `POLICY_NOT_FOUND`, `ROUTING_FAILED`)
3. Re-throws the original error for the HTTP layer to handle

**Why Failed rather than reverting to Queued?**
- Failed is explicit and inspectable — operators can see why routing failed
- Avoids infinite re-queue loops without a retry policy
- Callers can invoke `jobLifecycle.retryJob()` explicitly if retry logic is appropriate

---

## Usage example

```ts
import { jobRoutingService } from "../modules/jobs";
import { DecisionSource } from "../modules/routing";

// Live routing (standard path)
const result = await jobRoutingService.routeJob(ctx, {
  jobId: job.id,
  decisionSource: DecisionSource.Live,
});
const { job: assigned, decision, modelSummary, workerSummary } = result;
// assigned.modelId / assigned.workerId — ready for execution dispatch
// decision.id — routingDecisionId for audit

// Simulation (offline replay with a different policy)
const simResult = await jobRoutingService.routeJob(ctx, {
  jobId: simJob.id,
  decisionSource: DecisionSource.Simulation,
  policyOverride: "latency-optimised-v2",
});
```

---

## Extending for queue consumption

The orchestrator is designed to be called from a queue consumer loop. A future
queue processor would:

1. Dequeue a `jobId` from `IJobQueue`
2. Call `jobRoutingService.routeJob(ctx, { jobId })`
3. On `JobNotRoutableError` — skip (race condition, already processed)
4. On routing failure — log + optionally re-enqueue with backoff
5. On success — proceed to execution dispatch
