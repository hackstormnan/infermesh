/**
 * shared/index.ts
 *
 * Top-level barrel for the shared layer.
 *
 * Modules should import from here rather than from individual files:
 *   import type { ApiSuccessBody, InferenceRequest } from '../../shared';
 *
 * This gives the shared layer a stable public API — internal reorganisation
 * won't break downstream imports.
 */

// API envelope types and response builders
export * from "./types";
export * from "./response";

// Primitive types (branded IDs, timestamps, pagination)
export * from "./primitives";

// Domain contracts (entities, DTOs, enums, Zod schemas)
export * from "./contracts";
