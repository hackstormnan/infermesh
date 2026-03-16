/**
 * api/types/requests.ts
 *
 * Frontend contract for request-related API endpoints.
 * Mirrors InferenceRequestDto from the backend requests module.
 */

export type RequestStatus =
  | 'queued'
  | 'dispatched'
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface RoutingHints {
  preferCost?: boolean
  preferLatency?: boolean
  region?: string
  maxCostUsd?: number
  maxLatencyMs?: number
}

export interface InferenceParams {
  maxTokens?: number
  temperature?: number
  topP?: number
  stopSequences?: string[]
  stream?: boolean
}

/** GET /api/v1/requests and GET /api/v1/requests/:id */
export interface InferenceRequestDto {
  id: string
  modelId: string
  messages: ChatMessage[]
  params: InferenceParams
  routingHints: RoutingHints
  status: RequestStatus
  jobId?: string
  tokensIn?: number
  tokensOut?: number
  firstTokenAt?: string
  completedAt?: string
  failureReason?: string
  createdAt: string
  updatedAt: string
}
