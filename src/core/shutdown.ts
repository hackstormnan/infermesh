/**
 * core/shutdown.ts
 *
 * Graceful shutdown for InferMesh.
 *
 * ─── Shutdown sequence ────────────────────────────────────────────────────────
 *  1. Signal received (SIGINT or SIGTERM)
 *  2. Log: shutdown initiated
 *  3. Call fastify.close() — stops accepting new connections, drains existing
 *  4a. Close completes → log success → exit 0
 *  4b. Timeout expires before close → log timeout → exit 1 (force)
 *  4c. Close throws → log error → exit 1
 *
 * The timeout prevents the process from hanging indefinitely when a connection
 * does not drain (e.g. a streaming request that the client abandoned).
 *
 * ─── Usage ───────────────────────────────────────────────────────────────────
 *   import { registerShutdownHooks } from '../core/shutdown';
 *   registerShutdownHooks(server, logger, config.server.shutdownTimeoutMs);
 *
 * Call this once after the server has started listening.
 */

import type { FastifyInstance } from "fastify";
import type { AppLogger } from "./logger";

/**
 * Registers SIGINT and SIGTERM handlers that gracefully close the Fastify server.
 *
 * @param server      - The running Fastify instance
 * @param log         - Application logger (root or module logger)
 * @param timeoutMs   - Maximum drain wait in milliseconds before force-exit
 */
export function registerShutdownHooks(
  server: FastifyInstance,
  log: AppLogger,
  timeoutMs: number,
): void {
  async function shutdown(signal: string): Promise<void> {
    log.info({ signal, timeoutMs }, "Shutdown signal received — draining connections");

    // Force-exit if drain takes too long
    const forceExitTimer = setTimeout(() => {
      log.error(
        { signal, timeoutMs },
        "Graceful shutdown timed out — forcing exit",
      );
      process.exit(1);
    }, timeoutMs);

    // Ensure the timer does not keep the event loop alive past this point
    forceExitTimer.unref();

    try {
      await server.close();
      clearTimeout(forceExitTimer);
      log.info({ signal }, "Server closed — exiting cleanly");
      process.exit(0);
    } catch (err) {
      clearTimeout(forceExitTimer);
      log.error({ err, signal }, "Error during graceful shutdown — forcing exit");
      process.exit(1);
    }
  }

  // `once` — if two signals arrive in quick succession we only shut down once
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}
