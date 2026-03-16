/**
 * api/types/metrics.ts
 *
 * Frontend contracts for all /api/v1/metrics/* endpoints.
 */

export type MetricPeriod = '1h' | '24h' | '7d' | '30d'

export interface TrendIndicator {
  /** Absolute delta from the previous equivalent period */
  readonly delta: number
  /** Percentage change — positive = increased */
  readonly percent: number
  readonly direction: 'up' | 'down' | 'flat'
}

/** GET /api/v1/metrics/summary */
export interface MetricsSummary {
  readonly period: MetricPeriod
  readonly generatedAt: string
  readonly totalRequests: number
  readonly requests24h: number
  readonly requestsPerSecond: number
  readonly avgLatencyMs: number
  readonly p95LatencyMs: number
  readonly successRate: number
  readonly errorRate: number
  readonly totalCostUsd: number
  readonly avgCostPerRequestUsd: number
  readonly requestsTrend: TrendIndicator
  readonly latencyTrend: TrendIndicator
  readonly errorRateTrend: TrendIndicator
  readonly costTrend: TrendIndicator
}

export interface TimeSeriesPoint {
  /** Bucket start — Unix epoch ms */
  readonly timestamp: number
  readonly requests: number
  readonly avgLatencyMs: number
  readonly costUsd: number
  readonly errors: number
}

/** GET /api/v1/metrics/time-series */
export interface TimeSeriesData {
  readonly period: MetricPeriod
  readonly granularityMs: number
  readonly points: TimeSeriesPoint[]
  readonly generatedAt: string
}

/** GET /api/v1/metrics/latency-percentiles */
export interface LatencyPercentilesReport {
  readonly period: MetricPeriod
  readonly sampleCount: number
  readonly p50Ms: number
  readonly p75Ms: number
  readonly p95Ms: number
  readonly p99Ms: number
  readonly generatedAt: string
}

export interface CostBreakdownEntry {
  readonly modelId: string
  readonly modelName: string
  readonly costUsd: number
  readonly requestCount: number
  /** 0–100 share of total cost */
  readonly percentage: number
}

/** GET /api/v1/metrics/cost-breakdown */
export interface CostBreakdown {
  readonly period: MetricPeriod
  readonly totalCostUsd: number
  readonly entries: CostBreakdownEntry[]
  readonly generatedAt: string
}
