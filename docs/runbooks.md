# Runbooks

Troubleshooting guide for common issues in local development, CI, and production.

---

## 1. Server fails to start — config validation error

**Symptom:** process exits immediately, stderr contains `✗ Invalid environment — cannot start.`

**Cause:** one or more environment variables are missing, have the wrong type, or fail a cross-field rule.

**Fix:**

1. Read the structured error output — each failing field is listed with the reason:
   ```
   { "PORT": ["Expected number, received nan"], ... }
   ```
2. Compare your `.env` file against `.env.example`
3. Common mistakes:
   - `PORT=abc` — must be an integer
   - `LOG_LEVEL=verbose` — must be one of `fatal|error|warn|info|debug|trace`
   - `AUTH_ENABLED=true` without `JWT_SECRET` set
   - `JWT_SECRET` shorter than 32 characters when `NODE_ENV=production`

**Reference:** [docs/configuration.md](configuration.md)

---

## 2. `GET /health` returns non-200

**Symptom:** load balancer health check fails, `curl http://localhost:3000/health` returns error.

**Cause options:**

| Cause | Check |
|---|---|
| Server not started | `ps aux | grep node` — is the process running? |
| Wrong port | Check `PORT` env var (default 3000) |
| Bound to wrong interface | `HOST=127.0.0.1` blocks external access — use `0.0.0.0` in production |
| Server crashed after startup | Check logs for `Fatal error during server startup` |
| Plugin registration failure | Look for `Error` lines at boot in the log output |

The health route has no dependencies — it will respond as long as the Fastify server is up. If `/health` fails, the server itself is not running or not reachable.

---

## 3. Routing decisions not being produced

**Symptom:** `POST /api/v1/jobs/:id/route` returns 503 or 422.

**Error codes and their meaning:**

| HTTP | Code | Meaning |
|---|---|---|
| 503 | `NO_ACTIVE_POLICY` | No routing policy with `status: "active"` exists in the registry |
| 422 | `NO_ELIGIBLE_MODEL` | No model in the registry passes the filter + hard constraints |
| 422 | `NO_ELIGIBLE_WORKER` | No worker supports the selected model, or all workers are filtered out |

**Diagnosis steps:**

1. **Check for an active policy:**
   ```bash
   GET /api/v1/routing/policies
   ```
   At least one policy must have `status: "active"`. Create one if none exist.

2. **Check the model registry:**
   ```bash
   GET /api/v1/models
   ```
   At least one model must be registered and `status: "active"`.

3. **Check the worker registry:**
   ```bash
   GET /api/v1/workers
   ```
   At least one worker must be registered, have `status: "idle"` or `"busy"`, and must list the target model in its `supportedModels` array.

4. **Check for disqualification reasons:** the routing decision response includes `candidates[]` with `disqualificationReasons` for each rejected candidate. For the programmatic path, `DecideRouteResult` carries the full `modelScores` and `workerScores` arrays with per-candidate explanations.

---

## 4. Worker registration / heartbeat problems

**Symptom:** workers registered but not selected by the routing engine; workers showing as `unhealthy`.

**Worker status lifecycle:**

```
registered → idle → busy → idle   (normal)
             idle → unhealthy      (heartbeat deadline missed)
             any  → offline        (deregistered)
```

**Common issues:**

- **Workers evicted as unhealthy:** heartbeats are not being sent frequently enough. The eviction deadline is defined in `WorkerRegistryService`. Send heartbeats every 30s or less.
- **Worker not selected:** verify `supportedModels` includes the model ID exactly as it appears in the model registry. IDs are opaque UUIDs — names/aliases are resolved to IDs at registration time.
- **Worker load score too high:** if a worker's `loadScore` is close to 1.0, the routing evaluator scores it low. Check CPU/memory metrics being reported in heartbeats.
- **Worker region filter active:** if the routing policy has a region constraint, verify the worker's `region` field matches exactly.

---

## 5. WebSocket stream not receiving events

**Symptom:** WS connects but no events arrive after intake or routing actions.

**Checklist:**

1. **Confirm subscription was sent after connecting:**
   ```json
   { "action": "subscribe", "channels": ["requests", "workers", "decisions"] }
   ```
   Connections receive only system frames until a subscribe message is sent.

2. **Confirm the server sent an `ack` frame in response:**
   ```json
   { "type": "ack", "data": { "action": "subscribe", "channels": [...] } }
   ```
   If no ack arrives, the control message was malformed — check the JSON structure.

3. **Verify the channel name is correct:** valid channels are `requests`, `workers`, `routing`, `decisions`. An invalid channel name is silently dropped (the ack will show only accepted channels).

4. **Check for proxy timeout:** if a reverse proxy is in front, confirm `proxy_read_timeout` is set high enough (> 60s) and WebSocket upgrade headers are passed through.

5. **Check broker publish errors in logs:** publishing is best-effort. Look for `warn` lines containing `"Failed to publish"` — these indicate the broker caught an error but did not abort the domain operation.

6. **Multi-instance note:** `InMemoryStreamBroker` is single-process. If running multiple instances, events published in process A are not relayed to clients connected to process B. See [docs/deployment.md](deployment.md) for the Redis pub/sub upgrade path.

---

## 6. Simulation results are inconsistent between runs

**Symptom:** running the same simulation config twice produces different results.

**Cause:** without a `randomSeed`, the workload generator uses `Date.now()` as the seed — each run generates a different request profile sequence.

**Fix:** set `randomSeed` in the `workloadConfig` for reproducible results:

```json
{
  "workloadConfig": {
    "requestCount": 500,
    "randomSeed": 42
  }
}
```

With a fixed seed, the same input always produces the same `SyntheticRequestProfile[]` in the same order. The simulation engine also runs deterministically (no concurrency, no timer-based branching).

**Other causes of variation:**

- Worker `loadScore` changes between runs if heartbeats arrive during the run — use `workerOverrides` to pin candidates
- A different active policy is selected if policies are modified between runs — pin with `policyId`

See [docs/simulation.md](simulation.md) for the full determinism reference.

---

## 7. CI passes locally but fails on GitHub

**Symptom:** `npm run lint` / `npm test` / `npm run smoke` passes locally but the GitHub Actions job fails.

**Common causes:**

| Symptom | Likely cause | Fix |
|---|---|---|
| `npm ci` fails | `package-lock.json` is out of sync with `package.json` | Run `npm install` locally, commit the updated lock file |
| Lint fails | Local ESLint version differs from pinned devDependency | `npm ci` locally to match the lock file, re-run lint |
| Type errors only in CI | `tsconfig.json` `strict` flags catch issues hidden by local IDE settings | Run `npm run typecheck` locally before pushing |
| Smoke test fails in CI | Missing or wrong env vars | CI env vars are set in `.github/workflows/ci.yml` `env:` block — compare with `.env.test` |
| Smoke test passes locally, fails in CI | `.env` file loaded locally but not in CI | CI relies on the `env:` block only; no `.env` file is loaded in the runner |
| Tests are flaky | Non-deterministic test data (e.g. `Date.now()` in assertions) | Use fixed seeds and mock time where needed |

**Reproducing CI locally:**

```bash
# Clear installed modules and reinstall exactly from lock file
rm -rf node_modules
npm ci

# Run the full gate in order
npm run lint && npm run typecheck && npm test && npm run build && npm run smoke
```

**Environment for smoke test locally:**

```bash
# Use the .env.test template
export $(cat .env.test | xargs)
npm run smoke
```

**Reference:** [docs/ci.md](ci.md)
