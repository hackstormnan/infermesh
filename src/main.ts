/**
 * main.ts — Application entry point
 *
 * Bootstraps the Fastify server, registers graceful shutdown hooks,
 * and handles fatal startup errors.
 *
 * Startup sequence:
 *   1. Config is validated at import time (core/config.ts) — fail fast
 *   2. Server is built and plugins are registered
 *   3. Server begins listening on the configured host/port
 *   4. Shutdown hooks are registered for SIGINT and SIGTERM
 *   5. Unhandled rejection and uncaught exception handlers are armed
 */

import { buildServer } from "./app/server";
import { config } from "./core/config";
import { logger } from "./core/logger";
import { registerShutdownHooks } from "./core/shutdown";

async function main(): Promise<void> {
  const server = await buildServer();

  try {
    const address = await server.listen({
      port: config.server.port,
      host: config.server.host,
    });

    logger.info(
      {
        address,
        service: config.service.name,
        version: config.service.version,
        env: config.env,
      },
      "Server listening",
    );

    // Register SIGINT / SIGTERM handlers now that the server is up
    registerShutdownHooks(server, logger, config.server.shutdownTimeoutMs);
  } catch (err) {
    logger.error({ err }, "Fatal error during server startup");
    process.exit(1);
  }
}

// ── Process-level safety nets ─────────────────────────────────────────────────
// These catch errors that escape all other handlers. Both log and exit so the
// process manager (Docker, systemd, k8s) knows to restart the container.

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection — shutting down");
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception — shutting down");
  process.exit(1);
});

main();
