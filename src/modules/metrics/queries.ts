/**
 * modules/metrics/queries.ts
 *
 * Query schemas for the metrics API endpoints.
 * All four /metrics/* routes accept a single `period` query parameter.
 */

import { z } from "zod";
import type { MetricPeriod } from "../../shared/contracts/metrics";

export const METRIC_PERIODS = ["1h", "24h", "7d", "30d"] as const satisfies readonly MetricPeriod[];

export const metricsQuerySchema = z.object({
  /**
   * Analytics period.  Defaults to 24h.
   * Determines the time range and bucket granularity of the response.
   *
   *   1h  → 5-minute buckets  (12 points in time-series)
   *   24h → 1-hour buckets    (24 points)
   *   7d  → 6-hour buckets    (28 points)
   *   30d → 1-day buckets     (30 points)
   */
  period: z.enum(METRIC_PERIODS).default("24h"),
});

export type MetricsQuery = z.infer<typeof metricsQuerySchema>;

// ─── Period helpers ────────────────────────────────────────────────────────────

/**
 * Duration in milliseconds for each supported period.
 */
export const PERIOD_DURATION_MS: Record<MetricPeriod, number> = {
  "1h": 60 * 60 * 1_000,
  "24h": 24 * 60 * 60 * 1_000,
  "7d": 7 * 24 * 60 * 60 * 1_000,
  "30d": 30 * 24 * 60 * 60 * 1_000,
};

/**
 * Bucket granularity in milliseconds for each supported period.
 * Controls the number of points returned in time-series responses.
 */
export const PERIOD_GRANULARITY_MS: Record<MetricPeriod, number> = {
  "1h": 5 * 60 * 1_000,           // 5-minute buckets → 12 points
  "24h": 60 * 60 * 1_000,         // 1-hour buckets   → 24 points
  "7d": 6 * 60 * 60 * 1_000,      // 6-hour buckets   → 28 points
  "30d": 24 * 60 * 60 * 1_000,    // 1-day buckets    → 30 points
};
