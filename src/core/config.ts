/**
 * core/config.ts
 *
 * Centralized, validated configuration loaded from environment variables.
 * Uses Zod to enforce types and provide helpful error messages on misconfiguration.
 * Fails fast at startup if required env vars are missing or malformed.
 */

import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("0.0.0.0"),

  SERVICE_NAME: z.string().default("infermesh"),
  SERVICE_VERSION: z.string().default("0.1.0"),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
});

export type Config = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Use process.stderr directly — logger depends on config, avoid circular dep
  process.stderr.write(
    `[infermesh] Invalid environment configuration:\n${JSON.stringify(
      parsed.error.flatten().fieldErrors,
      null,
      2,
    )}\n`,
  );
  process.exit(1);
}

export const config: Config = parsed.data;
