/**
 * modules/intake/service/intake.service.ts
 *
 * Application-level orchestrator for the inference intake flow.
 *
 * The IntakeService sits above the domain modules. Its responsibility is
 * coordinating the writes that make up a complete intake:
 *
 * ─── Intake sequence ─────────────────────────────────────────────────────────
 *   1. Map the external IntakeRequestBody to a CreateInferenceRequestDto and
 *      persist a new InferenceRequest (status: Queued).
 *   2. Create a new Job linked to that request (status: Queued).
 *   3. Enqueue the job so the routing engine can pick it up asynchronously.
 *   4. Advance the InferenceRequest to Dispatched, stamping the jobId.
 *   5. Publish a "requests" stream event so dashboard subscribers receive
 *      a real-time notification of the new accepted request.
 *   6. Return an IntakeResponseDto with requestId, jobId, queueMessageId,
 *      statuses, createdAt, and enqueuedAt.
 *
 * ─── Stream publishing ────────────────────────────────────────────────────────
 *   If a stream broker is provided, a RequestAcceptedPayload is published to
 *   the "requests" channel after step 4. The broker is optional so the service
 *   can be used in tests and contexts without a live WebSocket gateway.
 *   Publishing is best-effort: a broker failure does NOT abort the intake.
 *
 * ─── Future extension points ──────────────────────────────────────────────────
 *   - Step 3 will call jobLifecycleService.moveToRouting() when a dequeue
 *     processor is wired and begins consuming the queue.
 *   - A transactional wrapper or saga pattern can be added here when atomicity
 *     across durable stores becomes a requirement.
 */

import type { RequestContext } from "../../../core/context";
import type { CreateInferenceRequestDto } from "../../../shared/contracts/request";
import { MessageRole, RequestStatus } from "../../../shared/contracts/request";
import { JobPriority, JobSourceType } from "../../../shared/contracts/job";
import type { IStreamBroker } from "../../../stream/broker/IStreamBroker";
import type { RequestAcceptedPayload } from "../../../stream/contract";
import type { JobsService } from "../../jobs/service/jobs.service";
import type { RequestsService } from "../../requests/service/requests.service";
import type { QueueService } from "../../queue/service/queue.service";
import type { IntakeRequestBody, IntakeResponseDto } from "../dto";

/** The canonical intake endpoint path — included in every request stream event */
const INTAKE_ENDPOINT = "/api/v1/inference/requests" as const;

// ─── Priority mapping ─────────────────────────────────────────────────────────

function mapPriority(priority: "low" | "normal" | "high"): JobPriority {
  switch (priority) {
    case "low":    return JobPriority.Low;
    case "high":   return JobPriority.High;
    default:       return JobPriority.Normal;
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class IntakeService {
  constructor(
    private readonly requestsService: RequestsService,
    private readonly jobsService: JobsService,
    private readonly queueService: QueueService,
    /**
     * Optional stream broker. When provided, a RequestAcceptedPayload is
     * published to the "requests" channel on every successful intake.
     * Omit in unit tests that do not need stream coverage.
     */
    private readonly streamBroker?: IStreamBroker,
  ) {}

  /**
   * Execute the full intake flow for a single inference request.
   *
   * Maps the external body to internal domain records, enqueues the job,
   * links the records, and returns an acknowledged DTO.
   */
  async intake(
    ctx: RequestContext,
    body: IntakeRequestBody,
  ): Promise<IntakeResponseDto> {
    ctx.log.info(
      { endpoint: body.endpoint, taskType: body.taskType, priority: body.priority },
      "Starting request intake",
    );

    // ── Step 1: Create the InferenceRequest ───────────────────────────────────
    //
    // Map routing-oriented intake fields to the canonical CreateInferenceRequestDto.
    //   endpoint            → modelId  (the target endpoint IS the model identifier)
    //   input               → a single User message with JSON-serialized content
    //   estimatedComplexity → routing hints (latency vs cost preference signal)

    const createReqDto: CreateInferenceRequestDto = {
      modelId: body.endpoint,
      messages: [
        {
          role: MessageRole.User,
          content: JSON.stringify(body.input),
        },
      ],
      params: { stream: false },
      routingHints: {
        preferLatency: body.estimatedComplexity === "low",
        preferCost:    body.estimatedComplexity === "high",
      },
    };

    const request = await this.requestsService.create(ctx, createReqDto);

    // ── Step 2: Create a linked Job ───────────────────────────────────────────

    const job = await this.jobsService.createJob(ctx, {
      requestId:  request.id,
      priority:   mapPriority(body.priority),
      sourceType: JobSourceType.Live,
    });

    // ── Step 3: Enqueue the job ───────────────────────────────────────────────
    //
    // Place the job into the queue so the routing engine can pick it up.
    // Routing metadata from the intake body (taskType, inputSize, complexity)
    // is forwarded as queue message metadata for the dequeue processor.

    const queueMsg = await this.queueService.enqueueJob(ctx, job, {
      taskType:            body.taskType,
      inputSize:           body.inputSize,
      estimatedComplexity: body.estimatedComplexity,
      ...(body.metadata ?? {}),
    });

    // ── Step 4: Link job → request (Queued → Dispatched) ─────────────────────
    //
    // Stamp the jobId onto the request and advance its status to Dispatched so
    // callers can correlate the two records by either ID.

    const linked = await this.requestsService.updateStatus(
      ctx,
      request.id,
      RequestStatus.Dispatched,
      { jobId: job.id },
    );

    ctx.log.info(
      {
        requestId:     linked.id,
        jobId:         job.id,
        queueMessageId: queueMsg.id,
      },
      "Intake complete — job queued",
    );

    // ── Step 5: Publish stream event ──────────────────────────────────────────
    //
    // Notify all WebSocket clients subscribed to the "requests" channel.
    // Publishing is fire-and-forget: any broker error is logged but does NOT
    // roll back or fail the intake. Latency is 0 at acceptance time — it will
    // be updated in a future ticket once execution completes.

    if (this.streamBroker) {
      const event: RequestAcceptedPayload = {
        id:        linked.id,
        timestamp: linked.createdAt,
        model:     body.endpoint,
        latency:   0,
        status:    "pending",
        endpoint:  INTAKE_ENDPOINT,
      };

      try {
        this.streamBroker.publish("requests", event);
        ctx.log.debug({ requestId: linked.id }, "Request stream event published");
      } catch (err) {
        ctx.log.warn({ requestId: linked.id, err }, "Failed to publish request stream event");
      }
    }

    // ── Step 6: Return acknowledgement ────────────────────────────────────────

    return {
      requestId:      linked.id,
      jobId:          job.id,
      queueMessageId: queueMsg.id,
      status:         linked.status,
      jobStatus:      job.status,
      createdAt:      linked.createdAt,
      enqueuedAt:     queueMsg.enqueuedAt,
    };
  }
}
