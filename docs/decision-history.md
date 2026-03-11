# Decision History

> Ticket 19 — Persist and expose routing decision history

## Overview

The decision history layer adds explanation-rich detail to every routing decision audit record.
It stores the full candidate evaluation (all model and worker scores, including disqualified
candidates) alongside the immutable `RoutingDecision` record, and exposes this data through
the existing `GET /routing/decisions` and `GET /routing/decisions/:id` routes.

## Architecture

```
GET /routing/decisions/:id
  └── DecisionHistoryService.getDecisionDetail()
        ├── RoutingService.getDecision()         — core RoutingDecision entity
        └── IDecisionEvaluationStore.findByDecisionId() — full candidate scores
              → buildDecisionDetailDto()          — merge into DecisionDetailDto
```

## Two-Store Design

| Store | Type | Contents | Mutability |
|---|---|---|---|
| `IDecisionRepository` | Append-only | `RoutingDecision` (winner pair + outcome) | Immutable |
| `IDecisionEvaluationStore` | Append-only | `RoutingDecisionEvaluation` (all candidate scores) | Immutable |

The stores are keyed by the same `DecisionId`. The split keeps the shared `RoutingDecision`
contract stable (no new fields needed) while enabling full observability for the history API.

## Evaluation Persistence

`RoutingDecisionService.decideRoute()` accepts an optional `IDecisionEvaluationStore`.
When wired, it saves the full `ModelScoreResult[]` and `WorkerScoreResult[]` after each
decision, enabling after-the-fact breakdown of why each candidate was selected or rejected.

The store parameter is `null`-safe — legacy callers and tests that omit it continue to work.

## DecisionDetailDto

```ts
interface DecisionDetailDto {
  // Identity
  id: DecisionId;
  requestId: RequestId;
  jobId?: JobId;
  policyId: PolicyId;

  // Outcome
  decisionSource: DecisionSource;
  outcome: RoutingOutcome;
  selectedModelId?: ModelId;
  selectedWorkerId?: WorkerId;
  strategy: RoutingStrategy;
  decidedAt: number;
  evaluationMs: number;
  reason: string;
  usedFallback: boolean;
  fallbackReason?: string;

  // Evaluation (absent for pre-T19 decisions or when store not wired)
  modelEvaluation?: CandidateEvaluationSection;
  workerEvaluation?: CandidateEvaluationSection;

  // Legacy candidates array
  candidates: RoutingCandidate[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}
```

### CandidateEvaluationSection

```ts
interface CandidateEvaluationSection {
  totalCandidates: number;
  eligibleCount: number;
  winner: CandidateScoreSummary | null;      // null when no model/worker was selected
  runners: CandidateScoreSummary[];          // eligible but not selected, score desc
  disqualified: CandidateScoreSummary[];     // failed hard constraints
}

interface CandidateScoreSummary {
  candidateId: string;
  eligible: boolean;
  totalScore: number;
  explanation: string[];
  disqualificationReasons: string[];
  dimensionScores: Record<string, number>;  // all per-dimension scores
}
```

## Extended Decision Filters

`GET /routing/decisions` now accepts three additional query parameters:

| Parameter | Description |
|---|---|
| `jobId` | Filter by the job that triggered the routing decision |
| `selectedModelId` | Filter decisions that selected a specific model |
| `selectedWorkerId` | Filter decisions that selected a specific worker |

These are backed by secondary indexes in `InMemoryDecisionRepository` for O(k) lookup when
used as the sole filter (where k = matching decisions, not total decisions).

## Graceful Degradation

`modelEvaluation` and `workerEvaluation` are optional fields. Decisions that were recorded
before T19 (or in environments where the evaluation store is not wired) are returned correctly
— the fields are simply absent. No schema migration required.

## Key Files

| File | Purpose |
|---|---|
| `src/modules/routing/decision/decision-history.contract.ts` | `IDecisionEvaluationStore`, `RoutingDecisionEvaluation`, `DecisionDetailDto`, `CandidateEvaluationSection`, `CandidateScoreSummary` |
| `src/modules/routing/decision/decision-history.service.ts` | `DecisionHistoryService`, `buildDecisionDetailDto()` (exported pure fn) |
| `src/modules/routing/decision/decision-history.service.test.ts` | ~40 unit tests |
| `src/modules/routing/decision/InMemoryDecisionEvaluationStore.ts` | In-memory `IDecisionEvaluationStore` |
| `src/modules/routing/repository/InMemoryDecisionRepository.ts` | Extended with `jobId`, `selectedModelId`, `selectedWorkerId` secondary indexes |
| `src/modules/routing/routes/routing.route.ts` | Updated: decision routes use `DecisionHistoryService` when wired |
| `src/modules/routing/queries.ts` | Extended with new filter fields |
