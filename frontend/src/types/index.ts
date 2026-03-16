// ─── Domain status literals ───────────────────────────────────────────────────

export type RequestStatus  = 'ROUTED' | 'QUEUED' | 'ASSIGNED' | 'FAILED'
export type WorkerStatusType = 'IDLE' | 'BUSY' | 'DRAINING' | 'UNHEALTHY'
export type DecisionOutcome  = 'ROUTED' | 'FALLBACK' | 'FAILED'

// ─── Overview page types ──────────────────────────────────────────────────────

export interface StatCardData {
  label:          string
  value:          string
  delta:          string
  deltaPositive:  boolean
  /** When true the delta is a policy name (blue), not a trend metric */
  deltaIsPolicy?: boolean
}

export interface RequestRow {
  id:       string
  model:    string
  taskType: string
  status:   RequestStatus
  age:      string
}

export interface RoutingDecisionRow {
  id:             string
  policyName:     string
  selectedModel:  string
  selectedWorker: string
  outcome:        DecisionOutcome
  evalMs:         number
  age:            string
}

export interface WorkerCard {
  id:         string
  name:       string
  status:     WorkerStatusType
  activeJobs: number
  maxJobs:    number
  models:     string[]
  region:     string
}
