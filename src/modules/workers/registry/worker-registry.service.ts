/**
 * modules/workers/registry/worker-registry.service.ts
 *
 * Selection-time worker lookup, health/load-aware filtering, and candidate
 * preparation for the routing and assignment engine.
 *
 * ─── Role ─────────────────────────────────────────────────────────────────────
 * WorkerRegistryService sits between the raw worker repository and the routing
 * engine. It answers the question:
 *
 *   "Given this job's requirements, which workers can handle it right now?"
 *
 * Responsibilities:
 *   1. Load the full worker set from the repository (findAll — no pagination)
 *   2. Apply multi-dimensional eligibility filtering (model, region, load,
 *      heartbeat freshness, GPU, labels, queue depth, status)
 *   3. Project each passing worker onto a lean WorkerCandidate object
 *   4. Return candidates sorted by available capacity (most headroom first)
 *
 * ─── Design notes ─────────────────────────────────────────────────────────────
 *   - All filtering logic lives here, not in the repository or route handlers.
 *   - `findAll()` is used rather than the paginated `list()` because routing
 *     needs a complete candidate set — pagination would silently drop workers.
 *   - Workers with an undefined `loadScore` pass the maxLoadScore filter because
 *     the score may simply not have been reported yet; a missing metric is not
 *     evidence of overload.
 *   - `availableSlots` is pre-computed in the candidate projection so scoring
 *     strategies don't recalculate it at every call site.
 *
 * ─── Consumers ────────────────────────────────────────────────────────────────
 *   - Routing / assignment engine (Ticket 15+): calls findEligible() at
 *     decision time to get the assignable worker pool for a given job
 *   - Debug/dev: GET /api/v1/workers/candidates exposes the same logic over HTTP
 */

import type { RequestContext } from "../../../core/context";
import { WorkerStatus } from "../../../shared/contracts/worker";
import type { Worker } from "../../../shared/contracts/worker";
import type { ModelId } from "../../../shared/primitives";
import type { IWorkerRepository } from "../repository/IWorkerRepository";
import type { WorkerAssignmentFilter, WorkerCandidate } from "./worker-registry.contract";

// ─── Assignable statuses ──────────────────────────────────────────────────────

/**
 * Statuses that indicate a worker is live and may accept new jobs.
 * Used as the default status set when no explicit `statuses` filter is provided.
 *
 * - Idle: available, below capacity
 * - Busy: at or near capacity but still online; router may deprioritise
 *
 * Draining, Unhealthy, and Offline are always excluded from the default pool.
 */
const ASSIGNABLE_STATUSES: WorkerStatus[] = [WorkerStatus.Idle, WorkerStatus.Busy];

// ─── Service ──────────────────────────────────────────────────────────────────

export class WorkerRegistryService {
  constructor(private readonly repo: IWorkerRepository) {}

  /**
   * Return all healthy (Idle + Busy) workers as assignment candidates.
   *
   * Convenience shortcut for "give me every worker that is online and not
   * draining or evicted". Equivalent to
   * `findEligible(ctx, { statuses: [Idle, Busy] })`.
   */
  async listHealthy(ctx: RequestContext): Promise<WorkerCandidate[]> {
    return this.findEligible(ctx, { statuses: ASSIGNABLE_STATUSES });
  }

  /**
   * Return workers that have free concurrency slots (Idle | Busy with headroom).
   *
   * Stricter than `listHealthy` — only workers that can immediately accept
   * another job without exceeding their `maxConcurrentJobs` limit.
   */
  async listAssignable(ctx: RequestContext): Promise<WorkerCandidate[]> {
    const healthy = await this.findEligible(ctx, { statuses: ASSIGNABLE_STATUSES });
    return healthy.filter((c) => c.availableSlots > 0);
  }

  /**
   * Find all workers that satisfy every constraint in `filter` and return
   * them as assignment-ready `WorkerCandidate` objects.
   *
   * Default behaviour when `filter.statuses` is not provided:
   *   - Restricts to [Idle, Busy] (workers that are live and may accept jobs)
   *
   * Results are sorted by `availableSlots` descending (most headroom first),
   * then by `loadScore` ascending (least loaded first), then by `name`
   * ascending for a fully deterministic tie-break.
   */
  async findEligible(
    ctx: RequestContext,
    filter: WorkerAssignmentFilter = {},
  ): Promise<WorkerCandidate[]> {
    const effectiveFilter: WorkerAssignmentFilter = {
      statuses: ASSIGNABLE_STATUSES,
      ...filter,
    };

    ctx.log.debug({ filter: effectiveFilter }, "WorkerRegistry: finding eligible workers");

    const all = await this.repo.findAll();
    const eligible = this.applyFilter(all, effectiveFilter);

    ctx.log.debug(
      { total: all.length, eligible: eligible.length },
      "WorkerRegistry: eligibility filter complete",
    );

    return eligible
      .map(toCandidate)
      .sort(byAvailableSlotsDescThenLoadAscThenNameAsc);
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /**
   * Apply all active filter constraints sequentially.
   * Each clause narrows the candidate set; absent clauses are skipped.
   */
  private applyFilter(workers: Worker[], filter: WorkerAssignmentFilter): Worker[] {
    let result = workers;

    // Status — most selective first (Draining/Unhealthy/Offline excluded by default)
    const statuses = filter.statuses ?? ASSIGNABLE_STATUSES;
    result = result.filter((w) => statuses.includes(w.status));

    // Required model ID — worker must list the model as supported
    if (filter.requiredModelId !== undefined) {
      const modelId = filter.requiredModelId as ModelId;
      result = result.filter((w) => w.supportedModelIds.includes(modelId));
    }

    // Region — case-insensitive exact match
    if (filter.preferredRegion !== undefined) {
      const region = filter.preferredRegion.toLowerCase();
      result = result.filter((w) => w.region.toLowerCase() === region);
    }

    // Max queue depth
    if (filter.maxQueueSize !== undefined) {
      const max = filter.maxQueueSize;
      result = result.filter((w) => w.capacity.queuedJobs <= max);
    }

    // Max load score — workers without a reported score always pass
    if (filter.maxLoadScore !== undefined) {
      const max = filter.maxLoadScore;
      result = result.filter((w) => {
        const score = w.runtimeMetrics.loadScore;
        return score === undefined || score <= max;
      });
    }

    // Heartbeat freshness — exclude stale workers
    if (filter.minHeartbeatFreshnessMs !== undefined) {
      const cutoff = Date.now() - filter.minHeartbeatFreshnessMs;
      result = result.filter((w) => w.lastHeartbeatAt >= cutoff);
    }

    // Instance type — exact match
    if (filter.instanceType !== undefined) {
      const instanceType = filter.instanceType;
      result = result.filter((w) => w.hardware.instanceType === instanceType);
    }

    // GPU required — hardware.gpuModel must be defined
    if (filter.gpuRequired === true) {
      result = result.filter((w) => w.hardware.gpuModel !== undefined);
    }

    // Required capability tags — ALL listed label keys must be present
    if (filter.requiredCapabilityTags !== undefined && filter.requiredCapabilityTags.length > 0) {
      const tags = filter.requiredCapabilityTags;
      result = result.filter((w) => tags.every((tag) => tag in w.labels));
    }

    return result;
  }
}

// ─── Sort comparator ──────────────────────────────────────────────────────────

function byAvailableSlotsDescThenLoadAscThenNameAsc(
  a: WorkerCandidate,
  b: WorkerCandidate,
): number {
  // More headroom first
  const slotDiff = b.availableSlots - a.availableSlots;
  if (slotDiff !== 0) return slotDiff;

  // Lower load score first (undefined treated as 0 — appears before loaded workers)
  const aLoad = a.loadScore ?? 0;
  const bLoad = b.loadScore ?? 0;
  const loadDiff = aLoad - bLoad;
  if (loadDiff !== 0) return loadDiff;

  // Deterministic tie-break
  return a.name.localeCompare(b.name);
}

// ─── Projection ───────────────────────────────────────────────────────────────

/**
 * Project the full internal Worker entity onto the lean WorkerCandidate shape.
 *
 * `endpoint` is intentionally excluded — it should only be provided to the
 * dispatch path, not to generic routing callers.
 * `availableSlots` is eagerly computed here.
 */
function toCandidate(worker: Worker): WorkerCandidate {
  return {
    id:               worker.id,
    name:             worker.name,
    region:           worker.region,
    status:           worker.status,
    hardware:         worker.hardware,
    supportedModelIds: worker.supportedModelIds,
    labels:           worker.labels,
    activeJobs:       worker.capacity.activeJobs,
    maxConcurrentJobs: worker.capacity.maxConcurrentJobs,
    queuedJobs:       worker.capacity.queuedJobs,
    availableSlots:   Math.max(0, worker.capacity.maxConcurrentJobs - worker.capacity.activeJobs),
    loadScore:        worker.runtimeMetrics.loadScore,
    tokensPerSecond:  worker.runtimeMetrics.tokensPerSecond,
    ttftMs:           worker.runtimeMetrics.ttftMs,
    cpuUsagePercent:  worker.runtimeMetrics.cpuUsagePercent,
    memoryUsagePercent: worker.runtimeMetrics.memoryUsagePercent,
    lastHeartbeatAt:  worker.lastHeartbeatAt,
  };
}
