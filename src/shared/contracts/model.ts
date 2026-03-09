/**
 * shared/contracts/model.ts
 *
 * Contracts for the **Models** module — the registry of AI models available
 * for routing decisions.
 *
 * Layers:
 *   - Enums           — ModelStatus, ModelProvider, ModelCapability,
 *                       QualityTier, ModelTask
 *   - Value objects   — ModelPricing, ModelLatencyProfile
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

/**
 * Coarse quality tier used by routing strategies that balance capability vs cost.
 * Routing policies can specify a minimum acceptable tier.
 *
 *   Frontier → state-of-the-art reasoning and instruction following; highest cost
 *   Standard → strong general-purpose capability; balanced cost
 *   Economy  → fast and cheap; best for simple tasks at high volume
 */
export enum QualityTier {
  Frontier = "frontier",
  Standard = "standard",
  Economy = "economy",
}

/**
 * Task types a model is particularly well-suited for.
 * Used by routing strategies that match requests to the most capable model
 * for the specific task at hand.
 */
export enum ModelTask {
  /** Open-ended chat and conversational responses */
  Chat = "chat",
  /** Document and article summarization */
  Summarization = "summarization",
  /** Source-to-target language translation */
  Translation = "translation",
  /** Text, intent, or sentiment classification */
  Classification = "classification",
  /** Structured information extraction */
  Extraction = "extraction",
  /** Code generation, review, and debugging */
  Coding = "coding",
  /** Multi-step reasoning and problem solving */
  Reasoning = "reasoning",
  /** Retrieval-augmented generation */
  Rag = "rag",
}

// ─── Value objects ────────────────────────────────────────────────────────────

/**
 * Pricing profile used by cost-optimising routing strategies.
 * All monetary values are in USD.
 */
export interface ModelPricing {
  /** Cost per 1 000 input tokens in USD */
  inputPer1kTokens: number;
  /** Cost per 1 000 output tokens in USD */
  outputPer1kTokens: number;
}

/**
 * Latency profile used by latency-sensitive routing strategies.
 * Values are approximate (typical under normal load) and should be
 * refreshed from real telemetry once the metrics module is active.
 */
export interface ModelLatencyProfile {
  /** Typical time-to-first-token in milliseconds under normal load */
  ttftMs: number;
  /** Typical inter-token generation speed in tokens/second */
  tokensPerSecond: number;
}

// ─── Domain entity ────────────────────────────────────────────────────────────

/**
 * Model — a registered AI model in the InferMesh catalog.
 *
 * Workers declare which model IDs they support; the routing engine uses
 * Model metadata — capabilities, qualityTier, supportedTasks, pricing,
 * latencyProfile — to score and select the best (model, worker) candidate.
 *
 * Immutable fields (readonly) are set on registration and never change.
 * Mutable fields (status, metadata) can be updated via the admin API.
 */
export interface Model extends BaseEntity {
  readonly id: ModelId;
  /** Canonical name used in API requests, e.g. "claude-sonnet-4-6" */
  readonly name: string;
  /** Shorter human-friendly aliases, e.g. ["claude-sonnet", "claude-3-5-sonnet"] */
  readonly aliases: string[];
  readonly provider: ModelProvider;
  /** Provider-specific model version string, e.g. "4-6", "turbo-2024-11-05" */
  readonly version?: string;
  readonly capabilities: ModelCapability[];
  /** Task types this model excels at — used for task-aware routing */
  readonly supportedTasks: ModelTask[];
  /** Quality tier for routing strategies that weight capability vs cost */
  readonly qualityTier: QualityTier;
  /** Total context window: maximum tokens across prompt + completion combined */
  readonly contextWindow: number;
  /** Maximum tokens the model can generate in a single response */
  readonly maxOutputTokens: number;
  readonly pricing: ModelPricing;
  readonly latencyProfile: ModelLatencyProfile;
  /** Current availability status — controls whether new requests can be dispatched */
  status: ModelStatus;
  /** Provider-specific configuration or any extra metadata */
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
  version: z.string().optional(),
  capabilities: z.array(z.nativeEnum(ModelCapability)).min(1),
  supportedTasks: z.array(z.nativeEnum(ModelTask)).default([]),
  qualityTier: z.nativeEnum(QualityTier),
  contextWindow: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  pricing: modelPricingSchema,
  latencyProfile: modelLatencyProfileSchema,
  metadata: z.record(z.unknown()).default({}),
});

export type RegisterModelDto = z.infer<typeof registerModelSchema>;

/** Fields that can be updated after a model has been registered */
export const updateModelSchema = z.object({
  status: z.nativeEnum(ModelStatus).optional(),
  pricing: modelPricingSchema.optional(),
  latencyProfile: modelLatencyProfileSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type UpdateModelDto = z.infer<typeof updateModelSchema>;

// ─── API DTO (response projection) ───────────────────────────────────────────

/** Public-facing model shape returned by GET /models and GET /models/:id */
export interface ModelDto {
  id: string;
  name: string;
  aliases: string[];
  provider: ModelProvider;
  version?: string;
  capabilities: ModelCapability[];
  supportedTasks: ModelTask[];
  qualityTier: QualityTier;
  contextWindow: number;
  maxOutputTokens: number;
  pricing: ModelPricing;
  latencyProfile: ModelLatencyProfile;
  status: ModelStatus;
  createdAt: string;
  updatedAt: string;
}
