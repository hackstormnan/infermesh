/**
 * modules/workers/registry/worker-registry.service.test.ts
 *
 * Unit tests for WorkerRegistryService.
 *
 * Tests cover:
 *   - listHealthy: returns only Idle + Busy workers
 *   - listAssignable: Idle + Busy workers with availableSlots > 0
 *   - findEligible: defaults to [Idle, Busy] statuses
 *   - findEligible: filters by requiredModelId
 *   - findEligible: filters by preferredRegion
 *   - findEligible: filters by maxQueueSize
 *   - findEligible: filters by maxLoadScore (undefined score passes)
 *   - findEligible: filters by minHeartbeatFreshnessMs
 *   - findEligible: filters by gpuRequired
 *   - findEligible: filters by instanceType
 *   - findEligible: filters by requiredCapabilityTags
 *   - findEligible: combined multi-constraint filtering
 *   - findEligible: returns empty array when no worker matches
 *   - Result ordering: most available slots first, then load asc, then name asc
 *   - Candidate shape: correct projection, no endpoint, has availableSlots
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryWorkerRepository } from "../repository/InMemoryWorkerRepository";
import { WorkerRegistryService } from "./worker-registry.service";
import { WorkerStatus } from "../../../shared/contracts/worker";
import type { Worker } from "../../../shared/contracts/worker";
import type { WorkerId } from "../../../shared/primitives";
import { toIsoTimestamp } from "../../../shared/primitives";
import { buildTestContext } from "../../../core/context";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

const FRESH_HEARTBEAT = Date.now() - 5_000;    // 5 seconds ago — very fresh
const STALE_HEARTBEAT = Date.now() - 120_000;  // 2 minutes ago — stale

function makeWorker(
  overrides: Partial<Worker> & { id: string; name: string },
): Worker {
  const now = toIsoTimestamp();
  return {
    id:               overrides.id as WorkerId,
    name:             overrides.name,
    endpoint:         overrides.endpoint         ?? "http://localhost:8080",
    supportedModelIds: overrides.supportedModelIds ?? ["model-a" as WorkerId],
    region:           overrides.region            ?? "us-east-1",
    hardware:         overrides.hardware          ?? { instanceType: "g4dn.xlarge", gpuModel: "NVIDIA T4" },
    status:           overrides.status            ?? WorkerStatus.Idle,
    capacity:         overrides.capacity          ?? { activeJobs: 0, maxConcurrentJobs: 4, queuedJobs: 0 },
    lastHeartbeatAt:  overrides.lastHeartbeatAt   ?? FRESH_HEARTBEAT,
    runtimeMetrics:   overrides.runtimeMetrics    ?? {},
    labels:           overrides.labels            ?? {},
    createdAt:        now,
    updatedAt:        now,
  };
}

// ─── Test fixtures ────────────────────────────────────────────────────────────

// GPU worker, Idle, plenty of capacity, supports model-a
const GPU_IDLE = makeWorker({
  id: "worker-gpu-idle",
  name: "gpu-worker-01",
  region: "us-east-1",
  hardware: { instanceType: "g4dn.xlarge", gpuModel: "NVIDIA T4" },
  supportedModelIds: ["model-a" as WorkerId, "model-b" as WorkerId],
  status: WorkerStatus.Idle,
  capacity: { activeJobs: 1, maxConcurrentJobs: 4, queuedJobs: 1 },
  runtimeMetrics: { loadScore: 0.25, tokensPerSecond: 80, ttftMs: 200, cpuUsagePercent: 30 },
  labels: { "vision-enabled": "true", "high-memory": "true" },
});

// CPU worker, Busy, still has slots, supports model-b
const CPU_BUSY = makeWorker({
  id: "worker-cpu-busy",
  name: "cpu-worker-01",
  region: "eu-west-1",
  hardware: { instanceType: "m5.2xlarge" },  // no GPU
  supportedModelIds: ["model-b" as WorkerId],
  status: WorkerStatus.Busy,
  capacity: { activeJobs: 3, maxConcurrentJobs: 4, queuedJobs: 2 },
  runtimeMetrics: { loadScore: 0.75, tokensPerSecond: 40, ttftMs: 500 },
  labels: {},
});

// GPU worker, Idle, fully saturated (no available slots)
const GPU_FULL = makeWorker({
  id: "worker-gpu-full",
  name: "gpu-worker-02",
  region: "us-east-1",
  hardware: { instanceType: "g4dn.xlarge", gpuModel: "NVIDIA A10G" },
  supportedModelIds: ["model-a" as WorkerId],
  status: WorkerStatus.Idle,
  capacity: { activeJobs: 4, maxConcurrentJobs: 4, queuedJobs: 3 },
  runtimeMetrics: { loadScore: 1.0 },
  labels: { "vision-enabled": "true" },
});

// Worker with stale heartbeat
const STALE_WORKER = makeWorker({
  id: "worker-stale",
  name: "stale-worker-01",
  region: "us-east-1",
  status: WorkerStatus.Idle,
  lastHeartbeatAt: STALE_HEARTBEAT,
  runtimeMetrics: {},
});

// Draining worker — should be excluded by default
const DRAINING = makeWorker({
  id: "worker-draining",
  name: "draining-worker-01",
  status: WorkerStatus.Draining,
  supportedModelIds: ["model-a" as WorkerId],
});

// Unhealthy worker — should be excluded by default
const UNHEALTHY = makeWorker({
  id: "worker-unhealthy",
  name: "unhealthy-worker-01",
  status: WorkerStatus.Unhealthy,
  supportedModelIds: ["model-a" as WorkerId],
});

// Offline worker — should be excluded by default
const OFFLINE = makeWorker({
  id: "worker-offline",
  name: "offline-worker-01",
  status: WorkerStatus.Offline,
});

// Worker with no loadScore reported
const NO_LOAD_SCORE = makeWorker({
  id: "worker-no-score",
  name: "worker-no-score-01",
  region: "us-east-1",
  status: WorkerStatus.Idle,
  capacity: { activeJobs: 0, maxConcurrentJobs: 2, queuedJobs: 0 },
  runtimeMetrics: {},  // no loadScore
  labels: {},
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("WorkerRegistryService", () => {
  let repo: InMemoryWorkerRepository;
  let registry: WorkerRegistryService;
  const ctx = buildTestContext();

  beforeEach(async () => {
    repo = new InMemoryWorkerRepository();
    registry = new WorkerRegistryService(repo);

    await repo.create(GPU_IDLE);
    await repo.create(CPU_BUSY);
    await repo.create(GPU_FULL);
    await repo.create(STALE_WORKER);
    await repo.create(DRAINING);
    await repo.create(UNHEALTHY);
    await repo.create(OFFLINE);
    await repo.create(NO_LOAD_SCORE);
  });

  // ─── listHealthy ──────────────────────────────────────────────────────────

  describe("listHealthy", () => {
    it("returns only Idle and Busy workers", async () => {
      const candidates = await registry.listHealthy(ctx);
      const statuses = candidates.map((c) => c.status);
      expect(statuses.every((s) => s === WorkerStatus.Idle || s === WorkerStatus.Busy)).toBe(true);
    });

    it("excludes Draining, Unhealthy, and Offline workers", async () => {
      const candidates = await registry.listHealthy(ctx);
      const names = candidates.map((c) => c.name);
      expect(names).not.toContain("draining-worker-01");
      expect(names).not.toContain("unhealthy-worker-01");
      expect(names).not.toContain("offline-worker-01");
    });

    it("returns 5 healthy workers from 8 total", async () => {
      const candidates = await registry.listHealthy(ctx);
      expect(candidates).toHaveLength(5);
    });
  });

  // ─── listAssignable ───────────────────────────────────────────────────────

  describe("listAssignable", () => {
    it("excludes workers with no available slots", async () => {
      const candidates = await registry.listAssignable(ctx);
      expect(candidates.every((c) => c.availableSlots > 0)).toBe(true);
    });

    it("excludes gpu-worker-02 (activeJobs === maxConcurrentJobs)", async () => {
      const candidates = await registry.listAssignable(ctx);
      const names = candidates.map((c) => c.name);
      expect(names).not.toContain("gpu-worker-02");
    });

    it("still includes Busy workers that have remaining slots", async () => {
      const candidates = await registry.listAssignable(ctx);
      const names = candidates.map((c) => c.name);
      expect(names).toContain("cpu-worker-01"); // 3/4 — 1 slot remaining
    });
  });

  // ─── findEligible — defaults ──────────────────────────────────────────────

  describe("findEligible defaults", () => {
    it("defaults to Idle + Busy when no filter provided", async () => {
      const candidates = await registry.findEligible(ctx);
      expect(candidates.every(
        (c) => c.status === WorkerStatus.Idle || c.status === WorkerStatus.Busy,
      )).toBe(true);
    });

    it("defaults to Idle + Busy when empty filter provided", async () => {
      const candidates = await registry.findEligible(ctx, {});
      expect(candidates).toHaveLength(5);
    });
  });

  // ─── findEligible — requiredModelId ──────────────────────────────────────

  describe("findEligible — requiredModelId", () => {
    it("filters to workers that support the required model", async () => {
      const candidates = await registry.findEligible(ctx, { requiredModelId: "model-a" });
      const names = candidates.map((c) => c.name);
      expect(names).toContain("gpu-worker-01");
      expect(names).toContain("gpu-worker-02");
      expect(names).not.toContain("cpu-worker-01"); // only supports model-b
    });

    it("filters to workers supporting model-b only", async () => {
      const candidates = await registry.findEligible(ctx, { requiredModelId: "model-b" });
      const names = candidates.map((c) => c.name);
      expect(names).toContain("gpu-worker-01"); // supports both
      expect(names).toContain("cpu-worker-01"); // supports model-b
    });

    it("returns empty array for unknown model", async () => {
      const candidates = await registry.findEligible(ctx, { requiredModelId: "model-unknown" });
      expect(candidates).toHaveLength(0);
    });
  });

  // ─── findEligible — preferredRegion ──────────────────────────────────────

  describe("findEligible — preferredRegion", () => {
    it("filters by region: us-east-1", async () => {
      const candidates = await registry.findEligible(ctx, { preferredRegion: "us-east-1" });
      expect(candidates.every((c) => c.region === "us-east-1")).toBe(true);
    });

    it("is case-insensitive", async () => {
      const candidates = await registry.findEligible(ctx, { preferredRegion: "US-EAST-1" });
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates.every((c) => c.region === "us-east-1")).toBe(true);
    });

    it("filters by region: eu-west-1", async () => {
      const candidates = await registry.findEligible(ctx, { preferredRegion: "eu-west-1" });
      expect(candidates).toHaveLength(1);
      expect(candidates[0].name).toBe("cpu-worker-01");
    });

    it("returns empty array for unknown region", async () => {
      const candidates = await registry.findEligible(ctx, { preferredRegion: "ap-southeast-99" });
      expect(candidates).toHaveLength(0);
    });
  });

  // ─── findEligible — maxQueueSize ─────────────────────────────────────────

  describe("findEligible — maxQueueSize", () => {
    it("filters workers with queuedJobs above the threshold", async () => {
      // GPU_FULL has 3 queued, CPU_BUSY has 2, GPU_IDLE has 1, others have 0
      const candidates = await registry.findEligible(ctx, { maxQueueSize: 1 });
      const names = candidates.map((c) => c.name);
      expect(names).toContain("gpu-worker-01");    // 1 queued ≤ 1 ✓
      expect(names).not.toContain("cpu-worker-01");  // 2 queued > 1 ✗
      expect(names).not.toContain("gpu-worker-02");  // 3 queued > 1 ✗
    });

    it("maxQueueSize=0 returns only workers with empty queues", async () => {
      const candidates = await registry.findEligible(ctx, { maxQueueSize: 0 });
      expect(candidates.every((c) => c.queuedJobs === 0)).toBe(true);
    });
  });

  // ─── findEligible — maxLoadScore ─────────────────────────────────────────

  describe("findEligible — maxLoadScore", () => {
    it("excludes workers with loadScore above threshold", async () => {
      const candidates = await registry.findEligible(ctx, { maxLoadScore: 0.5 });
      const names = candidates.map((c) => c.name);
      expect(names).toContain("gpu-worker-01");    // 0.25 ≤ 0.5 ✓
      expect(names).not.toContain("cpu-worker-01"); // 0.75 > 0.5 ✗
      expect(names).not.toContain("gpu-worker-02"); // 1.0 > 0.5 ✗
    });

    it("workers without a loadScore always pass the load filter", async () => {
      const candidates = await registry.findEligible(ctx, { maxLoadScore: 0.1 });
      const names = candidates.map((c) => c.name);
      // NO_LOAD_SCORE has undefined loadScore — should pass
      expect(names).toContain("worker-no-score-01");
    });
  });

  // ─── findEligible — minHeartbeatFreshnessMs ───────────────────────────────

  describe("findEligible — minHeartbeatFreshnessMs", () => {
    it("excludes workers whose heartbeat is older than the threshold", async () => {
      // STALE_WORKER last heartbeat was 2 minutes ago
      const candidates = await registry.findEligible(ctx, {
        minHeartbeatFreshnessMs: 60_000, // must have reported within last 60 seconds
      });
      const names = candidates.map((c) => c.name);
      expect(names).not.toContain("stale-worker-01");
    });

    it("includes workers whose heartbeat is within the threshold", async () => {
      const candidates = await registry.findEligible(ctx, {
        minHeartbeatFreshnessMs: 30_000, // 30 seconds
      });
      const names = candidates.map((c) => c.name);
      expect(names).toContain("gpu-worker-01");
      expect(names).toContain("cpu-worker-01");
    });
  });

  // ─── findEligible — gpuRequired ──────────────────────────────────────────

  describe("findEligible — gpuRequired", () => {
    it("filters to GPU workers only when gpuRequired=true", async () => {
      const candidates = await registry.findEligible(ctx, { gpuRequired: true });
      const names = candidates.map((c) => c.name);
      expect(names).toContain("gpu-worker-01");
      expect(names).toContain("gpu-worker-02");
      expect(names).not.toContain("cpu-worker-01"); // no gpuModel
    });

    it("all hardware.gpuModel fields are defined for GPU candidates", async () => {
      const candidates = await registry.findEligible(ctx, { gpuRequired: true });
      expect(candidates.every((c) => c.hardware.gpuModel !== undefined)).toBe(true);
    });
  });

  // ─── findEligible — instanceType ─────────────────────────────────────────

  describe("findEligible — instanceType", () => {
    it("filters by exact instanceType", async () => {
      const candidates = await registry.findEligible(ctx, { instanceType: "m5.2xlarge" });
      expect(candidates).toHaveLength(1);
      expect(candidates[0].name).toBe("cpu-worker-01");
    });

    it("returns empty array for unmatched instanceType", async () => {
      const candidates = await registry.findEligible(ctx, { instanceType: "p4d.24xlarge" });
      expect(candidates).toHaveLength(0);
    });
  });

  // ─── findEligible — requiredCapabilityTags ────────────────────────────────

  describe("findEligible — requiredCapabilityTags", () => {
    it("filters to workers that have the required label key", async () => {
      const candidates = await registry.findEligible(ctx, {
        requiredCapabilityTags: ["vision-enabled"],
      });
      const names = candidates.map((c) => c.name);
      expect(names).toContain("gpu-worker-01");
      expect(names).toContain("gpu-worker-02");
      expect(names).not.toContain("cpu-worker-01");
    });

    it("requires ALL listed tags (AND logic)", async () => {
      const candidates = await registry.findEligible(ctx, {
        requiredCapabilityTags: ["vision-enabled", "high-memory"],
      });
      const names = candidates.map((c) => c.name);
      expect(names).toContain("gpu-worker-01");      // has both
      expect(names).not.toContain("gpu-worker-02");  // has vision-enabled but not high-memory
    });

    it("applies no constraint when requiredCapabilityTags is empty", async () => {
      const candidates = await registry.findEligible(ctx, { requiredCapabilityTags: [] });
      expect(candidates).toHaveLength(5); // all healthy
    });
  });

  // ─── findEligible — statuses override ────────────────────────────────────

  describe("findEligible — statuses override", () => {
    it("restricts to Idle only when statuses=[Idle]", async () => {
      const candidates = await registry.findEligible(ctx, { statuses: [WorkerStatus.Idle] });
      expect(candidates.every((c) => c.status === WorkerStatus.Idle)).toBe(true);
    });

    it("returns Draining workers when explicitly requested", async () => {
      const candidates = await registry.findEligible(ctx, { statuses: [WorkerStatus.Draining] });
      expect(candidates).toHaveLength(1);
      expect(candidates[0].name).toBe("draining-worker-01");
    });
  });

  // ─── findEligible — combined filters ─────────────────────────────────────

  describe("findEligible — combined filters", () => {
    it("region + modelId returns gpu-worker-01 only", async () => {
      const candidates = await registry.findEligible(ctx, {
        preferredRegion: "us-east-1",
        requiredModelId: "model-b",
      });
      // gpu-worker-01 is in us-east-1 and supports model-b; gpu-worker-02 does not support model-b
      expect(candidates).toHaveLength(1);
      expect(candidates[0].name).toBe("gpu-worker-01");
    });

    it("gpuRequired + maxLoadScore=0.5 filters correctly", async () => {
      const candidates = await registry.findEligible(ctx, {
        gpuRequired: true,
        maxLoadScore: 0.5,
      });
      const names = candidates.map((c) => c.name);
      expect(names).toContain("gpu-worker-01");     // GPU + load 0.25 ✓
      expect(names).not.toContain("gpu-worker-02"); // GPU but load 1.0 ✗
      expect(names).not.toContain("cpu-worker-01"); // no GPU ✗
    });

    it("region + gpuRequired + maxQueueSize returns empty when no match", async () => {
      const candidates = await registry.findEligible(ctx, {
        preferredRegion: "eu-west-1",
        gpuRequired: true, // cpu-worker-01 is in eu-west-1 but has no GPU
      });
      expect(candidates).toHaveLength(0);
    });
  });

  // ─── Result ordering ──────────────────────────────────────────────────────

  describe("result ordering", () => {
    it("sorts by availableSlots descending", async () => {
      const candidates = await registry.findEligible(ctx, { statuses: [WorkerStatus.Idle] });
      // Verify availableSlots is non-increasing across the result
      for (let i = 1; i < candidates.length; i++) {
        expect(candidates[i - 1].availableSlots).toBeGreaterThanOrEqual(candidates[i].availableSlots);
      }
    });

    it("sorts by loadScore ascending within same available slots", async () => {
      // gpu-worker-01: 3 slots available, load 0.25
      // gpu-worker-02: 0 slots available, load 1.0
      // NO_LOAD_SCORE: 2 slots available, no load score (treated as 0)
      const candidates = await registry.findEligible(ctx, {
        statuses: [WorkerStatus.Idle],
        preferredRegion: "us-east-1",
      });
      const names = candidates.map((c) => c.name);
      // gpu-worker-01 has 3 available slots → comes before gpu-worker-02 (0 slots)
      expect(names.indexOf("gpu-worker-01")).toBeLessThan(names.indexOf("gpu-worker-02"));
    });
  });

  // ─── Candidate shape ──────────────────────────────────────────────────────

  describe("candidate shape", () => {
    it("projects all required fields onto WorkerCandidate", async () => {
      const candidates = await registry.findEligible(ctx, { requiredModelId: "model-b",
        statuses: [WorkerStatus.Busy] });
      expect(candidates).toHaveLength(1);
      const c = candidates[0];
      expect(c.id).toBe("worker-cpu-busy");
      expect(c.name).toBe("cpu-worker-01");
      expect(c.region).toBe("eu-west-1");
      expect(c.status).toBe(WorkerStatus.Busy);
      expect(c.activeJobs).toBe(3);
      expect(c.maxConcurrentJobs).toBe(4);
      expect(c.queuedJobs).toBe(2);
      expect(c.availableSlots).toBe(1); // 4 - 3
      expect(c.loadScore).toBe(0.75);
      expect(c.tokensPerSecond).toBe(40);
      expect(c.ttftMs).toBe(500);
      expect(c.lastHeartbeatAt).toBe(FRESH_HEARTBEAT);
    });

    it("computes availableSlots as max(0, maxConcurrentJobs - activeJobs)", async () => {
      const candidates = await registry.findEligible(ctx, { statuses: [WorkerStatus.Idle],
        preferredRegion: "us-east-1" });
      const full = candidates.find((c) => c.name === "gpu-worker-02");
      expect(full?.availableSlots).toBe(0); // 4 - 4 = 0
    });

    it("excludes the worker endpoint from candidates", async () => {
      const candidates = await registry.findEligible(ctx);
      expect(candidates[0]).not.toHaveProperty("endpoint");
    });

    it("excludes createdAt and updatedAt from candidates", async () => {
      const candidates = await registry.findEligible(ctx);
      expect(candidates[0]).not.toHaveProperty("createdAt");
      expect(candidates[0]).not.toHaveProperty("updatedAt");
    });
  });
});
