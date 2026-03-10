/**
 * modules/intake/dto.ts
 *
 * Request and response shapes for the intake endpoint.
 *
 * IntakeRequestBody is the external-facing API surface — it uses routing-oriented
 * fields (endpoint, taskType, estimatedComplexity) designed to carry enough
 * signal for the routing engine when it is wired in a future ticket.
 *
 * IntakeResponseDto is the immediate intake acknowledgement returned to the
 * caller. It confirms what was created so the caller can poll or stream.
 */

import { z } from "zod";
import type { JobStatus } from "../../shared/contracts/job";
import type { RequestStatus } from "../../shared/contracts/request";

// ─── Request body ─────────────────────────────────────────────────────────────

export const intakeRequestSchema = z.object({
  /** Target inference endpoint / model identifier (e.g. "gpt-4o", "llama-3-70b") */
  endpoint: z.string().min(1),

  /**
   * Logical task type — used for routing policy matching and metric grouping.
   * Examples: "chat", "embedding", "classification", "summarization"
   */
  taskType: z.string().min(1),

  /** Raw input payload forwarded to the model backend */
  input: z.record(z.unknown()),

  /**
   * Estimated input size in tokens or equivalent units.
   * Used by the routing engine as a cost/latency signal.
   */
  inputSize: z.number().int().nonnegative(),

  /**
   * Caller-estimated task complexity.
   * Influences routing preference: low → prefer latency; high → prefer cost.
   */
  estimatedComplexity: z.enum(["low", "medium", "high"]),

  /** Scheduling priority. Defaults to "normal" when omitted. */
  priority: z.enum(["low", "normal", "high"]).optional().default("normal"),

  /** Arbitrary caller metadata forwarded unchanged (not persisted yet). */
  metadata: z.record(z.unknown()).optional(),
});

export type IntakeRequestBody = z.infer<typeof intakeRequestSchema>;

// ─── Response DTO ─────────────────────────────────────────────────────────────

/**
 * Acknowledgement returned by POST /api/v1/inference/requests.
 * Contains the IDs and initial statuses of the created records.
 */
export interface IntakeResponseDto {
  /** ID of the persisted InferenceRequest */
  requestId: string;
  /** ID of the linked Job created by the routing engine */
  jobId: string;
  /** Current InferenceRequest lifecycle status (Dispatched on success) */
  status: RequestStatus;
  /** Current Job lifecycle status (Queued on success) */
  jobStatus: JobStatus;
  /** ISO timestamp when the InferenceRequest was created */
  createdAt: string;
}
