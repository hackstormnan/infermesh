/**
 * modules/stats/stats.service.ts
 *
 * SummaryStatsService — aggregates high-level system metrics from the
 * in-memory repositories of the requests, jobs, models, and workers modules.
 *
 * ─── Design notes ─────────────────────────────────────────────────────────────
 *
 * Aggregation strategy
 *   All four services are queried with limit: FETCH_LIMIT in parallel. This is
 *   intentional and explicit — the service is designed for in-process stores
 *   only. FETCH_LIMIT is a named constant that documents that assumption. A
 *   production analytics pipeline would use streaming queries or pre-aggregated
 *   snapshots instead of full-scan list() calls.
 *
 * latency derivation
 *   Job.completedAt − Job.startedAt for Succeeded jobs with both timestamps.
 *   Both fields are Unix epoch ms so the difference is pure execution time,
 *   not queue wait time (queuedAt → startedAt is the queue wait).
 *   Jobs that never reached Running status (no startedAt) are excluded.
 *
 * cost derivation
 *   For each Succeeded job that has a modelId: looks up the linked
 *   InferenceRequest for tokensIn/tokensOut and the Model for its pricing
 *   profile. Missing token data or unknown model ID contributes $0.
 *   Formula: (tokensIn × inputPer1kTokens + tokensOut × outputPer1kTokens) / 1000
 *
 * requestsPerSecond
 *   Requests that reached any terminal status within the last WINDOW_MS,
 *   divided by the window duration in seconds. Uses InferenceRequest.completedAt
 *   (ISO string, parsed to epoch ms) for semantic accuracy.
 *
 * changes
 *   Compares current WINDOW_MS window to the immediately preceding window of
 *   the same length. Both windows use Job.completedAt (epoch ms) for latency
 *   and cost comparisons; Request.completedAt (ISO → epoch ms) for counts.
 *   Returns neutral (delta = 0) when both windows have no data.
 */

import type { RequestContext } from "../../core/context";
import { JobStatus } from "../../shared/contracts/job";
import type { Job } from "../../shared/contracts/job";
import { WorkerStatus } from "../../shared/contracts/worker";
import type { InferenceRequestDto } from "../../shared/contracts/request";
import type { ModelDto } from "../../shared/contracts/model";
import type { RequestsService } from "../requests/service/requests.service";
import type { JobsService } from "../jobs/service/jobs.service";
import type { ModelsService } from "../models/service/models.service";
import type { WorkersService } from "../workers/service/workers.service";
import type { SummaryStatsDto, SummaryChanges, StatChange } from "./stats.contract";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Length of each comparison window in milliseconds.
 * requestsPerSecond and change indicators both use this duration.
 * 60 seconds balances responsiveness to load spikes and stability at low volume.
 */
export const WINDOW_MS = 60_000;

/**
 * Maximum records fetched per service call.
 * Documents the explicit assumption that this service runs against in-process
 * stores only. Replace with streaming / pre-aggregated queries before using
 * in production against durable storage.
 */
export const FETCH_LIMIT = 10_000;

// ─── Internal types ───────────────────────────────────────────────────────────

interface WindowStats {
  /** Requests that reached a terminal status within the window. */
  requestCount: number;
  /** Average (completedAt − startedAt) for Succeeded jobs in window (ms). */
  avgLatencyMs: number;
  /** Estimated USD cost for Succeeded jobs in window. */
  totalCostUsd: number;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class SummaryStatsService {
  constructor(
    private readonly requestsService: RequestsService,
    private readonly jobsService: JobsService,
    private readonly modelsService: ModelsService,
    private readonly workersService: WorkersService,
  ) {}

  async getSummary(ctx: RequestContext): Promise<SummaryStatsDto> {
    const now = Date.now();
    const currentWindowStart = now - WINDOW_MS;
    const priorWindowStart = currentWindowStart - WINDOW_MS;

    // Fetch all data in parallel — explicitly bounded by FETCH_LIMIT
    const [requestsPage, jobsPage, modelsPage, workersPage] = await Promise.all([
      this.requestsService.list(ctx, { page: 1, limit: FETCH_LIMIT }),
      this.jobsService.list(ctx, { page: 1, limit: FETCH_LIMIT }),
      this.modelsService.list(ctx, { page: 1, limit: FETCH_LIMIT }),
      this.workersService.list(ctx, { page: 1, limit: FETCH_LIMIT }),
    ]);

    const requests = requestsPage.items;
    const jobs = jobsPage.items as Job[];
    const models = modelsPage.items as ModelDto[];
    const workers = workersPage.items;

    // Cross-reference lookup maps
    const modelMap = new Map(models.map((m) => [m.id as string, m]));
    const requestMap = new Map(requests.map((r) => [r.id, r]));

    // ── All-time aggregates ────────────────────────────────────────────────────

    const totalRequests = requests.length;
    const avgLatency = computeAvgLatency(jobs);
    const totalCost = computeTotalCost(jobs, requestMap, modelMap);

    const succeededJobs = jobs.filter((j) => j.status === JobStatus.Succeeded);
    const failedJobs = jobs.filter((j) => j.status === JobStatus.Failed);
    const cancelledCount = jobs.filter((j) => j.status === JobStatus.Cancelled).length;
    const terminalCount = succeededJobs.length + failedJobs.length + cancelledCount;
    const successRate = terminalCount > 0 ? succeededJobs.length / terminalCount : 1.0;

    const activeWorkers = workers.filter(
      (w) => w.status === WorkerStatus.Idle || w.status === WorkerStatus.Busy,
    ).length;

    // ── Window-scoped stats for rps + change indicators ───────────────────────

    const currentWindow = computeWindowStats(
      requests,
      jobs,
      requestMap,
      modelMap,
      currentWindowStart,
      now,
    );
    const priorWindow = computeWindowStats(
      requests,
      jobs,
      requestMap,
      modelMap,
      priorWindowStart,
      currentWindowStart,
    );

    const requestsPerSecond = round(currentWindow.requestCount / (WINDOW_MS / 1000), 2);

    return {
      totalRequests,
      requestsPerSecond,
      avgLatency: Math.round(avgLatency),
      totalCost: round(totalCost, 4),
      activeWorkers,
      successRate: round(successRate, 4),
      totalSucceededJobs: succeededJobs.length,
      totalFailedJobs: failedJobs.length,
      changes: buildChanges(currentWindow, priorWindow),
      windowMs: WINDOW_MS,
      computedAt: now,
    };
  }
}

// ─── Aggregation helpers ──────────────────────────────────────────────────────

/**
 * Average end-to-end execution latency across all Succeeded jobs that have
 * both startedAt and completedAt populated. Returns 0 when no such jobs exist.
 */
function computeAvgLatency(jobs: Job[]): number {
  const latencies = jobs
    .filter(
      (j) =>
        j.status === JobStatus.Succeeded &&
        j.startedAt !== undefined &&
        j.completedAt !== undefined,
    )
    .map((j) => j.completedAt! - j.startedAt!);

  return latencies.length > 0
    ? latencies.reduce((a, b) => a + b, 0) / latencies.length
    : 0;
}

/**
 * Total estimated cost in USD across all Succeeded jobs.
 * Jobs without a modelId, an unrecognised model, or no token data contribute $0.
 */
function computeTotalCost(
  jobs: Job[],
  requestMap: Map<string, InferenceRequestDto>,
  modelMap: Map<string, ModelDto>,
): number {
  return jobs
    .filter((j) => j.status === JobStatus.Succeeded && j.modelId !== undefined)
    .reduce((sum, job) => sum + deriveJobCost(job, requestMap, modelMap), 0);
}

/**
 * Derive the estimated cost for a single job.
 * Returns 0 when the model or token data is unavailable.
 */
function deriveJobCost(
  job: Job,
  requestMap: Map<string, InferenceRequestDto>,
  modelMap: Map<string, ModelDto>,
): number {
  const model = modelMap.get(job.modelId as string);
  if (!model) return 0;

  const request = requestMap.get(job.requestId as string);
  const tokensIn = request?.tokensIn ?? 0;
  const tokensOut = request?.tokensOut ?? 0;
  if (tokensIn === 0 && tokensOut === 0) return 0;

  return (
    (tokensIn * model.pricing.inputPer1kTokens +
      tokensOut * model.pricing.outputPer1kTokens) /
    1000
  );
}

/**
 * Compute aggregated stats for a single time window.
 *
 * requestCount: requests with completedAt falling in [windowStart, windowEnd)
 * avgLatencyMs: avg execution time for Succeeded jobs completedAt in window
 * totalCostUsd: cost for Succeeded jobs completedAt in window
 */
function computeWindowStats(
  requests: InferenceRequestDto[],
  jobs: Job[],
  requestMap: Map<string, InferenceRequestDto>,
  modelMap: Map<string, ModelDto>,
  windowStart: number,
  windowEnd: number,
): WindowStats {
  // Requests completed in the window (ISO timestamp → epoch ms)
  const requestCount = requests.filter((r) => {
    if (!r.completedAt) return false;
    const ts = new Date(r.completedAt).getTime();
    return ts >= windowStart && ts < windowEnd;
  }).length;

  // Succeeded jobs whose completedAt falls in the window
  const jobsInWindow = jobs.filter(
    (j) =>
      j.status === JobStatus.Succeeded &&
      j.completedAt !== undefined &&
      j.completedAt >= windowStart &&
      j.completedAt < windowEnd,
  );

  const latencies = jobsInWindow
    .filter((j) => j.startedAt !== undefined)
    .map((j) => j.completedAt! - j.startedAt!);

  const avgLatencyMs =
    latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;

  const totalCostUsd = jobsInWindow
    .filter((j) => j.modelId !== undefined)
    .reduce((sum, job) => sum + deriveJobCost(job, requestMap, modelMap), 0);

  return { requestCount, avgLatencyMs, totalCostUsd };
}

// ─── Change indicator helpers ─────────────────────────────────────────────────

function buildChanges(current: WindowStats, prior: WindowStats): SummaryChanges {
  const rpsWindow = WINDOW_MS / 1000;
  const currentRps = current.requestCount / rpsWindow;
  const priorRps = prior.requestCount / rpsWindow;

  return {
    totalRequests: makeStatChange(current.requestCount, prior.requestCount, "count"),
    requestsPerSecond: makeStatChange(currentRps, priorRps, "rps"),
    avgLatency: makeStatChange(current.avgLatencyMs, prior.avgLatencyMs, "latency"),
    totalCost: makeStatChange(current.totalCostUsd, prior.totalCostUsd, "cost"),
  };
}

type MetricType = "count" | "rps" | "latency" | "cost";

function makeStatChange(current: number, prior: number, type: MetricType): StatChange {
  const delta = current - prior;
  const direction: StatChange["direction"] =
    delta > 0 ? "up" : delta < 0 ? "down" : "neutral";
  const sign = delta >= 0 ? "+" : "";

  let formatted: string;
  switch (type) {
    case "count":
      formatted = `${sign}${Math.round(delta)}`;
      break;
    case "rps":
      formatted = `${sign}${round(delta, 2).toFixed(2)} rps`;
      break;
    case "latency":
      formatted = `${sign}${Math.round(delta)}ms`;
      break;
    case "cost": {
      const abs = Math.abs(delta).toFixed(4);
      formatted = delta >= 0 ? `+$${abs}` : `-$${abs}`;
      break;
    }
  }

  return { delta: round(delta, 4), formatted, direction };
}

// ─── Numeric utility ──────────────────────────────────────────────────────────

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
