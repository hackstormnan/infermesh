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
 * Emitted on the "requests" channel when a new inference request is accepted
 * by the intake flow and successfully enqueued.
 *
 * Source event: IntakeService.intake() → success
 */
export interface RequestAcceptedPayload {
  requestId: string;
  jobId: string;
  queueMessageId: string;
  /** RequestStatus string value at acceptance time */
  status: string;
  createdAt: string;
  enqueuedAt: string;
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
 * Emitted on the "decisions" channel with the full routing decision record
 * including candidate scores and selection rationale.
 *
 * Source event: RoutingDecisionService.decideRoute() → success
 */
export interface RoutingDecisionPayload extends RoutingOutcomeSummaryPayload {
  /** Human-readable reason the selected candidate was chosen */
  reason: string;
  /** Number of (model, worker) pairs evaluated */
  candidateCount: number;
  /** Whether the decision came from live traffic or a simulation run */
  decisionSource: string;
}
