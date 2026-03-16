/**
 * api/types/stream.ts
 *
 * Frontend contracts for WebSocket stream events from /api/v1/stream.
 *
 * The backend publishes discriminated events over channels:
 *   "requests" — new intake events
 *   "workers"  — worker status/heartbeat updates
 *   "routing"  — routing decision events
 *   "decisions" — routing decision history updates
 *
 * Each event is a JSON object with a `type` discriminant.
 */

// ─── WebSocket subscription ───────────────────────────────────────────────────

export type StreamChannel = 'requests' | 'workers' | 'routing' | 'decisions'

export interface SubscribeMessage {
  type: 'subscribe'
  channels: StreamChannel[]
}

export interface UnsubscribeMessage {
  type: 'unsubscribe'
  channels: StreamChannel[]
}

// ─── Request stream events ────────────────────────────────────────────────────

export interface RequestStreamEvent {
  channel: 'requests'
  type: 'request.created' | 'request.updated'
  requestId: string
  modelId: string
  status: string
  timestamp: number
}

// ─── Worker stream events ─────────────────────────────────────────────────────

export interface WorkerStreamEvent {
  channel: 'workers'
  type: 'worker.registered' | 'worker.heartbeat' | 'worker.status_changed' | 'worker.evicted'
  workerId: string
  status: string
  activeJobs: number
  maxConcurrentJobs: number
  timestamp: number
}

// ─── Routing stream events ────────────────────────────────────────────────────

export interface RoutingStreamEvent {
  channel: 'routing' | 'decisions'
  type: 'routing.decision_made'
  decisionId: string
  requestId: string
  policyId: string
  outcome: string
  selectedModelId?: string
  selectedWorkerId?: string
  evaluationMs: number
  timestamp: number
}

// ─── Discriminated union ──────────────────────────────────────────────────────

export type InferMeshStreamEvent =
  | RequestStreamEvent
  | WorkerStreamEvent
  | RoutingStreamEvent
