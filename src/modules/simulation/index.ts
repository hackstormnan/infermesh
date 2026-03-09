/**
 * modules/simulation — Load Simulation & Policy Backtesting
 *
 * Accepts a SimulationConfig (traffic profile + routing policy + virtual workers),
 * generates synthetic or replayed workloads, and produces AggregatedMetrics
 * for policy comparison without touching production infrastructure.
 *
 * Depends on shared contracts:
 *   SimulationConfig, SimulationResult, SimulationDto, CreateSimulationDto
 *   SimulationStatus, TrafficProfile, SimulatedWorker
 *   AggregatedMetrics (from metrics contracts — read model)
 *   RoutingPolicy (from routing contracts — the policy under test)
 *
 * Will expose (future tickets):
 *   POST /api/v1/simulations            — submit a new simulation
 *   GET  /api/v1/simulations            — list simulations with status filter
 *   GET  /api/v1/simulations/:id        — status and result
 *   DELETE /api/v1/simulations/:id      — cancel a running simulation
 */

export type {
  SimulationConfig,
  SimulationResult,
  SimulationDto,
  CreateSimulationDto,
  TrafficProfile,
  SimulatedWorker,
} from "../../shared/contracts/simulation";

export {
  SimulationStatus,
  createSimulationSchema,
} from "../../shared/contracts/simulation";
