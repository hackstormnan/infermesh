/**
 * api/mappers/request.mapper.ts
 *
 * Adapts InferenceRequestDto → RequestViewModel for table and stream panels.
 */

import type { InferenceRequestDto, RequestStatus } from '../types/requests'

export interface RequestViewModel {
  id: string
  shortId: string
  modelId: string
  status: RequestStatus
  taskType: string
  tokensIn?: number
  tokensOut?: number
  totalTokens?: number
  age: string
  createdAt: Date
  completedAt?: Date
  failureReason?: string
  hasRouted: boolean
}

function relativeAge(isoStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins}m ago`
  return `${Math.floor(mins / 60)}h ago`
}

function inferTaskType(dto: InferenceRequestDto): string {
  // Derive a display label from routing hints or return a generic label
  if (dto.routingHints.preferLatency) return 'latency-sensitive'
  if (dto.routingHints.preferCost) return 'cost-optimised'
  // Fall back to first message role as a hint
  const firstUser = dto.messages.find(m => m.role === 'user')
  if (firstUser) {
    const text = firstUser.content.toLowerCase()
    if (text.includes('summar')) return 'summarization'
    if (text.includes('classif')) return 'classification'
    if (text.includes('embed')) return 'embedding'
    if (text.includes('translat')) return 'translation'
  }
  return 'chat'
}

export function mapRequest(dto: InferenceRequestDto): RequestViewModel {
  return {
    id: dto.id,
    shortId: dto.id.slice(0, 8),
    modelId: dto.modelId,
    status: dto.status,
    taskType: inferTaskType(dto),
    tokensIn: dto.tokensIn,
    tokensOut: dto.tokensOut,
    totalTokens: dto.tokensIn != null && dto.tokensOut != null
      ? dto.tokensIn + dto.tokensOut
      : undefined,
    age: relativeAge(dto.createdAt),
    createdAt: new Date(dto.createdAt),
    completedAt: dto.completedAt ? new Date(dto.completedAt) : undefined,
    failureReason: dto.failureReason,
    hasRouted: dto.jobId != null,
  }
}

export function mapRequests(dtos: InferenceRequestDto[]): RequestViewModel[] {
  return dtos.map(mapRequest)
}
