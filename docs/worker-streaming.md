# Worker Status Streaming

Real-time events for worker lifecycle and runtime metric changes, delivered over the WebSocket stream gateway.

## Overview

Every time a worker's state changes — registration, heartbeat, or deregistration — `WorkersService` publishes a `WorkerStatusPayload` to the **`workers`** WebSocket channel. Dashboard clients subscribed to this channel receive the event in real time.

## How to receive worker events

1. Connect to the stream gateway: `ws://host/api/v1/stream`
2. Send a subscribe control message:
   ```json
   { "action": "subscribe", "channels": ["workers"] }
   ```
3. The server sends an `ack` frame, then delivers a `workers` envelope for every worker state change.

## Event envelope

```json
{
  "type": "workers",
  "data": {
    "workerId": "worker-001",
    "status": "healthy",
    "cpu": 72,
    "memory": 55,
    "latency": 180,
    "queueSize": 1,
    "throughput": 85,
    "name": "us-east-worker-1",
    "region": "us-east-1",
    "lastHeartbeat": 1737000000000,
    "loadScore": 0.4,
    "event": "heartbeat"
  },
  "timestamp": "2026-01-15T12:00:00.050Z"
}
```

### `data` field reference

| Field           | Type     | Always present | Description                                                                |
|-----------------|----------|----------------|----------------------------------------------------------------------------|
| `workerId`      | `string` | ✓              | Server-assigned worker ID                                                  |
| `status`        | `string` | ✓              | Dashboard-facing status: `"healthy"`, `"degraded"`, or `"offline"`         |
| `queueSize`     | `number` | ✓              | Number of jobs queued locally on the worker                                |
| `name`          | `string` | ✓              | Worker display name                                                        |
| `lastHeartbeat` | `number` | ✓              | Unix epoch ms of the last received heartbeat                               |
| `event`         | `string` | ✓              | What triggered the event: `"registered"`, `"heartbeat"`, `"deregistered"` |
| `cpu`           | `number` | optional       | CPU utilisation percentage (0–100); absent until first heartbeat           |
| `memory`        | `number` | optional       | Memory utilisation percentage (0–100); absent until first heartbeat        |
| `latency`       | `number` | optional       | Time-to-first-token in milliseconds (rolling average)                      |
| `throughput`    | `number` | optional       | Output throughput in tokens per second                                     |
| `region`        | `string` | optional       | Geographic or logical region                                               |
| `loadScore`     | `number` | optional       | Composite load score [0 = idle, 1 = saturated]                             |

### Status vocabulary

The `status` field is simplified from the internal `WorkerStatus` enum:

| Internal `WorkerStatus` | Stream `status` |
|-------------------------|-----------------|
| `idle`                  | `"healthy"`     |
| `busy`                  | `"healthy"`     |
| `draining`              | `"degraded"`    |
| `unhealthy`             | `"degraded"`    |
| `offline`               | `"offline"`     |

Higher-level display logic (e.g. colour coding) is left to the dashboard client.

## When is the event published?

| Operation                      | Trigger                                         | `event` value    |
|--------------------------------|-------------------------------------------------|------------------|
| `POST /api/v1/workers`         | Worker self-registration                        | `"registered"`   |
| `POST /api/v1/workers/:id/heartbeat` | Capacity and metrics report               | `"heartbeat"`    |
| `DELETE /api/v1/workers/:id`   | Graceful deregistration                         | `"deregistered"` |

Publishing is **best-effort** (fire-and-forget). A broker error is logged at `warn` level but does not abort the operation or affect the response returned to the caller.

## Architecture

```
POST /api/v1/workers (register | heartbeat | deregister)
        │
        ▼
  WorkersService.register() | heartbeat() | deregister()
        │
        ├── repo.create() / repo.update()   → Worker entity persisted
        │
        └── broker.publish("workers", payload)
                │
                ▼
          InMemoryStreamBroker
                │  fans out to subscribed connections
                ▼
          WebSocket clients
```

`WorkersService` depends only on `IStreamBroker` — it has no knowledge of WebSocket connections or transport details.

## Wiring

The broker is injected into `WorkersService` via `buildWorkersModule(broker)` in `app/routes.ts`:

```ts
// app/routes.ts
const { broker } = createStreamServices();
await fastify.register(buildWorkersModule(broker), { prefix: "/api/v1" });
```

## Current limitations

- **No in-progress heartbeat events** — only the final persisted state is published; intermediate evaluation steps are not streamed.
- **No client filtering** — all subscribers to the `workers` channel receive all worker events regardless of region, model, or label.
- **In-memory broker only** — events are only delivered to WebSocket connections on the current process. Multi-node fanout is a future concern.
- **No heartbeat ingestion from external agents yet** — the worker heartbeat HTTP endpoint is available, but periodic background eviction is not yet implemented.
