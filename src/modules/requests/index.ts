/**
 * modules/requests — Inference Request Lifecycle
 *
 * Owns the creation, state machine, and API surface for InferenceRequest entities.
 *
 * Depends on shared contracts:
 *   InferenceRequest, RequestStatus, CreateInferenceRequestDto
 *
 * Will expose (future tickets):
 *   POST   /api/v1/requests        — submit a new inference request
 *   GET    /api/v1/requests/:id    — fetch request status and metadata
 *   GET    /api/v1/requests        — paginated list with status filter
 *   DELETE /api/v1/requests/:id    — cancel a pending or streaming request
 */

export type {
  InferenceRequest,
  InferenceRequestDto,
  CreateInferenceRequestDto,
  ChatMessage,
  InferenceParams,
  RoutingHints,
} from "../../shared/contracts/request";

export {
  RequestStatus,
  MessageRole,
  createInferenceRequestSchema,
} from "../../shared/contracts/request";
