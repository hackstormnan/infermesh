/**
 * src/test/setup-env.ts
 *
 * Vitest global setup — runs before every test file.
 *
 * Loads .env.test into process.env so that config.ts finds valid values when
 * it initialises at module-load time. dotenv does not override vars that are
 * already present in the environment, so CI job-level env vars always win over
 * the file — the file is only a local fallback.
 */

import { config } from "dotenv";

config({ path: ".env.test" });
