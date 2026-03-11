# Stream Gateway

Real-time WebSocket gateway for live operational updates from the InferMesh backend.

## Connection path

```
ws://localhost:3000/api/v1/stream
```

Upgrade via a standard WebSocket handshake (HTTP `GET /api/v1/stream` with `Upgrade: websocket`). TLS-terminated deployments use `wss://`.

## Subscribe message (client → server)

Send a JSON control message immediately after connecting to start receiving events:

```json
{
  "action": "subscribe",
  "channels": ["requests", "workers", "routing", "decisions"]
}
```

Unsubscribe from specific channels at any time:

```json
{
  "action": "unsubscribe",
  "channels": ["routing"]
}
```

Only `subscribe` and `unsubscribe` are valid actions. Unknown actions return an error frame without closing the connection. Channel names not in the known set are silently filtered out.

## Available channels

| Channel     | When emitted                                          | Key payload fields                                                       |
|-------------|-------------------------------------------------------|--------------------------------------------------------------------------|
| `requests`  | New inference request accepted through the intake flow | `requestId`, `jobId`, `queueMessageId`, `status`, `createdAt`            |
| `workers`   | Worker registered, heartbeat received, or deregistered | `workerId`, `name`, `status`, `region`, `activeJobs`, `event`            |
| `routing`   | Routing decision made (concise summary)               | `decisionId`, `outcome`, `selectedModelId`, `selectedWorkerId`, `evaluationMs` |
| `decisions` | Routing decision made (full detail)                   | All `routing` fields + `reason`, `candidateCount`, `decisionSource`      |

## Outbound message envelope (server → client)

Every frame sent by the server is a `StreamEnvelope`:

```json
{
  "type": "requests",
  "data": {
    "requestId": "req_abc123",
    "jobId": "job_xyz789",
    "queueMessageId": "msg_001",
    "status": "Dispatched",
    "createdAt": "2025-01-01T00:00:00.000Z",
    "enqueuedAt": "2025-01-01T00:00:00.050Z"
  },
  "timestamp": "2025-01-01T00:00:00.051Z"
}
```

The `type` field is the discriminant. In addition to channel names, the server also sends:

| `type`    | When                                           |
|-----------|------------------------------------------------|
| `system`  | Immediately on connection open (welcome frame) |
| `ack`     | After each successful subscribe/unsubscribe    |
| `error`   | When a control message cannot be parsed/honoured |

### Welcome frame (on connect)

```json
{
  "type": "system",
  "data": {
    "message": "Connected to InferMesh stream gateway",
    "connectionId": "550e8400-e29b-41d4-a716-446655440000",
    "availableChannels": ["requests", "workers", "routing", "decisions"]
  },
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

### Subscribe ack

```json
{
  "type": "ack",
  "data": { "action": "subscribe", "channels": ["requests", "workers"] },
  "timestamp": "2025-01-01T00:00:00.010Z"
}
```

## Internal dev/test endpoints

These endpoints are intentionally internal. Gate them behind a firewall rule or env flag in production.

### Emit a test event

```
POST /api/v1/internal/stream/emit
Content-Type: application/json

{ "channel": "workers", "data": { "workerId": "w-test", "status": "Idle", "event": "heartbeat" } }
```

Response:
```json
{ "published": true, "channel": "workers", "subscriberCount": 2 }
```

### Connection snapshot

```
GET /api/v1/internal/stream/status
```

Response:
```json
{
  "activeConnections": 1,
  "connections": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "subscribedChannels": ["requests", "workers"],
      "connectedAt": "2025-01-01T00:00:00.000Z"
    }
  ]
}
```

## Current limitations

- **Single-node only.** The `ConnectionRegistry` is an in-memory `Map`. There is no distributed pub/sub — events are only delivered to connections on the same process. Multi-node fanout (Redis pub/sub, NATS, etc.) is a planned future extension.
- **No persistent replay.** Events are delivered at the moment of publish and are not stored. Clients that are disconnected at publish time will miss those events. Stream replay/catch-up is not yet implemented.
- **No authentication.** The `/api/v1/stream` endpoint accepts any WebSocket upgrade without verifying credentials. Auth hardening (JWT validation on upgrade, per-channel ACLs) is deferred.
- **No domain wiring yet.** The broker is instantiated and the gateway is live, but domain services (IntakeService, WorkersService, RoutingDecisionService) do not yet call `broker.publish()`. That wiring is the next integration step.
- **No heartbeat/ping.** The gateway does not send periodic ping frames. Long-idle connections may be dropped by load balancers/proxies. Client-side reconnect logic is recommended.
- **No metrics.** Active connection count and message delivery metrics are not yet exported to Prometheus.

## Architecture notes

```
Domain services
      │
      │  broker.publish("requests", payload)
      ▼
IStreamBroker (interface)
      │
      ▼
InMemoryStreamBroker
      │  queries subscribers
      ▼
ConnectionRegistry ──── Map<connId, { socket, subscribedChannels }>
      │
      │  socket.send(JSON.stringify(envelope))
      ▼
WebSocket clients
```

The `IStreamBroker` interface is the only coupling point between domain logic and the stream transport. Replacing the in-memory implementation with a Redis or Kafka-backed broker requires zero changes to any call sites.
