# Candidate Evaluation — Scoring Layer

## Purpose

The candidate evaluation layer scores batches of `ModelCandidate` and `WorkerCandidate` objects with structured, dimension-level breakdowns. It sits between the **registry layer** (which supplies eligible candidates) and the **routing decision layer** (which selects the final winner).

```
ModelRegistryService  ──→  ModelCandidate[]  ──→  ModelEvaluator  ──→  ModelScoreResult[]
WorkerRegistryService ──→  WorkerCandidate[] ──→  WorkerEvaluator ──→  WorkerScoreResult[]
                                                         │
                                              CandidateEvaluatorService
                                              (orchestrator — Ticket 15)
                                                         │
                                              RoutingService.evaluate()
                                              (selects winner — Ticket 16+)
```

The evaluator **scores** — it does not **select**. This separation keeps scoring logic reusable for simulation, A/B analysis, and debugging without coupling it to the live routing path.

---

## Files

| File | Role |
|------|------|
| `evaluation/evaluation.contract.ts` | All type definitions: profiles, weight interfaces, raw dimensions, normalised scores, score results |
| `evaluation/model-evaluator.ts` | `ModelEvaluator` class — scores a batch of model candidates |
| `evaluation/worker-evaluator.ts` | `WorkerEvaluator` class — scores a batch of worker candidates |
| `evaluation/candidate-evaluator.service.ts` | `CandidateEvaluatorService` — thin orchestrator exposing `evaluateModels()` and `evaluateWorkers()` |
| `evaluation/candidate-evaluator.service.test.ts` | Unit tests covering all scoring dimensions and disqualification rules |

---

## Model Scoring Dimensions

| Dimension | Description | Normalisation |
|-----------|-------------|---------------|
| `quality` | Model quality tier | Static map: Frontier=1.0, Standard=0.5, Economy=0.0 |
| `cost` | Estimated request cost in USD | Min-max inverted: lowest cost → 1.0 |
| `latency` | Median TTFT from `latencyProfile.ttftMs` | Min-max inverted: lowest TTFT → 1.0 |
| `capabilityFit` | Fraction of required capabilities matched | `matchCount / requiredCount` (1.0 if none required) |
| `contextWindowSufficiency` | Context window ≥ minimum required | Binary: 1.0 / 0.0 (used in explanation, hard gate via disqualification) |

### Default model weights

```ts
{ quality: 0.35, cost: 0.25, latency: 0.25, capabilityFit: 0.15 }
```

### Model disqualification rules

| Condition | Reason |
|-----------|--------|
| Any required capability is missing | `Missing required capabilities: ...` |
| `contextWindow < minContextWindow` | `Context window N < required M tokens` |

---

## Worker Scoring Dimensions

| Dimension | Description | Normalisation |
|-----------|-------------|---------------|
| `load` | Composite load score | `1 - loadScore` (undefined → 0.5 neutral) |
| `queueDepth` | Jobs waiting in local queue | `max(0, 1 - queuedJobs / maxConcurrentJobs)` |
| `throughput` | Token output rate | Min-max ascending: highest tokens/s → 1.0 |
| `latency` | Time-to-first-token | Min-max inverted: lowest TTFT → 1.0 |
| `healthFitness` | Worker lifecycle status | Idle=1.0, Busy=0.7 (others → disqualified) |
| `regionFit` | Region preference alignment | 1.0 (match or no preference), 0.3 (mismatch) |
| `heartbeatFreshness` | Age of most recent heartbeat | Linear decay: `1 - (age / threshold)`, clamped [0, 1] |

### Default worker weights

```ts
{ load: 0.30, queueDepth: 0.20, throughput: 0.15, latency: 0.15,
  healthFitness: 0.10, regionFit: 0.05, heartbeatFreshness: 0.05 }
```

### Worker disqualification rules

| Condition | Reason |
|-----------|--------|
| Status is not Idle or Busy | `Non-routable status: <status>` |
| `heartbeatAge > 2 × threshold` | `Heartbeat critically stale: Nms > 2× threshold` |

Default staleness threshold: **60 000 ms** (overridable via `WorkerEvaluationProfile.heartbeatStalenessThresholdMs`).

---

## Weighted total formula

```
total = sum(weight_i × score_i) / sum(weight_i)
```

Dividing by the sum of all weights preserves the `[0, 1]` range regardless of whether weights sum to 1. Disqualified candidates always receive `totalScore = 0`.

---

## Result ordering

All result arrays are sorted consistently:

1. **Eligible** candidates before **disqualified** candidates
2. **`totalScore` descending** within each group
3. **`candidateId` ascending** as a deterministic tie-break

---

## Usage example

```ts
import { candidateEvaluatorService } from "../modules/routing";
import { modelRegistryService } from "../modules/models";
import { workerRegistryService } from "../modules/workers";

const models = await modelRegistryService.findEligible(ctx, { taskType: ModelTask.Coding });
const workers = await workerRegistryService.findEligible(ctx, { requiredModelId: models[0]?.id });

const modelScores = candidateEvaluatorService.evaluateModels(ctx, models, {
  estimatedInputTokens: 2000,
  estimatedOutputTokens: 500,
  requiredCapabilities: [ModelCapability.CodeGeneration],
});

const workerScores = candidateEvaluatorService.evaluateWorkers(ctx, workers, {
  preferredRegion: "us-east-1",
  heartbeatStalenessThresholdMs: 30_000,
});

const topModel = modelScores.find(r => r.eligible);
const topWorker = workerScores.find(r => r.eligible);
```

---

## Extending weights per routing policy

The `StrategyWeights` in `shared/contracts/routing.ts` captures the four high-level dimensions (`quality`, `cost`, `latency`, `load`). When feeding a policy into the evaluator, map policy weights to the more granular `ModelScoringWeights` / `WorkerScoringWeights` interfaces as needed for fine-grained control.
