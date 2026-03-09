/**
 * main.ts — Application entry point
 *
 * Boots the Fastify server and binds it to the configured host/port.
 * Handles fatal startup errors and unhandled rejections.
 */

import { buildServer } from "./app/server";
import { config } from "./core/config";
import { logger } from "./core/logger";

async function main(): Promise<void> {
  const server = await buildServer();

  try {
    const address = await server.listen({
      port: config.PORT,
      host: config.HOST,
    });

    logger.info(
      { address, service: config.SERVICE_NAME, env: config.NODE_ENV },
      "Server listening",
    );
  } catch (err) {
    logger.error({ err }, "Fatal error during server startup");
    process.exit(1);
  }
}

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection — shutting down");
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception — shutting down");
  process.exit(1);
});

main();
