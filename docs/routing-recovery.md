# Routing Recovery

> Ticket 18 — Fallback and Retry Strategy for Routing/Assignment Failures

## Overview

The routing recovery layer wraps `RoutingDecisionService` with bounded fallback
and retry-eligibility logic. It sits between the routing decision engine (T16)
and the job lifecycle orchestrator (T17), providing structured failure
classification, automatic fallback for placement failures, and retry scheduling
when capacity is temporarily constrained.

## Architecture

```
JobRoutingService
  └── RoutingRecoveryService        ← T18 recovery layer
        └── RoutingDecisionService  ← T16 decision engine
              ├── ModelRegistryService   (T13)
              ├── WorkerRegistryService  (T14)
              └── CandidateEvaluatorService (T15)
```

## Failure Classification

Every routing error is classified into a `RoutingFailureClass`:

| Class | HTTP | Retryable | Fallback |
|---|---|---|---|
| `no_eligible_model` | 422 | ✓ | — |
| `no_eligible_worker` | 422 | ✓ | ✓ (strips workerProfile) |
| `temporary_capacity_issue` | 422 | ✓ | — |
| `policy_blocked` | 503 | — | — |
| `policy_not_found` | 404 | — | — |
| `assignment_conflict` | 409 | — | — |
| `non_retryable_failure` | 500 | — | — |

## Recovery Flow

```
routeJob(jobId)
  │
  ├─ guard: Queued | Retrying
  ├─ moveToRouting()          (Queued only)
  │
  └─ attemptWithRecovery()
       │
       ├─ Primary attempt: decideRoute(input)
       │    └─ SUCCESS → assignJob() → AssignedJobOutcome
       │
       ├─ FAIL: NoEligibleWorker
       │    └─ Fallback attempt: decideRoute(input, workerProfile={})
       │         ├─ SUCCESS → assignJob() → AssignedJobOutcome (recovery.usedFallback=true)
       │         └─ FAIL    → (continue to retry/terminal logic)
       │
       ├─ FAIL: retryable + attempts < maxAttempts
       │    └─ failJob() → retryJob() → incrementRetryCount()
       │         → RetryingJobOutcome (outcome="retrying")
       │
       └─ FAIL: terminal (non-retryable or exhausted)
            └─ failJob() → throw original error
```

## Fallback Strategy

The only automatic fallback is for `NoEligibleWorker`:

- **Why**: Worker placement preferences (`preferredRegion`,
  `heartbeatStalenessThresholdMs`) are *soft* hints. Stripping them widens the
  eligible worker pool without compromising hard model capability requirements.
- **How**: A second `decideRoute()` call is made with `workerProfile: {}`. Model
  constraints and policy are unchanged.
- **Audit**: The fallback attempt is flagged with `usedFallback: true` and a
  `fallbackReason` string. Both the `RoutingDecision` record and the
  `RoutingRecoveryInfo` surface this for full observability.

Model failures are **not** fallback-eligible because the model registry already
evaluates all registered candidates — no relaxation can help if all are
disqualified by hard constraints.

## Retry Behavior

When routing fails with a retryable failure class and `job.attempts < job.maxAttempts`:

1. `failJob()` — Routing/Retrying → Failed (records failure code + reason)
2. `retryJob()` — Failed → Retrying
3. `incrementRetryCount()` — bumps `attempts`
4. Returns `RetryingJobOutcome` with `nextAttemptNumber` and `recovery` metadata

The next call to `routeJob()` on the same job will proceed from `Retrying`
status, skipping the `moveToRouting()` step.

## Retry Exhaustion

When `job.attempts >= job.maxAttempts`:

1. `failJob()` — marks the job Failed (terminal)
2. Original routing error is re-thrown to the caller
3. No `RetryingJobOutcome` is returned

## Output Types

| Outcome | Meaning | HTTP suggestion |
|---|---|---|
| `AssignedJobOutcome` | Routing succeeded (possibly via fallback) | 200 |
| `RetryingJobOutcome` | Retryable failure; job re-queued | 202 Accepted |
| thrown error | Terminal failure; job marked Failed | 422/503/404 |

## Recovery Metadata (`RoutingRecoveryInfo`)

Attached to both `AssignedJobOutcome.recovery` and `RetryingJobOutcome.recovery`:

```ts
interface RoutingRecoveryInfo {
  primaryFailureClass: RoutingFailureClass;
  primaryFailureReason: string;
  usedFallback: boolean;
  fallbackReason?: string;
  fallbackFailureClass?: RoutingFailureClass;
  fallbackFailureReason?: string;
  totalAttempts: number;   // 1 = primary only, 2 = primary + fallback
}
```

## Key Files

| File | Purpose |
|---|---|
| `src/modules/jobs/orchestration/recovery/routing-recovery.contract.ts` | Types: `RoutingFailureClass`, `RoutingRecoveryInfo`, `RecoveryOutcome` |
| `src/modules/jobs/orchestration/recovery/routing-recovery.service.ts` | `RoutingRecoveryService`, `classifyRoutingFailure()` |
| `src/modules/jobs/orchestration/recovery/routing-recovery.service.test.ts` | 18 unit tests |
| `src/modules/jobs/orchestration/job-routing.service.ts` | Orchestrator wiring recovery into lifecycle |
| `src/modules/jobs/orchestration/job-routing.service.test.ts` | Full integration tests (39 total) |
| `src/modules/jobs/index.ts` | Singleton `routingRecoveryService`; all recovery types exported |

## Scope

This layer handles **routing-stage** recovery only:
- ✓ Fallback model/worker candidate selection
- ✓ Retry scheduling for transient capacity failures
- ✗ Provider execution retries (out of scope — handled by execution layer)
- ✗ Queue consumer loop (out of scope — handled by scheduler)
- ✗ Streaming, auth, metrics aggregation (separate tickets)
