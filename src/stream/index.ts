/**
 * stream/index.ts
 *
 * Public API for the stream gateway module.
 *
 * ─── What to import ───────────────────────────────────────────────────────────
 *
 *   Gateway plugin (Fastify route registration):
 *     import { streamGateway }       from "../stream";
 *     import type { StreamGatewayOptions } from "../stream";
 *
 *   Publish abstraction (domain services, application orchestrators):
 *     import type { IStreamBroker }  from "../stream";
 *     import { InMemoryStreamBroker } from "../stream";
 *
 *   Connection management (server wiring):
 *     import { ConnectionRegistry }  from "../stream";
 *
 *   Protocol contracts (shared types):
 *     import type {
 *       StreamChannel,
 *       StreamEnvelope,
 *       StreamControlMessage,
 *       RequestAcceptedPayload,
 *       WorkerStatusPayload,
 *       RoutingOutcomeSummaryPayload,
 *       RoutingDecisionPayload,
 *     } from "../stream";
 */

// ─── Gateway ──────────────────────────────────────────────────────────────────
export { streamGateway } from "./gateway/stream.gateway";
export type { StreamGatewayOptions } from "./gateway/stream.gateway";

// ─── Connection registry ──────────────────────────────────────────────────────
export { ConnectionRegistry } from "./gateway/connection-registry";
export type { ConnectionState } from "./gateway/connection-registry";

// ─── Broker ───────────────────────────────────────────────────────────────────
export type { IStreamBroker } from "./broker/IStreamBroker";
export { InMemoryStreamBroker } from "./broker/stream-broker";

// ─── Protocol contracts ───────────────────────────────────────────────────────
export {
  STREAM_CHANNELS,
} from "./contract";
export type {
  StreamChannel,
  EnvelopeType,
  StreamEnvelope,
  ControlAction,
  StreamControlMessage,
  // System frames
  SystemWelcomePayload,
  AckPayload,
  ErrorPayload,
  // Domain channel payloads
  RequestAcceptedPayload,
  WorkerStatusPayload,
  RoutingOutcomeSummaryPayload,
  RoutingDecisionPayload,
} from "./contract";
