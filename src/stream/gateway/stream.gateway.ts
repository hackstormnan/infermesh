/**
 * stream/gateway/stream.gateway.ts
 *
 * Fastify plugin that mounts the WebSocket stream gateway at /stream
 * (registered under the /api/v1 prefix, making the full path /api/v1/stream).
 *
 * Responsibilities:
 *   - Upgrade HTTP GET /stream to a WebSocket connection
 *   - Register each new connection in the ConnectionRegistry
 *   - Parse and dispatch inbound client control messages (subscribe/unsubscribe)
 *   - Ack or reject control messages with structured response frames
 *   - Clean up registry state on disconnect (close or error)
 *   - Expose a POST /internal/stream/emit endpoint for dev/test publishing
 *     (clearly internal — not intended for production traffic)
 *
 * ─── WebSocket upgrade path ───────────────────────────────────────────────────
 *   ws://host/api/v1/stream   (or wss:// in TLS-terminated deployments)
 *
 * ─── Plugin dependencies ──────────────────────────────────────────────────────
 *   @fastify/websocket must be registered on the Fastify instance BEFORE this
 *   plugin is registered. See app/server.ts for the registration order.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import {
  STREAM_CHANNELS,
  type StreamChannel,
  type StreamControlMessage,
  type StreamEnvelope,
  type SystemWelcomePayload,
  type AckPayload,
  type ErrorPayload,
} from "../contract";
import type { ConnectionRegistry } from "./connection-registry";
import type { IStreamBroker } from "../broker/IStreamBroker";

// ─── Plugin options ───────────────────────────────────────────────────────────

export interface StreamGatewayOptions {
  registry: ConnectionRegistry;
  broker: IStreamBroker;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Serialise and send a typed envelope frame. Never throws. */
function send<T>(socket: WebSocket, envelope: StreamEnvelope<T>): void {
  try {
    socket.send(JSON.stringify(envelope));
  } catch {
    // Socket closed between readyState check and send — ignore.
  }
}

function systemFrame<T>(data: T): StreamEnvelope<T> {
  return { type: "system", data, timestamp: new Date().toISOString() };
}

function ackFrame<T>(data: T): StreamEnvelope<T> {
  return { type: "ack", data, timestamp: new Date().toISOString() };
}

function errorFrame(message: string, raw?: string): StreamEnvelope<ErrorPayload> {
  return {
    type: "error",
    data: { message, raw: raw?.slice(0, 200) },
    timestamp: new Date().toISOString(),
  };
}

/** Validate and filter raw channel strings against the known channel list. */
function parseChannels(raw: unknown): StreamChannel[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((ch): ch is StreamChannel =>
    typeof ch === "string" && (STREAM_CHANNELS as readonly string[]).includes(ch),
  );
}

// ─── Gateway plugin ───────────────────────────────────────────────────────────

export async function streamGateway(
  fastify: FastifyInstance,
  opts: StreamGatewayOptions,
): Promise<void> {
  const { registry, broker } = opts;

  // ── WebSocket upgrade: GET /stream ─────────────────────────────────────────

  fastify.get(
    "/stream",
    { websocket: true },
    (socket: WebSocket, req: FastifyRequest) => {
      // ── Connection open ────────────────────────────────────────────────────

      const connId = registry.register(socket);
      req.log.info({ connId }, "WebSocket connection opened");

      // Send a one-time welcome frame with connection metadata.
      // Clients can use `connectionId` for debugging and log correlation.
      send<SystemWelcomePayload>(socket, systemFrame({
        message: "Connected to InferMesh stream gateway",
        connectionId: connId,
        availableChannels: STREAM_CHANNELS,
      }));

      // ── Inbound messages ───────────────────────────────────────────────────

      socket.on("message", (raw: Buffer | string) => {
        const rawStr = Buffer.isBuffer(raw) ? raw.toString("utf8") : raw;
        let msg: StreamControlMessage;

        try {
          msg = JSON.parse(rawStr) as StreamControlMessage;
        } catch {
          send(socket, errorFrame("Invalid JSON — expected a StreamControlMessage", rawStr));
          return;
        }

        const channels = parseChannels(msg.channels);

        if (msg.action === "subscribe") {
          registry.subscribe(connId, channels);
          send<AckPayload>(socket, ackFrame({ action: "subscribe", channels }));
          req.log.debug({ connId, channels }, "Client subscribed");
          return;
        }

        if (msg.action === "unsubscribe") {
          registry.unsubscribe(connId, channels);
          send<AckPayload>(socket, ackFrame({ action: "unsubscribe", channels }));
          req.log.debug({ connId, channels }, "Client unsubscribed");
          return;
        }

        // Unknown action — inform the client but keep the connection open.
        send(
          socket,
          errorFrame(
            `Unknown action "${String((msg as unknown as Record<string, unknown>).action)}" — valid actions: subscribe, unsubscribe`,
          ),
        );
      });

      // ── Connection close ───────────────────────────────────────────────────

      socket.on("close", (code: number, reason: Buffer) => {
        registry.unregister(connId);
        req.log.info(
          { connId, code, reason: reason.toString() || "(none)" },
          "WebSocket connection closed",
        );
      });

      // ── Socket error ───────────────────────────────────────────────────────

      socket.on("error", (err: Error) => {
        registry.unregister(connId);
        req.log.warn({ connId, err: err.message }, "WebSocket connection error");
      });
    },
  );

  // ── Internal dev/test emit endpoint ───────────────────────────────────────
  //
  // POST /internal/stream/emit
  //
  // Allows developers and integration tests to push a sample event onto any
  // channel without wiring up a full domain flow. Not intended for production
  // use — gate behind an env flag or firewall rule if this route is a concern.
  //
  // Request body:
  //   { "channel": "requests", "data": { ... } }
  //
  // Response:
  //   { "published": true, "channel": "requests", "subscriberCount": 2 }

  fastify.post(
    "/internal/stream/emit",
    async (
      req: FastifyRequest<{
        Body: { channel: string; data: unknown };
      }>,
      reply: FastifyReply,
    ) => {
      const { channel, data } = req.body ?? {};

      if (!channel || !(STREAM_CHANNELS as readonly string[]).includes(channel)) {
        return reply.status(400).send({
          error: `Invalid channel "${channel}". Valid channels: ${STREAM_CHANNELS.join(", ")}`,
        });
      }

      const validChannel = channel as StreamChannel;
      const subscriberCount = registry.getSubscribersForChannel(validChannel).length;
      broker.publish(validChannel, data ?? {});

      req.log.info(
        { channel: validChannel, subscriberCount },
        "[internal] Stream event emitted",
      );

      return reply.send({
        published: true,
        channel: validChannel,
        subscriberCount,
      });
    },
  );

  // ── Connection stats endpoint ──────────────────────────────────────────────
  //
  // GET /internal/stream/status
  // Returns a snapshot of active connections and their subscription state.
  // Useful for debugging and load monitoring without exposing sensitive data.

  fastify.get(
    "/internal/stream/status",
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const connections = registry.getAll().map((conn) => ({
        id: conn.id,
        subscribedChannels: Array.from(conn.subscribedChannels),
        connectedAt: conn.connectedAt.toISOString(),
      }));

      return reply.send({
        activeConnections: registry.size,
        connections,
      });
    },
  );
}
