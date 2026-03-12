/**
 * core/config.test.ts
 *
 * Unit tests for config.ts environment validation.
 *
 * Strategy: each test case uses vi.resetModules() + dynamic import so the
 * module is re-evaluated with the specific process.env snapshot we want to
 * test. This mirrors the real boot path: config.ts runs at module load time,
 * so we must re-load the module to exercise different env states.
 *
 * The setup file (.env.test) provides safe defaults. Tests that want to
 * exercise a specific env state set process.env overrides before re-importing,
 * then restore process.env via afterEach cleanup.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Capture the original env so we can restore it after each test
const originalEnv = { ...process.env };

afterEach(() => {
  // Strip any keys added by the test, then restore originals
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, originalEnv);
  vi.resetModules();
});

describe("boolEnv() — boolean environment variable coercion", () => {
  it('treats "true" as true', async () => {
    process.env.AUTH_ENABLED = "true";
    process.env.JWT_SECRET = "a-secret-long-enough-for-test";
    vi.resetModules();
    const { config } = await import("./config");
    expect(config.auth.enabled).toBe(true);
  });

  it('treats "1" as true', async () => {
    process.env.AUTH_ENABLED = "1";
    process.env.JWT_SECRET = "a-secret-long-enough-for-test";
    vi.resetModules();
    const { config } = await import("./config");
    expect(config.auth.enabled).toBe(true);
  });

  it('treats "false" as false (regression: z.coerce.boolean coerces "false" → true)', async () => {
    process.env.AUTH_ENABLED = "false";
    vi.resetModules();
    const { config } = await import("./config");
    expect(config.auth.enabled).toBe(false);
  });

  it('treats "0" as false', async () => {
    process.env.AUTH_ENABLED = "0";
    vi.resetModules();
    const { config } = await import("./config");
    expect(config.auth.enabled).toBe(false);
  });

  it("treats absent value as false (default)", async () => {
    delete process.env.AUTH_ENABLED;
    vi.resetModules();
    const { config } = await import("./config");
    expect(config.auth.enabled).toBe(false);
  });
});

describe("cross-field validation — AUTH_ENABLED requires JWT_SECRET", () => {
  it("throws when AUTH_ENABLED=true and JWT_SECRET is absent", async () => {
    process.env.AUTH_ENABLED = "true";
    delete process.env.JWT_SECRET;
    vi.resetModules();
    await expect(import("./config")).rejects.toThrow("AUTH_ENABLED=true requires JWT_SECRET");
  });

  it("does not throw when AUTH_ENABLED=false and JWT_SECRET is absent", async () => {
    process.env.AUTH_ENABLED = "false";
    delete process.env.JWT_SECRET;
    vi.resetModules();
    await expect(import("./config")).resolves.toBeDefined();
  });
});

describe("schema validation — throws on invalid values", () => {
  it("throws when PORT is out of range", async () => {
    process.env.PORT = "99999";
    vi.resetModules();
    await expect(import("./config")).rejects.toThrow();
  });

  it("throws when NODE_ENV is an unrecognised value", async () => {
    process.env.NODE_ENV = "staging";
    vi.resetModules();
    await expect(import("./config")).rejects.toThrow();
  });

  it("throws when LOG_LEVEL is an unrecognised value", async () => {
    process.env.LOG_LEVEL = "verbose";
    vi.resetModules();
    await expect(import("./config")).rejects.toThrow();
  });
});

describe("config object shape", () => {
  it("exposes expected top-level sections", async () => {
    vi.resetModules();
    const { config } = await import("./config");
    expect(config).toMatchObject({
      env: expect.any(String),
      service: { name: expect.any(String), version: expect.any(String) },
      server: {
        port: expect.any(Number),
        host: expect.any(String),
        shutdownTimeoutMs: expect.any(Number),
        bodyLimitBytes: expect.any(Number),
      },
      logging: { level: expect.any(String), pretty: expect.any(Boolean) },
      auth: { enabled: expect.any(Boolean) },
      features: {
        streaming: expect.any(Boolean),
        metrics: expect.any(Boolean),
        simulation: expect.any(Boolean),
      },
    });
  });

  it("uses test defaults from .env.test", async () => {
    vi.resetModules();
    const { config } = await import("./config");
    expect(config.env).toBe("test");
    expect(config.auth.enabled).toBe(false);
  });
});
