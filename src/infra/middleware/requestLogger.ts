/**
 * infra/middleware/requestLogger.ts
 *
 * Fastify / Pino request logging configuration for InferMesh.
 *
 * ─── What gets logged ─────────────────────────────────────────────────────────
 * Fastify's built-in Pino integration automatically logs two events per request:
 *
 *   Incoming request (level: info):
 *     requestId, method, url, host, remoteAddress, remotePort
 *
 *   Completed response (level: info):
 *     requestId, statusCode, responseTime (ms)
 *
 * These are emitted by Fastify's internal hooks — no custom code needed.
 * The serializers below control exactly which fields appear and in what shape.
 *
 * ─── Security ─────────────────────────────────────────────────────────────────
 * Sensitive headers (authorization, api keys, cookies) are redacted before
 * Pino serializes the request object. They appear as "[redacted]" in logs.
 *
 * ─── Format ───────────────────────────────────────────────────────────────────
 * Development: pino-pretty with color and human-readable timestamps.
 * Production:  raw JSON — one object per line, ready for log aggregators
 *              (Datadog, CloudWatch, Loki, etc.).
 */

import type { FastifyRequest, FastifyLoggerOptions } from "fastify";
import type { PinoLoggerOptions } from "fastify/types/logger";

// ─── Redacted headers ─────────────────────────────────────────────────────────

const REDACTED_HEADERS = [
  "authorization",
  "x-api-key",
  "x-auth-token",
  "cookie",
  "set-cookie",
];

// ─── Custom serializers ───────────────────────────────────────────────────────

/**
 * Controls which fields appear in the `req` object on every incoming log line.
 * Keeps logs compact: only the fields ops teams actually use for debugging.
 * Fastify passes its own request wrapper here, not a raw IncomingMessage.
 */
function reqSerializer(req: FastifyRequest) {
  return {
    requestId: req.id,
    method: req.method,
    url: req.url,
    remoteAddress: req.socket?.remoteAddress,
  };
}

/**
 * Controls which fields appear in the `res` object on every response log line.
 * responseTime is added automatically by Fastify alongside this object.
 */
function resSerializer(res: { statusCode: number }) {
  return {
    statusCode: res.statusCode,
  };
}

// ─── Config builder ───────────────────────────────────────────────────────────

export function buildLoggerConfig(
  pretty: boolean,
  logLevel: string,
): FastifyLoggerOptions & PinoLoggerOptions {
  return {
    level: logLevel,

    serializers: {
      req: reqSerializer,
      res: resSerializer,
    },

    // Redact sensitive headers before Pino ever sees them
    redact: {
      paths: REDACTED_HEADERS.map((h) => `req.headers["${h}"]`),
      censor: "[redacted]",
    },

    transport: pretty
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
            // Show requestId inline with the message for quick scanning
            messageFormat: "{msg} — {req.requestId}",
          },
        }
      : undefined,
  };
}
