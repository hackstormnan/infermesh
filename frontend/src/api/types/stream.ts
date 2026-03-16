/**
 * api/types/stream.ts
 *
 * Frontend contracts for WebSocket stream events from /api/v1/stream.
 *
 * ─── Protocol ────────────────────────────────────────────────────────────────
 *
 *   Client → Server (control messages):
 *     { "action": "subscribe",   "channels": ["requests", "workers"] }
 *     { "action": "unsubscribe", "channels": ["routing"] }
 *
 *   Server → Client (outbound envelopes):
 *     { "type": "requests",  "data": { ... }, "timestamp": "2025-01-01T…Z" }
 *     { "type": "workers",   "data": { ... }, "timestamp": "…" }
 *     { "type": "routing",   "data": { ... }, "timestamp": "…" }
 *     { "type": "decisions", "data": { ... }, "timestamp": "…" }
 *     { "type": "system",    "data": { ... }, "timestamp": "…" }  ← welcome ack
 *     { "type": "ack",       "data": { ... }, "timestamp": "…" }  ← subscribe ack
 *     { "type": "error",     "data": { ... }, "timestamp": "…" }  ← protocol error
 */

// ─── WebSocket subscription (client → server) ─────────────────────────────────

export type StreamChannel = 'requests' | 'workers' | 'routing' | 'decisions'

export interface SubscribeMessage {
  action: 'subscribe'
  channels: StreamChannel[]
}

export interface UnsubscribeMessage {
  action: 'unsubscribe'
  channels: StreamChannel[]
}

// ─── Outbound envelope (server → client) ─────────────────────────────────────

export type EnvelopeType = StreamChannel | 'system' | 'ack' | 'error'

export interface StreamEnvelope<T = unknown> {
  /** Channel name or control frame type */
  type: EnvelopeType
  /** Event payload — shape determined by `type` */
  data: T
  /** ISO 8601 timestamp when the broker published this event */
  timestamp: string
}

// ─── Request channel payload ──────────────────────────────────────────────────

/** Simplified status string for dashboard display — decoupled from internal RequestStatus */
export type RequestStreamStatus = 'pending' | 'processing' | 'completed' | 'failed'

/** Published on the "requests" channel when a new inference request is accepted */
export interface RequestAcceptedPayload {
  id: string
  /** ISO 8601 timestamp when the request was accepted */
  timestamp: string
  /** Target model identifier */
  model: string
  /** End-to-end latency ms — always 0 at acceptance time */
  latency: number
  status: RequestStreamStatus
  /** Canonical intake endpoint path */
  endpoint: string
}

// ─── Worker channel payload ───────────────────────────────────────────────────

export type WorkerStreamStatus = 'healthy' | 'degraded' | 'offline'

/** Published on the "workers" channel when a worker's status or metrics change */
export interface WorkerStatusPayload {
  workerId: string
  status: WorkerStreamStatus
  cpu?: number
  memory?: number
  latency?: number
  queueSize: number
  throughput?: number
  name: string
  region?: string
  /** Unix epoch ms of the last heartbeat */
  lastHeartbeat: number
  loadScore?: number
  event: 'registered' | 'heartbeat' | 'deregistered'
}

// ─── Routing channel payload ──────────────────────────────────────────────────

/** Published on the "routing" channel with a concise summary of a routing decision */
export interface RoutingOutcomeSummaryPayload {
  decisionId: string
  requestId: string
  jobId?: string
  outcome: string
  selectedModelId?: string
  selectedWorkerId?: string
  strategy: string
  usedFallback: boolean
  evaluationMs: number
  /** Unix epoch ms */
  decidedAt: number
}

// ─── Decisions channel payload ────────────────────────────────────────────────

/** Published on the "decisions" channel with full scoring detail */
export interface RoutingDecisionPayload {
  id: string
  /** ISO 8601 timestamp */
  timestamp: string
  selectedModel: string
  reason: string
  factors: {
    latency: number
    cost: number
    availability: number
  }
}

// ─── Typed envelope variants ──────────────────────────────────────────────────

export type RequestsEnvelope  = StreamEnvelope<RequestAcceptedPayload>       & { type: 'requests' }
export type WorkersEnvelope   = StreamEnvelope<WorkerStatusPayload>          & { type: 'workers' }
export type RoutingEnvelope   = StreamEnvelope<RoutingOutcomeSummaryPayload> & { type: 'routing' }
export type DecisionsEnvelope = StreamEnvelope<RoutingDecisionPayload>       & { type: 'decisions' }

/** Discriminated union of all domain-channel events (excludes system/ack/error frames) */
export type InferMeshStreamEvent =
  | RequestsEnvelope
  | WorkersEnvelope
  | RoutingEnvelope
  | DecisionsEnvelope
