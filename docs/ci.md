# CI and Verification

InferMesh uses GitHub Actions for continuous integration. Every push and pull request runs the full quality gate pipeline automatically.

---

## Verification commands

| Command | What it does |
|---|---|
| `npm run lint` | ESLint + TypeScript-ESLint rules across `src/` |
| `npm run typecheck` | Full TypeScript type check (`tsc --noEmit`) |
| `npm run test` | Vitest unit/integration test suite |
| `npm run test:coverage` | Tests with coverage report (text + lcov) |
| `npm run build` | TypeScript compile to `dist/` |
| `npm run smoke` | Boot the server and validate `GET /health` |

Run them in order to replicate what CI does:

```bash
npm run lint && npm run typecheck && npm run test && npm run build && npm run smoke
```

---

## How CI works

The workflow is defined in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

**Triggers:** every `push` and `pull_request` — no branch filter, so all branches are covered.

**Single job, sequential gates:**

```
Install deps → Lint → Typecheck → Test → Build → Smoke
```

Each step must pass before the next one runs. A failure anywhere blocks the merge.

**Environment:** all required config values are set directly in the workflow `env` block. No `.env` file is needed in CI — the runner starts clean.

**Dependency caching:** `actions/setup-node` caches `~/.npm` keyed on `package-lock.json`, so subsequent runs skip the full download.

**Node version:** pinned to `22` (matches `@types/node: ^22`).

---

## What the smoke test validates

`npm run smoke` (`scripts/smoke.ts`) runs after a successful build and tests the production code path:

1. Calls `buildServer()` — exercises config loading, plugin registration, and route wiring
2. Binds to an ephemeral port (`port: 0`) — no conflicts with other processes
3. Calls `GET /health` on the live server
4. Asserts HTTP 200 and `body.data.status === "ok"`
5. Closes the server and exits `0`

This proves the compiled application starts cleanly in a clean environment with only environment variables — no mocks, no stubs.

---

## Local smoke test

Copy the test environment template, then run:

```bash
cp .env.test .env
npm run smoke
```

Or inline the vars:

```bash
NODE_ENV=test PORT=3001 HOST=127.0.0.1 LOG_LEVEL=warn LOG_PRETTY=false \
  npm run smoke
```

---

## Coverage (optional)

Coverage is not enforced in CI by default. To generate a report locally:

```bash
npm install --save-dev @vitest/coverage-v8
npm run test:coverage
```

The report prints to the terminal and writes `lcov.info` to `coverage/` for use with coverage services.
