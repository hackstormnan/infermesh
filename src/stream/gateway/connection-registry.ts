/**
 * stream/gateway/connection-registry.ts
 *
 * In-memory store for all active WebSocket connections and their per-connection
 * channel subscription state.
 *
 * The registry is intentionally kept as a plain class with no external
 * dependencies. It operates entirely in memory and is not distributed —
 * see the stream gateway docs for current limitations.
 *
 * ─── Responsibilities ─────────────────────────────────────────────────────────
 *   register      — record a new connection on open; returns a stable connId
 *   unregister    — clean up on close or error (no leaked entries)
 *   subscribe     — add channels to a connection's subscription set
 *   unsubscribe   — remove channels from a connection's subscription set
 *   getSubscribersForChannel — enumerate all connections subscribed to a channel
 *   size          — current active connection count (observability)
 *   getAll        — snapshot of all connections (internal / debug use)
 *
 * ─── Future extension points ──────────────────────────────────────────────────
 *   - Replace `Map<string, ConnectionState>` with a distributed connection
 *     registry backed by Redis or a shared store for multi-node fanout.
 *   - Add a TTL / heartbeat eviction loop to reclaim stale connections that
 *     dropped without a close event.
 *   - Emit metrics (active_connections, subscriptions_by_channel) for Prometheus.
 */

import { randomUUID } from "crypto";
import type { WebSocket } from "@fastify/websocket";
import type { StreamChannel } from "../contract";

// ─── Connection state ─────────────────────────────────────────────────────────

export interface ConnectionState {
  /** Stable, server-assigned ID for this connection (UUID v4) */
  readonly id: string;
  /** The underlying WebSocket instance */
  readonly socket: WebSocket;
  /** Channels this connection has subscribed to */
  readonly subscribedChannels: Set<StreamChannel>;
  /** Wall-clock time when the connection was opened */
  readonly connectedAt: Date;
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export class ConnectionRegistry {
  private readonly connections = new Map<string, ConnectionState>();

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /**
   * Register a new WebSocket connection.
   * Called on the "open" / connection event before any messages are processed.
   *
   * @returns A stable connection ID assigned to this socket session.
   */
  register(socket: WebSocket): string {
    const id = randomUUID();
    this.connections.set(id, {
      id,
      socket,
      subscribedChannels: new Set(),
      connectedAt: new Date(),
    });
    return id;
  }

  /**
   * Remove a connection from the registry.
   * Called on both clean close and error events to prevent memory leaks.
   * Safe to call multiple times for the same ID (idempotent).
   */
  unregister(id: string): void {
    this.connections.delete(id);
  }

  // ── Subscription management ─────────────────────────────────────────────────

  /**
   * Add one or more channels to a connection's subscription set.
   * Silently ignores unknown connection IDs (race between close and subscribe).
   */
  subscribe(id: string, channels: StreamChannel[]): void {
    const conn = this.connections.get(id);
    if (!conn) return;
    for (const ch of channels) {
      conn.subscribedChannels.add(ch);
    }
  }

  /**
   * Remove one or more channels from a connection's subscription set.
   * Silently ignores unknown connection IDs.
   */
  unsubscribe(id: string, channels: StreamChannel[]): void {
    const conn = this.connections.get(id);
    if (!conn) return;
    for (const ch of channels) {
      conn.subscribedChannels.delete(ch);
    }
  }

  // ── Query ───────────────────────────────────────────────────────────────────

  /**
   * Return all connections that are currently subscribed to the given channel.
   * Called by the broker on every publish to determine delivery targets.
   */
  getSubscribersForChannel(channel: StreamChannel): ConnectionState[] {
    const result: ConnectionState[] = [];
    for (const conn of this.connections.values()) {
      if (conn.subscribedChannels.has(channel)) {
        result.push(conn);
      }
    }
    return result;
  }

  /** Current number of active (open) connections. */
  get size(): number {
    return this.connections.size;
  }

  /**
   * Snapshot of all active connections.
   * Used by the internal emit endpoint for observability / debugging.
   */
  getAll(): ConnectionState[] {
    return Array.from(this.connections.values());
  }

  /**
   * Retrieve a single connection by ID.
   * Returns undefined if not found (already disconnected).
   */
  getById(id: string): ConnectionState | undefined {
    return this.connections.get(id);
  }
}
