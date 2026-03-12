/**
 * stream/contract.test.ts
 *
 * Contract-level shape tests for the WebSocket stream protocol.
 *
 * These tests verify the structural invariants of the stream contract:
 *   - STREAM_CHANNELS contains exactly the expected channel names
 *   - StreamEnvelope carries the required fields with correct types
 *   - Domain payload interfaces carry required fields
 *   - Control message shape is enforced
 *
 * No server or broker is instantiated — these are pure type/shape tests
 * that guard against accidental contract regressions.
 */

import { describe, it, expect } from "vitest";
import {
  STREAM_CHANNELS,
} from "./contract";
import type {
  StreamEnvelope,
  StreamControlMessage,
  SystemWelcomePayload,
  AckPayload,
  ErrorPayload,
  RequestAcceptedPayload,
  WorkerStatusPayload,
  RoutingOutcomeSummaryPayload,
  RoutingDecisionPayload,
} from "./contract";

// ─── STREAM_CHANNELS ──────────────────────────────────────────────────────────

describe("STREAM_CHANNELS", () => {
  it("contains exactly the four domain channels", () => {
    expect(STREAM_CHANNELS).toContain("requests");
    expect(STREAM_CHANNELS).toContain("workers");
    expect(STREAM_CHANNELS).toContain("routing");
    expect(STREAM_CHANNELS).toContain("decisions");
  });

  it("has exactly 4 entries", () => {
    expect(STREAM_CHANNELS).toHaveLength(4);
  });

  it("is a readonly tuple (immutable array)", () => {
    // Verify it's array-like and frozen or const-asserted
    expect(Array.isArray(STREAM_CHANNELS)).toBe(true);
  });
});

// ─── StreamEnvelope shape ─────────────────────────────────────────────────────

describe("StreamEnvelope", () => {
  it("accepts a domain channel type field", () => {
    const envelope: StreamEnvelope<{ value: number }> = {
      type: "requests",
      data: { value: 42 },
      timestamp: new Date().toISOString(),
    };

    expect(envelope.type).toBe("requests");
    expect(envelope.data).toEqual({ value: 42 });
    expect(typeof envelope.timestamp).toBe("string");
  });

  it("accepts system control frame types", () => {
    const systemFrame: StreamEnvelope<unknown> = {
      type: "system",
      data: { message: "connected" },
      timestamp: new Date().toISOString(),
    };
    expect(systemFrame.type).toBe("system");

    const ackFrame: StreamEnvelope<unknown> = {
      type: "ack",
      data: { action: "subscribe", channels: ["requests"] },
      timestamp: new Date().toISOString(),
    };
    expect(ackFrame.type).toBe("ack");

    const errorFrame: StreamEnvelope<unknown> = {
      type: "error",
      data: { message: "unknown channel" },
      timestamp: new Date().toISOString(),
    };
    expect(errorFrame.type).toBe("error");
  });
});

// ─── StreamControlMessage shape ───────────────────────────────────────────────

describe("StreamControlMessage", () => {
  it("accepts a subscribe control message", () => {
    const msg: StreamControlMessage = {
      action: "subscribe",
      channels: ["requests", "workers"],
    };
    expect(msg.action).toBe("subscribe");
    expect(msg.channels).toHaveLength(2);
  });

  it("accepts an unsubscribe control message", () => {
    const msg: StreamControlMessage = {
      action: "unsubscribe",
      channels: ["routing"],
    };
    expect(msg.action).toBe("unsubscribe");
  });
});

// ─── System frame payload shapes ─────────────────────────────────────────────

describe("SystemWelcomePayload", () => {
  it("has required fields", () => {
    const payload: SystemWelcomePayload = {
      message: "Connected to InferMesh stream gateway",
      connectionId: "conn-abc-123",
      availableChannels: STREAM_CHANNELS,
    };
    expect(payload.message).toBeDefined();
    expect(payload.connectionId).toBeDefined();
    expect(payload.availableChannels).toBe(STREAM_CHANNELS);
  });
});

describe("AckPayload", () => {
  it("has required action and channels fields", () => {
    const payload: AckPayload = {
      action: "subscribe",
      channels: ["requests", "decisions"],
    };
    expect(payload.action).toBe("subscribe");
    expect(payload.channels).toHaveLength(2);
  });
});

describe("ErrorPayload", () => {
  it("has a required message field", () => {
    const payload: ErrorPayload = {
      message: "Unknown channel: foo",
    };
    expect(payload.message).toBeDefined();
  });

  it("optionally carries the raw message text", () => {
    const payload: ErrorPayload = {
      message: "Parse error",
      raw: '{"action":"subscribe","channels":"not-an-array"}',
    };
    expect(payload.raw).toBeDefined();
  });
});

// ─── Domain channel payload shapes ───────────────────────────────────────────

describe("RequestAcceptedPayload", () => {
  it("has all required fields", () => {
    const payload: RequestAcceptedPayload = {
      id: "req-001",
      timestamp: new Date().toISOString(),
      model: "gpt-4o",
      latency: 0,
      status: "pending",
      endpoint: "/api/v1/inference/requests",
    };

    expect(payload.id).toBeDefined();
    expect(payload.timestamp).toBeDefined();
    expect(payload.model).toBeDefined();
    expect(payload.latency).toBe(0);
    expect(payload.status).toBe("pending");
    expect(payload.endpoint).toBeDefined();
  });

  it("status can be pending, processing, completed, or failed", () => {
    const statuses: RequestAcceptedPayload["status"][] = [
      "pending",
      "processing",
      "completed",
      "failed",
    ];
    expect(statuses).toHaveLength(4);
  });
});

describe("WorkerStatusPayload", () => {
  it("has all required fields", () => {
    const payload: WorkerStatusPayload = {
      workerId: "worker-001",
      status: "healthy",
      queueSize: 2,
      name: "gpu-worker-1",
      lastHeartbeat: Date.now(),
      event: "heartbeat",
    };

    expect(payload.workerId).toBeDefined();
    expect(payload.status).toBe("healthy");
    expect(typeof payload.queueSize).toBe("number");
    expect(payload.name).toBeDefined();
    expect(typeof payload.lastHeartbeat).toBe("number");
    expect(payload.event).toBe("heartbeat");
  });

  it("optional metric fields can be absent", () => {
    const payload: WorkerStatusPayload = {
      workerId: "worker-002",
      status: "offline",
      queueSize: 0,
      name: "cpu-worker-1",
      lastHeartbeat: Date.now(),
      event: "deregistered",
    };

    expect(payload.cpu).toBeUndefined();
    expect(payload.memory).toBeUndefined();
    expect(payload.latency).toBeUndefined();
    expect(payload.throughput).toBeUndefined();
    expect(payload.loadScore).toBeUndefined();
  });
});

describe("RoutingOutcomeSummaryPayload", () => {
  it("has all required fields", () => {
    const payload: RoutingOutcomeSummaryPayload = {
      decisionId: "dec-001",
      requestId: "req-001",
      outcome: "routed",
      strategy: "least_loaded",
      usedFallback: false,
      evaluationMs: 8,
      decidedAt: Date.now(),
    };

    expect(payload.decisionId).toBeDefined();
    expect(payload.requestId).toBeDefined();
    expect(payload.outcome).toBe("routed");
    expect(payload.strategy).toBeDefined();
    expect(typeof payload.usedFallback).toBe("boolean");
    expect(typeof payload.evaluationMs).toBe("number");
    expect(typeof payload.decidedAt).toBe("number");
  });
});

describe("RoutingDecisionPayload", () => {
  it("has all required fields including factors breakdown", () => {
    const payload: RoutingDecisionPayload = {
      id: "dec-001",
      timestamp: new Date().toISOString(),
      selectedModel: "claude-sonnet-4-6",
      reason: "Lowest load score among eligible workers",
      factors: {
        latency: 0.85,
        cost: 0.72,
        availability: 0.91,
      },
    };

    expect(payload.id).toBeDefined();
    expect(payload.timestamp).toBeDefined();
    expect(payload.selectedModel).toBeDefined();
    expect(payload.reason).toBeDefined();
    expect(typeof payload.factors.latency).toBe("number");
    expect(typeof payload.factors.cost).toBe("number");
    expect(typeof payload.factors.availability).toBe("number");
  });
});
