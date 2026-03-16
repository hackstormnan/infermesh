/**
 * api/mappers/worker.mapper.ts
 *
 * Adapts WorkerDto → WorkerViewModel for the worker status components.
 */

import type { WorkerDto, WorkerStatus } from '../types/workers'

export type WorkerHealth = 'healthy' | 'degraded' | 'unhealthy' | 'offline'

export interface WorkerViewModel {
  id: string
  name: string
  status: WorkerStatus
  health: WorkerHealth
  region: string
  instanceType: string
  gpuModel?: string
  supportedModelIds: string[]
  /** 0–1 utilization fraction */
  utilization: number
  /** Formatted e.g. "3 / 8" */
  jobSlots: string
  activeJobs: number
  maxConcurrentJobs: number
  queuedJobs: number
  loadScore?: number
  tokensPerSecond?: number
  ttftMs?: number
  cpuUsagePercent?: number
  memoryUsagePercent?: number
  uptimeSeconds?: number
  /** How long ago the last heartbeat was received */
  lastHeartbeatAge: string
  labels: Record<string, string>
}

function heartbeatAge(epochMs: number): string {
  const seconds = Math.floor((Date.now() - epochMs) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins}m ago`
  return `${Math.floor(mins / 60)}h ago`
}

function deriveHealth(dto: WorkerDto): WorkerHealth {
  if (dto.status === 'offline') return 'offline'
  if (dto.status === 'unhealthy') return 'unhealthy'
  const staleMs = Date.now() - dto.lastHeartbeatAt
  if (staleMs > 60_000) return 'unhealthy'
  if (dto.status === 'draining') return 'degraded'
  const util = dto.capacity.activeJobs / dto.capacity.maxConcurrentJobs
  if (util >= 0.9) return 'degraded'
  return 'healthy'
}

export function mapWorker(dto: WorkerDto): WorkerViewModel {
  const util = dto.capacity.maxConcurrentJobs > 0
    ? dto.capacity.activeJobs / dto.capacity.maxConcurrentJobs
    : 0

  return {
    id: dto.id,
    name: dto.name,
    status: dto.status,
    health: deriveHealth(dto),
    region: dto.region,
    instanceType: dto.hardware.instanceType,
    gpuModel: dto.hardware.gpuModel,
    supportedModelIds: dto.supportedModelIds,
    utilization: util,
    jobSlots: `${dto.capacity.activeJobs} / ${dto.capacity.maxConcurrentJobs}`,
    activeJobs: dto.capacity.activeJobs,
    maxConcurrentJobs: dto.capacity.maxConcurrentJobs,
    queuedJobs: dto.capacity.queuedJobs,
    loadScore:          dto.runtimeMetrics.loadScore,
    tokensPerSecond:    dto.runtimeMetrics.tokensPerSecond,
    ttftMs:             dto.runtimeMetrics.ttftMs,
    cpuUsagePercent:    dto.runtimeMetrics.cpuUsagePercent,
    memoryUsagePercent: dto.runtimeMetrics.memoryUsagePercent,
    uptimeSeconds:      dto.runtimeMetrics.uptimeSeconds,
    lastHeartbeatAge:   heartbeatAge(dto.lastHeartbeatAt),
    labels: dto.labels,
  }
}

export function mapWorkers(dtos: WorkerDto[]): WorkerViewModel[] {
  return dtos.map(mapWorker)
}
