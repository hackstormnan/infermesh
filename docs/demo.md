# Demo Walkthrough

A step-by-step guide to exploring the full InferMesh system locally — backend API, seed data, and frontend dashboard.

Expected time: **under 10 minutes** from a cold clone.

---

## Prerequisites

- Node.js 22+, npm
- `jq` (optional, for readable JSON output)

---

## 1. Start the backend

```bash
# From the repo root
npm install
npm run dev
```

Confirm it is healthy:

```bash
curl http://localhost:3000/health
# → { "success": true, "data": { "status": "ok" } }
```

---

## 2. Seed demo data

```bash
npm run seed
```

The seed script registers:
- **3 models** — a frontier, standard, and economy tier
- **3 workers** — simulated inference workers with differing capacity
- **1 routing policy** — `cost-optimised`, activated immediately
- **5 inference requests** — submitted via the intake endpoint, 3 of which are routed

After seeding you have a fully populated in-memory system ready to query.

---

## 3. Inspect the system state

### Models registered

```bash
curl http://localhost:3000/api/v1/models | jq '.data.items[] | {id, name, provider, qualityTier}'
```

### Workers registered

```bash
curl http://localhost:3000/api/v1/workers | jq '.data.items[] | {id, status, health}'
```

### Active routing policy

```bash
curl http://localhost:3000/api/v1/routing/policies | jq '.data.items[] | {name, strategy, status, priority}'
```

### Cross-module system stats

```bash
curl http://localhost:3000/api/v1/stats/summary | jq .data
```

---

## 4. Submit an inference request

```bash
curl -s -X POST http://localhost:3000/api/v1/intake/requests \
  -H "Content-Type: application/json" \
  -d '{
    "modelId": "gpt-4o",
    "prompt": "Summarise the Q1 earnings report",
    "taskType": "analysis",
    "priority": "normal"
  }' | jq '{requestId: .data.requestId, jobId: .data.jobId}'
```

Save the `jobId` for the next step:

```bash
export JOB_ID=<paste jobId here>
```

---

## 5. Trigger routing for the job

```bash
curl -s -X POST http://localhost:3000/api/v1/jobs/$JOB_ID/route | jq .data
```

The response shows the full routing decision including:
- Selected model and worker
- Per-candidate score breakdowns (quality, cost, latency, load)
- Evaluation time in milliseconds
- Whether a fallback was used

---

## 6. View routing decision history

```bash
curl http://localhost:3000/api/v1/routing/decisions?limit=10 | jq \
  '.data.items[] | {id, policyName, selectedModel, selectedWorker, evaluationMs, outcome}'
```

Every decision is persisted with full candidate evaluation detail — useful for auditing and replay.

---

## 7. Check request status

```bash
curl http://localhost:3000/api/v1/requests | jq '.data.items[] | {id, status, modelId}'
```

---

## 8. View metrics

```bash
# Summary with period-over-period trends
curl "http://localhost:3000/api/v1/metrics/summary?period=1h" | jq .data

# Latency percentiles
curl "http://localhost:3000/api/v1/metrics/latency-percentiles?period=1h" | jq .data

# Per-model cost breakdown
curl "http://localhost:3000/api/v1/metrics/cost-breakdown?period=1h" | jq .data
```

---

## 9. Subscribe to live events via WebSocket

Open a WebSocket connection and subscribe to all channels:

```bash
# Using wscat (npm install -g wscat)
wscat -c ws://localhost:3000/api/v1/stream
```

After connecting you will receive a system frame:

```json
{ "type": "system", "data": { "connectionId": "...", "availableChannels": ["requests","workers","routing","decisions"] } }
```

Subscribe to channels:

```json
{ "action": "subscribe", "channels": ["requests", "decisions", "workers"] }
```

Now submit another inference request in a second terminal — you will see the `requests` event arrive immediately, followed by a `decisions` event when the job is routed.

---

## 10. Run a policy simulation

Evaluate the active policy under a synthetic 100-request workload — no live records are created:

```bash
curl -s -X POST http://localhost:3000/api/v1/simulation/runs \
  -H "Content-Type: application/json" \
  -d '{
    "scenarioName": "baseline-100",
    "requestCount": 100
  }' | jq '{
    successCount: .data.successCount,
    failureCount: .data.failureCount,
    fallbackCount: .data.fallbackCount,
    avgEvalMs: .data.averageEvaluationMs,
    topModel: (.data.perModelSelections | to_entries | max_by(.value) | .key)
  }'
```

---

## 11. Compare policies with an experiment

Run two policies against the same synthetic workload and rank by success rate:

```bash
curl -s -X POST http://localhost:3000/api/v1/simulation/experiments \
  -H "Content-Type: application/json" \
  -d '{
    "experimentName": "cost-vs-latency",
    "policies": ["cost-optimised"],
    "workloadConfig": {
      "requestCount": 200,
      "taskDistribution": { "chat": 0.6, "analysis": 0.3, "reasoning": 0.1 },
      "randomSeed": 42
    }
  }' | jq '{
    winner: .data.rankings.bySuccessRate[0],
    durationMs: .data.durationMs,
    rankings: .data.rankings
  }'
```

Add more policy names to `policies` to compare them side-by-side. Each policy sees the exact same workload — differences in metrics reflect policy behaviour, not sampling variance.

---

## 12. Frontend dashboard

Start the frontend to explore the system visually:

```bash
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

Recommended page order:

| Step | Page | What to look at |
|---|---|---|
| 1 | **Overview** | Live request, routing, and worker stream panels |
| 2 | **Requests** | Filterable request log with live-appended rows |
| 3 | **Workers** | Health cards updating in real time |
| 4 | **Models** | Registry grid + latency vs cost comparison |
| 5 | **Routing** | Policy cards + live routing flow graph |
| 6 | **Metrics** | Time-series charts, percentile breakdown |
| 7 | **Simulation** | Single-run form + experiment comparison |

See [frontend/README.md](../frontend/README.md) for the full frontend demo walkthrough with per-page descriptions.

---

## What the demo covers

| Capability | Where to see it |
|---|---|
| Policy-driven routing with candidate scoring | Step 5–6, Routing page |
| Multi-dimensional weighted scoring | Routing decision JSON (`jq .data`) |
| WebSocket real-time event stream | Step 9, Overview / Requests pages |
| Offline simulation — no live state changes | Step 10–11, Simulation page |
| Multi-policy experiment comparison | Step 11, Simulation → Experiment tab |
| Repository interface isolation | `docs/architecture.md` — all `InMemory*` repos swap behind interfaces |
| Request correlation tracing | `x-request-id` header on every response |
