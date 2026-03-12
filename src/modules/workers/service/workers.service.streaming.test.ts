/**
 * modules/workers/service/workers.service.streaming.test.ts
 *
 * Unit tests for WorkersService — stream event publishing.
 *
 * Tests cover:
 *   - broker.publish() called exactly once after register()
 *   - broker.publish() called exactly once after heartbeat()
 *   - broker.publish() called exactly once after deregister()
 *   - all three publish to the "workers" channel
 *   - payload shape matches WorkerStatusPayload UI spec
 *   - status mapping: Idle/Busy → "healthy", Draining/Unhealthy → "degraded", Offline → "offline"
 *   - publish NOT called when no broker is provided (backward compat)
 *   - broker error does NOT propagate or abort the operation
 *   - register/heartbeat/deregister return same DTOs regardless of broker
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestContext } from "../../../core/context";
import { WorkerStatus } from "../../../shared/contracts/worker";
import type { RegisterWorkerDto, WorkerHeartbeatDto } from "../../../shared/contracts/worker";
import type { WorkerId } from "../../../shared/primitives";
import type { IStreamBroker } from "../../../stream/broker/IStreamBroker";
import type { WorkerStatusPayload } from "../../../stream/contract";
import type { IWorkerRepository } from "../repository/IWorkerRepository";
import { WorkersService } from "./workers.service";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WORKER_ID = "worker-001" as WorkerId;

function makeRegisterDto(overrides: Partial<RegisterWorkerDto> = {}): RegisterWorkerDto {
  return {
    name: "test-worker",
    endpoint: "http://localhost:9000",
    supportedModelIds: ["model-gpt4o"],
    region: "us-east-1",
    hardware: { instanceType: "g4dn.xlarge" },
    capacity: { activeJobs: 0, maxConcurrentJobs: 10, queuedJobs: 0 },
    labels: {},
    ...overrides,
  };
}

function makeHeartbeatDto(overrides: Partial<WorkerHeartbeatDto> = {}): WorkerHeartbeatDto {
  return {
    status: WorkerStatus.Busy,
    capacity: { activeJobs: 3, maxConcurrentJobs: 10, queuedJobs: 1 },
    reportedAt: Date.now(),
    runtimeMetrics: {
      cpuUsagePercent: 72,
      memoryUsagePercent: 55,
      ttftMs: 180,
      tokensPerSecond: 85,
      loadScore: 0.4,
    },
    ...overrides,
  };
}

// ─── Mock factories ───────────────────────────────────────────────────────────

function makeRepo(): IWorkerRepository {
  const workerStore = new Map<string, ReturnType<typeof makeWorkerEntity>>();

  function makeWorkerEntity(dto: RegisterWorkerDto, id: string) {
    return {
      id: id as WorkerId,
      name: dto.name,
      endpoint: dto.endpoint,
      supportedModelIds: dto.supportedModelIds as any,
      region: dto.region ?? "default",
      hardware: dto.hardware,
      status: WorkerStatus.Idle,
      capacity: dto.capacity,
      lastHeartbeatAt: Date.now(),
      runtimeMetrics: {},
      labels: dto.labels ?? {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  const repo = {
    create: vi.fn().mockImplementation(async (worker: any) => {
      workerStore.set(worker.id, worker);
      return worker;
    }),
    findByName: vi.fn().mockResolvedValue(null),
    findById: vi.fn().mockImplementation(async (id: string) => workerStore.get(id) ?? null),
    update: vi.fn().mockImplementation(async (id: string, patch: any) => {
      const existing = workerStore.get(id) ?? makeWorkerEntity(makeRegisterDto(), id);
      const updated = { ...existing, ...patch };
      workerStore.set(id, updated);
      return updated;
    }),
    list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20, hasMore: false }),
  } as unknown as IWorkerRepository;

  return repo;
}

function makeBroker(): IStreamBroker & { publish: ReturnType<typeof vi.fn> } {
  return { publish: vi.fn() };
}

const ctx = buildTestContext();

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("WorkersService — stream publishing", () => {
  let repo: IWorkerRepository;
  let broker: ReturnType<typeof makeBroker>;

  beforeEach(() => {
    repo = makeRepo();
    broker = makeBroker();
  });

  // ── register() ─────────────────────────────────────────────────────────────

  describe("register()", () => {
    it("calls broker.publish exactly once", async () => {
      const svc = new WorkersService(repo, broker);
      await svc.register(ctx, makeRegisterDto());
      expect(broker.publish).toHaveBeenCalledOnce();
    });

    it("publishes to the 'workers' channel", async () => {
      const svc = new WorkersService(repo, broker);
      await svc.register(ctx, makeRegisterDto());
      const [channel] = broker.publish.mock.calls[0];
      expect(channel).toBe("workers");
    });

    it("payload.event is 'registered'", async () => {
      const svc = new WorkersService(repo, broker);
      await svc.register(ctx, makeRegisterDto());
      const payload = broker.publish.mock.calls[0][1] as WorkerStatusPayload;
      expect(payload.event).toBe("registered");
    });

    it("payload.status is 'healthy' for a freshly registered (Idle) worker", async () => {
      const svc = new WorkersService(repo, broker);
      await svc.register(ctx, makeRegisterDto());
      const payload = broker.publish.mock.calls[0][1] as WorkerStatusPayload;
      expect(payload.status).toBe("healthy");
    });

    it("payload.name matches the registered worker name", async () => {
      const svc = new WorkersService(repo, broker);
      await svc.register(ctx, makeRegisterDto({ name: "my-worker" }));
      const payload = broker.publish.mock.calls[0][1] as WorkerStatusPayload;
      expect(payload.name).toBe("my-worker");
    });

    it("payload.queueSize matches the registration capacity.queuedJobs", async () => {
      const svc = new WorkersService(repo, broker);
      await svc.register(ctx, makeRegisterDto());
      const payload = broker.publish.mock.calls[0][1] as WorkerStatusPayload;
      expect(payload.queueSize).toBe(0);
    });

    it("does NOT call broker when no broker is provided", async () => {
      const svc = new WorkersService(repo);
      await expect(svc.register(ctx, makeRegisterDto())).resolves.toBeDefined();
      // no assertion — if broker were accessed it would throw
    });

    it("broker error does NOT propagate — register still returns the DTO", async () => {
      broker.publish.mockImplementationOnce(() => { throw new Error("broker down"); });
      const svc = new WorkersService(repo, broker);
      const dto = await svc.register(ctx, makeRegisterDto({ name: "worker-x" }));
      expect(dto.name).toBe("worker-x");
    });
  });

  // ── heartbeat() ────────────────────────────────────────────────────────────

  describe("heartbeat()", () => {
    it("calls broker.publish exactly once", async () => {
      const svc = new WorkersService(repo, broker);
      await svc.heartbeat(ctx, WORKER_ID, makeHeartbeatDto());
      expect(broker.publish).toHaveBeenCalledOnce();
    });

    it("publishes to the 'workers' channel", async () => {
      const svc = new WorkersService(repo, broker);
      await svc.heartbeat(ctx, WORKER_ID, makeHeartbeatDto());
      const [channel] = broker.publish.mock.calls[0];
      expect(channel).toBe("workers");
    });

    it("payload.event is 'heartbeat'", async () => {
      const svc = new WorkersService(repo, broker);
      await svc.heartbeat(ctx, WORKER_ID, makeHeartbeatDto());
      const payload = broker.publish.mock.calls[0][1] as WorkerStatusPayload;
      expect(payload.event).toBe("heartbeat");
    });

    it("payload.status is 'healthy' for a Busy worker", async () => {
      const svc = new WorkersService(repo, broker);
      await svc.heartbeat(ctx, WORKER_ID, makeHeartbeatDto({ status: WorkerStatus.Busy }));
      const payload = broker.publish.mock.calls[0][1] as WorkerStatusPayload;
      expect(payload.status).toBe("healthy");
    });

    it("payload carries runtime metrics from the heartbeat", async () => {
      const svc = new WorkersService(repo, broker);
      await svc.heartbeat(ctx, WORKER_ID, makeHeartbeatDto());
      const payload = broker.publish.mock.calls[0][1] as WorkerStatusPayload;
      expect(payload.cpu).toBe(72);
      expect(payload.memory).toBe(55);
      expect(payload.latency).toBe(180);
      expect(payload.throughput).toBe(85);
      expect(payload.loadScore).toBe(0.4);
      expect(payload.queueSize).toBe(1);
    });

    it("does NOT call broker when no broker is provided", async () => {
      const svc = new WorkersService(repo);
      await expect(svc.heartbeat(ctx, WORKER_ID, makeHeartbeatDto())).resolves.toBeDefined();
    });

    it("broker error does NOT propagate — heartbeat still returns the DTO", async () => {
      broker.publish.mockImplementationOnce(() => { throw new Error("broker down"); });
      const svc = new WorkersService(repo, broker);
      const dto = await svc.heartbeat(ctx, WORKER_ID, makeHeartbeatDto());
      expect(dto).toBeDefined();
    });
  });

  // ── deregister() ───────────────────────────────────────────────────────────

  describe("deregister()", () => {
    it("calls broker.publish exactly once", async () => {
      const svc = new WorkersService(repo, broker);
      await svc.deregister(ctx, WORKER_ID);
      expect(broker.publish).toHaveBeenCalledOnce();
    });

    it("publishes to the 'workers' channel", async () => {
      const svc = new WorkersService(repo, broker);
      await svc.deregister(ctx, WORKER_ID);
      const [channel] = broker.publish.mock.calls[0];
      expect(channel).toBe("workers");
    });

    it("payload.event is 'deregistered'", async () => {
      const svc = new WorkersService(repo, broker);
      await svc.deregister(ctx, WORKER_ID);
      const payload = broker.publish.mock.calls[0][1] as WorkerStatusPayload;
      expect(payload.event).toBe("deregistered");
    });

    it("payload.status is 'offline' after deregistration", async () => {
      const svc = new WorkersService(repo, broker);
      await svc.deregister(ctx, WORKER_ID);
      const payload = broker.publish.mock.calls[0][1] as WorkerStatusPayload;
      expect(payload.status).toBe("offline");
    });

    it("does NOT call broker when no broker is provided", async () => {
      const svc = new WorkersService(repo);
      await expect(svc.deregister(ctx, WORKER_ID)).resolves.toBeDefined();
    });

    it("broker error does NOT propagate — deregister still returns the DTO", async () => {
      broker.publish.mockImplementationOnce(() => { throw new Error("broker down"); });
      const svc = new WorkersService(repo, broker);
      const dto = await svc.deregister(ctx, WORKER_ID);
      expect(dto).toBeDefined();
    });
  });

  // ── Status mapping ─────────────────────────────────────────────────────────

  describe("status mapping", () => {
    it.each([
      [WorkerStatus.Idle,      "healthy"],
      [WorkerStatus.Busy,      "healthy"],
      [WorkerStatus.Draining,  "degraded"],
      [WorkerStatus.Unhealthy, "degraded"],
      [WorkerStatus.Offline,   "offline"],
    ] as const)("WorkerStatus.%s → '%s'", async (workerStatus, expectedStreamStatus) => {
      const svc = new WorkersService(repo, broker);
      await svc.heartbeat(ctx, WORKER_ID, makeHeartbeatDto({ status: workerStatus }));
      const payload = broker.publish.mock.calls[0][1] as WorkerStatusPayload;
      expect(payload.status).toBe(expectedStreamStatus);
    });
  });

  // ── Payload shape ──────────────────────────────────────────────────────────

  describe("payload shape", () => {
    it("heartbeat payload has the required top-level fields", async () => {
      const svc = new WorkersService(repo, broker);
      await svc.heartbeat(ctx, WORKER_ID, makeHeartbeatDto());
      const payload = broker.publish.mock.calls[0][1] as WorkerStatusPayload;
      expect(payload).toHaveProperty("workerId");
      expect(payload).toHaveProperty("status");
      expect(payload).toHaveProperty("queueSize");
      expect(payload).toHaveProperty("name");
      expect(payload).toHaveProperty("lastHeartbeat");
      expect(payload).toHaveProperty("event");
    });

    it("register and heartbeat return consistent DTOs regardless of broker", async () => {
      const withBroker    = new WorkersService(repo, broker);
      const withoutBroker = new WorkersService(repo);

      const dto1 = await withBroker.register(ctx, makeRegisterDto({ name: "w-1" }));
      const dto2 = await withoutBroker.register(ctx, makeRegisterDto({ name: "w-2" }));

      expect(dto1.status).toBe(dto2.status);
      expect(dto1.hardware).toEqual(dto2.hardware);
    });
  });
});
