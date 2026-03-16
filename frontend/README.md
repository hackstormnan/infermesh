# InferMesh — Frontend Dashboard

A React + TypeScript admin console for the [InferMesh](../README.md) AI inference routing backend.
Demonstrates live WebSocket streams, REST-backed data grids, interactive simulation forms, and a dark infrastructure-console visual style — all without a UI framework.

---

## What this demonstrates

| Capability | Implementation |
|---|---|
| Live WebSocket streams | `useStreamSocket` → `useRequestStream`, `useWorkerStream`, `useDecisionStream` |
| REST polling with stale-data UX | `useModelsPage`, `useRoutingPage`, `useMetricsPage` — 30–60 s auto-refresh |
| Reconnecting connection state | `connecting → connected → reconnecting → disconnected` in `ConnectionStatusBadge` |
| Interactive simulation forms | Controlled React forms → `POST /simulation/runs` and `/simulation/experiments` |
| Adapter / mapper layer | `src/api/mappers/` — DTOs → ViewModels; pages only see clean view types |
| Shared UI primitive library | `src/components/ui/` — Panel, Badge, StatCard, EmptyState, ErrorState, StaleBadge, … |
| TypeScript strict mode | Full `tsc --noEmit` passes clean; no `any` in page or hook code |

---

## Pages at a glance

| Page | Route | Data source | Key feature |
|---|---|---|---|
| **Overview** | `/overview` | REST stats + 3 WebSocket streams | Live request, routing, and worker feeds side-by-side |
| **Requests** | `/requests` | REST paginated + WebSocket stream | Filterable table with live-appended rows |
| **Workers** | `/workers` | REST seed + WebSocket heartbeats | Real-time health cards updated in-place |
| **Models** | `/models` | REST poll (60 s) | Registry grid + latency vs cost comparison panel |
| **Routing** | `/routing` | REST poll (30 s) + WebSocket decisions | Policy cards + live routing flow graph |
| **Metrics** | `/metrics` | REST analytics endpoints | Time-series charts, percentile breakdown, cost table |
| **Simulation** | `/simulation` | REST POST (on demand) | Single-run + multi-policy experiment comparison |

---

## Prerequisites

- **Node.js 22+** and npm
- The **InferMesh backend** running locally (see [../README.md](../README.md))

The frontend proxies all API calls to `http://localhost:3000` via the Vite dev server config.
No CORS configuration needed during local development.

---

## Quick start

```bash
# From the repo root — start the backend first
npm run dev          # starts Fastify on :3000

# Terminal 2 — seed demo data (models, workers, policy, requests)
npm run seed

# Terminal 3 — start the frontend
cd frontend
npm install
npm run dev          # starts Vite on :5173
```

Open [http://localhost:5173](http://localhost:5173) — you should see the Overview page with live stream panels already receiving events.

---

## Recommended demo walkthrough

Follow this sequence for the clearest reviewer or hiring-manager walkthrough.
Run `npm run seed` in the backend terminal before starting.

### 1. Overview — live system pulse
Navigate to **Overview**. You'll see three live panels:
- **Incoming Requests** — new requests appear in real time via WebSocket
- **Routing Decisions** — policy evaluations stream in as jobs are routed
- **Worker Status** — heartbeat health updates land without page refresh

The four summary cards (Total Requests, Success Rate, Avg Latency, Total Cost) are REST-polled and update every 30 seconds.

### 2. Requests — filterable request log
Navigate to **Requests**. The table shows all accepted inference requests with status, model, latency, and cost columns. Use the filter bar to narrow by status or model. New requests appended via WebSocket appear at the top without a full reload.

### 3. Metrics — analytics dashboard
Navigate to **Metrics**. Select a time period (1h / 6h / 24h / 7d). You'll see:
- Throughput time-series chart
- Latency line chart (p50 / p95 / p99)
- Latency percentile breakdown card
- Per-model cost allocation table

### 4. Routing — policy engine view
Navigate to **Routing**. Policy cards show name, strategy, status, and priority. The **Live Routing Flow** panel visualises recent decisions as they arrive over WebSocket — model selected, worker assigned, evaluation time, and fallback status.

### 5. Workers — live worker registry
Navigate to **Workers**. Each card shows worker ID, capacity bar, health status, and runtime metrics (requests served, GPU util, memory). Cards update in-place when heartbeat events arrive. Healthy / Degraded / Offline counts update in the summary row.

### 6. Models — model registry
Navigate to **Models**. The grid lists registered models with provider, quality tier, context window, TTFT, and pricing. The **Latency vs Cost Comparison** panel below visualises active models as horizontal bars for quick comparison.

### 7. Simulation — offline policy evaluation
Navigate to **Simulation**.

**Single Run tab:** Fill in a scenario name (e.g. `peak-load-test`), leave policy blank to use the active default, set request count to 100, and click **Run Simulation**. Results show success rate, fallback rate, avg evaluation time, and per-model / per-worker selection breakdowns.

**Experiment tab:** Enter a name (e.g. `cost-vs-latency`), add two policy IDs on separate lines, and click **Run Experiment**. The results panel ranks policies by success rate with side-by-side metric cards and a clear winner banner.

---

## Frontend architecture

### App shell

```
src/
├── main.tsx                  # React 18 createRoot entry point
├── App.tsx                   # BrowserRouter + AppShell + Routes
├── index.css                 # CSS custom properties (design tokens), global resets,
│                             # @keyframes spin + pulse
└── components/layout/
    ├── AppShell.tsx           # Sidebar + main content flex wrapper
    ├── Sidebar.tsx            # Nav links (React Router Links), brand, connection footer
    └── Topbar.tsx             # Page-level topbar (currently minimal)
```

### Shared UI primitives (`src/components/ui/`)

All primitive components accept only inline styles (no CSS modules, no Tailwind).
Design tokens live entirely in CSS custom properties in `index.css`.

| Component | Purpose |
|---|---|
| `Panel` / `PanelHeader` | Bordered surface card with optional title + subtitle + right slot |
| `MiniStatCard` | Small labelled metric tile with optional accent colour and loading skeleton |
| `StatCard` | Larger metric card used on Metrics page |
| `Badge` | Coloured label chip |
| `StatusBadge` | Semantic status (active / inactive / pending / error) |
| `ConnectionStatusBadge` | WebSocket state pill (connecting / connected / reconnecting / disconnected / error) |
| `StaleBadge` | Amber "Stale · Xm ago" indicator when background refresh has failed |
| `RefreshButton` | Spinning-icon manual refresh trigger |
| `EmptyState` | Centred icon + title + description for zero-data sections |
| `ErrorState` | Centred alert icon + message + optional retry button |
| `SkeletonBlock` | Animated placeholder rectangle for loading states |
| `ProgressBar` | Thin horizontal fill bar |
| `TrendBadge` | ↑/↓ percentage change badge |
| `ChartContainer` | Recharts wrapper with consistent padding |
| `TableShell` | Consistent table wrapper with header/body styles |

### Page structure

Each page follows the same layout contract:

```
Page component
├── Hook (data + state)         useXxxPage / useXxxStream
│   ├── REST fetch or WebSocket  apiClient.get() / useStreamSocket()
│   ├── DTO → ViewModel mapping  src/api/mappers/xxx.mapper.ts
│   └── Returns: data, loading, error, isStale, lastUpdatedAt, refetch
├── Page header                  h1 title + subtitle + StaleBadge + RefreshButton
├── Summary stat row             4× MiniStatCard
└── Content area                 grid of feature-specific components
```

### Frontend contracts / adapters

```
src/api/
├── client.ts                   # Typed fetch wrapper; adds /api/v1/ prefix; throws ApiClientError
├── types/                      # DTO types matching backend JSON responses exactly
│   ├── common.ts               # PaginatedData, ApiResponse, StreamEvent
│   ├── stats.ts  requests.ts  workers.ts  models.ts  routing.ts
│   ├── metrics.ts  simulation.ts  stream.ts
└── mappers/                    # Pure functions: DTO → ViewModel
    ├── stats.mapper.ts         # StatsDto → StatsViewModel
    ├── request.mapper.ts       # RequestDto → RequestViewModel
    ├── worker.mapper.ts        # WorkerDto → WorkerViewModel
    ├── model.mapper.ts         # ModelDto → ModelViewModel
    ├── routing.mapper.ts       # RoutingPolicyDto + DecisionDto → ViewModels
    ├── metrics.mapper.ts       # MetricsSummaryDto + time-series → ViewModels
    └── simulation.mapper.ts    # SimRunDto + ExperimentDto → ViewModels
```

Pages import only ViewModel types. DTO shapes never leak into components.

### REST integration pattern

```ts
// hooks/useModelsPage.ts (representative example)
const load = useCallback((showLoading: boolean) => {
  if (showLoading) setLoading(true)
  apiClient.get<PaginatedData<ModelDto>>('/models?limit=100')
    .then(result => {
      setModels(mapModels(result.items))
      setIsStale(false)
      setLastUpdatedAt(new Date())
      firstLoad.current = false
    })
    .catch(e => {
      if (!firstLoad.current) setIsStale(true)   // background failure → keep data
      else setError(e.message)                    // first-load failure → show error
    })
    .finally(() => { if (showLoading) setLoading(false) })
}, [])
```

Stale-data rule: if data already exists and a background refresh fails, show the existing data with a `StaleBadge` rather than collapsing the page into an error state.

### WebSocket integration pattern

```
useStreamSocket (src/hooks/useStreamSocket.ts)
│  Manages connect / exponential-backoff reconnect / teardown
│  Tracks hasConnectedRef to distinguish initial connect from reconnect
│  ConnectionState: 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error'
│
├── useRequestStream   — subscribes to "requests" channel
├── useWorkerStream    — subscribes to "workers" channel  (REST seed on mount)
└── useDecisionStream  — subscribes to "decisions" channel
```

All WebSocket consumers show `<ConnectionStatusBadge state={connectionState} />` in their page headers so users always know the stream health.

---

## Available scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server on `:5173` with HMR |
| `npm run build` | TypeScript compile + Vite production bundle → `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run typecheck` | Full `tsc --noEmit` type check |

---

## Tech stack

| Dependency | Version | Role |
|---|---|---|
| React | 18.3 | UI rendering |
| React Router | 6.26 | Client-side routing |
| Recharts | 2.x | Time-series and bar charts |
| Lucide React | 0.441 | Icon set |
| Vite | 5.x | Dev server + bundler |
| TypeScript | 5.x | Strict type checking |

No CSS framework. No component library. All styling via CSS custom properties and inline style objects.
