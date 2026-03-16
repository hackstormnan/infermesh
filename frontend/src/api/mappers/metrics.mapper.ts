/**
 * api/mappers/metrics.mapper.ts
 *
 * Adapts raw MetricsSummary and CostBreakdown DTOs into display-ready
 * view models consumed by the Metrics page components.
 *
 * TimeSeriesData and LatencyPercentilesReport are structurally clean
 * enough to be used directly by chart components after simple transforms.
 */

import type {
  MetricsSummary,
  TrendIndicator,
  CostBreakdown,
  CostBreakdownEntry,
} from '../types/metrics'

// ─── Shared trend type ────────────────────────────────────────────────────────

export interface FormattedTrend {
  /** Pre-formatted string, e.g. "+12.3%" */
  formatted: string
  direction: 'up' | 'down' | 'flat' | 'neutral'
  /**
   * When true the color mapping inverts: down = green (improvement),
   * up = red (degradation). Use for latency, error rate, cost.
   */
  invertColors?: boolean
}

// ─── MetricsSummary view model ────────────────────────────────────────────────

export interface MetricsSummaryViewModel {
  requests24h:       string   // "1,234"
  requestsPerSecond: string   // "0.45 rps"
  p95LatencyMs:      string   // "287 ms"
  successRate:       string   // "98.3%"
  totalCostUsd:      string   // "$0.0234"
  requestsTrend:     FormattedTrend
  latencyTrend:      FormattedTrend  // invertColors: true (lower = better)
  costTrend:         FormattedTrend  // invertColors: true (lower = better)
}

// ─── CostBreakdown view model ────────────────────────────────────────────────

export interface CostBreakdownEntryViewModel {
  modelId:      string
  modelName:    string
  costUsd:      string   // "$0.0234"
  requestCount: string   // "1,234"
  percentage:   number   // 0–100
}

export interface CostBreakdownViewModel {
  totalCostUsd: string
  entries:      CostBreakdownEntryViewModel[]
  hasData:      boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTrend(t: TrendIndicator, invertColors = false): FormattedTrend {
  const sign = t.percent >= 0 ? '+' : ''
  return {
    formatted: `${sign}${t.percent.toFixed(1)}%`,
    direction: t.direction,
    invertColors,
  }
}

/** Returns true when the trend represents a "good" direction for StatCard colouring. */
export function trendIsPositive(trend: FormattedTrend): boolean {
  if (trend.direction === 'flat') return true
  return trend.invertColors
    ? trend.direction === 'down'  // lower is better (latency, cost)
    : trend.direction === 'up'    // higher is better (requests, success)
}

/** Arrow prefix for pre-formatting delta strings. */
export function trendArrow(direction: FormattedTrend['direction']): string {
  return direction === 'up' ? '↑' : direction === 'down' ? '↓' : '—'
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

export function mapMetricsSummary(dto: MetricsSummary): MetricsSummaryViewModel {
  return {
    requests24h:       dto.requests24h.toLocaleString(),
    requestsPerSecond: `${dto.requestsPerSecond.toFixed(2)} rps`,
    p95LatencyMs:      `${Math.round(dto.p95LatencyMs)} ms`,
    successRate:       `${(dto.successRate * 100).toFixed(1)}%`,
    totalCostUsd:      `$${dto.totalCostUsd.toFixed(4)}`,
    requestsTrend:     formatTrend(dto.requestsTrend),
    latencyTrend:      formatTrend(dto.latencyTrend, true),
    costTrend:         formatTrend(dto.costTrend,     true),
  }
}

function mapCostEntry(entry: CostBreakdownEntry): CostBreakdownEntryViewModel {
  return {
    modelId:      entry.modelId,
    modelName:    entry.modelName,
    costUsd:      `$${entry.costUsd.toFixed(4)}`,
    requestCount: entry.requestCount.toLocaleString(),
    percentage:   entry.percentage,
  }
}

export function mapCostBreakdown(dto: CostBreakdown): CostBreakdownViewModel {
  return {
    totalCostUsd: `$${dto.totalCostUsd.toFixed(4)}`,
    entries:      dto.entries.map(mapCostEntry),
    hasData:      dto.entries.length > 0 && dto.totalCostUsd > 0,
  }
}
