/**
 * scripts/seed.ts — Demo seed script
 *
 * Seeds a running InferMesh server with realistic demo data:
 *   - 3 AI models  (GPT-4o, Claude 3.5 Haiku, Llama 3.1 8B)
 *   - 3 workers    (high-end GPU, mid-tier GPU, CPU-only)
 *   - 1 routing policy (cost-optimised, active)
 *   - 5 inference requests across different task types
 *   - Routes 3 jobs through the routing engine
 *   - Prints a state summary
 *
 * Usage:
 *   npm run seed                           — targets http://localhost:3000
 *   INFERMESH_URL=http://host:3000 npm run seed
 *
 * Prerequisites:
 *   Server must be running: npm run dev
 */

const BASE = (process.env.INFERMESH_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function post<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { success: boolean; data: T; error?: { message: string } };
  if (!json.success) {
    throw new Error(`POST ${path} failed: ${json.error?.message ?? res.status}`);
  }
  return json.data;
}

async function patch<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { success: boolean; data: T; error?: { message: string } };
  if (!json.success) {
    throw new Error(`PATCH ${path} failed: ${json.error?.message ?? res.status}`);
  }
  return json.data;
}

async function get<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  const json = (await res.json()) as { success: boolean; data: T; error?: { message: string } };
  if (!json.success) {
    throw new Error(`GET ${path} failed: ${json.error?.message ?? res.status}`);
  }
  return json.data;
}

// ─── Logging helpers ──────────────────────────────────────────────────────────

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

function step(label: string) {
  process.stdout.write(`  ${yellow("▸")} ${label} … `);
}
function ok(detail = "") {
  console.log(green("✓") + (detail ? dim(` ${detail}`) : ""));
}

// ─── Seed data ────────────────────────────────────────────────────────────────

const MODELS = [
  {
    name: "gpt-4o",
    aliases: ["gpt-4o-2024-11-20", "gpt-4o-latest"],
    provider: "openai",
    version: "2024-11-20",
    capabilities: ["text_generation", "tool_use", "vision", "code_generation"],
    supportedTasks: ["chat", "coding", "reasoning"],
    qualityTier: "frontier",
    contextWindow: 128000,
    maxOutputTokens: 16384,
    pricing: { inputPer1kTokens: 0.0025, outputPer1kTokens: 0.01 },
    latencyProfile: { ttftMs: 350, tokensPerSecond: 110 },
    metadata: { provider_url: "https://platform.openai.com" },
  },
  {
    name: "claude-3-5-haiku",
    aliases: ["claude-haiku", "claude-3-5-haiku-20241022"],
    provider: "anthropic",
    version: "20241022",
    capabilities: ["text_generation", "tool_use", "code_generation"],
    supportedTasks: ["chat", "summarization", "extraction", "classification"],
    qualityTier: "standard",
    contextWindow: 200000,
    maxOutputTokens: 8192,
    pricing: { inputPer1kTokens: 0.0008, outputPer1kTokens: 0.004 },
    latencyProfile: { ttftMs: 220, tokensPerSecond: 180 },
    metadata: { provider_url: "https://console.anthropic.com" },
  },
  {
    name: "llama-3-1-8b",
    aliases: ["llama-3.1-8b", "meta-llama-3.1-8b-instruct"],
    provider: "meta",
    version: "3.1",
    capabilities: ["text_generation", "code_generation"],
    supportedTasks: ["chat", "classification", "summarization"],
    qualityTier: "economy",
    contextWindow: 128000,
    maxOutputTokens: 4096,
    pricing: { inputPer1kTokens: 0.00018, outputPer1kTokens: 0.00018 },
    latencyProfile: { ttftMs: 150, tokensPerSecond: 280 },
    metadata: { self_hosted: true, quantization: "q4_k_m" },
  },
] as const;

function buildWorkers(modelIds: string[]) {
  const [gpt4oId, claudeId, llamaId] = modelIds;
  return [
    {
      name: "gpu-worker-a",
      endpoint: "http://gpu-worker-a.internal:8080",
      supportedModelIds: [gpt4oId, claudeId],
      region: "us-east-1",
      hardware: { instanceType: "p4d.24xlarge", gpuModel: "NVIDIA A100 80GB" },
      capacity: { activeJobs: 1, maxConcurrentJobs: 8, queuedJobs: 0 },
      labels: { tier: "premium", team: "platform" },
    },
    {
      name: "gpu-worker-b",
      endpoint: "http://gpu-worker-b.internal:8080",
      supportedModelIds: [claudeId, llamaId],
      region: "us-east-1",
      hardware: { instanceType: "g6.xlarge", gpuModel: "NVIDIA L4" },
      capacity: { activeJobs: 3, maxConcurrentJobs: 6, queuedJobs: 1 },
      labels: { tier: "standard", team: "platform" },
    },
    {
      name: "cpu-worker-c",
      endpoint: "http://cpu-worker-c.internal:8080",
      supportedModelIds: [llamaId],
      region: "us-west-2",
      hardware: { instanceType: "m7i.4xlarge" },
      capacity: { activeJobs: 0, maxConcurrentJobs: 4, queuedJobs: 0 },
      labels: { tier: "economy", team: "batch" },
    },
  ];
}

const INTAKE_REQUESTS = [
  {
    endpoint: "gpt-4o",
    taskType: "chat",
    input: {
      messages: [{ role: "user", content: "Explain transformer attention in one paragraph." }],
    },
    inputSize: 24,
    estimatedComplexity: "medium",
    priority: "normal",
  },
  {
    endpoint: "claude-3-5-haiku",
    taskType: "summarization",
    input: {
      document: "InferMesh is a policy-driven routing backend for AI inference workloads…",
    },
    inputSize: 512,
    estimatedComplexity: "low",
    priority: "normal",
  },
  {
    endpoint: "llama-3-1-8b",
    taskType: "classification",
    input: {
      text: "This pull request adds retry logic to the routing recovery service.",
      labels: ["bug", "feature", "refactor", "docs"],
    },
    inputSize: 64,
    estimatedComplexity: "low",
    priority: "low",
  },
  {
    endpoint: "gpt-4o",
    taskType: "coding",
    input: {
      prompt: "Write a TypeScript function that implements exponential backoff.",
      language: "typescript",
    },
    inputSize: 32,
    estimatedComplexity: "high",
    priority: "high",
  },
  {
    endpoint: "claude-3-5-haiku",
    taskType: "extraction",
    input: {
      text: "Invoice #1042, issued 2026-01-15, total: $4,280.00, vendor: Acme Corp.",
    },
    inputSize: 48,
    estimatedComplexity: "low",
    priority: "normal",
  },
] as const;

// ─── Main ─────────────────────────────────────────────────────────────────────

async function seed(): Promise<void> {
  console.log();
  console.log(bold("InferMesh demo seed"));
  console.log(dim(`  targeting ${BASE}`));
  console.log();

  // ── 0. Verify server is reachable ──────────────────────────────────────────
  step("Checking server health");
  await get("/health");
  ok();

  // ── 1. Register models ─────────────────────────────────────────────────────
  console.log(bold("\n  Models"));
  const modelIds: string[] = [];
  for (const m of MODELS) {
    step(m.name);
    const data = await post<{ id: string }>("/api/v1/models", m);
    modelIds.push(data.id);
    ok(data.id);
  }

  // ── 2. Register workers ────────────────────────────────────────────────────
  console.log(bold("\n  Workers"));
  const workerIds: string[] = [];
  for (const w of buildWorkers(modelIds)) {
    step(w.name);
    const data = await post<{ id: string }>("/api/v1/workers", w);
    workerIds.push(data.id);
    ok(data.id);
  }

  // ── 3. Create routing policy ───────────────────────────────────────────────
  console.log(bold("\n  Routing policy"));
  step("cost-optimised");
  const policy = await post<{ id: string; status: string }>("/api/v1/routing/policies", {
    name: "cost-optimised",
    description: "Prefer the lowest-cost candidate that satisfies constraints",
    strategy: "cost_optimised",
    constraints: { maxCostUsd: 0.10, maxLatencyMs: 8000 },
    weights: { quality: 0.1, cost: 0.6, latency: 0.2, load: 0.1 },
    allowFallback: true,
    fallbackStrategy: "least_loaded",
    priority: 10,
  });
  ok(`id=${policy.id}  status=${policy.status}`);

  step("activating policy");
  await patch(`/api/v1/routing/policies/${policy.id}`, { status: "active" });
  ok("active");

  // ── 4. Submit inference requests ───────────────────────────────────────────
  console.log(bold("\n  Inference requests"));
  const jobIds: string[] = [];
  for (const req of INTAKE_REQUESTS) {
    step(`${req.taskType} → ${req.endpoint}`);
    const data = await post<{ requestId: string; jobId: string; jobStatus: string }>(
      "/api/v1/intake/requests",
      req,
    );
    jobIds.push(data.jobId);
    ok(`job=${data.jobId}  status=${data.jobStatus}`);
  }

  // ── 5. Route jobs ──────────────────────────────────────────────────────────
  console.log(bold("\n  Routing jobs"));
  const toRoute = jobIds.slice(0, 3);
  for (const jobId of toRoute) {
    step(`route job ${jobId}`);
    try {
      const data = await post<{ outcome: string; selectedModelId?: string; selectedWorkerId?: string }>(
        `/api/v1/jobs/${jobId}/route`,
        {},
      );
      const outcome = data.outcome ?? "routed";
      const model = data.selectedModelId ?? "—";
      const worker = data.selectedWorkerId ?? "—";
      ok(`outcome=${outcome}  model=${model}  worker=${worker}`);
    } catch (err) {
      // Routing may fail if policy/worker state is not fully compatible —
      // this is non-fatal for a demo seed.
      console.log(yellow("⚠") + dim(` skipped — ${(err as Error).message}`));
    }
  }

  // ── 6. Print summary ───────────────────────────────────────────────────────
  console.log(bold("\n  System summary"));
  const stats = await get<Record<string, unknown>>("/api/v1/stats/summary");
  console.log(
    "  " +
      Object.entries(stats)
        .map(([k, v]) => `${dim(k)}: ${bold(String(v))}`)
        .join("  |  "),
  );

  console.log();
  console.log(green("✓") + bold("  Seed complete."));
  console.log(dim("  Try: curl http://localhost:3000/api/v1/routing/decisions | jq ."));
  console.log(dim("  Try: curl http://localhost:3000/api/v1/stats/summary | jq .data"));
  console.log();
}

seed().catch((err: unknown) => {
  console.error("\n" + bold("\x1b[31m✗  Seed failed\x1b[0m"), (err as Error).message);
  console.error(
    dim("  Is the server running?  npm run dev  →  then retry: npm run seed"),
  );
  process.exit(1);
});
