# Configuration

All configuration is supplied via environment variables. Variables are parsed once at startup by `src/core/config.ts` using a Zod schema. If any value is invalid the process writes a structured diagnostic to stderr and exits — no partially-booted server.

Copy `.env.example` as a starting point:

```bash
cp .env.example .env
```

---

## Reference

### Runtime environment

| Variable | Type | Default | Description |
|---|---|---|---|
| `NODE_ENV` | `development` \| `production` \| `test` | `development` | Controls logging format and cross-field validation rules |

---

### Service identity

| Variable | Type | Default | Description |
|---|---|---|---|
| `SERVICE_NAME` | string | `infermesh` | Appears in structured log output and `/health` response |
| `SERVICE_VERSION` | string | `0.1.0` | Appears in structured log output and `/health` response |

---

### HTTP server

| Variable | Type | Default | Description |
|---|---|---|---|
| `PORT` | integer 1–65535 | `3000` | TCP port the server listens on |
| `HOST` | string | `0.0.0.0` | Bind address. Use `127.0.0.1` for local-only access |
| `SHUTDOWN_TIMEOUT_MS` | positive integer | `10000` | Milliseconds to wait for in-flight connections to drain on SIGINT/SIGTERM before force-exiting |
| `BODY_LIMIT_BYTES` | positive integer | `1048576` | Maximum request body size in bytes (default 1 MiB) |

---

### Logging

| Variable | Type | Default | Description |
|---|---|---|---|
| `LOG_LEVEL` | `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace` | `info` | Pino log level. Use `warn` in CI and load tests to reduce noise |
| `LOG_PRETTY` | boolean | `true` in dev, `false` otherwise | Enable pino-pretty human-readable formatting. Set `false` for raw JSON (production, log aggregators) |

**Log format in production:** raw Pino JSON — one object per line, suitable for Datadog, CloudWatch, Loki, etc.

**Log format in development:** pino-pretty coloured output with readable timestamps.

---

### Auth (placeholder — not yet implemented)

| Variable | Type | Default | Description |
|---|---|---|---|
| `AUTH_ENABLED` | boolean | `false` | Enable auth gate. When `true`, `JWT_SECRET` is required |
| `JWT_SECRET` | string | — | Required when `AUTH_ENABLED=true`. Must be ≥ 32 characters in production |

**Cross-field rule:** if `AUTH_ENABLED=true` and `JWT_SECRET` is missing → startup fails. If `NODE_ENV=production` and `JWT_SECRET.length < 32` → startup fails.

---

### Feature flags

These flags are placeholders for incremental activation. The underlying implementations are complete; the flags exist to allow zero-downtime enablement.

| Variable | Type | Default | Description |
|---|---|---|---|
| `FEATURE_STREAMING` | boolean | `false` | Enable streaming response path |
| `FEATURE_METRICS` | boolean | `false` | Enable metrics ingestion and aggregation |
| `FEATURE_SIMULATION` | boolean | `false` | Enable simulation engine endpoints |

---

## Environment separation

### Local development

```env
NODE_ENV=development
PORT=3000
HOST=0.0.0.0
LOG_LEVEL=debug
LOG_PRETTY=true
AUTH_ENABLED=false
FEATURE_STREAMING=false
FEATURE_METRICS=false
FEATURE_SIMULATION=false
```

All variables have sensible defaults — `cp .env.example .env` with no edits is sufficient to run locally.

### CI / smoke test

```env
NODE_ENV=test
PORT=3001
HOST=127.0.0.1
LOG_LEVEL=warn
LOG_PRETTY=false
AUTH_ENABLED=false
```

These are set directly in `.github/workflows/ci.yml` as job-level `env:` — no `.env` file is loaded in CI.

See `.env.test` for a local equivalent.

### Production

```env
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
LOG_LEVEL=info
LOG_PRETTY=false
SERVICE_NAME=infermesh
SERVICE_VERSION=1.0.0
SHUTDOWN_TIMEOUT_MS=30000
```

Set via your platform's secrets/environment mechanism (Docker `--env-file`, k8s `ConfigMap`/`Secret`, AWS Parameter Store, etc.). Never commit production values to source control.

---

## Startup failure diagnosis

If the server exits immediately at startup, check stderr for a structured message:

```
[infermesh] ✗ Invalid environment — cannot start.

{
  "PORT": ["Expected number, received nan"],
  "LOG_LEVEL": ["Invalid enum value. Expected 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'"]
}

See .env.example for all required variables.
```

Each field error lists exactly which variable failed and why.
