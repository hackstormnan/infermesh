# Inference Request Intake

## Overview

`POST /api/v1/inference/requests` is the primary entry point for submitting inference workloads to InferMesh. It accepts a structured payload, persists an `InferenceRequest` record and a linked `Job` record, and returns an acknowledgement with both IDs.

## Endpoint

```
POST /api/v1/inference/requests
Content-Type: application/json
```

## Request body

| Field                | Type                          | Required | Description                                                    |
|---------------------|-------------------------------|----------|----------------------------------------------------------------|
| `endpoint`          | `string`                      | ✓        | Target model / inference endpoint (e.g. `"gpt-4o"`)           |
| `taskType`          | `string`                      | ✓        | Logical task type (e.g. `"chat"`, `"embedding"`, `"classify"`) |
| `input`             | `object`                      | ✓        | Raw input payload forwarded to the model backend               |
| `inputSize`         | `integer ≥ 0`                 | ✓        | Estimated input size in tokens                                 |
| `estimatedComplexity` | `"low" \| "medium" \| "high"` | ✓      | Routing complexity hint (low → prefer latency; high → prefer cost) |
| `priority`          | `"low" \| "normal" \| "high"` | –        | Scheduling priority; defaults to `"normal"`                    |
| `metadata`          | `object`                      | –        | Arbitrary caller metadata (stored but not yet acted on)        |

### Example

```json
{
  "endpoint": "llama-3-70b",
  "taskType": "chat",
  "input": {
    "messages": [{ "role": "user", "content": "Summarise the following text…" }]
  },
  "inputSize": 512,
  "estimatedComplexity": "medium",
  "priority": "high"
}
```

## Response — 201 Created

```json
{
  "success": true,
  "data": {
    "requestId": "d290f1ee-6c54-4b01-90e6-d701748f0851",
    "jobId":     "a18f9e2c-3c1d-4e8a-bd9e-12f34567890a",
    "status":    "dispatched",
    "jobStatus": "queued",
    "createdAt": "2026-03-10T12:00:00.000Z"
  },
  "meta": {
    "requestId": "x-req-id-from-header",
    "timestamp": "2026-03-10T12:00:00.001Z"
  }
}
```

## Current intake flow

```
Caller → POST /api/v1/inference/requests
          │
          ▼
      IntakeService.intake()
          │
          ├─ 1. requestsService.create()   → InferenceRequest { status: Queued }
          ├─ 2. jobsService.createJob()    → Job             { status: Queued  }
          └─ 3. requestsService.updateStatus(Dispatched, { jobId })
                                           → InferenceRequest { status: Dispatched, jobId }
          │
          ▼
      201 { requestId, jobId, status: "dispatched", jobStatus: "queued" }
```

## Statuses after intake

| Record             | Status       | Meaning                                      |
|--------------------|--------------|----------------------------------------------|
| `InferenceRequest` | `dispatched` | A job has been created and linked             |
| `Job`              | `queued`     | Waiting for the routing engine to assign it   |

## What is NOT implemented yet

- Routing engine selection (model + worker assignment)
- Queue backend — the job sits in memory only
- Retry logic, streaming, auth, metrics aggregation
- Persistence — state is lost on restart

## Polling created records

After intake, use the read endpoints to inspect state:

```
GET /api/v1/requests/:requestId
GET /api/v1/jobs/:jobId
```
