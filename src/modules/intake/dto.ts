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
 * caller. It confirms what was created and queued so the caller can poll.
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

  /** Arbitrary caller metadata forwarded unchanged to the queue message. */
  metadata: z.record(z.unknown()).optional(),
});

export type IntakeRequestBody = z.infer<typeof intakeRequestSchema>;

// ─── Response DTO ─────────────────────────────────────────────────────────────

/**
 * Acknowledgement returned by POST /api/v1/inference/requests (HTTP 202).
 *
 * Contains the IDs and initial statuses of the created records plus the
 * queue message ID so callers can correlate all three: request ↔ job ↔ message.
 */
export interface IntakeResponseDto {
  /** ID of the persisted InferenceRequest */
  requestId: string;
  /** ID of the linked Job (status: Queued) */
  jobId: string;
  /** ID of the QueueMessage — use this to track queue position */
  queueMessageId: string;
  /** Current InferenceRequest lifecycle status (Dispatched on success) */
  status: RequestStatus;
  /** Current Job lifecycle status (Queued on success) */
  jobStatus: JobStatus;
  /** ISO timestamp when the InferenceRequest was created */
  createdAt: string;
  /** Unix epoch ms when the job was placed in the queue */
  enqueuedAt: number;
}
