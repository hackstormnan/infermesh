# Request Streaming

Real-time events for newly accepted inference requests, delivered over the WebSocket stream gateway.

## Overview

Every time a new inference request is accepted through `POST /api/v1/inference/requests`, the intake orchestrator publishes a `RequestAcceptedPayload` to the **`requests`** WebSocket channel. Dashboard clients subscribed to this channel receive the event in real time without polling.

## How to receive request events

1. Connect to the stream gateway: `ws://host/api/v1/stream`
2. Send a subscribe control message:
   ```json
   { "action": "subscribe", "channels": ["requests"] }
   ```
3. The server sends an `ack` frame, then delivers a `requests` envelope for every new accepted request.

## Event envelope

```json
{
  "type": "requests",
  "data": {
    "id": "req_abc123",
    "timestamp": "2026-01-15T12:00:00.000Z",
    "model": "gpt-4o",
    "latency": 0,
    "status": "pending",
    "endpoint": "/api/v1/inference/requests"
  },
  "timestamp": "2026-01-15T12:00:00.050Z"
}
```

### `data` field reference

| Field      | Type     | Description                                                              |
|------------|----------|--------------------------------------------------------------------------|
| `id`       | `string` | Server-assigned request ID                                               |
| `timestamp`| `string` | ISO 8601 timestamp when the request was accepted (matches `createdAt`)   |
| `model`    | `string` | Model identifier the request targets (e.g. `"gpt-4o"`, `"llama-3-70b"`) |
| `latency`  | `number` | End-to-end latency in milliseconds. Always `0` at acceptance time.       |
| `status`   | `string` | Dashboard status. Always `"pending"` at acceptance time.                 |
| `endpoint` | `string` | Intake API path. Always `"/api/v1/inference/requests"`.                  |

### Status vocabulary

| Value         | Meaning                                              |
|---------------|------------------------------------------------------|
| `pending`     | Request accepted and queued; waiting for a worker    |
| `processing`  | *(future)* Worker assigned; execution in flight      |
| `completed`   | *(future)* Request completed successfully            |
| `failed`      | *(future)* Request reached a terminal failure state  |

## When is the event published?

The event is published by `IntakeService` after:
1. The `InferenceRequest` record is persisted (status: `Queued`)
2. The `Job` record is created and linked (status: `Dispatched`)
3. The job has been placed on the queue

Publishing is **best-effort** (fire-and-forget). A broker error is logged at `warn` level but does not abort the intake or affect the HTTP response returned to the caller.

## Architecture

```
POST /api/v1/inference/requests
        │
        ▼
  IntakeService.intake()
        │
        ├── requestsService.create()     → InferenceRequest persisted
        ├── jobsService.createJob()      → Job created
        ├── queueService.enqueueJob()    → Job enqueued
        ├── requestsService.updateStatus() → status: Dispatched
        │
        └── broker.publish("requests", payload)
                │
                ▼
          InMemoryStreamBroker
                │  fans out to subscribed connections
                ▼
          WebSocket clients
```

The `IntakeService` depends only on `IStreamBroker` — it has no knowledge of WebSocket connections, the registry, or transport details.

## Current limitations

- **`latency` is always `0`** — actual end-to-end latency is not yet measured. A future ticket will publish a follow-up event once the worker completes execution.
- **Single channel event** — only the initial acceptance is streamed. Status transitions (pending → processing → completed/failed) are not yet emitted.
- **No client filtering** — all subscribers to the `requests` channel receive all request events regardless of model or priority. Per-client filtering (e.g. "only show my requests") is not yet implemented.
- **In-memory broker only** — events are only delivered to WebSocket connections on the current process. Multi-node fanout is a future concern.
