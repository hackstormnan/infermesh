/**
 * api/mappers/model.mapper.ts
 *
 * Adapts ModelDto → ModelViewModel for the Models page components.
 */

import type { ModelDto, ModelProvider, ModelStatus, QualityTier } from '../types/models'

export interface ModelViewModel {
  id: string
  name: string
  aliases: string[]
  provider: ModelProvider
  version?: string
  capabilities: string[]
  supportedTasks: string[]
  qualityTier: QualityTier
  qualityTierLabel: string
  status: ModelStatus
  contextWindow: number
  contextWindowDisplay: string
  maxOutputTokens: number
  maxOutputDisplay: string
  inputPer1kTokens: number
  outputPer1kTokens: number
  /** e.g. "$3.00 / $15.00" (in / out per 1k) */
  pricingDisplay: string
  ttftMs: number
  tokensPerSecond: number
  createdAt: Date
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`
  return String(n)
}

function fmtPrice(n: number): string {
  return `$${n.toFixed(2)}`
}

const TIER_LABELS: Record<QualityTier, string> = {
  frontier: 'Frontier',
  standard: 'Standard',
  economy:  'Economy',
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

export function mapModel(dto: ModelDto): ModelViewModel {
  return {
    id:                   dto.id,
    name:                 dto.name,
    aliases:              dto.aliases,
    provider:             dto.provider,
    version:              dto.version,
    capabilities:         dto.capabilities,
    supportedTasks:       dto.supportedTasks,
    qualityTier:          dto.qualityTier,
    qualityTierLabel:     TIER_LABELS[dto.qualityTier],
    status:               dto.status,
    contextWindow:        dto.contextWindow,
    contextWindowDisplay: fmtTokenCount(dto.contextWindow),
    maxOutputTokens:      dto.maxOutputTokens,
    maxOutputDisplay:     fmtTokenCount(dto.maxOutputTokens),
    inputPer1kTokens:     dto.pricing.inputPer1kTokens,
    outputPer1kTokens:    dto.pricing.outputPer1kTokens,
    pricingDisplay:       `${fmtPrice(dto.pricing.inputPer1kTokens)} / ${fmtPrice(dto.pricing.outputPer1kTokens)}`,
    ttftMs:               dto.latencyProfile.ttftMs,
    tokensPerSecond:      dto.latencyProfile.tokensPerSecond,
    createdAt:            new Date(dto.createdAt),
  }
}

export function mapModels(dtos: ModelDto[]): ModelViewModel[] {
  return dtos.map(mapModel)
}
