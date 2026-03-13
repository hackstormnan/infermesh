# API Examples

Copy-paste `curl` examples for every InferMesh route. All examples target `http://localhost:3000` (the default dev server).

Set up a base URL variable to simplify commands:

```bash
export BASE=http://localhost:3000
```

---

## Health

```bash
curl $BASE/health
```

```jsonc
{
  "success": true,
  "data": { "status": "ok" },
  "meta": { "requestId": "uuid", "timestamp": "2026-01-01T00:00:00.000Z" }
}
```

---

## Model registry

### Register a model

```bash
curl -s -X POST $BASE/api/v1/models \
  -H "Content-Type: application/json" \
  -d '{
    "name": "gpt-4o",
    "aliases": ["gpt-4o-2024-11-20"],
    "provider": "openai",
    "version": "2024-11-20",
    "capabilities": ["text_generation", "tool_use", "vision", "code_generation"],
    "supportedTasks": ["chat", "coding", "reasoning"],
    "qualityTier": "frontier",
    "contextWindow": 128000,
    "maxOutputTokens": 16384,
    "pricing": { "inputPer1kTokens": 0.0025, "outputPer1kTokens": 0.01 },
    "latencyProfile": { "ttftMs": 350, "tokensPerSecond": 110 },
    "metadata": {}
  }' | jq .data.id
```

### List models

```bash
curl "$BASE/api/v1/models?limit=20&page=1" | jq .
```

Filter by provider and quality tier:

```bash
curl "$BASE/api/v1/models?provider=anthropic&qualityTier=standard" | jq .data.items
```

### Fetch a single model

```bash
curl $BASE/api/v1/models/<model-id> | jq .
```

### Update model status or pricing

```bash
curl -s -X PATCH $BASE/api/v1/models/<model-id> \
  -H "Content-Type: application/json" \
  -d '{ "status": "inactive" }' | jq .data.status
```

### Deregister a model

```bash
curl -s -X DELETE $BASE/api/v1/models/<model-id>
```

---

## Worker registry

### Register a worker

```bash
curl -s -X POST $BASE/api/v1/workers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "gpu-worker-a",
    "endpoint": "http://worker-a.internal:8080",
    "supportedModelIds": ["<model-id-1>", "<model-id-2>"],
    "region": "us-east-1",
    "hardware": {
      "instanceType": "p4d.24xlarge",
      "gpuModel": "NVIDIA A100 80GB"
    },
    "capacity": {
      "activeJobs": 0,
      "maxConcurrentJobs": 8,
      "queuedJobs": 0
    },
    "labels": { "tier": "premium", "team": "platform" }
  }' | jq .data.id
```

### List workers

```bash
curl "$BASE/api/v1/workers?status=idle&region=us-east-1" | jq .data.items
```

### Worker heartbeat

Workers call this endpoint on a regular interval to report current capacity and runtime metrics:

```bash
curl -s -X POST $BASE/api/v1/workers/<worker-id>/heartbeat \
  -H "Content-Type: application/json" \
  -d '{
    "status": "idle",
    "capacity": { "activeJobs": 2, "maxConcurrentJobs": 8, "queuedJobs": 0 },
    "reportedAt": '"$(date +%s000)"',
    "runtimeMetrics": {
      "tokensPerSecond": 95.4,
      "loadScore": 0.25,
      "ttftMs": 310,
      "cpuUsagePercent": 12.5,
      "memoryUsagePercent": 68.0,
      "uptimeSeconds": 14400
    }
  }' | jq .data.status
```

### Deregister a worker

```bash
curl -s -X DELETE $BASE/api/v1/workers/<worker-id>
```

---

## Routing policies

### Create a cost-optimised policy

```bash
curl -s -X POST $BASE/api/v1/routing/policies \
  -H "Content-Type: application/json" \
  -d '{
    "name": "cost-optimised",
    "description": "Prefer the lowest-cost candidate that satisfies constraints",
    "strategy": "cost_optimised",
    "constraints": {
      "maxCostUsd": 0.05,
      "maxLatencyMs": 5000
    },
    "weights": { "quality": 0.1, "cost": 0.6, "latency": 0.2, "load": 0.1 },
    "allowFallback": true,
    "fallbackStrategy": "least_loaded",
    "priority": 10
  }' | jq .data
```

### Create a latency-optimised policy

```bash
curl -s -X POST $BASE/api/v1/routing/policies \
  -H "Content-Type: application/json" \
  -d '{
    "name": "latency-optimised",
    "description": "Minimise time-to-first-token for interactive workloads",
    "strategy": "latency_optimised",
    "constraints": {},
    "weights": { "quality": 0.1, "cost": 0.1, "latency": 0.7, "load": 0.1 },
    "allowFallback": true,
    "fallbackStrategy": "least_loaded",
    "priority": 5
  }' | jq .data
```

### Activate a policy

Newly created policies default to `inactive`. Activate before routing:

```bash
curl -s -X PATCH $BASE/api/v1/routing/policies/<policy-id> \
  -H "Content-Type: application/json" \
  -d '{ "status": "active" }' | jq .data.status
```

### List policies

```bash
curl "$BASE/api/v1/routing/policies?status=active" | jq .data.items
```

---

## Request intake

### Submit an inference request

```bash
curl -s -X POST $BASE/api/v1/intake/requests \
  -H "Content-Type: application/json" \
  -d '{
    "endpoint": "gpt-4o",
    "taskType": "chat",
    "input": {
      "messages": [
        { "role": "user", "content": "Explain transformer attention in one paragraph." }
      ]
    },
    "inputSize": 24,
    "estimatedComplexity": "medium",
    "priority": "normal"
  }' | jq .data
```

Response (HTTP 202):

```jsonc
{
  "success": true,
  "data": {
    "requestId": "req_...",
    "jobId": "job_...",
    "queueMessageId": "msg_...",
    "status": "dispatched",
    "jobStatus": "queued",
    "createdAt": "2026-01-01T00:00:00.000Z",
    "enqueuedAt": 1735689600000
  }
}
```

### List inference requests

```bash
curl "$BASE/api/v1/requests?limit=10&page=1" | jq .data
```

---

## Job management

### Route a queued job

Triggers the routing engine to evaluate candidates and assign the job to an (model, worker) pair:

```bash
curl -s -X POST $BASE/api/v1/jobs/<job-id>/route \
  -H "Content-Type: application/json" \
  -d '{}' | jq .data
```

### List jobs

```bash
curl "$BASE/api/v1/jobs?status=assigned&limit=20" | jq .data.items
```

Filter by worker or model:

```bash
curl "$BASE/api/v1/jobs?workerId=<worker-id>" | jq .data.items
```

---

## Routing decisions

### List routing decisions

```bash
curl "$BASE/api/v1/routing/decisions?limit=10" | jq .data.items
```

### Fetch a decision with full score breakdown

```bash
curl $BASE/api/v1/routing/decisions/<decision-id> | jq .data
```

Example response shape — note the `candidates` array with per-dimension score breakdowns:

```jsonc
{
  "id": "dec_...",
  "requestId": "req_...",
  "jobId": "job_...",
  "policyId": "pol_...",
  "outcome": "routed",
  "selectedModelId": "mdl_...",
  "selectedWorkerId": "wkr_...",
  "strategy": "cost_optimised",
  "usedFallback": false,
  "reason": "Candidate selected: lowest weighted score under cost_optimised strategy",
  "candidates": [
    {
      "modelId": "mdl_...",
      "workerId": "wkr_...",
      "estimatedCostUsd": 0.0018,
      "estimatedLatencyMs": 350,
      "excluded": false,
      "scoreBreakdown": {
        "quality": 1.0,
        "cost": 0.9,
        "latency": 0.75,
        "load": 1.0,
        "total": 0.91,
        "rationale": "Frontier model, low cost, low load"
      }
    }
  ],
  "decidedAt": 1735689600000,
  "evaluationMs": 4
}
```

---

## Metrics

### System-wide summary

```bash
curl "$BASE/api/v1/metrics/summary?period=24h" | jq .data
```

### Time-series data

```bash
curl "$BASE/api/v1/metrics/time-series?period=1h" | jq .data
```

### Latency percentiles

```bash
curl "$BASE/api/v1/metrics/latency-percentiles?period=24h" | jq .data
```

### Cost breakdown by model

```bash
curl "$BASE/api/v1/metrics/cost-breakdown?period=7d" | jq .data
```

---

## Stats summary

Cross-module aggregate — total requests, jobs, workers, models, queue depth:

```bash
curl $BASE/api/v1/stats/summary | jq .data
```

---

## Simulation

### Run a simulation against a policy

Runs `requestCount` synthetic routing evaluations entirely offline — does not create requests, jobs, or routing decisions in the live system:

```bash
curl -s -X POST $BASE/api/v1/simulation/runs \
  -H "Content-Type: application/json" \
  -d '{
    "scenarioName": "peak-load-test",
    "requestCount": 100,
    "workload": {
      "requestIdPrefix": "sim-peak"
    }
  }' | jq .data
```

### Policy experiment — compare multiple policies

Runs identical synthetic workloads against each named policy and returns a comparative ranking:

```bash
curl -s -X POST $BASE/api/v1/simulation/experiments \
  -H "Content-Type: application/json" \
  -d '{
    "experimentName": "cost-vs-latency-q1",
    "policies": ["cost-optimised", "latency-optimised", "round-robin"],
    "workloadConfig": {
      "requestCount": 200,
      "randomSeed": 42,
      "taskDistribution": {
        "chat": 0.6,
        "coding": 0.3,
        "summarization": 0.1
      }
    }
  }' | jq '.data | { winner: .winner, rankings: [.policyResults[] | { policy: .policyName, successRate: .successRate, avgEvalMs: .avgEvaluationMs }] }'
```

---

## WebSocket event stream

Subscribe to real-time events using any WebSocket client. Events are enveloped as:

```jsonc
{
  "channel": "decisions",
  "payload": { /* channel-specific payload */ },
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

### Using `wscat`

```bash
# Install: npm install -g wscat
wscat -c ws://localhost:3000/api/v1/stream
```

Once connected, subscribe to one or more channels:

```json
{ "type": "subscribe", "channels": ["requests", "decisions"] }
```

Subscribe to all channels:

```json
{ "type": "subscribe", "channels": ["requests", "workers", "routing", "decisions"] }
```

### Available channels

| Channel | Fires when |
|---|---|
| `requests` | A new inference request is accepted via `POST /intake/requests` |
| `workers` | A worker registers, sends a heartbeat, or is deregistered |
| `routing` | A routing policy is created or its status changes |
| `decisions` | A routing decision is made (live or simulation) |

### Using Node.js

```js
const ws = new WebSocket("ws://localhost:3000/api/v1/stream");

ws.on("open", () => {
  ws.send(JSON.stringify({
    type: "subscribe",
    channels: ["decisions", "requests"],
  }));
});

ws.on("message", (raw) => {
  const event = JSON.parse(raw.toString());
  console.log(`[${event.channel}]`, event.payload);
});
```

---

## Internal stream endpoints

### Publish a test event

```bash
curl -s -X POST $BASE/api/v1/internal/stream/emit \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "requests",
    "payload": { "message": "test event" }
  }' | jq .
```

### Stream gateway status

```bash
curl $BASE/api/v1/internal/stream/status | jq .
```
