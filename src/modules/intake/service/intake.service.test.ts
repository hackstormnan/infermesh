/**
 * modules/intake/service/intake.service.test.ts
 *
 * Unit tests for IntakeService with a focus on stream event publishing.
 *
 * Tests cover:
 *   - broker.publish() is called exactly once on a successful intake
 *   - published payload matches the RequestAcceptedPayload UI spec exactly
 *   - payload fields are derived from the correct sources (linked request, intake body)
 *   - publish is NOT called when no broker is provided (backward compat)
 *   - a broker error does NOT propagate or abort the intake flow
 *   - the IntakeResponseDto returned is unaffected by broker presence/absence
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { IntakeService } from "./intake.service";
import type { RequestsService } from "../../requests/service/requests.service";
import type { JobsService } from "../../jobs/service/jobs.service";
import type { QueueService } from "../../queue/service/queue.service";
import type { IStreamBroker } from "../../../stream/broker/IStreamBroker";
import type { RequestAcceptedPayload } from "../../../stream/contract";
import type { RequestContext } from "../../../core/context";
import type { InferenceRequest } from "../../../shared/contracts/request";
import { RequestStatus } from "../../../shared/contracts/request";
import { JobStatus, JobPriority, JobSourceType } from "../../../shared/contracts/job";
import type { RequestId, JobId, IsoTimestamp } from "../../../shared/primitives";
import type { IntakeRequestBody } from "../dto";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FIXED_REQUEST_ID = "req-test-001" as RequestId;
const FIXED_JOB_ID     = "job-test-001" as JobId;
const FIXED_QUEUE_ID   = "msg-test-001";
const FIXED_TIMESTAMP  = "2026-01-15T12:00:00.000Z" as IsoTimestamp;
const FIXED_ENQUEUED   = 1737000000000;

const INTAKE_BODY: IntakeRequestBody = {
  endpoint:            "gpt-4o",
  taskType:            "chat",
  input:               { prompt: "Hello" },
  inputSize:           10,
  estimatedComplexity: "medium",
  priority:            "normal",
};

/** The linked request returned by requestsService.updateStatus() */
const LINKED_REQUEST: InferenceRequest = {
  id:          FIXED_REQUEST_ID,
  modelId:     "gpt-4o" as ReturnType<typeof FIXED_REQUEST_ID.slice>,
  messages:    [],
  params:      { stream: false },
  routingHints: {},
  status:      RequestStatus.Dispatched,
  jobId:       FIXED_JOB_ID,
  createdAt:   FIXED_TIMESTAMP,
  updatedAt:   FIXED_TIMESTAMP,
};

// ─── Minimal mock context ─────────────────────────────────────────────────────

function makeCtx(): RequestContext {
  return {
    requestId: "ctx-req-id",
    log: {
      info:  vi.fn(),
      debug: vi.fn(),
      warn:  vi.fn(),
      error: vi.fn(),
    },
  } as unknown as RequestContext;
}

// ─── Service mock factories ───────────────────────────────────────────────────

function makeRequestsService(): RequestsService {
  return {
    create: vi.fn().mockResolvedValue({
      ...LINKED_REQUEST,
      status: RequestStatus.Queued,
      jobId:  undefined,
    }),
    updateStatus: vi.fn().mockResolvedValue(LINKED_REQUEST),
  } as unknown as RequestsService;
}

function makeJobsService(): JobsService {
  return {
    createJob: vi.fn().mockResolvedValue({
      id:         FIXED_JOB_ID,
      requestId:  FIXED_REQUEST_ID,
      status:     JobStatus.Queued,
      priority:   JobPriority.Normal,
      sourceType: JobSourceType.Live,
      attempts:   0,
      maxAttempts: 3,
      createdAt:  FIXED_TIMESTAMP,
      updatedAt:  FIXED_TIMESTAMP,
    }),
  } as unknown as JobsService;
}

function makeQueueService(): QueueService {
  return {
    enqueueJob: vi.fn().mockResolvedValue({
      id:         FIXED_QUEUE_ID,
      jobId:      FIXED_JOB_ID,
      status:     "pending",
      enqueuedAt: FIXED_ENQUEUED,
    }),
  } as unknown as QueueService;
}

function makeBroker(): IStreamBroker & { publish: ReturnType<typeof vi.fn> } {
  return { publish: vi.fn() };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("IntakeService — stream publishing", () => {
  let requestsService: ReturnType<typeof makeRequestsService>;
  let jobsService: ReturnType<typeof makeJobsService>;
  let queueService: ReturnType<typeof makeQueueService>;
  let broker: ReturnType<typeof makeBroker>;
  let ctx: RequestContext;

  beforeEach(() => {
    requestsService = makeRequestsService();
    jobsService     = makeJobsService();
    queueService    = makeQueueService();
    broker          = makeBroker();
    ctx             = makeCtx();
  });

  // ── Broker invocation ──────────────────────────────────────────────────────

  it("calls broker.publish exactly once on a successful intake", async () => {
    const service = new IntakeService(requestsService, jobsService, queueService, broker);
    await service.intake(ctx, INTAKE_BODY);
    expect(broker.publish).toHaveBeenCalledOnce();
  });

  it("publishes to the 'requests' channel", async () => {
    const service = new IntakeService(requestsService, jobsService, queueService, broker);
    await service.intake(ctx, INTAKE_BODY);
    const [channel] = broker.publish.mock.calls[0];
    expect(channel).toBe("requests");
  });

  it("does NOT call broker.publish when no broker is provided", async () => {
    const service = new IntakeService(requestsService, jobsService, queueService);
    // Should complete without errors and without touching any broker
    await expect(service.intake(ctx, INTAKE_BODY)).resolves.toBeDefined();
  });

  // ── Payload shape (UI spec alignment) ────────────────────────────────────────

  it("payload.id equals the linked request ID", async () => {
    const service = new IntakeService(requestsService, jobsService, queueService, broker);
    await service.intake(ctx, INTAKE_BODY);
    const payload = broker.publish.mock.calls[0][1] as RequestAcceptedPayload;
    expect(payload.id).toBe(FIXED_REQUEST_ID);
  });

  it("payload.timestamp equals linked.createdAt (ISO string)", async () => {
    const service = new IntakeService(requestsService, jobsService, queueService, broker);
    await service.intake(ctx, INTAKE_BODY);
    const payload = broker.publish.mock.calls[0][1] as RequestAcceptedPayload;
    expect(payload.timestamp).toBe(FIXED_TIMESTAMP);
    // Must be a valid ISO 8601 date
    expect(() => new Date(payload.timestamp)).not.toThrow();
    expect(isNaN(new Date(payload.timestamp).getTime())).toBe(false);
  });

  it("payload.model equals the intake body endpoint (model identifier)", async () => {
    const service = new IntakeService(requestsService, jobsService, queueService, broker);
    await service.intake(ctx, INTAKE_BODY);
    const payload = broker.publish.mock.calls[0][1] as RequestAcceptedPayload;
    expect(payload.model).toBe(INTAKE_BODY.endpoint); // "gpt-4o"
  });

  it("payload.latency is 0 at acceptance time (not yet measured)", async () => {
    const service = new IntakeService(requestsService, jobsService, queueService, broker);
    await service.intake(ctx, INTAKE_BODY);
    const payload = broker.publish.mock.calls[0][1] as RequestAcceptedPayload;
    expect(payload.latency).toBe(0);
    expect(typeof payload.latency).toBe("number");
  });

  it("payload.status is 'pending' at acceptance time", async () => {
    const service = new IntakeService(requestsService, jobsService, queueService, broker);
    await service.intake(ctx, INTAKE_BODY);
    const payload = broker.publish.mock.calls[0][1] as RequestAcceptedPayload;
    expect(payload.status).toBe("pending");
  });

  it("payload.endpoint is the canonical intake API path", async () => {
    const service = new IntakeService(requestsService, jobsService, queueService, broker);
    await service.intake(ctx, INTAKE_BODY);
    const payload = broker.publish.mock.calls[0][1] as RequestAcceptedPayload;
    expect(payload.endpoint).toBe("/api/v1/inference/requests");
  });

  it("payload has exactly the required UI-spec fields (no extra fields)", async () => {
    const service = new IntakeService(requestsService, jobsService, queueService, broker);
    await service.intake(ctx, INTAKE_BODY);
    const payload = broker.publish.mock.calls[0][1] as RequestAcceptedPayload;
    const keys = Object.keys(payload).sort();
    expect(keys).toEqual(["endpoint", "id", "latency", "model", "status", "timestamp"]);
  });

  it("payload reflects a different model when intake body uses a different endpoint", async () => {
    const bodyWithAltModel: IntakeRequestBody = { ...INTAKE_BODY, endpoint: "llama-3-70b" };
    const service = new IntakeService(requestsService, jobsService, queueService, broker);
    await service.intake(ctx, bodyWithAltModel);
    const payload = broker.publish.mock.calls[0][1] as RequestAcceptedPayload;
    expect(payload.model).toBe("llama-3-70b");
  });

  // ── Publish timing (after request AND job are created) ────────────────────

  it("publish is called after both request and job records are created", async () => {
    const callOrder: string[] = [];
    requestsService.create = vi.fn().mockImplementation(async () => {
      callOrder.push("create-request");
      return { ...LINKED_REQUEST, status: RequestStatus.Queued };
    });
    jobsService.createJob = vi.fn().mockImplementation(async () => {
      callOrder.push("create-job");
      return { id: FIXED_JOB_ID, status: JobStatus.Queued };
    });
    broker.publish = vi.fn().mockImplementation(() => {
      callOrder.push("publish");
    });

    const service = new IntakeService(requestsService, jobsService, queueService, broker);
    await service.intake(ctx, INTAKE_BODY);

    const createReqIdx = callOrder.indexOf("create-request");
    const createJobIdx = callOrder.indexOf("create-job");
    const publishIdx   = callOrder.indexOf("publish");

    expect(publishIdx).toBeGreaterThan(createReqIdx);
    expect(publishIdx).toBeGreaterThan(createJobIdx);
  });

  // ── Resilience: broker failure must not abort intake ─────────────────────

  it("a broker.publish() exception does NOT propagate — intake still returns successfully", async () => {
    broker.publish.mockImplementationOnce(() => {
      throw new Error("broker connection lost");
    });

    const service = new IntakeService(requestsService, jobsService, queueService, broker);
    const result = await service.intake(ctx, INTAKE_BODY);

    // Intake should still return a valid response
    expect(result.requestId).toBe(FIXED_REQUEST_ID);
    expect(result.jobId).toBe(FIXED_JOB_ID);
  });

  // ── IntakeResponseDto unaffected by broker ────────────────────────────────

  it("returns the same IntakeResponseDto regardless of broker presence", async () => {
    const withBroker    = new IntakeService(requestsService, jobsService, queueService, broker);
    const withoutBroker = new IntakeService(requestsService, jobsService, queueService);

    const resultWith    = await withBroker.intake(ctx, INTAKE_BODY);
    const resultWithout = await withoutBroker.intake(makeCtx(), INTAKE_BODY);

    expect(resultWith.requestId).toBe(resultWithout.requestId);
    expect(resultWith.jobId).toBe(resultWithout.jobId);
    expect(resultWith.queueMessageId).toBe(resultWithout.queueMessageId);
    expect(resultWith.status).toBe(resultWithout.status);
  });
});
