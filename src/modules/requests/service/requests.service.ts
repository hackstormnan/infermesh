/**
 * modules/requests/service/requests.service.ts
 *
 * Service layer for the requests module.
 *
 * Route handlers call this service — they never access the repository directly.
 * This enforces a clean separation: routes handle HTTP concerns (parsing,
 * serialization, status codes); the service handles business logic and
 * orchestration.
 *
 * ─── Current operations ───────────────────────────────────────────────────────
 *   getById  — fetch a single request; throws NotFoundError if absent
 *   list     — paginated, filtered list mapped to DTOs
 *   create   — construct and persist an InferenceRequest entity (Ticket 6+)
 *
 * ─── Future linkage points ────────────────────────────────────────────────────
 *   - Ticket 5: attach jobId after the routing engine dispatches to a worker
 *   - Ticket 7: record selectedModelId from the routing decision
 *   - Ticket 9: advance status to Streaming as tokens arrive
 */

import { randomUUID } from "crypto";
import type { RequestContext } from "../../../core/context";
import { NotFoundError } from "../../../core/errors";
import type {
  CreateInferenceRequestDto,
  InferenceRequest,
  InferenceRequestDto,
} from "../../../shared/contracts/request";
import { RequestStatus } from "../../../shared/contracts/request";
import type { PaginatedResponse, RequestId } from "../../../shared/primitives";
import { toIsoTimestamp } from "../../../shared/primitives";
import type { IRequestRepository, StatusUpdate } from "../repository/IRequestRepository";
import type { ListRequestsQuery } from "../queries";

export class RequestsService {
  constructor(private readonly repo: IRequestRepository) {}

  // ─── Read operations ───────────────────────────────────────────────────────

  async getById(
    ctx: RequestContext,
    id: string,
  ): Promise<InferenceRequestDto> {
    ctx.log.debug({ inferenceRequestId: id }, "Fetching request by ID");

    const request = await this.repo.findById(id as RequestId);
    if (!request) {
      throw new NotFoundError(`Request ${id}`);
    }

    return toDto(request);
  }

  async list(
    ctx: RequestContext,
    query: ListRequestsQuery,
  ): Promise<PaginatedResponse<InferenceRequestDto>> {
    ctx.log.debug({ query }, "Listing inference requests");

    const result = await this.repo.list(query);

    return {
      ...result,
      items: result.items.map(toDto),
    };
  }

  // ─── Write operations ─────────────────────────────────────────────────────

  /**
   * Transition a request to a new lifecycle status, optionally stamping
   * associated fields (e.g. jobId when advancing to Dispatched).
   * Called by the intake orchestrator after a job is created.
   */
  async updateStatus(
    ctx: RequestContext,
    id: string,
    status: RequestStatus,
    updates?: StatusUpdate,
  ): Promise<InferenceRequestDto> {
    ctx.log.debug({ inferenceRequestId: id, status }, "Updating request status");

    const updated = await this.repo.updateStatus(id as RequestId, status, updates);
    if (!updated) {
      throw new NotFoundError(`Request ${id}`);
    }
    return toDto(updated);
  }

  // ─── Legacy write operations (wired to routes in Ticket 6) ───────────────

  /**
   * Constructs and persists a new InferenceRequest from an inbound DTO.
   *
   * The entity is created in Queued status. Routing and dispatch (Tickets 5-7)
   * will advance it to Dispatched, then Completed or Failed.
   *
   * Not yet wired to a POST /requests route — the full intake pipeline
   * (queueing, routing, worker assignment) is implemented in Ticket 6.
   */
  async create(
    ctx: RequestContext,
    dto: CreateInferenceRequestDto,
  ): Promise<InferenceRequestDto> {
    const now = toIsoTimestamp();
    const request: InferenceRequest = {
      id: randomUUID() as RequestId,
      modelId: dto.modelId as InferenceRequest["modelId"],
      messages: dto.messages,
      params: dto.params,
      routingHints: dto.routingHints,
      status: RequestStatus.Queued,
      createdAt: now,
      updatedAt: now,
    };

    ctx.log.info(
      { inferenceRequestId: request.id, modelId: request.modelId },
      "Creating inference request",
    );

    const saved = await this.repo.create(request);
    return toDto(saved);
  }
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

/**
 * Projects an internal InferenceRequest entity onto the public-facing DTO.
 * Strips any future internal-only fields before they reach the API response.
 */
function toDto(request: InferenceRequest): InferenceRequestDto {
  return {
    id: request.id,
    modelId: request.modelId,
    messages: request.messages,
    params: request.params,
    routingHints: request.routingHints,
    status: request.status,
    jobId: request.jobId,
    tokensIn: request.tokensIn,
    tokensOut: request.tokensOut,
    firstTokenAt: request.firstTokenAt,
    completedAt: request.completedAt,
    failureReason: request.failureReason,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}
