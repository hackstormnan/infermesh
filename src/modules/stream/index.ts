/**
 * modules/stream — Streaming Response Handling
 *
 * Proxies token-by-token completions from model backends to clients via SSE
 * or WebSocket. Emits structured StreamEvents consumed by the metrics module.
 *
 * Depends on shared contracts:
 *   StreamEvent (discriminated union of all event types)
 *   StreamEventType, StopReason, StreamSession
 *   Individual event shapes: TokenDeltaEvent, UsageReportEvent, StreamErrorEvent, etc.
 *
 * Will expose (future tickets):
 *   GET /api/v1/requests/:id/stream    — SSE endpoint for streaming completions
 *   WS  /api/v1/requests/:id/ws        — WebSocket alternative
 */

export type {
  StreamEvent,
  StreamSession,
  StreamStartedEvent,
  TokenDeltaEvent,
  StreamStopEvent,
  UsageReportEvent,
  StreamErrorEvent,
  HeartbeatEvent,
} from "../../shared/contracts/stream";

export { StreamEventType, StopReason } from "../../shared/contracts/stream";
