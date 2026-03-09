/**
 * modules/models/queries.ts
 *
 * Query and filter contracts for the models list endpoint.
 *
 * Extends the shared PaginationQuery with model-specific filter fields.
 * Used at the route boundary (Zod parse) and typed through to the service
 * and repository layers.
 */

import { z } from "zod";
import { paginationQuerySchema } from "../../shared/primitives";
import {
  ModelCapability,
  ModelProvider,
  ModelStatus,
  QualityTier,
} from "../../shared/contracts/model";

export const listModelsQuerySchema = paginationQuerySchema.extend({
  /**
   * Filter by availability status.
   * e.g. ?status=active returns only models currently accepting requests.
   */
  status: z.nativeEnum(ModelStatus).optional(),

  /**
   * Filter by provider.
   * e.g. ?provider=anthropic
   */
  provider: z.nativeEnum(ModelProvider).optional(),

  /**
   * Filter by required capability.
   * Only models that declare this capability are returned.
   * e.g. ?capability=tool_use
   */
  capability: z.nativeEnum(ModelCapability).optional(),

  /**
   * Filter by quality tier.
   * e.g. ?qualityTier=frontier
   */
  qualityTier: z.nativeEnum(QualityTier).optional(),

  /**
   * Prefix search across both canonical name and aliases.
   * e.g. ?name=claude returns claude-sonnet-4-6, claude-haiku-4-5, …
   */
  name: z.string().optional(),
});

export type ListModelsQuery = z.infer<typeof listModelsQuerySchema>;
