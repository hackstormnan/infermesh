/**
 * shared/contracts/stream.ts
 *
 * Contracts for the **Stream** module — token-by-token streaming responses.
 *
 * InferMesh proxies streaming completions from model backends to clients.
 * These contracts define the event payload shapes emitted over the stream,
 * modelled as a discriminated union so consumers can handle each event type
 * in a type-safe, exhaustive switch statement.
 *
 * Transport layer (SSE / WebSocket framing) is intentionally out of scope here —
 * these are the data shapes, not the wire protocol.
 *
 * Event sequence for a successful streaming request:
 *   stream.started → token.delta (×N) → stream.stop → usage.report
 *
 * Event sequence for a failed streaming request:
 *   stream.started → token.delta (×N, optional) → stream.error
 */

import type { JobId, ModelId, RequestId, WorkerId } from "../primitives";

// ─── Event type discriminant ──────────────────────────────────────────────────

export enum StreamEventType {
  /** Stream opened; connection to worker established */
  StreamStarted = "stream.started",
  /** A chunk of generated text */
  TokenDelta = "token.delta",
  /** Model reached a natural stopping point */
  StreamStop = "stream.stop",
  /** Usage accounting — emitted after the final token */
  UsageReport = "usage.report",
  /** An error occurred; stream will not produce further tokens */
  StreamError = "stream.error",
  /** Keepalive — emitted on long-running requests to prevent connection timeout */
  Heartbeat = "heartbeat",
}

export enum StopReason {
  /** Model generated an end-of-sequence token */
  EndOfSequence = "end_of_sequence",
  /** Output reached the maxTokens limit */
  MaxTokens = "max_tokens",
  /** A configured stop sequence was encountered */
  StopSequence = "stop_sequence",
  /** Client cancelled the stream */
  ClientCancelled = "client_cancelled",
}

// ─── Base event ───────────────────────────────────────────────────────────────

interface BaseStreamEvent {
  /** Discriminant field — always present; determines the event shape */
  type: StreamEventType;
  requestId: RequestId;
  /** Unix epoch ms; used for latency measurement and ordering */
  timestamp: number;
}

// ─── Concrete event shapes ────────────────────────────────────────────────────

export interface StreamStartedEvent extends BaseStreamEvent {
  type: StreamEventType.StreamStarted;
  jobId: JobId;
  modelId: ModelId;
  workerId: WorkerId;
}

export interface TokenDeltaEvent extends BaseStreamEvent {
  type: StreamEventType.TokenDelta;
  /** The text chunk for this token or token group */
  delta: string;
  /** Running total of output tokens emitted so far (may be approximate) */
  tokenIndex: number;
}

export interface StreamStopEvent extends BaseStreamEvent {
  type: StreamEventType.StreamStop;
  stopReason: StopReason;
}

export interface UsageReportEvent extends BaseStreamEvent {
  type: StreamEventType.UsageReport;
  tokensIn: number;
  tokensOut: number;
  /** Total wall-clock duration from first token to last token in milliseconds */
  durationMs: number;
  /** Estimated cost in USD for this request */
  estimatedCostUsd?: number;
}

export interface StreamErrorEvent extends BaseStreamEvent {
  type: StreamEventType.StreamError;
  /** Machine-readable error code */
  code: string;
  message: string;
  /** Whether the caller can safely retry this request */
  retryable: boolean;
}

export interface HeartbeatEvent extends BaseStreamEvent {
  type: StreamEventType.Heartbeat;
}

// ─── Discriminated union ──────────────────────────────────────────────────────

/**
 * StreamEvent — the canonical union of all events that can appear on a stream.
 *
 * Use an exhaustive switch on `event.type` to handle each case:
 *
 * ```ts
 * switch (event.type) {
 *   case StreamEventType.TokenDelta:    // event is TokenDeltaEvent
 *   case StreamEventType.StreamStop:    // event is StreamStopEvent
 *   case StreamEventType.UsageReport:   // event is UsageReportEvent
 *   case StreamEventType.StreamError:   // event is StreamErrorEvent
 *   case StreamEventType.StreamStarted: // event is StreamStartedEvent
 *   case StreamEventType.Heartbeat:     // event is HeartbeatEvent
 * }
 * ```
 */
export type StreamEvent =
  | StreamStartedEvent
  | TokenDeltaEvent
  | StreamStopEvent
  | UsageReportEvent
  | StreamErrorEvent
  | HeartbeatEvent;

// ─── Stream session metadata ──────────────────────────────────────────────────

/**
 * Metadata for an active or completed streaming session.
 * Tracked by the stream module per connection.
 */
export interface StreamSession {
  requestId: RequestId;
  jobId: JobId;
  modelId: ModelId;
  workerId: WorkerId;
  /** Unix epoch ms when the stream was opened */
  openedAt: number;
  /** Unix epoch ms when the first token was emitted (TTFT measurement point) */
  firstTokenAt?: number;
  /** Unix epoch ms when the stream closed (any terminal event) */
  closedAt?: number;
  tokenCount: number;
  isActive: boolean;
}
