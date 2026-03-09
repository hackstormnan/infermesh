/**
 * shared/contracts/request.ts
 *
 * Contracts for the **Requests** module — the entry point for every AI
 * inference workload entering InferMesh.
 *
 * Layers defined here:
 *   - Enums/constants  — RequestStatus, MessageRole
 *   - Domain entity    — InferenceRequest (internal representation)
 *   - API DTOs         — CreateInferenceRequestDto (validated input)
 *                        InferenceRequestDto (API response projection)
 *   - Zod schemas      — for runtime validation of inbound API payloads
 */

import { z } from "zod";
import type { BaseEntity, IsoTimestamp, JobId, ModelId, RequestId } from "../primitives";

// ─── Enums ────────────────────────────────────────────────────────────────────

export enum RequestStatus {
  /** Accepted and waiting to be dispatched to a worker */
  Queued = "queued",
  /** Assigned to a job; a worker has been selected */
  Dispatched = "dispatched",
  /** Worker is actively streaming tokens back */
  Streaming = "streaming",
  /** Successfully completed */
  Completed = "completed",
  /** Terminal failure (exhausted retries or hard error) */
  Failed = "failed",
  /** Cancelled by the caller before completion */
  Cancelled = "cancelled",
}

export enum MessageRole {
  System = "system",
  User = "user",
  Assistant = "assistant",
}

// ─── Value objects ────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: MessageRole;
  content: string;
}

/**
 * Caller-supplied hints that influence routing decisions.
 * All fields are optional — the router applies defaults when absent.
 */
export interface RoutingHints {
  /** Prefer lowest-cost eligible model/worker pair */
  preferCost?: boolean;
  /** Prefer lowest-latency eligible model/worker pair */
  preferLatency?: boolean;
  /** Require the worker to run in this region */
  region?: string;
  /** Maximum acceptable cost in USD for this request */
  maxCostUsd?: number;
  /** Maximum acceptable latency in milliseconds (time-to-first-token) */
  maxLatencyMs?: number;
}

/**
 * Inference parameters forwarded to the model backend.
 * Mirrors the common subset across major provider APIs.
 */
export interface InferenceParams {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  stream?: boolean;
}

// ─── Domain entity ────────────────────────────────────────────────────────────

/**
 * InferenceRequest — the canonical internal representation of an AI request.
 * Created on intake; its status advances as the request moves through the system.
 */
export interface InferenceRequest extends BaseEntity {
  readonly id: RequestId;
  /** Preferred model; the router may substitute an equivalent if unavailable */
  readonly modelId: ModelId;
  readonly messages: ChatMessage[];
  readonly params: InferenceParams;
  readonly routingHints: RoutingHints;
  status: RequestStatus;
  /** Set once the router creates a Job for this request */
  jobId?: JobId;
  /** Total input tokens consumed (set on completion) */
  tokensIn?: number;
  /** Total output tokens generated (set on completion) */
  tokensOut?: number;
  /** ISO timestamp when the first token was emitted (latency measurement) */
  firstTokenAt?: IsoTimestamp;
  /** ISO timestamp when the request reached a terminal state */
  completedAt?: IsoTimestamp;
  /** Human-readable reason for failure or cancellation */
  failureReason?: string;
}

// ─── Zod schemas (input validation) ──────────────────────────────────────────

export const chatMessageSchema = z.object({
  role: z.nativeEnum(MessageRole),
  content: z.string().min(1, "Message content cannot be empty"),
});

export const inferenceParamsSchema = z.object({
  maxTokens: z.number().int().positive().max(128_000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  stopSequences: z.array(z.string()).max(4).optional(),
  stream: z.boolean().default(false),
});

export const routingHintsSchema = z.object({
  preferCost: z.boolean().optional(),
  preferLatency: z.boolean().optional(),
  region: z.string().optional(),
  maxCostUsd: z.number().positive().optional(),
  maxLatencyMs: z.number().int().positive().optional(),
});

/** Validated shape of POST /requests body */
export const createInferenceRequestSchema = z.object({
  modelId: z.string().min(1),
  messages: z.array(chatMessageSchema).min(1, "At least one message is required"),
  params: inferenceParamsSchema.optional().default({}),
  routingHints: routingHintsSchema.optional().default({}),
});

export type CreateInferenceRequestDto = z.infer<typeof createInferenceRequestSchema>;

// ─── API DTO (response projection) ───────────────────────────────────────────

/** Public-facing shape returned by GET /requests/:id and list endpoints */
export interface InferenceRequestDto {
  id: string;
  modelId: string;
  messages: ChatMessage[];
  params: InferenceParams;
  routingHints: RoutingHints;
  status: RequestStatus;
  jobId?: string;
  tokensIn?: number;
  tokensOut?: number;
  firstTokenAt?: string;
  completedAt?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}
