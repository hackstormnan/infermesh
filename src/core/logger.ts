/**
 * core/logger.ts
 *
 * Standalone Pino logger for use outside of request context
 * (startup, shutdown, background processes).
 *
 * Per-request logging is handled by Fastify's built-in Pino integration
 * via the server configuration in app/server.ts.
 */

import pino from "pino";
import { config } from "./config";

const transport =
  config.NODE_ENV === "development"
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      }
    : undefined;

export const logger = pino({
  name: config.SERVICE_NAME,
  level: config.LOG_LEVEL,
  transport,
});
