/**
 * infra/middleware/requestLogger.ts
 *
 * Request logging strategy for InferMesh.
 *
 * Fastify's built-in Pino integration handles structured request/response
 * logging automatically when `logger` is enabled in the server options
 * (see app/server.ts). This module documents what is logged and provides
 * the serializer configuration used at server creation time.
 *
 * Logged per request (automatically by Fastify + Pino):
 *   - Incoming:  method, url, hostname, remoteAddress, requestId
 *   - Outgoing:  statusCode, responseTime (ms), requestId
 *
 * Sensitive header redaction is applied via the `serializers` config below
 * so auth tokens and API keys never appear in logs.
 */

import type { FastifyLoggerOptions } from "fastify";
import type { PinoLoggerOptions } from "fastify/types/logger";

const REDACTED_HEADERS = [
  "authorization",
  "x-api-key",
  "cookie",
  "set-cookie",
];

export function buildLoggerConfig(
  nodeEnv: string,
  logLevel: string,
): FastifyLoggerOptions & PinoLoggerOptions {
  const isDev = nodeEnv === "development";

  return {
    level: logLevel,
    redact: {
      paths: REDACTED_HEADERS.map((h) => `req.headers["${h}"]`),
      censor: "[redacted]",
    },
    transport: isDev
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
            messageFormat: "{msg} [{requestId}]",
          },
        }
      : undefined,
  };
}
