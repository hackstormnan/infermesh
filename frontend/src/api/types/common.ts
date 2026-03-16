/**
 * api/types/common.ts
 *
 * Shared envelope and pagination shapes used across all InferMesh API responses.
 * Mirrors the standard JSON envelope returned by the Fastify server.
 */

/** Standard success envelope */
export interface ApiSuccess<T> {
  success: true
  data: T
  meta: ApiMeta
}

/** Standard error envelope */
export interface ApiError {
  success: false
  error: {
    code: string
    message: string
    details?: unknown
  }
  meta: ApiMeta
}

export interface ApiMeta {
  requestId: string
  timestamp: string
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError

/** Paginated list wrapper — data is the list itself, pagination is in meta */
export interface PaginatedData<T> {
  items: T[]
  total: number
  page: number
  limit: number
  hasMore: boolean
}

export type PaginatedResponse<T> = ApiSuccess<PaginatedData<T>>
