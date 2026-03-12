# Routing Simulation Engine

Evaluate routing policies under synthetic workloads without affecting the live system.

## Overview

The simulation engine runs `N` synthetic routing requests through the existing routing decision logic and returns an aggregate result. It is designed for:

- **Policy comparison** — test a new policy against a fixed candidate pool before activating it
- **Load modelling** — understand how model/worker selection distributes under different request volumes
- **Regression testing** — verify that routing behaviour is stable across code changes

## How to run a simulation

```http
POST /api/v1/simulation/runs
Content-Type: application/json

{
  "scenarioName": "latency-policy-peak-load",
  "policyId": "prod-latency-optimised",
  "requestCount": 100,
  "workload": {
    "requestIdPrefix": "perf-test"
  },
  "sourceTag": "ci-baseline"
}
```

### Response

```json
{
  "success": true,
  "data": {
    "runId": "a1b2c3d4-...",
    "scenarioName": "latency-policy-peak-load",
    "policyId": "policy-uuid-...",
    "policyName": "prod-latency-optimised",
    "sourceTag": "ci-baseline",
    "startedAt": "2026-01-15T12:00:00.000Z",
    "completedAt": "2026-01-15T12:00:00.045Z",
    "durationMs": 45,
    "totalRequests": 100,
    "successCount": 98,
    "failureCount": 2,
    "fallbackCount": 0,
    "averageEvaluationMs": 0.4,
    "perModelSelections": {
      "model-gpt4o": 72,
      "model-claude-sonnet": 26
    },
    "perWorkerAssignments": {
      "worker-us-east-1": 55,
      "worker-us-west-2": 43
    },
    "errors": [
      {
        "requestIndex": 14,
        "requestId": "perf-test-a1b2c3d4-14",
        "errorType": "NoEligibleWorkerError",
        "message": "No eligible workers found..."
      }
    ]
  },
  "meta": { "requestId": "...", "timestamp": "..." }
}
```

## Input reference

| Field           | Type     | Required | Description                                                                 |
|-----------------|----------|----------|-----------------------------------------------------------------------------|
| `scenarioName`  | `string` | ✓        | Human-readable label for this scenario                                      |
| `policyId`      | `string` | –        | Policy name or UUID to evaluate; defaults to the active policy              |
| `requestCount`  | `number` | ✓        | Number of synthetic requests to route (max 1 000 via HTTP)                  |
| `workload`      | `object` | –        | Per-request configuration                                                   |
| `workload.requestIdPrefix` | `string` | – | Prefix for synthetic request IDs (default: `"sim"`)          |
| `sourceTag`     | `string` | –        | Free-form tag attached to the result for downstream filtering               |

## Result reference

| Field                  | Description                                                                      |
|------------------------|----------------------------------------------------------------------------------|
| `runId`                | Server-assigned UUID for this run                                                |
| `successCount`         | Requests that produced a successful routing decision                             |
| `failureCount`         | Requests that resulted in a routing error                                        |
| `fallbackCount`        | Successful decisions that used the fallback strategy                             |
| `averageEvaluationMs`  | Mean routing evaluation time across successful decisions                         |
| `perModelSelections`   | `{ modelId: count }` — how often each model was selected                         |
| `perWorkerAssignments` | `{ workerId: count }` — how often each worker was assigned                       |
| `errors`               | Per-request error records (requestIndex, errorType, message)                     |

`successCount + failureCount` always equals `totalRequests`.

## Isolation guarantees

The simulation engine is fully isolated from the live system:

| Concern                       | Isolation mechanism                                               |
|-------------------------------|-------------------------------------------------------------------|
| Live routing decisions        | A fresh `InMemoryDecisionRepository` is created per run          |
| Stream events                 | No `IStreamBroker` is injected — no WebSocket events published   |
| Live requests / jobs          | No `InferenceRequest` or `Job` records are created               |
| Worker state mutations        | Worker registry is read-only; no capacity or status writes       |
| Audit trail contamination     | All decisions carry `DecisionSource.Simulation`                  |

## Programmatic usage (model/worker overrides)

The service API accepts `modelOverrides: ModelCandidate[]` and `workerOverrides: WorkerCandidate[]` to replace the live registries with a fixed candidate pool. This is useful for unit-testing policies under controlled infrastructure states without requiring real registered workers or models.

```ts
import { simulationEngineService } from "../modules/simulation";

const result = await simulationEngineService.run(ctx, {
  scenarioName: "synthetic-pool",
  requestCount: 50,
  modelOverrides: [/* fixed ModelCandidate[] */],
  workerOverrides: [/* fixed WorkerCandidate[] */],
});
```

Model/worker overrides are not exposed via the HTTP API in this version.

## Architecture

```
POST /api/v1/simulation/runs
        │
        ▼
  SimulationEngineService.run()
        │
        ├── Creates: InMemoryDecisionRepository (sim-scoped, discarded after)
        ├── Creates: RoutingDecisionService (uses sim repo, no broker)
        │
        ├── for each request (0..requestCount-1):
        │     ├── decideRoute(ctx, { requestId, decisionSource: Simulation, policyOverride })
        │     │     → DecideRouteResult  (success)
        │     │     → SimulationError    (captured on throw, run continues)
        │
        └── buildRunResult() → SimulationRunResult
```

## Current limitations

- **No persistent storage** — simulation results are returned synchronously and not stored; there is no GET /simulation/runs/:id endpoint.
- **No async / queued execution** — runs are synchronous in the request–response cycle; large `requestCount` values will increase response latency.
- **No stochastic workload generation** — each request uses the same filter configuration; there is no Poisson arrival modelling or token-range sampling yet.
- **HTTP max 1 000 requests** — the HTTP API enforces `requestCount ≤ 1 000`; the service API has no limit.
- **No worker load simulation** — worker capacity is not decremented between iterations; each request sees the same candidate pool.
