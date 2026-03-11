/**
 * stream/gateway/connection-registry.test.ts
 *
 * Unit tests for ConnectionRegistry.
 *
 * Tests cover:
 *   - register / unregister lifecycle and size tracking
 *   - subscribe / unsubscribe channel management
 *   - getSubscribersForChannel — channel-targeted delivery
 *   - cleanup on disconnect (no leaked state)
 *   - idempotent unregister
 *   - getById lookup
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { WebSocket } from "@fastify/websocket";
import { ConnectionRegistry } from "./connection-registry";
import type { StreamChannel } from "../contract";

// ─── Minimal WebSocket stub ───────────────────────────────────────────────────

function makeSocket(readyState = 1): WebSocket {
  return {
    readyState,
    send: () => {},
    on: () => {},
  } as unknown as WebSocket;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ConnectionRegistry", () => {
  let registry: ConnectionRegistry;

  beforeEach(() => {
    registry = new ConnectionRegistry();
  });

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  describe("register / unregister", () => {
    it("starts empty", () => {
      expect(registry.size).toBe(0);
    });

    it("register() returns a non-empty ID and increments size", () => {
      const id = registry.register(makeSocket());
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
      expect(registry.size).toBe(1);
    });

    it("each register() call returns a distinct ID", () => {
      const ids = Array.from({ length: 5 }, () => registry.register(makeSocket()));
      const unique = new Set(ids);
      expect(unique.size).toBe(5);
    });

    it("unregister() removes the connection and decrements size", () => {
      const id = registry.register(makeSocket());
      registry.unregister(id);
      expect(registry.size).toBe(0);
    });

    it("unregister() is idempotent — calling twice does not throw", () => {
      const id = registry.register(makeSocket());
      registry.unregister(id);
      expect(() => registry.unregister(id)).not.toThrow();
      expect(registry.size).toBe(0);
    });

    it("unregister() only removes the targeted connection", () => {
      const id1 = registry.register(makeSocket());
      const id2 = registry.register(makeSocket());
      registry.unregister(id1);
      expect(registry.size).toBe(1);
      expect(registry.getById(id2)).toBeDefined();
    });
  });

  // ── Subscription management ─────────────────────────────────────────────────

  describe("subscribe", () => {
    it("adds channels to the connection's subscription set", () => {
      const id = registry.register(makeSocket());
      registry.subscribe(id, ["requests", "workers"]);
      const conn = registry.getById(id)!;
      expect(conn.subscribedChannels.has("requests")).toBe(true);
      expect(conn.subscribedChannels.has("workers")).toBe(true);
    });

    it("is additive — subsequent subscribes merge channels", () => {
      const id = registry.register(makeSocket());
      registry.subscribe(id, ["requests"]);
      registry.subscribe(id, ["routing"]);
      const conn = registry.getById(id)!;
      expect(conn.subscribedChannels.size).toBe(2);
    });

    it("subscribing to the same channel twice does not duplicate it", () => {
      const id = registry.register(makeSocket());
      registry.subscribe(id, ["requests"]);
      registry.subscribe(id, ["requests"]);
      const conn = registry.getById(id)!;
      expect(conn.subscribedChannels.size).toBe(1);
    });

    it("silently ignores unknown connection IDs (race: close before subscribe)", () => {
      expect(() => registry.subscribe("nonexistent-id", ["requests"])).not.toThrow();
    });
  });

  describe("unsubscribe", () => {
    it("removes specified channels", () => {
      const id = registry.register(makeSocket());
      registry.subscribe(id, ["requests", "workers", "routing"]);
      registry.unsubscribe(id, ["workers"]);
      const conn = registry.getById(id)!;
      expect(conn.subscribedChannels.has("workers")).toBe(false);
      expect(conn.subscribedChannels.has("requests")).toBe(true);
      expect(conn.subscribedChannels.has("routing")).toBe(true);
    });

    it("unsubscribing a channel not previously subscribed is a no-op", () => {
      const id = registry.register(makeSocket());
      registry.subscribe(id, ["requests"]);
      expect(() => registry.unsubscribe(id, ["routing"])).not.toThrow();
      expect(registry.getById(id)!.subscribedChannels.size).toBe(1);
    });

    it("silently ignores unknown connection IDs", () => {
      expect(() =>
        registry.unsubscribe("nonexistent-id", ["requests"]),
      ).not.toThrow();
    });
  });

  // ── Channel-targeted delivery ────────────────────────────────────────────────

  describe("getSubscribersForChannel", () => {
    it("returns only connections subscribed to the requested channel", () => {
      const idA = registry.register(makeSocket());
      const idB = registry.register(makeSocket());
      const idC = registry.register(makeSocket());

      registry.subscribe(idA, ["requests"]);
      registry.subscribe(idB, ["requests", "workers"]);
      // idC has no subscriptions

      const subs = registry.getSubscribersForChannel("requests");
      const ids = subs.map((c) => c.id);

      expect(ids).toContain(idA);
      expect(ids).toContain(idB);
      expect(ids).not.toContain(idC);
    });

    it("returns an empty array when no connections subscribe to the channel", () => {
      registry.register(makeSocket()); // no subscriptions
      expect(registry.getSubscribersForChannel("routing")).toHaveLength(0);
    });

    it("does not include a connection after it unsubscribes from the channel", () => {
      const id = registry.register(makeSocket());
      registry.subscribe(id, ["decisions"]);
      registry.unsubscribe(id, ["decisions"]);
      expect(registry.getSubscribersForChannel("decisions")).toHaveLength(0);
    });

    it("does not include a connection after it disconnects", () => {
      const id = registry.register(makeSocket());
      registry.subscribe(id, ["workers"]);
      registry.unregister(id);
      expect(registry.getSubscribersForChannel("workers")).toHaveLength(0);
    });
  });

  // ── getAll / getById ─────────────────────────────────────────────────────────

  describe("getAll / getById", () => {
    it("getAll() returns a snapshot of all connections", () => {
      const id1 = registry.register(makeSocket());
      const id2 = registry.register(makeSocket());
      const all = registry.getAll();
      expect(all.map((c) => c.id)).toEqual(expect.arrayContaining([id1, id2]));
    });

    it("getById() returns the connection state for a known ID", () => {
      const socket = makeSocket();
      const id = registry.register(socket);
      const conn = registry.getById(id);
      expect(conn).toBeDefined();
      expect(conn!.id).toBe(id);
      expect(conn!.socket).toBe(socket);
    });

    it("getById() returns undefined for an unknown ID", () => {
      expect(registry.getById("not-a-real-id")).toBeUndefined();
    });

    it("connectedAt is set at registration time", () => {
      const before = new Date();
      const id = registry.register(makeSocket());
      const after = new Date();
      const conn = registry.getById(id)!;
      expect(conn.connectedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(conn.connectedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  // ── Multi-channel correctness ────────────────────────────────────────────────

  describe("multi-channel correctness", () => {
    const CHANNELS: StreamChannel[] = ["requests", "workers", "routing", "decisions"];

    it("a single connection can subscribe to all channels independently", () => {
      const id = registry.register(makeSocket());
      registry.subscribe(id, CHANNELS);
      for (const ch of CHANNELS) {
        expect(registry.getSubscribersForChannel(ch)).toHaveLength(1);
      }
    });

    it("unregistering clears the connection from every channel's subscriber list", () => {
      const id = registry.register(makeSocket());
      registry.subscribe(id, CHANNELS);
      registry.unregister(id);
      for (const ch of CHANNELS) {
        expect(registry.getSubscribersForChannel(ch)).toHaveLength(0);
      }
    });
  });
});
