/**
 * shared/contracts/index.ts
 *
 * Barrel export for all domain contracts.
 *
 * Import pattern for modules:
 *   import type { InferenceRequest, RequestStatus } from '../../shared/contracts';
 *   import type { Worker, WorkerStatus }            from '../../shared/contracts';
 *
 * Importing from this barrel (rather than individual files) keeps import paths
 * stable when contracts are refactored into sub-files in future tickets.
 */

export * from "./request";
export * from "./job";
export * from "./model";
export * from "./worker";
export * from "./routing";
export * from "./metrics";
export * from "./simulation";
export * from "./stream";
