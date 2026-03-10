# Job Queue Abstraction

## Overview

InferMesh uses a transport-neutral queue layer to decouple job creation (intake)
from job execution (routing + worker dispatch). When a new inference request is
accepted, a `QueueMessage` is immediately placed into the queue. A routing
processor (Ticket 13+) will dequeue messages and drive jobs through the
lifecycle service.

## Architecture

```
POST /api/v1/inference/requests
          │
          ▼
     IntakeService
          │
          ├─ 1. requestsService.create()     → InferenceRequest { Queued }
          ├─ 2. jobsService.createJob()       → Job              { Queued }
          ├─ 3. queueService.enqueueJob()     → QueueMessage     { Pending }
          └─ 4. requestsService.updateStatus(Dispatched)
          │
          ▼
     202 Accepted { requestId, jobId, queueMessageId, enqueuedAt, ... }
```

## Queue message envelope

```typescript
interface QueueMessage {
  id:           string;               // queue-internal UUID (≠ jobId)
  jobId:        JobId;
  requestId:    RequestId;
  status:       QueueMessageStatus;   // pending | processing | done | dead
  jobStatus:    JobStatus;            // mirrored at enqueue time
  priority:     JobPriority;          // 0=Low … 3=Critical
  sourceType:   JobSourceType;        // live | simulation
  attempt:      number;               // 1-indexed
  enqueuedAt:   number;               // Unix epoch ms
  scheduledAt?: number;               // earliest dequeue time (future use)
  metadata?:    Record<string, unknown>; // routing hints, taskType, etc.
}
```

The message `id` is separate from `jobId` so a job can be **re-enqueued on
retry** with a fresh message ID while preserving the original job's history.

## Dequeue ordering

Messages are returned by `peek()` (and will be dequeued) in the following order:

1. **Priority descending** — Critical → High → Normal → Low
2. **enqueuedAt ascending** (FIFO within each priority class)

## Current adapter

`InMemoryJobQueue` — a Map-backed in-memory implementation. Suitable for local
development and testing only. State is lost on restart. No dequeue processor
exists yet.

## Swapping backends

To use BullMQ, Redis, SQS, or any other backend:

1. Implement `IJobQueue`:
   ```typescript
   class BullMQJobQueue implements IJobQueue {
     async enqueue(payload: EnqueuePayload): Promise<QueueMessage> { ... }
     async peek(limit?: number): Promise<QueueMessage[]> { ... }
     async size(): Promise<number> { ... }
   }
   ```
2. Replace the binding in `src/modules/queue/index.ts`:
   ```typescript
   const jobQueue = new BullMQJobQueue(redisConnection);
   ```
3. No other files change.

## Internal debug endpoint

```
GET /api/v1/queue/items?limit=50
```

Returns the current pending queue contents sorted by dequeue priority.

⚠ **Internal / development only.** Do not expose this endpoint to external
callers in production. Gate it behind a feature flag or network policy.

### Example response

```json
{
  "success": true,
  "data": {
    "messages": [
      {
        "id": "a1b2c3d4-...",
        "jobId": "e5f6a7b8-...",
        "requestId": "c9d0e1f2-...",
        "status": "pending",
        "jobStatus": "queued",
        "priority": 1,
        "sourceType": "live",
        "attempt": 1,
        "enqueuedAt": 1741608000000,
        "metadata": { "taskType": "chat", "inputSize": 512 }
      }
    ],
    "total": 1
  },
  "meta": { "requestId": "...", "timestamp": "..." }
}
```

## What is NOT implemented yet

- Dequeue processor (routing engine integration) — Ticket 13+
- Message acknowledgement (`acknowledge`, `nack`)
- Dead-letter queue for failed messages
- Scheduled / delayed delivery (`scheduledAt`)
- Back-pressure and capacity limits
- Persistent queue storage
