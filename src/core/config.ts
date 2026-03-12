/**
 * core/config.ts
 *
 * Centralized, Zod-validated configuration organized by concern.
 *
 * ─── Design ──────────────────────────────────────────────────────────────────
 * All env vars are parsed once at module load. If validation fails an Error is
 * thrown — the caller (main.ts or the test runner) decides how to handle it.
 * In production the unhandled throw crashes the process immediately with a
 * non-zero exit code and a clear message. In tests Vitest surfaces it as a
 * module-load failure with the full error message.
 *
 * Config is projected into typed sub-sections so call sites read
 * `config.server.port` rather than `config.PORT`. The section name makes
 * the origin and intent of each value immediately clear.
 *
 * ─── Sections ────────────────────────────────────────────────────────────────
 *   config.env        — runtime environment discriminant
 *   config.service    — service identity (name, version)
 *   config.server     — HTTP binding and operational tuning
 *   config.logging    — log level and format
 *   config.auth       — auth gate (placeholder — not yet implemented)
 *   config.features   — incremental feature flags
 */

import "dotenv/config";
import { z } from "zod";

// ─── Boolean env helper ───────────────────────────────────────────────────────
//
// z.coerce.boolean() uses JavaScript's Boolean() function, which converts any
// non-empty string — including "false" and "0" — to true. That is wrong for
// environment variables where "false" means false.
//
// This preprocessor maps the conventional env-var string representations:
//   "true" | "1"  → true
//   anything else → false  (including "false", "0", "", undefined)

function boolEnv(defaultVal = false) {
  return z.preprocess((v) => {
    if (v === undefined || v === null || v === "") return defaultVal;
    if (typeof v === "string") return v === "true" || v === "1";
    return Boolean(v);
  }, z.boolean());
}

// Optional variant: returns undefined when the variable is absent.
const optionalBoolEnv = z.preprocess((v) => {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "string") return v === "true" || v === "1";
  return Boolean(v);
}, z.boolean().optional());

// ─── Schema ───────────────────────────────────────────────────────────────────

const envSchema = z.object({
  // Runtime environment
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  // Service identity
  SERVICE_NAME: z.string().min(1).default("infermesh"),
  SERVICE_VERSION: z.string().default("0.1.0"),

  // HTTP server
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default("0.0.0.0"),
  /** Milliseconds to wait for in-flight requests to drain before force-exiting */
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  /** Maximum request body size in bytes (default 1 MiB) */
  BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(1_048_576),

  // Logging
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  /**
   * Override pino-pretty formatting. Defaults to true in development.
   * Explicitly set LOG_PRETTY=false to see raw JSON locally.
   */
  LOG_PRETTY: optionalBoolEnv,

  // Auth (placeholder — implementation in a future ticket)
  AUTH_ENABLED: boolEnv(false),
  JWT_SECRET: z.string().optional(),

  // Feature flags
  FEATURE_STREAMING: boolEnv(false),
  FEATURE_METRICS: boolEnv(false),
  FEATURE_SIMULATION: boolEnv(false),
});

type RawEnv = z.infer<typeof envSchema>;

// ─── Parse ────────────────────────────────────────────────────────────────────

const result = envSchema.safeParse(process.env);

if (!result.success) {
  throw new Error(
    `\n[infermesh] ✗ Invalid environment — cannot start.\n\n` +
      JSON.stringify(result.error.flatten().fieldErrors, null, 2) +
      `\n\nSee .env.example for all required variables.\n`,
  );
}

const raw: RawEnv = result.data;

// ─── Cross-field validation ───────────────────────────────────────────────────

if (raw.AUTH_ENABLED) {
  if (!raw.JWT_SECRET) {
    throw new Error(
      `\n[infermesh] ✗ AUTH_ENABLED=true requires JWT_SECRET to be set.\n`,
    );
  }
  if (raw.NODE_ENV === "production" && raw.JWT_SECRET.length < 32) {
    throw new Error(
      `\n[infermesh] ✗ JWT_SECRET must be at least 32 characters in production.\n`,
    );
  }
}

// ─── Structured config object ─────────────────────────────────────────────────

export const config = {
  /** "development" | "production" | "test" */
  env: raw.NODE_ENV,

  service: {
    name: raw.SERVICE_NAME,
    version: raw.SERVICE_VERSION,
  },

  server: {
    port: raw.PORT,
    host: raw.HOST,
    /** How long the shutdown sequence waits for open connections to drain */
    shutdownTimeoutMs: raw.SHUTDOWN_TIMEOUT_MS,
    bodyLimitBytes: raw.BODY_LIMIT_BYTES,
  },

  logging: {
    level: raw.LOG_LEVEL,
    /** Use pino-pretty output — true by default in development */
    pretty: raw.LOG_PRETTY ?? raw.NODE_ENV === "development",
  },

  auth: {
    /** Auth not yet implemented — gate for future activation */
    enabled: raw.AUTH_ENABLED,
    jwtSecret: raw.JWT_SECRET,
  },

  features: {
    streaming: raw.FEATURE_STREAMING,
    metrics: raw.FEATURE_METRICS,
    simulation: raw.FEATURE_SIMULATION,
  },
} as const;

export type AppConfig = typeof config;
