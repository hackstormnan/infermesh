/**
 * api/types/stats.ts
 *
 * Frontend contract for GET /api/v1/stats/summary.
 * Mirrors SummaryStatsDto + supporting types from the backend stats module.
 */

export interface StatChange {
  /** Raw numeric delta (current − prior) */
  readonly delta: number
  /** Pre-formatted string for display, e.g. "+12", "-15ms", "+$0.0020" */
  readonly formatted: string
  readonly direction: 'up' | 'down' | 'neutral'
}

export interface SummaryChanges {
  readonly totalRequests: StatChange
  readonly requestsPerSecond: StatChange
  readonly avgLatency: StatChange
  readonly totalCost: StatChange
}

/** Response shape of GET /api/v1/stats/summary */
export interface SummaryStatsDto {
  readonly totalRequests: number
  /** Requests completed per second in the current window */
  readonly requestsPerSecond: number
  /** Average job execution time in ms */
  readonly avgLatency: number
  /** Estimated total cost in USD */
  readonly totalCost: number
  /** Workers in Idle or Busy status */
  readonly activeWorkers: number
  /** 0.0–1.0 — succeeded / all terminal jobs */
  readonly successRate: number
  readonly totalSucceededJobs: number
  readonly totalFailedJobs: number
  readonly changes: SummaryChanges
  /** Window length in ms (typically 60000) */
  readonly windowMs: number
  /** Unix epoch ms when the snapshot was computed */
  readonly computedAt: number
}
