/**
 * scripts/smoke.ts — Smoke validation
 *
 * Boots the Fastify server on an ephemeral port, calls GET /health, validates
 * the response shape and status code, then exits cleanly.
 *
 * What it proves:
 *   - Config loads without throwing (all required env vars present)
 *   - All route plugins register without error
 *   - The HTTP server accepts connections
 *   - GET /health returns HTTP 200 with { data: { status: "ok" } }
 *
 * Usage:
 *   npm run smoke           — uses process.env (set by CI or a local .env.test)
 *   NODE_ENV=test tsx scripts/smoke.ts
 */

import { buildServer } from "../src/app/server";

async function smoke(): Promise<void> {
  const server = await buildServer();

  // Bind to port 0 so the OS assigns a free ephemeral port — no conflicts with
  // a running dev server or other CI jobs sharing the same host.
  const address = await server.listen({ port: 0, host: "127.0.0.1" });

  // address is a string like "http://127.0.0.1:PORT" (Fastify v5)
  const url = `${address}/health`;

  let ok = false;

  try {
    const res = await fetch(url);

    if (res.status !== 200) {
      throw new Error(`GET /health returned HTTP ${res.status} (expected 200)`);
    }

    const body = (await res.json()) as {
      success?: boolean;
      data?: { status?: string };
    };

    if (body?.data?.status !== "ok") {
      throw new Error(
        `GET /health body.data.status is "${body?.data?.status}" (expected "ok")`,
      );
    }

    console.log(`✓  smoke: GET /health → 200  { status: "ok" }  (${url})`);
    ok = true;
  } finally {
    await server.close();
  }

  process.exit(ok ? 0 : 1);
}

smoke().catch((err: unknown) => {
  console.error("✗  smoke: failed —", err);
  process.exit(1);
});
