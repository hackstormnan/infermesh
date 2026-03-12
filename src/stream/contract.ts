/**
 * stream/contract.ts
 *
 * Central protocol contracts for the WebSocket stream gateway.
 *
 * All channel names, outbound envelope shapes, inbound control message types,
 * and per-channel payload shapes are defined here so the gateway, broker,
 * and any future consumers share a single source of truth.
 *
 * ─── Protocol overview ────────────────────────────────────────────────────────
 *
 *   Client → Server (control messages):
 *     { "action": "subscribe",   "channels": ["requests", "workers"] }
 *     { "action": "unsubscribe", "channels": ["routing"] }
 *
 *   Server → Client (outbound envelopes):
 *     { "type": "requests", "data": { ... }, "timestamp": "2025-01-01T00:00:00.000Z" }
 *     { "type": "system",   "data": { ... }, "timestamp": "..." }  ← connection ack
 *     { "type": "ack",      "data": { ... }, "timestamp": "..." }  ← subscribe ack
 *     { "type": "error",    "data": { ... }, "timestamp": "..." }  ← protocol errors
 *
 * ─── Channel taxonomy ─────────────────────────────────────────────────────────
 *   requests  — new inference requests accepted through the intake flow
 *   workers   — worker status changes (register, heartbeat, deregister)
 *   routing   — routing decision outcomes (model + worker selected)
 *   decisions — full routing decision details (enriched version of routing)
 */

// ─── Channels ─────────────────────────────────────────────────────────────────

export const STREAM_CHANNELS = [
  "requests",
  "workers",
  "routing",
  "decisions",
] as const;

export type StreamChannel = (typeof STREAM_CHANNELS)[number];

// ─── System / control frame types (server-to-client only) ─────────────────────

/** Types allowed in the envelope `type` field (domain channels + control frames) */
export type EnvelopeType = StreamChannel | "system" | "ack" | "error";

// ─── Outbound envelope ────────────────────────────────────────────────────────

/**
 * StreamEnvelope — the canonical wrapper for every server-to-client message.
 *
 * Consumers should switch on `type` to determine the shape of `data`.
 * System frames ("system", "ack", "error") are always present regardless of
 * channel subscriptions. Domain frames ("requests", "workers", …) are only
 * sent to connections that have subscribed to the corresponding channel.
 */
export interface StreamEnvelope<T = unknown> {
  /** Discriminant: which operational domain this event belongs to */
  type: EnvelopeType;
  /** Event payload — shape is determined by `type` */
  data: T;
  /** ISO 8601 timestamp of when the event was published by the broker */
  timestamp: string;
}

// ─── Inbound control messages (client-to-server) ──────────────────────────────

export type ControlAction = "subscribe" | "unsubscribe";

/**
 * StreamControlMessage — the only message type clients are expected to send.
 *
 * Clients SHOULD send a subscribe message immediately after connecting to
 * begin receiving events. Unsubscribed connections receive only system frames.
 *
 * Example:
 *   { "action": "subscribe", "channels": ["requests", "workers"] }
 */
export interface StreamControlMessage {
  action: ControlAction;
  /** One or more channel names from the STREAM_CHANNELS tuple */
  channels: StreamChannel[];
}

// ─── System frame payloads ────────────────────────────────────────────────────

/** Sent once on connection open as a connection-acknowledged frame */
export interface SystemWelcomePayload {
  message: string;
  connectionId: string;
  /** Complete list of subscribable channels */
  availableChannels: readonly StreamChannel[];
}

/** Sent in response to a subscribe/unsubscribe control message */
export interface AckPayload {
  action: ControlAction;
  /** The subset of requested channels that were accepted */
  channels: StreamChannel[];
}

/** Sent when the gateway cannot parse or honour a client message */
export interface ErrorPayload {
  message: string;
  /** Original raw message text, truncated for logging */
  raw?: string;
}

// ─── Domain channel payload types ────────────────────────────────────────────

/**
 * UI-facing status vocabulary for the "requests" stream channel.
 *
 * This is deliberately decoupled from the internal RequestStatus enum so
 * the dashboard receives a stable, simplified status string that the frontend
 * can display without knowing the backend's lifecycle state machine.
 *
 * Lifecycle progression:
 *   pending    → request accepted, waiting for routing/execution
 *   processing → worker has been assigned; execution in flight
 *   completed  → terminal success
 *   failed     → terminal failure
 */
export type RequestStreamStatus = "pending" | "processing" | "completed" | "failed";

/**
 * Emitted on the "requests" channel when a new inference request is accepted
 * by the intake flow and successfully enqueued.
 *
 * Source event: IntakeService.intake() → success (after both request and
 * job records are created and the job has been dispatched to the queue).
 *
 * Shape is aligned with the dashboard UI specification so the frontend can
 * consume it directly without field remapping.
 */
export interface RequestAcceptedPayload {
  /** Server-assigned request ID */
  id: string;
  /** ISO 8601 timestamp when the request was accepted */
  timestamp: string;
  /** Model identifier the request targets (e.g. "gpt-4o", "llama-3-70b") */
  model: string;
  /**
   * Measured end-to-end latency in milliseconds.
   * Always 0 at acceptance time; updated by subsequent stream events
   * once the worker completes execution.
   */
  latency: number;
  /** Dashboard-facing request status at the time of this event */
  status: RequestStreamStatus;
  /** Canonical intake API endpoint path */
  endpoint: string;
}

/**
 * Emitted on the "workers" channel when a worker's operational status changes.
 *
 * Source events: WorkersService.register(), heartbeat(), deregister()
 */
export interface WorkerStatusPayload {
  workerId: string;
  name: string;
  /** WorkerStatus string value */
  status: string;
  region?: string;
  /** Current number of active jobs on this worker */
  activeJobs?: number;
  updatedAt: string;
  /** The operation that triggered this event */
  event: "registered" | "heartbeat" | "deregistered";
}

/**
 * Emitted on the "routing" channel with a concise summary of a routing decision.
 * For full candidate-level detail, subscribe to "decisions".
 *
 * Source event: RoutingDecisionService.decideRoute() → success
 */
export interface RoutingOutcomeSummaryPayload {
  decisionId: string;
  requestId: string;
  jobId?: string;
  /** RoutingOutcome string value */
  outcome: string;
  selectedModelId?: string;
  selectedWorkerId?: string;
  /** RoutingStrategy string value */
  strategy: string;
  usedFallback: boolean;
  evaluationMs: number;
  /** Unix epoch ms */
  decidedAt: number;
}

/**
 * Emitted on the "decisions" channel when a routing decision is finalized.
 *
 * Shape is aligned with the dashboard UI specification. The `factors` object
 * carries normalized [0–1] dimension scores that drove the selection so the
 * frontend can render a visual breakdown without additional API calls.
 *
 * Source event: RoutingDecisionService.decideRoute() → success (after the
 * RoutingDecision record is persisted).
 */
export interface RoutingDecisionPayload {
  /** Server-assigned decision ID */
  id: string;
  /** ISO 8601 timestamp when the decision was finalized */
  timestamp: string;
  /** ID of the model that was selected (e.g. "gpt-4o", "llama-3-70b") */
  selectedModel: string;
  /** Human-readable explanation of why this model + worker were chosen */
  reason: string;
  /** Normalized scoring dimensions that drove the selection [0 = worst, 1 = best] */
  factors: {
    /** Combined latency score for the selected model + worker pair */
    latency: number;
    /** Cost efficiency score for the selected model */
    cost: number;
    /** Worker availability score (inverse of load; 1 = fully free, 0 = saturated) */
    availability: number;
  };
}
