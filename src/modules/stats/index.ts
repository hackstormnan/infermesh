/**
 * modules/stats — Summary Stats Aggregation
 *
 * Provides a single overview-level aggregation endpoint for dashboard use.
 * Reads from the in-memory stores of requests, jobs, models, and workers to
 * produce a consistent point-in-time snapshot.
 *
 * ─── API surface ──────────────────────────────────────────────────────────────
 *   GET /api/v1/stats/summary  — system overview (counts, latency, cost, changes)
 *
 * ─── Wiring ───────────────────────────────────────────────────────────────────
 * Register in app/routes.ts:
 *   import { statsRoute } from "../modules/stats";
 *   fastify.register(statsRoute, { prefix: "/api/v1" });
 *
 * ─── Design ───────────────────────────────────────────────────────────────────
 * SummaryStatsService is stateless — it aggregates on demand from the live
 * repository state. All aggregation logic lives in the service, not in route
 * handlers. See docs/stats-summary.md for derivation details and limitations.
 */

import { requestsService } from "../requests";
import { jobsService } from "../jobs";
import { modelsService } from "../models";
import { workersService } from "../workers";
import { SummaryStatsService } from "./stats.service";
import { buildStatsRoute } from "./routes/stats.route";

// ─── Module composition ───────────────────────────────────────────────────────

/** Singleton aggregation service — shared across the process lifetime */
export const summaryStatsService = new SummaryStatsService(
  requestsService,
  jobsService,
  modelsService,
  workersService,
);

/** Fastify plugin — register under /api/v1 prefix in app/routes.ts */
export const statsRoute = buildStatsRoute(summaryStatsService);

// ─── Public exports ───────────────────────────────────────────────────────────

export { SummaryStatsService } from "./stats.service";
export { WINDOW_MS, FETCH_LIMIT } from "./stats.service";

export type {
  SummaryStatsDto,
  SummaryChanges,
  StatChange,
} from "./stats.contract";
