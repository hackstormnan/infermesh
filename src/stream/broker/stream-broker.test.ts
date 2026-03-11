/**
 * stream/broker/stream-broker.test.ts
 *
 * Unit tests for InMemoryStreamBroker.
 *
 * Tests cover:
 *   - channel-targeted publishing (only subscribed connections receive frames)
 *   - message envelope stability (type, timestamp, data fields)
 *   - no-op behaviour when no subscribers exist
 *   - best-effort delivery (closed/erroring sockets are skipped, others unaffected)
 *   - publish only reaches the correct channel — cross-channel isolation
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { WebSocket } from "@fastify/websocket";
import { ConnectionRegistry } from "../gateway/connection-registry";
import { InMemoryStreamBroker } from "./stream-broker";
import type { StreamEnvelope } from "../contract";

// ─── Socket factory ───────────────────────────────────────────────────────────

interface SpySocket {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  /** Convenience: parsed frames sent via this socket */
  frames: () => StreamEnvelope[];
}

function makeSpySocket(readyState = 1): SpySocket & WebSocket {
  const sendMock = vi.fn();
  return {
    readyState,
    send: sendMock,
    on: vi.fn(),
    frames: () => sendMock.mock.calls.map(([raw]: [string]) => JSON.parse(raw) as StreamEnvelope),
  } as unknown as SpySocket & WebSocket;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("InMemoryStreamBroker", () => {
  let registry: ConnectionRegistry;
  let broker: InMemoryStreamBroker;

  beforeEach(() => {
    registry = new ConnectionRegistry();
    broker = new InMemoryStreamBroker(registry);
  });

  // ── No-op when empty ─────────────────────────────────────────────────────────

  it("does nothing when there are no connections", () => {
    expect(() => broker.publish("requests", { requestId: "r1" })).not.toThrow();
  });

  it("does nothing when no connections subscribe to the target channel", () => {
    const socket = makeSpySocket();
    const id = registry.register(socket as WebSocket);
    registry.subscribe(id, ["workers"]); // subscribed to workers, not requests

    broker.publish("requests", { requestId: "r1" });
    expect(socket.send).not.toHaveBeenCalled();
  });

  // ── Channel targeting ────────────────────────────────────────────────────────

  it("delivers to connections subscribed to the target channel", () => {
    const socket = makeSpySocket();
    const id = registry.register(socket as WebSocket);
    registry.subscribe(id, ["requests"]);

    broker.publish("requests", { requestId: "r1" });
    expect(socket.send).toHaveBeenCalledOnce();
  });

  it("does not deliver to connections subscribed to a different channel", () => {
    const socketA = makeSpySocket(); // subscribed to requests
    const socketB = makeSpySocket(); // subscribed to workers

    const idA = registry.register(socketA as WebSocket);
    const idB = registry.register(socketB as WebSocket);
    registry.subscribe(idA, ["requests"]);
    registry.subscribe(idB, ["workers"]);

    broker.publish("requests", { requestId: "r1" });

    expect(socketA.send).toHaveBeenCalledOnce();
    expect(socketB.send).not.toHaveBeenCalled();
  });

  it("delivers to ALL connections subscribed to the target channel", () => {
    const sockets = Array.from({ length: 4 }, () => makeSpySocket());
    for (const s of sockets) {
      const id = registry.register(s as WebSocket);
      registry.subscribe(id, ["routing"]);
    }

    broker.publish("routing", { decisionId: "d1" });
    for (const s of sockets) {
      expect(s.send).toHaveBeenCalledOnce();
    }
  });

  // ── Envelope stability ────────────────────────────────────────────────────────

  it("wraps data in a StreamEnvelope with type, data, and timestamp", () => {
    const socket = makeSpySocket();
    const id = registry.register(socket as WebSocket);
    registry.subscribe(id, ["workers"]);

    const payload = { workerId: "w1", status: "Idle", event: "heartbeat" } as const;
    broker.publish("workers", payload);

    const [frame] = socket.frames();
    expect(frame.type).toBe("workers");
    expect(frame.data).toEqual(payload);
    expect(typeof frame.timestamp).toBe("string");
    expect(() => new Date(frame.timestamp)).not.toThrow();
  });

  it("timestamp is a valid ISO 8601 string close to now", () => {
    const before = Date.now();
    const socket = makeSpySocket();
    const id = registry.register(socket as WebSocket);
    registry.subscribe(id, ["decisions"]);
    broker.publish("decisions", {});
    const after = Date.now();

    const [frame] = socket.frames();
    const ts = new Date(frame.timestamp).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("all subscribers receive an identical envelope payload", () => {
    const sockets = [makeSpySocket(), makeSpySocket()];
    for (const s of sockets) {
      const id = registry.register(s as WebSocket);
      registry.subscribe(id, ["requests"]);
    }

    broker.publish("requests", { requestId: "r1" });
    const frames = sockets.map((s) => s.frames()[0]);
    expect(frames[0]).toEqual(frames[1]);
  });

  // ── Best-effort delivery (closed sockets) ────────────────────────────────────

  it("skips sockets that are not OPEN (readyState !== 1)", () => {
    const closedSocket = makeSpySocket(3); // CLOSED
    const openSocket   = makeSpySocket(1); // OPEN

    const idClosed = registry.register(closedSocket as WebSocket);
    const idOpen   = registry.register(openSocket as WebSocket);
    registry.subscribe(idClosed, ["workers"]);
    registry.subscribe(idOpen, ["workers"]);

    broker.publish("workers", { workerId: "w2" });

    expect(closedSocket.send).not.toHaveBeenCalled();
    expect(openSocket.send).toHaveBeenCalledOnce();
  });

  it("continues delivering to other sockets when one send() throws", () => {
    const badSocket  = makeSpySocket();
    const goodSocket = makeSpySocket();

    badSocket.send.mockImplementationOnce(() => {
      throw new Error("simulated send failure");
    });

    const idBad  = registry.register(badSocket as WebSocket);
    const idGood = registry.register(goodSocket as WebSocket);
    registry.subscribe(idBad,  ["requests"]);
    registry.subscribe(idGood, ["requests"]);

    expect(() => broker.publish("requests", { requestId: "r99" })).not.toThrow();
    expect(goodSocket.send).toHaveBeenCalledOnce();
  });

  // ── Cross-channel isolation ───────────────────────────────────────────────────

  it("publishing to one channel does not emit frames on unrelated channels", () => {
    const socket = makeSpySocket();
    const id = registry.register(socket as WebSocket);
    registry.subscribe(id, ["requests", "workers", "routing", "decisions"]);

    broker.publish("routing", { decisionId: "d99" });
    expect(socket.send).toHaveBeenCalledOnce(); // not 4 times

    const [frame] = socket.frames();
    expect(frame.type).toBe("routing");
  });

  // ── After disconnect ──────────────────────────────────────────────────────────

  it("does not deliver to connections that have been unregistered", () => {
    const socket = makeSpySocket();
    const id = registry.register(socket as WebSocket);
    registry.subscribe(id, ["requests"]);
    registry.unregister(id); // simulate disconnect

    broker.publish("requests", { requestId: "r1" });
    expect(socket.send).not.toHaveBeenCalled();
  });
});
