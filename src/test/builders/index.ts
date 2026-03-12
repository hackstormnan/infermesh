/**
 * test/builders/index.ts
 *
 * Canonical domain object builders for tests.
 *
 * Every builder function:
 *   - Returns a fully-valid object using sensible defaults
 *   - Accepts an optional Partial<T> override to change any field
 *   - Generates unique IDs using a monotonic counter so two calls always
 *     produce distinct objects without reaching for randomUUID in test code
 *
 * Convention:
 *   aModel()           — a registered Model entity
 *   aModelCandidate()  — routing-facing ModelCandidate projection
 *   aWorker()          — a registered Worker entity
 *   aWorkerCandidate() — routing-facing WorkerCandidate projection
 *   aJob()             — a Job entity (Queued status)
 *   aRoutingPolicy()   — a RoutingPolicy (Active, LeastLoaded)
 *   aRoutingDecision() — a RoutingDecision (Routed outcome)
 *   anInferenceRequest() — an InferenceRequest (Queued status)
 *   aWorkloadConfig()  — a WorkloadConfig for the simulation generator
 *   aModelScoreResult()  — a fully-eligible ModelScoreResult
 *   aWorkerScoreResult() — a fully-eligible WorkerScoreResult
 */

import type { Model } from "../../shared/contracts/model";
import {
  ModelCapability,
  ModelProvider,
  ModelStatus,
  ModelTask,
  QualityTier,
} from "../../shared/contracts/model";
import type { ModelCandidate } from "../../modules/models/registry/model-registry.contract";
import type { Worker } from "../../shared/contracts/worker";
import { WorkerStatus } from "../../shared/contracts/worker";
import type { WorkerCandidate } from "../../modules/workers/registry/worker-registry.contract";
import type { Job } from "../../shared/contracts/job";
import { JobPriority, JobSourceType, JobStatus } from "../../shared/contracts/job";
import type { RoutingPolicy, RoutingDecision } from "../../shared/contracts/routing";
import {
  DecisionSource,
  RoutingOutcome,
  RoutingPolicyStatus,
  RoutingStrategy,
} from "../../shared/contracts/routing";
import type { InferenceRequest } from "../../shared/contracts/request";
import { MessageRole, RequestStatus } from "../../shared/contracts/request";
import type { WorkloadConfig } from "../../modules/simulation/workload/workload-generator.contract";
import type {
  ModelScoreResult,
  WorkerScoreResult,
} from "../../modules/routing/evaluation/evaluation.contract";
import type {
  DecisionId,
  JobId,
  ModelId,
  PolicyId,
  RequestId,
  WorkerId,
} from "../../shared/primitives";
import { toIsoTimestamp } from "../../shared/primitives";

// ─── Monotonic counter ────────────────────────────────────────────────────────
// Ensures every builder call produces a distinct ID without randomness.

let _seq = 0;
function next(prefix: string): string {
  return `${prefix}-${++_seq}`;
}

/** Reset the counter — call in beforeEach if isolation across tests is needed */
export function resetBuilderSequence(): void {
  _seq = 0;
}

// ─── Model ────────────────────────────────────────────────────────────────────

export function aModel(overrides: Partial<Model> = {}): Model {
  const id = next("model") as ModelId;
  const now = toIsoTimestamp();
  return {
    id,
    name: `test-model-${id}`,
    aliases: [],
    provider: ModelProvider.OpenAI,
    capabilities: [ModelCapability.TextGeneration],
    supportedTasks: [ModelTask.Chat],
    qualityTier: QualityTier.Standard,
    contextWindow: 8_192,
    maxOutputTokens: 2_048,
    pricing: { inputPer1kTokens: 0.001, outputPer1kTokens: 0.002 },
    latencyProfile: { ttftMs: 200, tokensPerSecond: 50 },
    status: ModelStatus.Active,
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ─── ModelCandidate ───────────────────────────────────────────────────────────

export function aModelCandidate(overrides: Partial<ModelCandidate> = {}): ModelCandidate {
  const id = next("model-candidate");
  return {
    id,
    name: `test-model-${id}`,
    provider: ModelProvider.OpenAI,
    capabilities: [ModelCapability.TextGeneration],
    supportedTasks: [ModelTask.Chat],
    qualityTier: QualityTier.Standard,
    contextWindow: 8_192,
    maxOutputTokens: 2_048,
    pricing: { inputPer1kTokens: 0.001, outputPer1kTokens: 0.002 },
    latencyProfile: { ttftMs: 200, tokensPerSecond: 50 },
    status: ModelStatus.Active,
    ...overrides,
  };
}

// ─── Worker ───────────────────────────────────────────────────────────────────

export function aWorker(overrides: Partial<Worker> = {}): Worker {
  const id = next("worker") as WorkerId;
  const now = toIsoTimestamp();
  return {
    id,
    name: `test-worker-${id}`,
    endpoint: `http://worker-${id}.internal`,
    region: "us-east-1",
    status: WorkerStatus.Idle,
    hardware: { instanceType: "m5.xlarge" },
    supportedModelIds: [] as ModelId[],
    labels: {},
    capacity: { activeJobs: 0, maxConcurrentJobs: 4, queuedJobs: 0 },
    runtimeMetrics: {},
    lastHeartbeatAt: Date.now(),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ─── WorkerCandidate ──────────────────────────────────────────────────────────

export function aWorkerCandidate(overrides: Partial<WorkerCandidate> = {}): WorkerCandidate {
  const id = next("worker-candidate");
  return {
    id,
    name: `test-worker-${id}`,
    region: "us-east-1",
    status: WorkerStatus.Idle,
    hardware: { instanceType: "m5.xlarge" },
    supportedModelIds: [],
    labels: {},
    activeJobs: 0,
    maxConcurrentJobs: 4,
    queuedJobs: 0,
    availableSlots: 4,
    lastHeartbeatAt: Date.now(),
    ...overrides,
  };
}

// ─── Job ──────────────────────────────────────────────────────────────────────

export function aJob(overrides: Partial<Job> = {}): Job {
  const id = next("job") as JobId;
  const now = toIsoTimestamp();
  return {
    id,
    requestId: next("request") as RequestId,
    sourceType: JobSourceType.Live,
    status: JobStatus.Queued,
    priority: JobPriority.Normal,
    attempts: 1,
    maxAttempts: 3,
    queuedAt: Date.now(),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ─── InferenceRequest ─────────────────────────────────────────────────────────

export function anInferenceRequest(overrides: Partial<InferenceRequest> = {}): InferenceRequest {
  const id = next("request") as RequestId;
  const now = toIsoTimestamp();
  return {
    id,
    modelId: next("model") as ModelId,
    messages: [{ role: MessageRole.User, content: "Hello" }],
    params: { stream: false },
    routingHints: {},
    status: RequestStatus.Queued,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ─── RoutingPolicy ────────────────────────────────────────────────────────────

export function aRoutingPolicy(overrides: Partial<RoutingPolicy> = {}): RoutingPolicy {
  const id = next("policy") as PolicyId;
  const now = toIsoTimestamp();
  return {
    id,
    name: `test-policy-${id}`,
    strategy: RoutingStrategy.LeastLoaded,
    constraints: {},
    weights: { quality: 0.25, cost: 0.25, latency: 0.25, load: 0.25 },
    allowFallback: true,
    priority: 0,
    version: 1,
    status: RoutingPolicyStatus.Active,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ─── RoutingDecision ──────────────────────────────────────────────────────────

export function aRoutingDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  const id = next("decision") as DecisionId;
  const modelId = next("model") as ModelId;
  const workerId = next("worker") as WorkerId;
  const now = toIsoTimestamp();
  return {
    id,
    requestId: next("request") as RequestId,
    policyId: next("policy") as PolicyId,
    outcome: RoutingOutcome.Routed,
    selectedModelId: modelId,
    selectedWorkerId: workerId,
    strategy: RoutingStrategy.LeastLoaded,
    usedFallback: false,
    candidates: [],
    reason: "Lowest load score among eligible workers",
    decisionSource: DecisionSource.Live,
    decidedAt: Date.now(),
    evaluationMs: 5,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ─── WorkloadConfig ───────────────────────────────────────────────────────────

export function aWorkloadConfig(overrides: Partial<WorkloadConfig> = {}): WorkloadConfig {
  return {
    requestCount: 10,
    taskDistribution: { chat: 0.6, reasoning: 0.3, analysis: 0.1 },
    inputSizeDistribution: { small: 0.5, medium: 0.4, large: 0.1 },
    complexityDistribution: { low: 0.5, medium: 0.3, high: 0.2 },
    randomSeed: 42,
    ...overrides,
  };
}

// ─── ModelScoreResult ─────────────────────────────────────────────────────────

export function aModelScoreResult(overrides: Partial<ModelScoreResult> = {}): ModelScoreResult {
  const id = next("model-score");
  return {
    candidateId: id,
    candidateType: "model",
    eligible: true,
    disqualificationReasons: [],
    raw: {
      qualityTier: "standard",
      ttftMs: 200,
      capabilityMatchCount: 1,
      capabilityRequiredCount: 1,
      contextWindow: 8_192,
    },
    scores: {
      quality: 0.5,
      cost: 0.8,
      latency: 0.7,
      capabilityFit: 1.0,
      contextWindowSufficiency: 1.0,
    },
    contributions: { quality: 0.175, cost: 0.2, latency: 0.175, capabilityFit: 0.15 },
    totalScore: 0.7,
    explanation: ["quality: standard tier (0.50)", "cost: low estimated cost (0.80)"],
    ...overrides,
  };
}

// ─── WorkerScoreResult ────────────────────────────────────────────────────────

export function aWorkerScoreResult(overrides: Partial<WorkerScoreResult> = {}): WorkerScoreResult {
  const id = next("worker-score");
  return {
    candidateId: id,
    candidateType: "worker",
    eligible: true,
    disqualificationReasons: [],
    raw: {
      queuedJobs: 0,
      maxConcurrentJobs: 4,
      status: "idle",
      region: "us-east-1",
      heartbeatAgeMs: 5_000,
    },
    scores: {
      load: 1.0,
      queueDepth: 1.0,
      throughput: 0.5,
      latency: 0.5,
      healthFitness: 1.0,
      regionFit: 1.0,
      heartbeatFreshness: 1.0,
    },
    contributions: { load: 0.3, queueDepth: 0.2, healthFitness: 0.1, regionFit: 0.05, heartbeatFreshness: 0.05 },
    totalScore: 0.85,
    explanation: ["load: idle (1.00)", "queue: 0 queued jobs (1.00)"],
    ...overrides,
  };
}
