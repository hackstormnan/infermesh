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
import type { InferMeshStreamEvent } from '../api/types/stream'
import type { WorkerHealth } from '../api/mappers/worker.mapper'
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
    if (event.type !== 'workers') return
    const payload = event.data

    // WorkerStreamStatus ('healthy'|'degraded'|'offline') is a simplified
    // view — map to the closest internal WorkerStatus for display.
    const streamStatusToWorkerStatus = (s: typeof payload.status): WorkerStatus =>
      s === 'offline'  ? 'offline'   :
      s === 'degraded' ? 'draining'  :
      'idle'

    const streamStatusToHealth = (s: typeof payload.status): WorkerHealth =>
      s === 'offline'  ? 'offline'  :
      s === 'degraded' ? 'degraded' :
      'healthy'

    if (payload.event === 'deregistered') {
      setWorkers(prev => prev.filter(w => w.id !== payload.workerId))
      return
    }

    if (payload.event === 'registered') {
      // Fetch the full DTO so we have all display fields (name, region, models…)
      apiClient
        .get<WorkerDto>(`/workers/${payload.workerId}`)
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

    // heartbeat — update live metrics from the payload fields available
    if (payload.event === 'heartbeat') {
      setWorkers(prev =>
        prev.map(w => {
          if (w.id !== payload.workerId) return w
          return {
            ...w,
            status:           streamStatusToWorkerStatus(payload.status),
            health:           streamStatusToHealth(payload.status),
            queuedJobs:       payload.queueSize,
            utilization:      payload.loadScore ?? w.utilization,
            loadScore:        payload.loadScore,
            tokensPerSecond:  payload.throughput ?? w.tokensPerSecond,
            ttftMs:           payload.latency ?? w.ttftMs,
            lastHeartbeatAge: 'just now',
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
