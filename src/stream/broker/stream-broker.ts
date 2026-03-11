/**
 * stream/broker/stream-broker.ts
 *
 * InMemoryStreamBroker — the default (and currently only) publish backend.
 *
 * Wraps the payload in a StreamEnvelope, queries the ConnectionRegistry for
 * all connections subscribed to the target channel, and fans out the JSON
 * frame to each open socket. Delivery is best-effort: a send failure for one
 * subscriber does not affect others.
 *
 * ─── Design notes ─────────────────────────────────────────────────────────────
 *   - Zero external dependencies — works with any Node.js WebSocket that
 *     exposes `readyState` and `send(data: string)`.
 *   - The publish path is synchronous from the caller's perspective; it does
 *     not await individual socket sends. This matches the "fire-and-forget"
 *     contract expected by domain services.
 *   - readyState === 1 (OPEN) guard prevents send on closing/closed sockets.
 *     The actual cleanup happens via the gateway's "close"/"error" handlers
 *     calling ConnectionRegistry.unregister().
 *
 * ─── Future extension points ──────────────────────────────────────────────────
 *   - Swap the ConnectionRegistry dependency for a distributed connection
 *     store to support multi-node fanout.
 *   - Add an optional Logger parameter to record dropped-message metrics.
 *   - Add a per-channel event buffer / replay window.
 */

import type { IStreamBroker } from "./IStreamBroker";
import type { StreamChannel, StreamEnvelope } from "../contract";
import type { ConnectionRegistry } from "../gateway/connection-registry";

/** WebSocket.OPEN — the socket is connected and ready to send/receive */
const WS_OPEN = 1;

export class InMemoryStreamBroker implements IStreamBroker {
  constructor(private readonly registry: ConnectionRegistry) {}

  /**
   * Publish an event to all connections subscribed to `channel`.
   *
   * Builds the envelope once, serialises to JSON once, then iterates over
   * subscribers. Errors for individual sockets are swallowed — the registry
   * will clean up stale entries via the gateway's close handler.
   */
  publish<T>(channel: StreamChannel, data: T): void {
    const subscribers = this.registry.getSubscribersForChannel(channel);
    if (subscribers.length === 0) return;

    const envelope: StreamEnvelope<T> = {
      type: channel,
      data,
      timestamp: new Date().toISOString(),
    };

    const payload = JSON.stringify(envelope);

    for (const conn of subscribers) {
      try {
        if (conn.socket.readyState === WS_OPEN) {
          conn.socket.send(payload);
        }
      } catch {
        // Best-effort delivery.
        // The socket will be removed from the registry when its "close" or
        // "error" event fires. Silently skip failed sends here.
      }
    }
  }
}
