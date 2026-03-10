/**
 * modules/jobs/lifecycle/transitions.ts
 *
 * Declarative job state machine.
 *
 * ALLOWED_TRANSITIONS is the single source of truth for which status changes
 * are legal. The lifecycle service guards every mutation through canTransition()
 * before calling the repository.
 *
 * ─── State machine ────────────────────────────────────────────────────────────
 *
 *   Queued ──────────────────────────────────────────────────── Cancelled
 *     │                                                             ▲
 *     ▼                                                             │
 *   Routing ─────────────────────────────────────────────────── Cancelled
 *     │    └─► Failed                                               ▲
 *     ▼            │                                                │
 *   Assigned ───────────────────────────────────────────────── Cancelled
 *     │                                                             ▲
 *     ▼                                                             │
 *   Running ──────────────────────────────────────────────────── Cancelled
 *     │    └─► Failed                                               ▲
 *     ▼            │                                                │
 *   Succeeded    Retrying ──────────────────────────────────── Cancelled
 *   (terminal)      │
 *                   ▼
 *                 Assigned  (retry re-enters the assignment step)
 *
 * Terminal states: Succeeded, Cancelled
 * Cancelled is reachable from any non-terminal state.
 */

import { ConflictError } from "../../../core/errors";
import { JobStatus } from "../../../shared/contracts/job";

// ─── Allowed transitions table ────────────────────────────────────────────────

export const ALLOWED_TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  [JobStatus.Queued]:    [JobStatus.Routing,   JobStatus.Cancelled],
  [JobStatus.Routing]:   [JobStatus.Assigned,  JobStatus.Failed,    JobStatus.Cancelled],
  [JobStatus.Assigned]:  [JobStatus.Running,   JobStatus.Cancelled],
  [JobStatus.Running]:   [JobStatus.Succeeded, JobStatus.Failed,    JobStatus.Cancelled],
  [JobStatus.Succeeded]: [],
  [JobStatus.Failed]:    [JobStatus.Retrying,  JobStatus.Cancelled],
  [JobStatus.Retrying]:  [JobStatus.Assigned,  JobStatus.Cancelled],
  [JobStatus.Cancelled]: [],
};

// ─── Guard helpers ────────────────────────────────────────────────────────────

/** Returns true if the `from → to` transition is allowed by the state machine. */
export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] as readonly JobStatus[]).includes(to);
}

/** Returns true when `status` is a terminal state (no further transitions allowed). */
export function isTerminal(status: JobStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Thrown when a caller attempts a status transition that is not allowed by
 * the state machine, e.g. Succeeded → Running.
 *
 * Extends ConflictError (409) because invalid transitions are a state-conflict,
 * not a malformed request.
 */
export class InvalidTransitionError extends ConflictError {
  constructor(from: JobStatus, to: JobStatus) {
    super(`Invalid job lifecycle transition: ${from} → ${to}`, {
      fromStatus: from,
      toStatus: to,
      allowed: ALLOWED_TRANSITIONS[from],
    });
    this.name = "InvalidTransitionError";
  }
}
