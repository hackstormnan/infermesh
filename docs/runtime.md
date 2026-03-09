# InferMesh — Runtime Behavior Reference

## Configuration

Configuration is loaded once at process startup from environment variables and
validated with Zod. **The process exits immediately if validation fails** — no
partially-booted server, no silent misconfiguration.

Config is organized into typed sections:

```typescript
config.env              // "development" | "production" | "test"
config.service.name     // SERVICE_NAME
config.service.version  // SERVICE_VERSION
config.server.port      // PORT
config.server.host      // HOST
config.server.shutdownTimeoutMs   // SHUTDOWN_TIMEOUT_MS
config.server.bodyLimitBytes      // BODY_LIMIT_BYTES
config.logging.level    // LOG_LEVEL
config.logging.pretty   // derived from LOG_PRETTY or NODE_ENV
config.auth.enabled     // AUTH_ENABLED (placeholder)
config.auth.jwtSecret   // JWT_SECRET (placeholder)
config.features.streaming   // FEATURE_STREAMING
config.features.metrics     // FEATURE_METRICS
config.features.simulation  // FEATURE_SIMULATION
```

Cross-field rules validated at startup:
- `AUTH_ENABLED=true` requires `JWT_SECRET` to be set
- In production, `JWT_SECRET` must be at least 32 characters

---

## Logging

InferMesh uses [Pino](https://getpino.io) — the fastest Node.js JSON logger.

### Logger types

| Logger | Import | When to use |
|---|---|---|
| Root logger | `import { logger } from '../core/logger'` | Startup, shutdown, one-off app events |
| Module logger | `import { createLogger } from '../core/logger'` | Module-level logging (binds `module` field) |
| Request logger | `request.log` inside a handler | Per-request logging (binds `requestId`) |
| Context logger | `request.ctx.log` inside a handler | Same as request.log; preferred in service functions |

### Usage conventions

```typescript
// ✓ Good — structured context first, static string second
log.info({ workerId, modelId }, 'Worker selected');

// ✓ Good — error serialization
log.error({ err }, 'Failed to register worker');

// ✗ Bad — no console usage anywhere in the codebase
console.log('something happened');

// ✗ Bad — interpolated string loses structure
log.info(`Worker ${workerId} selected`);
```

### Output format

| Environment | Format | Configured by |
|---|---|---|
| development | pino-pretty (color, readable timestamp) | `NODE_ENV=development` or `LOG_PRETTY=true` |
| production | NDJSON (one JSON object per line) | `NODE_ENV=production` and no `LOG_PRETTY` override |

### What every request log includes

**Incoming request** (emitted automatically by Fastify):
```json
{ "requestId": "uuid", "method": "POST", "url": "/api/v1/requests", "remoteAddress": "10.0.0.1" }
```

**Completed response** (emitted automatically by Fastify):
```json
{ "requestId": "uuid", "statusCode": 201, "responseTime": 12.4 }
```

**Sensitive headers** (`authorization`, `x-api-key`, `x-auth-token`, `cookie`, `set-cookie`)
are redacted to `"[redacted]"` before Pino serializes the request object.

---

## Error Handling

### Error taxonomy

All application errors extend `ApiError`. Throw the most specific subclass:

| Class | HTTP | Code | Typical cause |
|---|---|---|---|
| `BadRequestError` | 400 | `BAD_REQUEST` | Malformed request structure |
| `UnauthorizedError` | 401 | `UNAUTHORIZED` | Missing credentials |
| `ForbiddenError` | 403 | `FORBIDDEN` | Insufficient permissions |
| `NotFoundError` | 404 | `NOT_FOUND` | Resource does not exist |
| `ConflictError` | 409 | `CONFLICT` | Duplicate resource or state conflict |
| `ValidationError` | 422 | `VALIDATION_ERROR` | Semantic field validation failure |
| `TooManyRequestsError` | 429 | `TOO_MANY_REQUESTS` | Rate limit exceeded |
| `GatewayError` | 502 | `BAD_GATEWAY` | Upstream model/worker error |
| `ServiceUnavailableError` | 503 | `SERVICE_UNAVAILABLE` | Service draining or overloaded |
| `TimeoutError` | 504 | `GATEWAY_TIMEOUT` | Upstream timed out |

**Operational vs unexpected errors:**

- `ApiError` subclasses are *operational* — their message and code are safe for clients.
- Any other thrown value is *unexpected* (a bug). In **production**, the client receives
  only `"An unexpected error occurred"`. In **development**, the real message is returned
  to aid debugging. Full error + stack is always logged internally.

### Error response shape

All error responses use the standard API envelope:

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Model claude-sonnet not found",
    "details": null
  },
  "meta": {
    "requestId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "timestamp": "2026-03-09T15:00:00.000Z"
  }
}
```

---

## Request Context

Every request is decorated with a `RequestContext` object available at `request.ctx`:

```typescript
interface RequestContext {
  requestId: string;    // correlation ID
  method: string;       // HTTP method
  path: string;         // URL path
  startedAt: number;    // Unix ms — compute duration as Date.now() - ctx.startedAt
  log: AppLogger;       // pino child pre-bound with requestId
}
```

**Pattern for service functions:**

```typescript
// Route handler
async function handleCreate(req: FastifyRequest, reply: FastifyReply) {
  const result = await modelsService.create(req.ctx, dto);
  reply.send(successResponse(result, buildMeta(req.ctx.requestId)));
}

// Service function — no Fastify dependency
async function create(ctx: RequestContext, dto: RegisterModelDto): Promise<Model> {
  ctx.log.info({ name: dto.name }, 'Registering model');
  // ...
}

// Unit test — no HTTP needed
const ctx = buildTestContext({ requestId: 'test-123' });
await modelsService.create(ctx, dto);
```

---

## Graceful Shutdown

On `SIGINT` (Ctrl-C) or `SIGTERM` (container stop / k8s pod eviction):

1. Fastify stops accepting new connections
2. Existing connections are allowed to complete (drain)
3. If drain completes within `SHUTDOWN_TIMEOUT_MS` → `process.exit(0)`
4. If timeout expires before drain → `process.exit(1)` (force)

```
SIGTERM received
  → fastify.close() called
  → existing requests drain
  → "Server closed — exiting cleanly"
  → exit 0
```

Tune `SHUTDOWN_TIMEOUT_MS` (default: 10 000 ms) based on your longest expected
request duration. Set lower in environments where fast restarts are preferred.

---

## Startup Failure Modes

| Cause | Behaviour |
|---|---|
| Invalid / missing env var | Structured error to stderr, `exit(1)` before server starts |
| `AUTH_ENABLED=true` without `JWT_SECRET` | Structured error to stderr, `exit(1)` |
| Port already in use | Fastify listen throws, caught in `main()`, logged + `exit(1)` |
| `buildServer()` throws | Caught in `main()`, logged + `exit(1)` |
