/**
 * modules/intake/service/intake.service.ts
 *
 * Application-level orchestrator for the inference intake flow.
 *
 * The IntakeService sits above the domain modules. Its single responsibility
 * is coordinating the two writes that must happen atomically from the caller's
 * perspective: creating an InferenceRequest record and creating a linked Job.
 *
 * ─── Intake sequence ─────────────────────────────────────────────────────────
 *   1. Map the external IntakeRequestBody to a CreateInferenceRequestDto and
 *      persist a new InferenceRequest (status: Queued).
 *   2. Create a new Job linked to that request (status: Queued).
 *   3. Advance the InferenceRequest to Dispatched, stamping the jobId so the
 *      request and job are bi-directionally linked.
 *   4. Return an IntakeResponseDto with both IDs and their current statuses.
 *
 * ─── Future extension points ──────────────────────────────────────────────────
 *   - Step 1 will be extended to parse metadata / routing hints from the body
 *     when the routing policy engine is wired (future routing ticket).
 *   - Step 3 may be replaced by an event emission once an event bus exists.
 *   - A transactional wrapper or saga pattern can be added here if atomicity
 *     across durable stores becomes a requirement.
 */

import type { RequestContext } from "../../../core/context";
import type { CreateInferenceRequestDto } from "../../../shared/contracts/request";
import { MessageRole, RequestStatus } from "../../../shared/contracts/request";
import { JobPriority, JobSourceType } from "../../../shared/contracts/job";
import type { JobsService } from "../../jobs/service/jobs.service";
import type { RequestsService } from "../../requests/service/requests.service";
import type { IntakeRequestBody, IntakeResponseDto } from "../dto";

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
  ) {}

  /**
   * Execute the full intake flow for a single inference request.
   *
   * Maps the external body to internal domain records, persists both,
   * links them, and returns an acknowledgement DTO.
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
    // The intake body uses routing-oriented fields; map them to the canonical
    // CreateInferenceRequestDto that the requests module understands.
    //   endpoint          → modelId  (the target inference endpoint IS the model identifier)
    //   input             → a single User message with JSON-serialized content
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

    // ── Step 3: Link job → request (Queued → Dispatched) ─────────────────────
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
      { requestId: linked.id, jobId: job.id, jobStatus: job.status },
      "Intake complete — request dispatched",
    );

    // ── Step 4: Return acknowledgement ────────────────────────────────────────

    return {
      requestId: linked.id,
      jobId:     job.id,
      status:    linked.status,
      jobStatus: job.status,
      createdAt: linked.createdAt,
    };
  }
}
