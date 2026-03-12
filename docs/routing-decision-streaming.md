# Routing Decision Streaming

Real-time events for finalized routing decisions, delivered over the WebSocket stream gateway.

## Overview

Every time `RoutingDecisionService.decideRoute()` successfully selects a `(model, worker)` pair and persists the decision record, it publishes a `RoutingDecisionPayload` to the **`decisions`** WebSocket channel. Dashboard clients subscribed to this channel receive the event in real time.

## How to receive routing decision events

1. Connect to the stream gateway: `ws://host/api/v1/stream`
2. Send a subscribe control message:
   ```json
   { "action": "subscribe", "channels": ["decisions"] }
   ```
3. The server sends an `ack` frame, then delivers a `decisions` envelope for every finalized routing decision.

## Event envelope

```json
{
  "type": "decisions",
  "data": {
    "id": "a1b2c3d4-...",
    "timestamp": "2026-01-15T12:00:00.000Z",
    "selectedModel": "gpt-4o",
    "reason": "Model gpt-4o (score: 0.821); Worker worker-us-1 (score: 0.934); ...",
    "factors": {
      "latency": 0.72,
      "cost": 0.65,
      "availability": 0.91
    }
  },
  "timestamp": "2026-01-15T12:00:00.050Z"
}
```

### `data` field reference

| Field           | Type     | Description                                                               |
|-----------------|----------|---------------------------------------------------------------------------|
| `id`            | `string` | Server-assigned routing decision ID                                       |
| `timestamp`     | `string` | ISO 8601 timestamp when the decision was finalized (matches `createdAt`)  |
| `selectedModel` | `string` | Model identifier chosen for this request (e.g. `"gpt-4o"`)               |
| `reason`        | `string` | Human-readable explanation of why this model + worker were selected       |
| `factors`       | `object` | Normalized [0–1] scoring dimensions that drove the selection              |

### `factors` sub-fields

| Field          | Range | Meaning                                                            |
|----------------|-------|--------------------------------------------------------------------|
| `latency`      | 0–1   | Combined latency score for the selected model + worker pair        |
| `cost`         | 0–1   | Cost efficiency score for the selected model                       |
| `availability` | 0–1   | Worker availability (1 = fully free, 0 = saturated / high load)    |

Higher values are always better. A score of `1.0` means the candidate is optimal on that dimension relative to the configured weights.

## When is the event published?

The event is published by `RoutingDecisionService.decideRoute()` after:
1. The routing policy has been resolved
2. Model and worker candidates have been evaluated and ranked
3. The `RoutingDecision` record is persisted (`decisionRepo.save()`)

Publishing is **best-effort** (fire-and-forget). A broker error is logged at `warn` level but does not abort the routing flow or affect the result returned to the caller.

## Trigger paths

The event is emitted wherever `decideRoute()` is called:

| HTTP endpoint                 | Service chain                                                          |
|-------------------------------|------------------------------------------------------------------------|
| `POST /api/v1/jobs/:id/route` | `JobRoutingService` → `RoutingRecoveryService` → `RoutingDecisionService` |

## Architecture

```
POST /api/v1/jobs/:id/route
        │
        ▼
  JobRoutingService.routeJob()
        │
        ▼
  RoutingRecoveryService.attemptRouting()
        │
        ▼
  RoutingDecisionService.decideRoute()
        │
        ├── resolvePolicy()         → active RoutingPolicy
        ├── modelRegistry.findEligible() → model candidates scored
        ├── workerRegistry.findEligible() → worker candidates scored
        ├── buildDecision()         → RoutingDecision assembled
        ├── decisionRepo.save()     → decision persisted
        │
        └── broker.publish("decisions", payload)
                │
                ▼
          InMemoryStreamBroker
                │  fans out to subscribed connections
                ▼
          WebSocket clients
```

`RoutingDecisionService` depends only on `IStreamBroker` — it has no knowledge of WebSocket connections, the registry, or transport details.

## Current limitations

- **`factors` values are derived from the winning candidate only** — scores for rejected candidates are not included in the stream event. Full candidate evaluation details are available via `GET /api/v1/routing/decisions/:id`.
- **Single decision event** — only the final selection is streamed. There is no in-progress event for the evaluation phase.
- **No client filtering** — all subscribers to the `decisions` channel receive all routing decision events regardless of model, policy, or request origin.
- **In-memory broker only** — events are only delivered to WebSocket connections on the current process. Multi-node fanout is a future concern.
