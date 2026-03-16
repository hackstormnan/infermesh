/**
 * hooks/useModelsPage.ts
 *
 * Fetches and caches the model registry list.
 * Follows the AsyncResult pattern from useMetricsPage — 60 s auto-refresh,
 * loading only shown on first fetch, manual refetch on error.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { apiClient, ApiClientError } from '../api/client'
import { mapModels, type ModelViewModel } from '../api/mappers/model.mapper'
import type { ModelDto } from '../api/types/models'
import type { PaginatedData } from '../api/types/common'

export interface UseModelsPageResult {
  models:   ModelViewModel[]
  loading:  boolean
  error:    string | null
  refetch:  () => void
}

const REFRESH_MS = 60_000

export function useModelsPage(): UseModelsPageResult {
  const [models,  setModels]  = useState<ModelViewModel[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const firstLoad = useRef(true)

  const load = useCallback((showLoading: boolean) => {
    if (showLoading) setLoading(true)
    setError(null)
    apiClient
      .get<PaginatedData<ModelDto>>('/models?limit=100')
      .then(result => {
        setModels(mapModels(result.items))
        firstLoad.current = false
      })
      .catch(e =>
        setError(e instanceof ApiClientError ? e.message : 'Failed to load models'),
      )
      .finally(() => { if (showLoading) setLoading(false) })
  }, [])

  const refetch = useCallback(() => load(true), [load])

  useEffect(() => {
    load(true)
    const id = setInterval(() => load(false), REFRESH_MS)
    return () => clearInterval(id)
  }, [load])

  return { models, loading, error, refetch }
}
