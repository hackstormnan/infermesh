/**
 * api/types/models.ts
 *
 * Frontend contract for model-related API endpoints.
 * Mirrors ModelDto from src/shared/contracts/model.ts.
 */

export type ModelStatus = 'active' | 'inactive' | 'deprecated'

export type ModelProvider =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'mistral'
  | 'cohere'
  | 'meta'
  | 'custom'

export type ModelCapability =
  | 'text_generation'
  | 'tool_use'
  | 'vision'
  | 'audio'
  | 'embedding'
  | 'code_generation'

export type QualityTier = 'frontier' | 'standard' | 'economy'

export type ModelTask =
  | 'chat'
  | 'summarization'
  | 'translation'
  | 'classification'
  | 'extraction'
  | 'coding'
  | 'reasoning'
  | 'rag'

export interface ModelPricing {
  inputPer1kTokens: number
  outputPer1kTokens: number
}

export interface ModelLatencyProfile {
  ttftMs: number
  tokensPerSecond: number
}

/** GET /api/v1/models and GET /api/v1/models/:id */
export interface ModelDto {
  id: string
  name: string
  aliases: string[]
  provider: ModelProvider
  version?: string
  capabilities: ModelCapability[]
  supportedTasks: ModelTask[]
  qualityTier: QualityTier
  contextWindow: number
  maxOutputTokens: number
  pricing: ModelPricing
  latencyProfile: ModelLatencyProfile
  status: ModelStatus
  createdAt: string
  updatedAt: string
}
