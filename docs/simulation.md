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

## Policy experiment runner

Compare multiple routing policies under an identical synthetic workload in a single API call.

### Run an experiment

```http
POST /api/v1/simulation/experiments
Content-Type: application/json

{
  "experimentName": "cost-vs-latency-q1-2026",
  "policies": ["policy_low_cost", "policy_balanced", "policy_low_latency"],
  "workloadConfig": {
    "requestCount": 500,
    "taskDistribution": { "chat": 0.6, "analysis": 0.25, "reasoning": 0.15 },
    "randomSeed": 42
  }
}
```

### Response

```json
{
  "success": true,
  "data": {
    "experimentId": "a1b2c3d4-...",
    "experimentName": "cost-vs-latency-q1-2026",
    "workloadRequestCount": 500,
    "policies": ["policy_low_cost", "policy_balanced", "policy_low_latency"],
    "startedAt": "2026-01-15T12:00:00.000Z",
    "completedAt": "2026-01-15T12:00:00.210Z",
    "durationMs": 210,
    "results": [
      {
        "policyId": "policy-uuid-a",
        "policyName": "policy_low_cost",
        "runId": "run-uuid-1",
        "totalRequests": 500,
        "successCount": 470,
        "failureCount": 30,
        "fallbackCount": 48,
        "successRate": 0.94,
        "fallbackRate": 0.102,
        "averageEvaluationMs": 0.42,
        "perModelSelections": { "model-economy": 380, "model-standard": 90 },
        "perWorkerAssignments": { "worker-us-east": 260, "worker-us-west": 210 }
      }
    ],
    "rankings": {
      "bySuccessRate":     ["policy_low_latency", "policy_balanced", "policy_low_cost"],
      "byFallbackRate":    ["policy_low_latency", "policy_balanced", "policy_low_cost"],
      "byEvaluationSpeed": ["policy_low_latency", "policy_balanced", "policy_low_cost"]
    }
  }
}
```

### Input reference

| Field | Type | Required | Description |
|---|---|---|---|
| `experimentName` | `string` | ✓ | Human-readable label |
| `policies` | `string[]` | ✓ | Policy names or UUIDs (1–20) |
| `workloadConfig` | `WorkloadConfig` | ✓ | Passed to the workload generator (see below) |
| `sourceTag` | `string` | – | Free-form tag attached to every underlying simulation run |

### How it works

1. The workload generator produces **one set of `SyntheticRequestProfile[]`** from `workloadConfig`.
2. The simulation engine runs **one isolated simulation per policy**, each receiving **identical profiles**.
3. Per-policy metrics (`successRate`, `fallbackRate`, `averageEvaluationMs`) are derived from each run's `SimulationRunResult`.
4. Rankings (`bySuccessRate`, `byFallbackRate`, `byEvaluationSpeed`) are computed across all policies.

Because the workload is shared, differences in metrics reflect policy behaviour — not sampling variance.

### Programmatic usage

```ts
import { experimentRunnerService } from "../modules/simulation";

const result = await experimentRunnerService.run(ctx, {
  experimentName: "synthetic-pool-comparison",
  policies: ["policy-a", "policy-b"],
  workloadConfig: { requestCount: 200, randomSeed: 1 },
  modelOverrides: [/* fixed ModelCandidate[] */],
  workerOverrides: [/* fixed WorkerCandidate[] */],
});
```

`modelOverrides` and `workerOverrides` are programmatic-only — they bypass the live registries for all policy runs in the experiment.

## Workload generator

The `WorkloadGeneratorService` produces arrays of `SyntheticRequestProfile` that can be passed to the simulation engine via `SimulationRunInput.workloadProfiles`. Generated profiles are entirely in-memory — no live records are created.

```ts
import { workloadGeneratorService, simulationEngineService } from "../modules/simulation";

const profiles = workloadGeneratorService.generateWorkload({
  requestCount: 100,
  taskDistribution:       { chat: 0.6, reasoning: 0.3, analysis: 0.1 },
  inputSizeDistribution:  { small: 0.5, medium: 0.4, large: 0.1 },
  complexityDistribution: { low: 0.4, medium: 0.4, high: 0.2 },
  randomSeed: 42,           // omit for non-deterministic runs
});

const result = await simulationEngineService.run(ctx, {
  scenarioName:     "chat-heavy-baseline",
  requestCount:     profiles.length,
  workloadProfiles: profiles,
});
```

### Profile shape

| Field | Type | Description |
|---|---|---|
| `requestId` | `string` | `<prefix>-<index>` |
| `taskType` | `"chat" \| "analysis" \| "reasoning"` | Maps to `ModelTask` for routing evaluation |
| `inputSize` | `"small" \| "medium" \| "large"` | Token volume class |
| `estimatedComplexity` | `"low" \| "medium" \| "high"` | Combined with `inputSize` to determine token count |
| `requiredCapabilities` | `string[]` | Derived from `taskType` (see `TASK_CAPABILITIES`) |
| `estimatedTokenCount` | `number` | Sampled from `TOKEN_RANGES[inputSize][complexity]` |

### Token count ranges

| Input size | Low | Medium | High |
|---|---|---|---|
| small | 64–256 | 256–512 | 512–1 024 |
| medium | 512–1 500 | 1 500–3 000 | 3 000–5 000 |
| large | 5 000–8 000 | 8 000–16 000 | 16 000–32 000 |

### Burst pattern

```ts
workloadGeneratorService.generateWorkload({
  requestCount: 200,
  burstPattern: {
    burstInterval: 20,      // 20 regular requests, then…
    burstSize: 5,           // …5 burst requests (large/high/reasoning by default)
    burstTaskType: "reasoning",
    burstInputSize: "large",
    burstComplexity: "high",
  },
  randomSeed: 1,
});
```

Burst slots replace regular slots — total output length always equals `requestCount`.

### Determinism

Pass `randomSeed` for reproducible output. Omit it for time-seeded non-deterministic runs. The PRNG is mulberry32 — compact and statistically suitable for simulation use.

## Current limitations

- **No persistent storage** — simulation results are returned synchronously and not stored; there is no GET /simulation/runs/:id endpoint.
- **No async / queued execution** — runs are synchronous in the request–response cycle; large `requestCount` values will increase response latency.
- **No stochastic workload generation** — each request uses the same filter configuration; there is no Poisson arrival modelling or token-range sampling yet.
- **HTTP max 1 000 requests** — the HTTP API enforces `requestCount ≤ 1 000`; the service API has no limit.
- **No worker load simulation** — worker capacity is not decremented between iterations; each request sees the same candidate pool.
