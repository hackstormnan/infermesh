/**
 * modules/stats/stats.contract.ts
 *
 * DTOs and helper types for the summary stats aggregation API.
 *
 * ─── Unit conventions ─────────────────────────────────────────────────────────
 *   latency     → milliseconds (integer)
 *   cost        → USD (4 decimal places, raw number)
 *   rps         → requests per second (2 decimal places)
 *   rates       → 0.0 – 1.0 fraction
 *   timestamps  → Unix epoch ms (number)
 */

/**
 * A single metric change value comparing the current comparison window
 * to the immediately preceding window of the same length.
 */
export interface StatChange {
  /** Raw numeric delta (current − prior). Positive = increased this window. */
  readonly delta: number;
  /**
   * Human-readable signed change string for direct UI display.
   * Format varies by metric type:
   *   count   → "+12", "-5", "0"
   *   rps     → "+0.30 rps", "-0.10 rps"
   *   latency → "+15ms", "-15ms"
   *   cost    → "+$1.2000", "-$0.5000"
   */
  readonly formatted: string;
  /** Whether the metric moved up, down, or stayed the same vs the prior window. */
  readonly direction: "up" | "down" | "neutral";
}

/** Change deltas for each primary metric, current window vs prior window. */
export interface SummaryChanges {
  readonly totalRequests: StatChange;
  readonly requestsPerSecond: StatChange;
  readonly avgLatency: StatChange;
  readonly totalCost: StatChange;
}

/**
 * SummaryStatsDto — the response shape for GET /api/v1/stats/summary.
 *
 * ─── Derivation notes ─────────────────────────────────────────────────────────
 *
 * totalRequests
 *   Total count of all InferenceRequest records regardless of status.
 *
 * requestsPerSecond
 *   Requests that reached any terminal status within the most recent WINDOW_MS
 *   milliseconds, divided by the window duration in seconds. This is a
 *   recent-window rate, not a long-run average.
 *
 * avgLatency
 *   Average end-to-end execution time across all Succeeded jobs that have both
 *   startedAt and completedAt timestamps (completedAt − startedAt, ms). Falls
 *   back to 0 when no jobs have execution timing data yet.
 *
 * totalCost
 *   Estimated USD cost across all Succeeded jobs with token data.
 *   Formula per job: (tokensIn × inputPer1kTokens + tokensOut × outputPer1kTokens) / 1000.
 *   Jobs without a modelId or token counts contribute $0.
 *
 * changes
 *   Each metric compares the current WINDOW_MS window to the prior WINDOW_MS
 *   window (e.g. last 60 s vs 60–120 s ago). Returns neutral (delta = 0) when
 *   both windows are empty.
 */
export interface SummaryStatsDto {
  /** All-time count of InferenceRequest records (all statuses). */
  readonly totalRequests: number;
  /** Requests completed per second in the current window. */
  readonly requestsPerSecond: number;
  /** Average end-to-end job execution time in milliseconds (integer). */
  readonly avgLatency: number;
  /** All-time estimated cost in USD from token usage × model pricing. */
  readonly totalCost: number;
  /** Workers currently in Idle or Busy status. */
  readonly activeWorkers: number;
  /** Fraction of terminal jobs that succeeded (0.0–1.0). */
  readonly successRate: number;
  /** Count of all jobs that reached Succeeded status. */
  readonly totalSucceededJobs: number;
  /** Count of all jobs that reached Failed status. */
  readonly totalFailedJobs: number;
  /** Deltas vs the immediately prior same-length window. */
  readonly changes: SummaryChanges;
  /**
   * Length of each comparison window in milliseconds.
   * Exposed so callers can display accurate "last N seconds" labels.
   */
  readonly windowMs: number;
  /** Unix epoch ms when this snapshot was computed. */
  readonly computedAt: number;
}
