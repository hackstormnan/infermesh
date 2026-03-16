/**
 * api/client.ts
 *
 * Lightweight fetch wrapper for InferMesh API calls.
 *
 * Not wired to live backend yet — pages use mock data.
 * This layer exists so future tickets can swap in real calls
 * without touching component code.
 *
 * All methods return the unwrapped `data` field from the success envelope,
 * or throw an ApiClientError with the server's error code + message.
 */

import type { ApiSuccess, ApiError } from './types/common'

const BASE = '/api/v1'

export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
  ) {
    super(message)
    this.name = 'ApiClientError'
  }
}

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })

  const body: ApiSuccess<T> | ApiError = await res.json()

  if (!body.success) {
    throw new ApiClientError(
      body.error.code,
      body.error.message,
      body.meta?.requestId,
    )
  }

  return body.data
}

export const apiClient = {
  get<T>(path: string): Promise<T> {
    return request<T>(path)
  },
  post<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, { method: 'POST', body: JSON.stringify(body) })
  },
  patch<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, { method: 'PATCH', body: JSON.stringify(body) })
  },
  delete<T>(path: string): Promise<T> {
    return request<T>(path, { method: 'DELETE' })
  },
}
