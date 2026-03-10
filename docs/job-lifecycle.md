# Job Lifecycle Rules

## Overview

Every inference workload entering InferMesh is backed by a `Job` record that
progresses through a finite set of states. The `JobLifecycleService` is the
single authority for all status transitions — it validates each move against
the state machine, rejects illegal moves with a `409 Conflict`, and records a
`JobTransitionRecord` for every successful transition.

## State machine

```
                        ┌──────────────────────────────────────────────────────┐
                        │              Cancelled (terminal)                    │
                        └──▲──────▲──────────▲──────▲──────────▲──────────────┘
                           │      │           │      │           │
  Queued ──► Routing ──► Assigned ──► Running ──► Succeeded (terminal)
                 │                       │
                 └──► Failed ◄───────────┘
                          │
                          ▼
                       Retrying ──► Assigned  (back to assignment for retry)
```

| From        | Allowed next states                         |
|-------------|---------------------------------------------|
| `queued`    | `routing`, `cancelled`                      |
| `routing`   | `assigned`, `failed`, `cancelled`           |
| `assigned`  | `running`, `cancelled`                      |
| `running`   | `succeeded`, `failed`, `cancelled`          |
| `succeeded` | — (terminal)                                |
| `failed`    | `retrying`, `cancelled`                     |
| `retrying`  | `assigned`, `cancelled`                     |
| `cancelled` | — (terminal)                                |

## Named transition methods

All methods on `JobLifecycleService` accept `(ctx: RequestContext, jobId, ...args, meta?)`.

| Method          | Transition              | Side effects                                    |
|----------------|-------------------------|-------------------------------------------------|
| `moveToRouting` | `queued → routing`      | —                                               |
| `assignJob`     | `routing → assigned`    | stamps `modelId`, `workerId`, `assignedAt`      |
|                 | `retrying → assigned`   | same (retry re-assignment)                      |
| `startJob`      | `assigned → running`    | stamps `startedAt`                              |
| `completeJob`   | `running → succeeded`   | stamps `completedAt`                            |
| `failJob`       | `running → failed`      | stamps `failureCode`, `lastFailureReason`, `completedAt` |
|                 | `routing → failed`      | same (routing-time failure)                     |
| `cancelJob`     | any non-terminal → `cancelled` | stamps `completedAt`                   |
| `retryJob`      | `failed → retrying`     | caller must call `assignJob` to continue        |

### Optional TransitionMeta

Every method accepts an optional `meta` object:

```typescript
interface TransitionMeta {
  source?: string;  // e.g. "api", "routing_engine", "worker_adapter"
  reason?: string;  // free-form note
}
```

## Error handling

An invalid transition throws `InvalidTransitionError` (extends `ConflictError`, HTTP 409):

```json
{
  "success": false,
  "error": {
    "code": "CONFLICT",
    "message": "Invalid job lifecycle transition: succeeded → cancelled",
    "details": {
      "fromStatus": "succeeded",
      "toStatus": "cancelled",
      "allowed": []
    }
  }
}
```

## Transition history

`JobLifecycleService.getHistory(jobId)` returns an ordered list of
`JobTransitionRecord` entries — one per successful transition:

```typescript
interface JobTransitionRecord {
  fromStatus: JobStatus;
  toStatus: JobStatus;
  changedAt: number;            // Unix epoch ms
  source: string;               // who triggered it
  reason?: string;
  workerId?: WorkerId;
  modelId?: ModelId;
  routingDecisionId?: DecisionId;
  attempt: number;              // 1-indexed
}
```

History is stored in-process only (lost on restart). A durable audit log
backed by a repository interface will be added in a future ticket.

## Retry flow

```
Running → Failed           (worker reports failure)
  └─ retryJob()     → Retrying
  └─ assignJob()    → Assigned  (new model/worker selection)
  └─ startJob()     → Running   (worker begins new attempt)
```

The `attempts` counter is incremented by `assignJob` — each assignment
represents a new attempt. `maxAttempts` is checked externally by the retry
coordinator (not enforced inside the lifecycle service itself).

## What is NOT implemented yet

- Automatic retry evaluation (checking `attempts < maxAttempts`)
- Timeout detection for jobs stuck in `Running`
- Domain events emitted on each transition
- Durable history persistence
