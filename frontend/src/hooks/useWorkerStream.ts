/**
 * hooks/useWorkerStream.ts
 *
 * Combines a REST seed load (GET /api/v1/workers?limit=50) with a WebSocket
 * subscription to the "workers" channel.
 *
 * Event handling:
 *   worker.heartbeat / worker.status_changed — updates utilization + status
 *   worker.evicted — removes the worker from the list
 *   worker.registered — fetches the full WorkerDto and appends it
 */

import { useState, useEffect, useCallback } from 'react'
import { apiClient, ApiClientError } from '../api/client'
import {
  mapWorker,
  mapWorkers,
  type WorkerViewModel,
} from '../api/mappers/worker.mapper'
import type { WorkerDto, WorkerStatus } from '../api/types/workers'
import type { PaginatedData } from '../api/types/common'
import type { InferMeshStreamEvent, WorkerStreamEvent } from '../api/types/stream'
import { useStreamSocket, type ConnectionState } from './useStreamSocket'

export interface UseWorkerStreamResult {
  workers: WorkerViewModel[]
  loading: boolean
  error: string | null
  connectionState: ConnectionState
}

export function useWorkerStream(): UseWorkerStreamResult {
  const [workers, setWorkers] = useState<WorkerViewModel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ── WebSocket event handler ──────────────────────────────────────────────────

  const handleEvent = useCallback((event: InferMeshStreamEvent) => {
    if (event.channel !== 'workers') return
    const e = event as WorkerStreamEvent

    if (e.type === 'worker.evicted') {
      setWorkers(prev => prev.filter(w => w.id !== e.workerId))
      return
    }

    if (e.type === 'worker.registered') {
      // Fetch the full DTO so we have all display fields (name, region, models…)
      apiClient
        .get<WorkerDto>(`/workers/${e.workerId}`)
        .then(dto => {
          const vm = mapWorker(dto)
          setWorkers(prev =>
            prev.some(w => w.id === vm.id) ? prev : [...prev, vm],
          )
        })
        .catch(() => {
          // New worker will appear on the next polling cycle — acceptable fallback
        })
      return
    }

    if (e.type === 'worker.heartbeat' || e.type === 'worker.status_changed') {
      setWorkers(prev =>
        prev.map(w => {
          if (w.id !== e.workerId) return w
          const util =
            e.maxConcurrentJobs > 0 ? e.activeJobs / e.maxConcurrentJobs : 0
          return {
            ...w,
            status: e.status as WorkerStatus,
            activeJobs: e.activeJobs,
            maxConcurrentJobs: e.maxConcurrentJobs,
            utilization: util,
            jobSlots: `${e.activeJobs} / ${e.maxConcurrentJobs}`,
          }
        }),
      )
    }
  }, [])

  const connectionState = useStreamSocket(['workers'], handleEvent)

  // ── Initial REST seed ────────────────────────────────────────────────────────

  useEffect(() => {
    setLoading(true)
    setError(null)
    apiClient
      .get<PaginatedData<WorkerDto>>('/workers?limit=50')
      .then(result => setWorkers(mapWorkers(result.items)))
      .catch(e =>
        setError(e instanceof ApiClientError ? e.message : 'Failed to load workers'),
      )
      .finally(() => setLoading(false))
  }, [])

  return { workers, loading, error, connectionState }
}
