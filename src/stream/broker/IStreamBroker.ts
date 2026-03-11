/**
 * stream/broker/IStreamBroker.ts
 *
 * Port (interface) for the stream publish abstraction.
 *
 * Domain services and application orchestrators depend on this interface,
 * never on the concrete InMemoryStreamBroker. This keeps domain logic free
 * from transport details and makes the broker easy to swap (e.g. replacing
 * the in-memory fanout with a Redis pub/sub or Kafka producer in the future).
 *
 * ─── Usage ────────────────────────────────────────────────────────────────────
 *
 *   // In IntakeService (future wiring):
 *   this.streamBroker.publish("requests", {
 *     requestId: linked.id,
 *     jobId:     job.id,
 *     ...
 *   });
 *
 *   // In WorkersService (future wiring):
 *   this.streamBroker.publish("workers", {
 *     workerId: worker.id,
 *     status:   worker.status,
 *     event:    "registered",
 *     ...
 *   });
 */

import type { StreamChannel } from "../contract";

export interface IStreamBroker {
  /**
   * Publish an event to all connections subscribed to `channel`.
   *
   * Implementations MUST:
   *   - Be non-blocking (best-effort delivery; never throw on send failure)
   *   - Wrap the payload in a StreamEnvelope before transmitting
   *   - Stamp the envelope with the publish time as an ISO timestamp
   *
   * Implementations MAY:
   *   - Batch, buffer, or queue messages for eventual delivery
   *   - Add per-channel filtering or throttling
   *   - Log dropped messages for observability
   *
   * @param channel  Target channel — only subscribed connections receive this.
   * @param data     Event payload; shape should match the channel's payload type.
   */
  publish<T>(channel: StreamChannel, data: T): void;
}
