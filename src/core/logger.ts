/**
 * core/logger.ts
 *
 * Application-level structured logger powered by Pino.
 *
 * ─── Usage ───────────────────────────────────────────────────────────────────
 * Root logger (startup, shutdown, one-off app events):
 *   import { logger } from '../core/logger';
 *   logger.info({ port: 3000 }, 'Server listening');
 *
 * Module logger (binds a `module` field to every log line — preferred):
 *   import { createLogger } from '../core/logger';
 *   const log = createLogger('workers');
 *   log.info({ workerId }, 'Worker registered');
 *   // → { "module": "workers", "workerId": "...", "msg": "Worker registered" }
 *
 * Request-scoped logging (inside route handlers — always prefer this):
 *   request.log.info({ modelId }, 'Routing request');
 *   // request.log is a Pino child already bound with requestId
 *
 * ─── Conventions ─────────────────────────────────────────────────────────────
 * - Never use console.log / console.error / console.warn anywhere in this codebase.
 * - Structured context goes in the first arg: log.info({ key: val }, 'msg')
 * - Errors: log.error({ err }, 'What we were doing when it failed')
 *   Pino serializes err.stack automatically via stdSerializers.
 * - Keep message strings static — variable data belongs in the context object.
 *   Good:  log.info({ userId }, 'User created')
 *   Bad:   log.info(`User ${userId} created`)
 */

import pino from "pino";
import { config } from "./config";

// ─── Transport ────────────────────────────────────────────────────────────────

function buildTransport(): pino.TransportSingleOptions | undefined {
  if (!config.logging.pretty) return undefined;
  return {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:standard",
      ignore: "pid,hostname",
      // Include the module binding in the formatted output when present
      messageFormat: "{module} {msg}",
    },
  };
}

// ─── Root logger ──────────────────────────────────────────────────────────────

const transport = buildTransport();

export const logger = pino(
  {
    name: config.service.name,
    level: config.logging.level,
    serializers: {
      // Serialize Error instances with message, type, and stack
      err: pino.stdSerializers.err,
    },
  },
  transport ? pino.transport(transport) : undefined,
);

// ─── Module logger factory ────────────────────────────────────────────────────

/**
 * Creates a child logger with `{ module }` bound to every emitted log line.
 * Call this once at the top of each module file — not inside functions.
 *
 * @param module - Short, lowercase identifier: 'workers', 'routing', 'stream'
 *
 * @example
 *   const log = createLogger('routing');
 *   log.warn({ strategy, workerId }, 'Fallback strategy applied');
 *   // → { "module": "routing", "strategy": "...", "msg": "..." }
 */
export function createLogger(module: string): pino.Logger {
  return logger.child({ module });
}

/** Convenience re-export of the Pino Logger type for use in function signatures */
export type AppLogger = pino.Logger;
