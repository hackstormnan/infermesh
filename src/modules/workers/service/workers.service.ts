/**
 * modules/workers/service/workers.service.ts
 *
 * Service layer for the workers module.
 *
 * Route handlers call this service — they never access the repository directly.
 * Routes handle HTTP concerns (parsing, status codes, serialization); the
 * service handles business logic: ID generation, name uniqueness, heartbeat
 * application, eviction logic, and entity-to-DTO mapping.
 *
 * ─── Operations ───────────────────────────────────────────────────────────────
 *   register    — create and persist a new worker; enforces name uniqueness
 *   heartbeat   — apply a heartbeat: update status, capacity, metrics, timestamp
 *   deregister  — mark a worker as Offline
 *   getById     — fetch by UUID; throws NotFoundError if absent
 *   getByName   — fetch by name; throws NotFoundError if absent
 *   list        — paginated, filtered list mapped to DTOs
 *
 * ─── Future extension points ──────────────────────────────────────────────────
 *   - Ticket 8 (routing engine): list(ctx, { status: Idle }) to get candidates
 *     for routing; getById used to score each candidate by runtimeMetrics
 *   - Heartbeat eviction (Ticket 8): a background timer calls list() to find
 *     workers where lastHeartbeatAt < Date.now() - HEARTBEAT_TIMEOUT_MS and
 *     marks them Unhealthy via heartbeat() or a dedicated markUnhealthy()
 *   - Ticket 6 (request intake): capacity.activeJobs incremented on dispatch,
 *     decremented on completion
 */

import { randomUUID } from "crypto";
import type { RequestContext } from "../../../core/context";
import { ConflictError, NotFoundError } from "../../../core/errors";
import type {
  Worker,
  WorkerDto,
  WorkerHeartbeatDto,
  RegisterWorkerDto,
} from "../../../shared/contracts/worker";
import { WorkerStatus } from "../../../shared/contracts/worker";
import type { ModelId, PaginatedResponse, WorkerId } from "../../../shared/primitives";
import { toIsoTimestamp } from "../../../shared/primitives";
import type { IWorkerRepository } from "../repository/IWorkerRepository";
import type { ListWorkersQuery } from "../queries";

export class WorkersService {
  constructor(private readonly repo: IWorkerRepository) {}

  // ─── Write operations (wired to routes in a later ticket) ─────────────────

  /**
   * Register a new worker in the registry.
   * Rejects if the name is already taken — worker names must be unique
   * so dashboards, logs, and routing policies can reference them unambiguously.
   */
  async register(
    ctx: RequestContext,
    dto: RegisterWorkerDto,
  ): Promise<WorkerDto> {
    const existing = await this.repo.findByName(dto.name);
    if (existing) {
      throw new ConflictError(
        `Worker name "${dto.name}" is already registered`,
        { conflictingId: existing.id },
      );
    }

    const now = toIsoTimestamp();
    const worker: Worker = {
      id: randomUUID() as WorkerId,
      name: dto.name,
      endpoint: dto.endpoint,
      supportedModelIds: dto.supportedModelIds as ModelId[],
      region: dto.region,
      hardware: dto.hardware,
      status: WorkerStatus.Idle,
      capacity: dto.capacity,
      lastHeartbeatAt: Date.now(),
      runtimeMetrics: {},
      labels: dto.labels,
      createdAt: now,
      updatedAt: now,
    };

    ctx.log.info(
      {
        workerId: worker.id,
        name: worker.name,
        region: worker.region,
        instanceType: worker.hardware.instanceType,
      },
      "Registering worker",
    );

    const saved = await this.repo.create(worker);
    return toDto(saved);
  }

  /**
   * Apply a heartbeat from a worker.
   *
   * Updates status, capacity, runtimeMetrics, and lastHeartbeatAt in one
   * atomic repository write. The routing engine relies on these values being
   * fresh — stale metrics lead to suboptimal placement decisions.
   *
   * Does not validate clock skew between dto.reportedAt and Date.now() yet;
   * that check will be added alongside the eviction background task.
   */
  async heartbeat(
    ctx: RequestContext,
    id: string,
    dto: WorkerHeartbeatDto,
  ): Promise<WorkerDto> {
    ctx.log.debug(
      { workerId: id, status: dto.status, activeJobs: dto.capacity.activeJobs },
      "Applying worker heartbeat",
    );

    const updated = await this.repo.update(id as WorkerId, {
      status: dto.status,
      capacity: dto.capacity,
      lastHeartbeatAt: dto.reportedAt,
      runtimeMetrics: dto.runtimeMetrics,
    });

    if (!updated) {
      throw new NotFoundError(`Worker ${id}`);
    }

    return toDto(updated);
  }

  /**
   * Mark a worker as Offline (graceful deregistration).
   * The worker will be excluded from all routing decisions immediately.
   * In-flight jobs are handled by the job/request state machine (Ticket 7).
   */
  async deregister(ctx: RequestContext, id: string): Promise<WorkerDto> {
    ctx.log.info({ workerId: id }, "Deregistering worker");

    const updated = await this.repo.update(id as WorkerId, {
      status: WorkerStatus.Offline,
    });

    if (!updated) {
      throw new NotFoundError(`Worker ${id}`);
    }

    return toDto(updated);
  }

  // ─── Read operations ───────────────────────────────────────────────────────

  async getById(ctx: RequestContext, id: string): Promise<WorkerDto> {
    ctx.log.debug({ workerId: id }, "Fetching worker by ID");

    const worker = await this.repo.findById(id as WorkerId);
    if (!worker) {
      throw new NotFoundError(`Worker ${id}`);
    }

    return toDto(worker);
  }

  async getByName(ctx: RequestContext, name: string): Promise<WorkerDto> {
    ctx.log.debug({ name }, "Fetching worker by name");

    const worker = await this.repo.findByName(name);
    if (!worker) {
      throw new NotFoundError(`Worker "${name}"`);
    }

    return toDto(worker);
  }

  async list(
    ctx: RequestContext,
    query: ListWorkersQuery,
  ): Promise<PaginatedResponse<WorkerDto>> {
    ctx.log.debug({ query }, "Listing workers");

    const result = await this.repo.list(query);
    return { ...result, items: result.items.map(toDto) };
  }
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

/**
 * Projects the internal Worker entity onto the public WorkerDto.
 * The `endpoint` field is included so operators can verify worker reachability,
 * but in a production environment with auth guards it may be redacted.
 */
function toDto(worker: Worker): WorkerDto {
  return {
    id: worker.id,
    name: worker.name,
    endpoint: worker.endpoint,
    supportedModelIds: worker.supportedModelIds,
    region: worker.region,
    hardware: worker.hardware,
    status: worker.status,
    capacity: worker.capacity,
    lastHeartbeatAt: worker.lastHeartbeatAt,
    runtimeMetrics: worker.runtimeMetrics,
    labels: worker.labels,
    createdAt: worker.createdAt,
    updatedAt: worker.updatedAt,
  };
}
