/**
 * api/types/workers.ts
 *
 * Frontend contract for worker-related API endpoints.
 * Mirrors WorkerDto from the backend workers module.
 */

export type WorkerStatus = 'idle' | 'busy' | 'draining' | 'unhealthy' | 'offline'

export interface WorkerCapacity {
  activeJobs: number
  maxConcurrentJobs: number
  queuedJobs: number
}

export interface WorkerHardware {
  instanceType: string
  gpuModel?: string
}

export interface WorkerRuntimeMetrics {
  tokensPerSecond?: number
  /** 0.0 = idle, 1.0 = fully saturated */
  loadScore?: number
  ttftMs?: number
  cpuUsagePercent?: number
  memoryUsagePercent?: number
  uptimeSeconds?: number
}

/** GET /api/v1/workers and GET /api/v1/workers/:id */
export interface WorkerDto {
  id: string
  name: string
  endpoint: string
  supportedModelIds: string[]
  region: string
  hardware: WorkerHardware
  status: WorkerStatus
  capacity: WorkerCapacity
  lastHeartbeatAt: number
  runtimeMetrics: WorkerRuntimeMetrics
  labels: Record<string, string>
  createdAt: string
  updatedAt: string
}
