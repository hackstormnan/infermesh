/**
 * api/mappers/stats.mapper.ts
 *
 * Adapts SummaryStatsDto → a flat view model ready for the Overview stat cards.
 */

import type { SummaryStatsDto, StatChange } from '../types/stats'

export interface StatsViewModel {
  totalRequests: string
  requestsPerSecond: string
  avgLatencyMs: string
  totalCostUsd: string
  activeWorkers: number
  successRatePct: string
  /** 0–1 fraction */
  successRate: number
  changes: {
    totalRequests: StatChange
    requestsPerSecond: StatChange
    avgLatency: StatChange
    totalCost: StatChange
  }
  computedAt: Date
}

export function mapSummaryStats(dto: SummaryStatsDto): StatsViewModel {
  return {
    totalRequests: dto.totalRequests.toLocaleString(),
    requestsPerSecond: `${dto.requestsPerSecond.toFixed(2)} rps`,
    avgLatencyMs: `${dto.avgLatency} ms`,
    totalCostUsd: `$${dto.totalCost.toFixed(4)}`,
    activeWorkers: dto.activeWorkers,
    successRatePct: `${(dto.successRate * 100).toFixed(1)}%`,
    successRate: dto.successRate,
    changes: dto.changes,
    computedAt: new Date(dto.computedAt),
  }
}
