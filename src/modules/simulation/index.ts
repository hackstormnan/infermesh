/**
 * modules/simulation — Offline Routing Simulation Engine
 *
 * Evaluates routing policies under synthetic workloads without touching the
 * live system. Every simulation run is fully isolated: it uses a run-scoped
 * in-memory decision repository, carries DecisionSource.Simulation on all
 * routing calls, and publishes no stream events.
 *
 * ─── Key service ─────────────────────────────────────────────────────────────
 *   simulationEngineService — execute offline simulation runs
 *
 * ─── API surface ─────────────────────────────────────────────────────────────
 *   POST /api/v1/simulation/runs — run a simulation, receive aggregate results
 *
 * ─── Wiring ──────────────────────────────────────────────────────────────────
 * Register routes in app/routes.ts:
 *   import { simulationRoute } from "../modules/simulation";
 *   fastify.register(simulationRoute, { prefix: "/api/v1" });
 *
 * ─── Isolation design ────────────────────────────────────────────────────────
 * The engine is wired to the live policyRepo (read-only), modelRegistryService,
 * and workerRegistryService. A fresh InMemoryDecisionRepository is created for
 * each run — simulation records never enter the live decision log.
 *
 * ─── Future extensions ───────────────────────────────────────────────────────
 * The SimulationConfig, TrafficProfile, SimulatedWorker, and AggregatedMetrics
 * contracts in shared/contracts/simulation.ts describe a richer async simulation
 * API with Poisson arrival processes and per-strategy breakdowns. The engine
 * added here is the synchronous first step toward that richer system.
 */

import { SimulationEngineService } from "./service/simulation-engine.service";
import { buildSimulationRoute } from "./routes/simulation.route";
import {
  policyRepo,
  candidateEvaluatorService,
} from "../routing";
import { modelRegistryService } from "../models";
import { workerRegistryService } from "../workers";

// ─── Module composition ───────────────────────────────────────────────────────

/**
 * Singleton simulation engine — wired to the live routing infrastructure
 * (policy repo, model registry, worker registry, candidate evaluator).
 *
 * The engine is stateless between runs; each run() call creates its own
 * isolated context and can be used concurrently without contention.
 */
export const simulationEngineService = new SimulationEngineService(
  policyRepo,
  modelRegistryService,
  workerRegistryService,
  candidateEvaluatorService,
);

/** Fastify plugin — register under /api/v1 prefix in app/routes.ts */
export const simulationRoute = buildSimulationRoute(simulationEngineService);

// ─── Engine type re-exports ───────────────────────────────────────────────────

export { SimulationEngineService } from "./service/simulation-engine.service";

export type {
  SimulationRunInput,
  SimulationRunResult,
  SimulationRunHttpInput,
  WorkloadDefinition,
  SimulationError,
} from "./contract";

export { simulationRunHttpSchema } from "./contract";

// ─── Shared contract re-exports (forward-looking async simulation API) ────────
//
// These types describe the richer future simulation system with Poisson arrival
// processes, traffic profiles, and per-strategy metric breakdowns. Re-exported
// here so consumers can access both the current engine and future contracts
// from a single import path.

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
