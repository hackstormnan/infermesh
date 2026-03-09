/**
 * modules/requests/repository/IRequestRepository.ts
 *
 * Repository interface (port) for InferenceRequest persistence.
 *
 * The service layer depends only on this interface. Swapping the in-memory
 * adapter for a database-backed one (Postgres, Redis, DynamoDB) requires
 * zero changes to the service.
 *
 * Fields eligible for update alongside a status transition are defined in
 * StatusUpdate so callers are explicit about what changes and what is read-only.
 */

import type {
  InferenceRequest,
  RequestStatus,
} from "../../../shared/contracts/request";
import type { RequestId, PaginatedResponse } from "../../../shared/primitives";
import type { ListRequestsQuery } from "../queries";

/**
 * Fields that may be updated alongside a status transition.
 *
 * Only supply the fields meaningful for the specific transition:
 *   - Dispatched  → jobId
 *   - Completed   → tokensIn, tokensOut, firstTokenAt, completedAt
 *   - Failed      → failureReason, completedAt
 *   - Cancelled   → completedAt
 */
export type StatusUpdate = Partial<
  Pick<
    InferenceRequest,
    | "jobId"
    | "tokensIn"
    | "tokensOut"
    | "firstTokenAt"
    | "completedAt"
    | "failureReason"
  >
>;

export interface IRequestRepository {
  /** Persist a new request. The caller must supply a fully-constructed entity. */
  create(request: InferenceRequest): Promise<InferenceRequest>;

  /** Retrieve a request by its ID. Returns null if no record exists. */
  findById(id: RequestId): Promise<InferenceRequest | null>;

  /**
   * Paginated, filtered list of requests.
   * Results are always sorted by createdAt descending (newest first).
   */
  list(query: ListRequestsQuery): Promise<PaginatedResponse<InferenceRequest>>;

  /**
   * Transition a request to a new lifecycle status.
   * Accepts optional field-level updates that accompany the status change.
   * Returns the updated entity, or null if the ID is not found.
   *
   * Future callers (routing engine, worker adapter) will use this to advance
   * the request through its state machine: Queued → Dispatched → Completed/Failed.
   */
  updateStatus(
    id: RequestId,
    status: RequestStatus,
    updates?: StatusUpdate,
  ): Promise<InferenceRequest | null>;
}
