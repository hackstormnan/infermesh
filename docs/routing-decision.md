# Routing Decision — Decision Engine

## Purpose

The routing decision layer selects the best `(model, worker)` pair for an inference request under an active routing policy. It sits between the **evaluation layer** (T15, which scores candidates) and the **execution layer** (future — job dispatch and worker assignment).

```
DecideRouteInput
      │
      ▼
RoutingDecisionService.decideRoute()
      │
      ├── resolvePolicy()             → RoutingPolicy       (active or override)
      ├── ModelRegistryService        → ModelCandidate[]    (eligible models)
      ├── CandidateEvaluatorService   → ModelScoreResult[]  (scored + ranked)
      ├── select bestModel            (first eligible by score)
      │
      ├── WorkerRegistryService       → WorkerCandidate[]   (scoped to bestModel)
      ├── CandidateEvaluatorService   → WorkerScoreResult[] (scored + ranked)
      ├── select bestWorker           (first eligible by score)
      │
      └── IDecisionRepository.save() → RoutingDecision     (persisted audit record)
                                       │
                                       ▼
                                  DecideRouteResult
```

The decision service **selects** — it does not **execute**. This separation keeps the decision engine reusable for both live routing and offline simulation without coupling it to worker communication.

---

## Files

| File | Role |
|------|------|
| `routing/decision/routing-decision.contract.ts` | `DecideRouteInput`, `DecideRouteResult`, `ModelSelectionSummary`, `WorkerSelectionSummary`, domain error classes |
| `routing/decision/routing-decision.service.ts` | `RoutingDecisionService` — the decision engine |
| `routing/decision/routing-decision.service.test.ts` | 24 unit tests covering all scenarios |

---

## Decision flow

### 1. Policy resolution

```
policyOverride provided?
    ├── Yes → findByName() → fallback to findById()
    │         NotFoundError if neither matches
    └── No  → list(status=Active, limit=1)
              NoActivePolicyError if list is empty
              (list is sorted by priority desc, so items[0] is the winner)
```

### 2. Model evaluation

- Call `ModelRegistryService.findEligible(ctx, modelFilter)`.
- Score all returned candidates via `CandidateEvaluatorService.evaluateModels()`.
- `NoEligibleModelError` if the registry returns no candidates **or** all are disqualified.
- The first eligible entry (sorted: eligible first → score desc → id asc) is selected.

### 3. Worker evaluation

- Call `WorkerRegistryService.findEligible(ctx, { ...workerFilter, requiredModelId: bestModel.id })`.
  Worker query is always scoped to the selected model — callers should not set `requiredModelId`.
- Score all returned candidates via `CandidateEvaluatorService.evaluateWorkers()`.
- `NoEligibleWorkerError` if the registry returns no candidates **or** all are disqualified.
- The first eligible entry (same deterministic ordering) is selected.

### 4. Decision record

The persisted `RoutingDecision` contains:

| Field | Description |
|-------|-------------|
| `id` | Generated UUID |
| `requestId` | From `DecideRouteInput` |
| `jobId` | From `DecideRouteInput` (optional) |
| `policyId` | Resolved policy's ID |
| `outcome` | `Routed` on success |
| `selectedModelId` | Winning model's ID |
| `selectedWorkerId` | Winning worker's ID |
| `strategy` | Policy strategy |
| `candidates` | Selected (model, worker) pair with composite `ScoreBreakdown` |
| `reason` | Human-readable explanation string (model + worker summaries) |
| `decisionSource` | `Live` or `Simulation` |
| `decidedAt` | Unix epoch ms |
| `evaluationMs` | Wall-clock time of the full evaluation |

---

## Error types

| Error | HTTP | When |
|-------|------|------|
| `NoActivePolicyError` | 503 | No active policy exists and no override given |
| `NotFoundError` | 404 | `policyOverride` name/ID does not exist |
| `NoEligibleModelError` | 422 | Registry returned no models, or all were disqualified |
| `NoEligibleWorkerError` | 422 | Registry returned no workers, or all were disqualified |

---

## Usage example

```ts
import { routingDecisionService } from "../modules/routing";
import { DecisionSource } from "../modules/routing";

// Live routing
const result = await routingDecisionService.decideRoute(ctx, {
  requestId: req.id,
  jobId: job.id,
  decisionSource: DecisionSource.Live,
  modelProfile: {
    estimatedInputTokens: 2_000,
    estimatedOutputTokens: 500,
    requiredCapabilities: [ModelCapability.CodeGeneration],
  },
  workerProfile: {
    preferredRegion: "us-east-1",
    heartbeatStalenessThresholdMs: 30_000,
  },
});

const { decision, modelSummary, workerSummary } = result;
// decision.selectedModelId / decision.selectedWorkerId — use for job dispatch
// decision.reason — human-readable audit string
// modelSummary.explanation / workerSummary.explanation — per-dimension detail

// Simulation (offline replay with a different policy)
const simResult = await routingDecisionService.decideRoute(ctx, {
  requestId: "sim-req-001",
  decisionSource: DecisionSource.Simulation,
  policyOverride: "latency-optimised-v2",
});
```

---

## Extending for fallback strategies

The current implementation selects the top-eligible candidate from a single evaluation pass. To add fallback support (e.g. try `LatencyOptimised`, fall back to `LeastLoaded`):

1. Catch `NoEligibleWorkerError` after the first pass.
2. Check `policy.allowFallback && policy.fallbackStrategy`.
3. Re-run evaluation with the fallback strategy's weights.
4. Record `usedFallback: true` and `fallbackReason` in the decision.

The `RoutingDecision` contract already has `usedFallback` and `fallbackReason` fields for this.
