# Screenshots

Visual reference for the InferMesh frontend dashboard.

> **Note:** Replace the placeholder paths below with actual screenshots after running the app locally.
> Recommended tool: browser DevTools → "Capture screenshot", or any screen capture utility.
> Target viewport: 1440 × 900 or wider.

---

## Overview

**Route:** `/overview`

The main system pulse view. Four summary stat cards (Total Requests, Success Rate, Avg Latency, Total Cost) above three live stream panels: Incoming Requests, Routing Decisions, and Worker Status. All three panels receive WebSocket events in real time without a page refresh.

![Overview page](screenshots/overview.png)

---

## Requests

**Route:** `/requests`

Filterable, paginated request log. The filter bar supports narrowing by status and model. New requests are appended live via WebSocket. Each row shows request ID, model, status badge, latency, cost, and timestamp.

![Requests page](screenshots/requests.png)

---

## Workers

**Route:** `/workers`

Live worker registry. Each card shows worker ID, endpoint, health status, capacity progress bar, and runtime metrics (GPU util, memory, requests served). Cards update in-place when heartbeat events arrive. The summary row tracks Healthy / Degraded / Offline counts.

![Workers page — healthy state](screenshots/workers-healthy.png)
![Workers page — degraded state](screenshots/workers-degraded.png)

---

## Models

**Route:** `/models`

Model registry grid (3-column). Each card shows provider badge, quality tier, context window, TTFT, and pricing. The Latency vs Cost Comparison panel below visualises active models as dual horizontal bars for quick ranking.

![Models page](screenshots/models.png)
![Models — latency vs cost comparison panel](screenshots/models-comparison.png)

---

## Routing

**Route:** `/routing`

Policy cards show name, strategy, status, and priority. The Live Routing Flow panel at the bottom visualises recent decisions as they arrive — model selected, worker assigned, evaluation time, and fallback indicator.

![Routing page — policy cards](screenshots/routing-policies.png)
![Routing page — live flow graph](screenshots/routing-flow.png)

---

## Metrics

**Route:** `/metrics`

Analytics dashboard with a period selector (1h / 6h / 24h / 7d). Includes throughput time-series chart, latency line chart (p50 / p95 / p99), latency percentile breakdown card, and per-model cost allocation table.

![Metrics page — charts](screenshots/metrics-charts.png)
![Metrics page — cost breakdown table](screenshots/metrics-cost.png)

---

## Simulation — Single Run

**Route:** `/simulation` (Single Run tab)

Left column: form with scenario name, policy selector, request count, and source tag. Right column: results panel showing success / fallback / failure counts, average evaluation time, and per-model / per-worker selection bar charts.

![Simulation — single run form](screenshots/simulation-run-form.png)
![Simulation — single run results](screenshots/simulation-run-results.png)

---

## Simulation — Experiment Comparison

**Route:** `/simulation` (Experiment tab)

Left column: multi-policy experiment form with advanced workload distribution controls (task type, input size, complexity, burst pattern, random seed). Right column: side-by-side policy metric cards, rankings by success rate / fallback rate / evaluation speed, and a winner banner.

![Simulation — experiment form](screenshots/simulation-experiment-form.png)
![Simulation — experiment results](screenshots/simulation-experiment-results.png)

---

## Empty and loading states

The dashboard is designed to be honest about data freshness and connection state.

| State | What you see |
|---|---|
| First load | Skeleton placeholder blocks in the shape of each card or row |
| Background refresh failed | Amber "Stale · Xm ago" badge next to the refresh button; existing data remains visible |
| WebSocket connecting | Amber pulsing "Connecting…" badge in the page header |
| WebSocket reconnecting | Amber pulsing "Reconnecting…" badge — shown only after a prior successful connection |
| WebSocket disconnected | Grey "Disconnected" badge — shown only on initial connect failure |
| No data (first run) | Centred empty-state illustration with a description of how to populate the section |

![Empty state — no workers registered](screenshots/empty-workers.png)
![Stale badge — background refresh failed](screenshots/stale-badge.png)
![Connection badge — reconnecting](screenshots/connection-reconnecting.png)
