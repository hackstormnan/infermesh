# Testing Strategy

InferMesh uses a three-layer test strategy. Each layer has a distinct scope, speed, and configuration.

---

## Layers

### Unit tests (`*.test.ts`)

Scope: a single class or function in isolation. Dependencies are replaced with in-memory stubs or
typed fakes — **never mocks backed by real I/O**.

Characteristics:
- No network, no file system, no process spawning
- Deterministic: same seed → same output (simulation tests)
- Fast: a full unit run completes in seconds

Run:
```bash
npm run test:unit
```

Config: `vitest.unit.config.ts` — includes `src/**/*.test.ts`, excludes `*.integration.test.ts`.

---

### Integration tests (`*.integration.test.ts`)

Scope: multiple collaborating components, typically exercised through the HTTP layer via Fastify's
`server.inject()`. The full server factory (`buildServer()`) is used so the real plugin lifecycle,
context decorator, error handler, and route handler all participate.

Characteristics:
- In-memory repositories — no external database or queue
- HTTP request/response cycle fully exercised
- Response envelope shape is verified (not just status codes)

Run:
```bash
npm run test:integration
```

Config: `vitest.integration.config.ts` — includes only `src/**/*.integration.test.ts`.

---

### Smoke tests (`scripts/smoke.ts`)

Scope: the fully-booted production server binary against a live HTTP endpoint.

Characteristics:
- Boots the real server on an ephemeral port (port 0)
- Makes a real HTTP request to `GET /health`
- Asserts `200 OK` and `body.data.status === "ok"`
- Tears down the server after the check

Run:
```bash
npm run smoke
```

Used in CI as the final gate after `build`.

---

## Running all tests

```bash
npm test                  # all tests (unit + integration) via default vitest.config.ts
npm run test:unit         # unit only
npm run test:integration  # integration only
npm run test:coverage     # full run with lcov/text coverage
npm run smoke             # smoke test (requires successful build first)
```

---

## Test builders (`src/test/builders/index.ts`)

All test files should create domain objects through the canonical builders rather than
constructing raw objects inline. This ensures:

- Defaults are always valid and compile-checked
- Field additions to domain interfaces cause a single compile error (in the builder), not
  scattered errors across many test files
- IDs are unique across builder calls within a test run (monotonic counter)

```ts
import { aModel, aWorkerCandidate, aRoutingPolicy } from "../../../test/builders";

const model    = aModelCandidate({ qualityTier: QualityTier.Frontier });
const worker   = aWorkerCandidate({ region: "eu-west-1", availableSlots: 2 });
const policy   = aRoutingPolicy({ strategy: RoutingStrategy.CostOptimised });
```

Reset the counter in `beforeEach` when strict ID isolation is needed:

```ts
import { resetBuilderSequence } from "../../../test/builders";
beforeEach(resetBuilderSequence);
```

---

## Config tests (`src/core/config.test.ts`)

The `vi.resetModules()` + dynamic `import()` pattern is required because `config.ts` runs
validation at module load time. To exercise a different env state:

```ts
afterEach(() => { vi.resetModules(); });

it("throws when AUTH_ENABLED=true without JWT_SECRET", async () => {
  process.env.AUTH_ENABLED = "true";
  delete process.env.JWT_SECRET;
  vi.resetModules();
  await expect(import("../core/config")).rejects.toThrow("AUTH_ENABLED=true requires JWT_SECRET");
});
```

Always clean up `process.env` in `afterEach` to prevent leaking state into subsequent tests.

---

## CI

The CI pipeline (`.github/workflows/ci.yml`) runs all gates in order:

```
lint → typecheck → test → build → smoke
```

Tests use the environment variables defined in the workflow `env:` block.
The `.env.test` file provides the same variables for local `npm test` runs.
