/**
 * shared/contracts/model.ts
 *
 * Contracts for the **Models** module — the registry of AI models available
 * for routing decisions.
 *
 * Layers:
 *   - Enums           — ModelStatus, ModelProvider, ModelCapability, Modality
 *   - Domain entity   — Model (internal registry record)
 *   - API DTOs        — RegisterModelDto (admin input), ModelDto (response)
 *   - Zod schemas     — for validating model registration payloads
 */

import { z } from "zod";
import type { BaseEntity, ModelId } from "../primitives";

// ─── Enums ────────────────────────────────────────────────────────────────────

export enum ModelStatus {
  /** Accepting new requests */
  Active = "active",
  /** Temporarily not accepting requests (e.g. capacity constraint) */
  Inactive = "inactive",
  /** Retained for in-flight requests only; no new dispatches */
  Deprecated = "deprecated",
}

export enum ModelProvider {
  Anthropic = "anthropic",
  OpenAI = "openai",
  Google = "google",
  Mistral = "mistral",
  Cohere = "cohere",
  Meta = "meta",
  /** Self-hosted or custom deployment */
  Custom = "custom",
}

export enum ModelCapability {
  /** Text generation / chat completion */
  TextGeneration = "text_generation",
  /** Function/tool calling */
  ToolUse = "tool_use",
  /** Vision — understanding images */
  Vision = "vision",
  /** Audio understanding */
  Audio = "audio",
  /** Text embedding generation */
  Embedding = "embedding",
  /** Code generation and analysis */
  CodeGeneration = "code_generation",
}

// ─── Value objects ────────────────────────────────────────────────────────────

/**
 * Cost and latency profile used by the routing engine to score candidates.
 * All monetary values are in USD.
 */
export interface ModelLatencyProfile {
  /** Typical time-to-first-token in milliseconds under normal load */
  ttftMs: number;
  /** Typical inter-token generation speed in tokens/second */
  tokensPerSecond: number;
}

export interface ModelPricing {
  /** Cost per 1 000 input tokens in USD */
  inputPer1kTokens: number;
  /** Cost per 1 000 output tokens in USD */
  outputPer1kTokens: number;
}

// ─── Domain entity ────────────────────────────────────────────────────────────

/**
 * Model — a registered AI model in the InferMesh catalog.
 * Workers declare which model IDs they support; the routing engine
 * uses Model metadata to score and select the best candidate.
 */
export interface Model extends BaseEntity {
  readonly id: ModelId;
  /** Display name, e.g. "claude-sonnet-4-6" */
  readonly name: string;
  /** Human-readable alias list, e.g. ["claude-3-5-sonnet", "claude-sonnet"] */
  readonly aliases: string[];
  readonly provider: ModelProvider;
  readonly capabilities: ModelCapability[];
  /** Maximum number of tokens in the combined prompt + completion */
  readonly contextWindow: number;
  readonly pricing: ModelPricing;
  readonly latencyProfile: ModelLatencyProfile;
  status: ModelStatus;
  /** Free-form metadata for provider-specific configuration */
  metadata: Record<string, unknown>;
}

// ─── Zod schemas ──────────────────────────────────────────────────────────────

export const modelPricingSchema = z.object({
  inputPer1kTokens: z.number().nonnegative(),
  outputPer1kTokens: z.number().nonnegative(),
});

export const modelLatencyProfileSchema = z.object({
  ttftMs: z.number().int().nonnegative(),
  tokensPerSecond: z.number().positive(),
});

/** Validated shape for registering a new model via the admin API */
export const registerModelSchema = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  provider: z.nativeEnum(ModelProvider),
  capabilities: z.array(z.nativeEnum(ModelCapability)).min(1),
  contextWindow: z.number().int().positive(),
  pricing: modelPricingSchema,
  latencyProfile: modelLatencyProfileSchema,
  metadata: z.record(z.unknown()).default({}),
});

export type RegisterModelDto = z.infer<typeof registerModelSchema>;

// ─── API DTO ──────────────────────────────────────────────────────────────────

/** Public-facing model shape returned by GET /models and GET /models/:id */
export interface ModelDto {
  id: string;
  name: string;
  aliases: string[];
  provider: ModelProvider;
  capabilities: ModelCapability[];
  contextWindow: number;
  pricing: ModelPricing;
  latencyProfile: ModelLatencyProfile;
  status: ModelStatus;
  createdAt: string;
  updatedAt: string;
}
