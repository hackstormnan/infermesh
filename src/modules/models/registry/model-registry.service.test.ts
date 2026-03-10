/**
 * modules/models/registry/model-registry.service.test.ts
 *
 * Unit tests for ModelRegistryService.
 *
 * Tests cover:
 *   - listActive: returns only Active models
 *   - findEligible: defaults to Active status
 *   - findEligible: filters by taskType, requiredCapabilities, provider,
 *                   minQualityTier, minContextWindow, status
 *   - findEligible: combined multi-constraint filtering
 *   - findEligible: returns empty array when no model matches
 *   - findEligible: result ordering (quality-desc, name-asc within tier)
 *   - findEligible: candidate shape (correct projection, no metadata)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryModelRepository } from "../repository/InMemoryModelRepository";
import { ModelRegistryService } from "./model-registry.service";
import {
  ModelCapability,
  ModelProvider,
  ModelStatus,
  ModelTask,
  QualityTier,
} from "../../../shared/contracts/model";
import type { Model } from "../../../shared/contracts/model";
import type { ModelId } from "../../../shared/primitives";
import { toIsoTimestamp } from "../../../shared/primitives";
import { buildTestContext } from "../../../core/context";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeModel(overrides: Partial<Model> & { id: string; name: string }): Model {
  const now = toIsoTimestamp();
  return {
    id:             overrides.id as ModelId,
    name:           overrides.name,
    aliases:        overrides.aliases        ?? [],
    provider:       overrides.provider       ?? ModelProvider.Anthropic,
    version:        overrides.version,
    capabilities:   overrides.capabilities   ?? [ModelCapability.TextGeneration],
    supportedTasks: overrides.supportedTasks ?? [ModelTask.Chat],
    qualityTier:    overrides.qualityTier    ?? QualityTier.Standard,
    contextWindow:  overrides.contextWindow  ?? 8192,
    maxOutputTokens: overrides.maxOutputTokens ?? 4096,
    pricing: overrides.pricing ?? {
      inputPer1kTokens: 0.003,
      outputPer1kTokens: 0.015,
    },
    latencyProfile: overrides.latencyProfile ?? {
      ttftMs: 300,
      tokensPerSecond: 60,
    },
    status:   overrides.status   ?? ModelStatus.Active,
    metadata: overrides.metadata ?? {},
    createdAt: now,
    updatedAt: now,
  };
}

// ─── Test models ──────────────────────────────────────────────────────────────

const FRONTIER_CHAT = makeModel({
  id: "model-frontier-1",
  name: "claude-opus-4",
  provider: ModelProvider.Anthropic,
  qualityTier: QualityTier.Frontier,
  capabilities: [ModelCapability.TextGeneration, ModelCapability.ToolUse, ModelCapability.Vision],
  supportedTasks: [ModelTask.Chat, ModelTask.Reasoning, ModelTask.Coding],
  contextWindow: 200000,
  maxOutputTokens: 8192,
  pricing: { inputPer1kTokens: 0.015, outputPer1kTokens: 0.075 },
  latencyProfile: { ttftMs: 800, tokensPerSecond: 30 },
});

const STANDARD_CODING = makeModel({
  id: "model-standard-1",
  name: "claude-sonnet-4-6",
  provider: ModelProvider.Anthropic,
  qualityTier: QualityTier.Standard,
  capabilities: [ModelCapability.TextGeneration, ModelCapability.ToolUse, ModelCapability.CodeGeneration],
  supportedTasks: [ModelTask.Chat, ModelTask.Coding, ModelTask.Rag],
  contextWindow: 100000,
  maxOutputTokens: 8192,
  pricing: { inputPer1kTokens: 0.003, outputPer1kTokens: 0.015 },
  latencyProfile: { ttftMs: 300, tokensPerSecond: 80 },
});

const ECONOMY_CHAT = makeModel({
  id: "model-economy-1",
  name: "claude-haiku-4-5",
  provider: ModelProvider.Anthropic,
  qualityTier: QualityTier.Economy,
  capabilities: [ModelCapability.TextGeneration],
  supportedTasks: [ModelTask.Chat, ModelTask.Classification, ModelTask.Summarization],
  contextWindow: 32000,
  maxOutputTokens: 4096,
  pricing: { inputPer1kTokens: 0.001, outputPer1kTokens: 0.005 },
  latencyProfile: { ttftMs: 100, tokensPerSecond: 120 },
});

const OPENAI_GPT = makeModel({
  id: "model-openai-1",
  name: "gpt-4o",
  provider: ModelProvider.OpenAI,
  qualityTier: QualityTier.Frontier,
  capabilities: [ModelCapability.TextGeneration, ModelCapability.ToolUse, ModelCapability.Vision],
  supportedTasks: [ModelTask.Chat, ModelTask.Coding, ModelTask.Reasoning],
  contextWindow: 128000,
  maxOutputTokens: 16384,
  pricing: { inputPer1kTokens: 0.005, outputPer1kTokens: 0.015 },
  latencyProfile: { ttftMs: 400, tokensPerSecond: 60 },
});

const INACTIVE_MODEL = makeModel({
  id: "model-inactive-1",
  name: "old-model-v1",
  status: ModelStatus.Inactive,
  qualityTier: QualityTier.Standard,
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ModelRegistryService", () => {
  let repo: InMemoryModelRepository;
  let registry: ModelRegistryService;
  const ctx = buildTestContext();

  beforeEach(async () => {
    repo = new InMemoryModelRepository();
    registry = new ModelRegistryService(repo);

    // Seed all fixtures
    await repo.create(FRONTIER_CHAT);
    await repo.create(STANDARD_CODING);
    await repo.create(ECONOMY_CHAT);
    await repo.create(OPENAI_GPT);
    await repo.create(INACTIVE_MODEL);
  });

  // ─── listActive ─────────────────────────────────────────────────────────────

  describe("listActive", () => {
    it("returns only Active models", async () => {
      const candidates = await registry.listActive(ctx);
      expect(candidates.every((c) => c.status === ModelStatus.Active)).toBe(true);
    });

    it("excludes Inactive models", async () => {
      const candidates = await registry.listActive(ctx);
      expect(candidates.map((c) => c.name)).not.toContain("old-model-v1");
    });

    it("returns 4 active models from 5 total", async () => {
      const candidates = await registry.listActive(ctx);
      expect(candidates).toHaveLength(4);
    });
  });

  // ─── findEligible — defaults ─────────────────────────────────────────────────

  describe("findEligible defaults", () => {
    it("defaults to Active status when no filter is provided", async () => {
      const candidates = await registry.findEligible(ctx);
      expect(candidates.every((c) => c.status === ModelStatus.Active)).toBe(true);
      expect(candidates).toHaveLength(4);
    });

    it("defaults to Active status when empty filter is provided", async () => {
      const candidates = await registry.findEligible(ctx, {});
      expect(candidates).toHaveLength(4);
    });
  });

  // ─── findEligible — taskType ─────────────────────────────────────────────────

  describe("findEligible — taskType", () => {
    it("filters by taskType: Coding", async () => {
      const candidates = await registry.findEligible(ctx, { taskType: ModelTask.Coding });
      const names = candidates.map((c) => c.name);
      expect(names).toContain("claude-opus-4");
      expect(names).toContain("claude-sonnet-4-6");
      expect(names).toContain("gpt-4o");
      expect(names).not.toContain("claude-haiku-4-5");
    });

    it("filters by taskType: Classification (only Economy model)", async () => {
      const candidates = await registry.findEligible(ctx, { taskType: ModelTask.Classification });
      expect(candidates).toHaveLength(1);
      expect(candidates[0].name).toBe("claude-haiku-4-5");
    });

    it("returns empty array when no model supports the task type", async () => {
      const candidates = await registry.findEligible(ctx, { taskType: ModelTask.Translation });
      expect(candidates).toHaveLength(0);
    });
  });

  // ─── findEligible — requiredCapabilities ────────────────────────────────────

  describe("findEligible — requiredCapabilities", () => {
    it("filters by single capability: CodeGeneration", async () => {
      const candidates = await registry.findEligible(ctx, {
        requiredCapabilities: [ModelCapability.CodeGeneration],
      });
      expect(candidates).toHaveLength(1);
      expect(candidates[0].name).toBe("claude-sonnet-4-6");
    });

    it("filters by multiple capabilities: ToolUse + Vision", async () => {
      const candidates = await registry.findEligible(ctx, {
        requiredCapabilities: [ModelCapability.ToolUse, ModelCapability.Vision],
      });
      const names = candidates.map((c) => c.name);
      expect(names).toContain("claude-opus-4");
      expect(names).toContain("gpt-4o");
      expect(names).not.toContain("claude-sonnet-4-6"); // has ToolUse but not Vision
      expect(names).not.toContain("claude-haiku-4-5");
    });

    it("applies no constraint when requiredCapabilities is empty", async () => {
      const candidates = await registry.findEligible(ctx, { requiredCapabilities: [] });
      expect(candidates).toHaveLength(4);
    });
  });

  // ─── findEligible — provider ─────────────────────────────────────────────────

  describe("findEligible — provider", () => {
    it("filters by provider: OpenAI", async () => {
      const candidates = await registry.findEligible(ctx, { provider: ModelProvider.OpenAI });
      expect(candidates).toHaveLength(1);
      expect(candidates[0].name).toBe("gpt-4o");
    });

    it("filters by provider: Anthropic", async () => {
      const candidates = await registry.findEligible(ctx, { provider: ModelProvider.Anthropic });
      expect(candidates).toHaveLength(3);
      expect(candidates.map((c) => c.provider)).toEqual(
        Array(3).fill(ModelProvider.Anthropic),
      );
    });

    it("returns empty array for unknown provider", async () => {
      const candidates = await registry.findEligible(ctx, { provider: ModelProvider.Mistral });
      expect(candidates).toHaveLength(0);
    });
  });

  // ─── findEligible — minQualityTier ───────────────────────────────────────────

  describe("findEligible — minQualityTier", () => {
    it("minQualityTier=Frontier returns only Frontier models", async () => {
      const candidates = await registry.findEligible(ctx, {
        minQualityTier: QualityTier.Frontier,
      });
      expect(candidates.every((c) => c.qualityTier === QualityTier.Frontier)).toBe(true);
      expect(candidates).toHaveLength(2); // claude-opus-4 + gpt-4o
    });

    it("minQualityTier=Standard returns Standard and Frontier models", async () => {
      const candidates = await registry.findEligible(ctx, {
        minQualityTier: QualityTier.Standard,
      });
      const tiers = candidates.map((c) => c.qualityTier);
      expect(tiers).not.toContain(QualityTier.Economy);
      expect(candidates).toHaveLength(3); // opus + sonnet + gpt-4o
    });

    it("minQualityTier=Economy returns all active models", async () => {
      const candidates = await registry.findEligible(ctx, {
        minQualityTier: QualityTier.Economy,
      });
      expect(candidates).toHaveLength(4);
    });
  });

  // ─── findEligible — minContextWindow ────────────────────────────────────────

  describe("findEligible — minContextWindow", () => {
    it("filters models below the minimum context window", async () => {
      const candidates = await registry.findEligible(ctx, { minContextWindow: 100000 });
      const names = candidates.map((c) => c.name);
      expect(names).toContain("claude-opus-4");        // 200 000 ≥ 100 000 ✓
      expect(names).toContain("claude-sonnet-4-6");    // 100 000 ≥ 100 000 ✓ (inclusive)
      expect(names).toContain("gpt-4o");               // 128 000 ≥ 100 000 ✓
      expect(names).not.toContain("claude-haiku-4-5"); // 32 000  < 100 000 ✗
    });

    it("includes gpt-4o at minContextWindow=128000", async () => {
      const candidates = await registry.findEligible(ctx, { minContextWindow: 128000 });
      const names = candidates.map((c) => c.name);
      expect(names).toContain("gpt-4o");
      expect(names).toContain("claude-opus-4");
      expect(names).not.toContain("claude-sonnet-4-6");
      expect(names).not.toContain("claude-haiku-4-5");
    });

    it("returns empty array when minContextWindow exceeds all models", async () => {
      const candidates = await registry.findEligible(ctx, { minContextWindow: 999999 });
      expect(candidates).toHaveLength(0);
    });
  });

  // ─── findEligible — status override ─────────────────────────────────────────

  describe("findEligible — status override", () => {
    it("returns Inactive models when status=Inactive", async () => {
      const candidates = await registry.findEligible(ctx, { status: ModelStatus.Inactive });
      expect(candidates).toHaveLength(1);
      expect(candidates[0].name).toBe("old-model-v1");
    });
  });

  // ─── findEligible — combined filters ────────────────────────────────────────

  describe("findEligible — combined filters", () => {
    it("provider + taskType narrows correctly", async () => {
      const candidates = await registry.findEligible(ctx, {
        provider: ModelProvider.Anthropic,
        taskType: ModelTask.Coding,
      });
      const names = candidates.map((c) => c.name);
      expect(names).toContain("claude-opus-4");
      expect(names).toContain("claude-sonnet-4-6");
      expect(names).not.toContain("gpt-4o");
      expect(names).not.toContain("claude-haiku-4-5");
    });

    it("minQualityTier + requiredCapabilities narrows to frontier tool-use models", async () => {
      const candidates = await registry.findEligible(ctx, {
        minQualityTier: QualityTier.Frontier,
        requiredCapabilities: [ModelCapability.ToolUse],
      });
      expect(candidates).toHaveLength(2);
    });

    it("provider + minContextWindow + taskType returns single best match", async () => {
      const candidates = await registry.findEligible(ctx, {
        provider: ModelProvider.Anthropic,
        minContextWindow: 150000,
        taskType: ModelTask.Reasoning,
      });
      expect(candidates).toHaveLength(1);
      expect(candidates[0].name).toBe("claude-opus-4");
    });
  });

  // ─── Result ordering ─────────────────────────────────────────────────────────

  describe("result ordering", () => {
    it("sorts by quality tier descending (Frontier first)", async () => {
      const candidates = await registry.findEligible(ctx);
      const anthropicCandidates = candidates.filter(
        (c) => c.provider === ModelProvider.Anthropic,
      );
      expect(anthropicCandidates[0].qualityTier).toBe(QualityTier.Frontier);
      expect(anthropicCandidates[anthropicCandidates.length - 1].qualityTier).toBe(QualityTier.Economy);
    });

    it("sorts alphabetically within the same tier", async () => {
      // Both claude-opus-4 and gpt-4o are Frontier
      const candidates = await registry.findEligible(ctx, {
        minQualityTier: QualityTier.Frontier,
      });
      const frontierNames = candidates.map((c) => c.name);
      // 'c' < 'g' → claude-opus-4 before gpt-4o
      expect(frontierNames[0]).toBe("claude-opus-4");
      expect(frontierNames[1]).toBe("gpt-4o");
    });
  });

  // ─── Candidate shape ─────────────────────────────────────────────────────────

  describe("candidate shape", () => {
    it("projects all required fields onto ModelCandidate", async () => {
      const candidates = await registry.findEligible(ctx, {
        provider: ModelProvider.OpenAI,
      });
      expect(candidates).toHaveLength(1);
      const c = candidates[0];
      expect(c.id).toBe("model-openai-1");
      expect(c.name).toBe("gpt-4o");
      expect(c.provider).toBe(ModelProvider.OpenAI);
      expect(c.qualityTier).toBe(QualityTier.Frontier);
      expect(c.contextWindow).toBe(128000);
      expect(c.maxOutputTokens).toBe(16384);
      expect(c.pricing.inputPer1kTokens).toBe(0.005);
      expect(c.latencyProfile.ttftMs).toBe(400);
      expect(c.status).toBe(ModelStatus.Active);
    });

    it("excludes internal metadata from candidates", async () => {
      const candidates = await registry.findEligible(ctx, {
        provider: ModelProvider.OpenAI,
      });
      expect(candidates[0]).not.toHaveProperty("metadata");
    });

    it("excludes timestamps from candidates", async () => {
      const candidates = await registry.findEligible(ctx, {
        provider: ModelProvider.OpenAI,
      });
      expect(candidates[0]).not.toHaveProperty("createdAt");
      expect(candidates[0]).not.toHaveProperty("updatedAt");
    });
  });
});
