import type { StatCardData, RequestRow, RoutingDecisionRow, WorkerCard } from '../types'

// ─── Overview stat cards ──────────────────────────────────────────────────────

export const mockStatCards: StatCardData[] = [
  {
    label:         'TOTAL REQUESTS',
    value:         '12,847',
    delta:         '↑ +8.2%  from yesterday',
    deltaPositive: true,
  },
  {
    label:         'ACTIVE WORKERS',
    value:         '23 / 28',
    delta:         '82%  capacity healthy',
    deltaPositive: true,
  },
  {
    label:         'AVG LATENCY',
    value:         '284 ms',
    delta:         '↓ −12ms  vs last hour',
    deltaPositive: true,
  },
  {
    label:         'ROUTING SUCCESS',
    value:         '99.1%',
    delta:         'Live: cost-optimised',
    deltaPositive: false,
    deltaIsPolicy: true,
  },
]

// ─── Request stream ───────────────────────────────────────────────────────────

export const mockRequestStream: RequestRow[] = [
  { id: 'req-a4f2', model: 'gpt-4o',           taskType: 'chat',           status: 'ROUTED',   age: '2s ago'  },
  { id: 'req-b7c1', model: 'claude-3-5-haiku',  taskType: 'summarization',  status: 'ROUTED',   age: '5s ago'  },
  { id: 'req-c2e8', model: 'llama-3-1-8b',      taskType: 'classification', status: 'QUEUED',   age: '8s ago'  },
  { id: 'req-d9a3', model: 'gpt-4o',            taskType: 'coding',         status: 'ROUTED',   age: '12s ago' },
  { id: 'req-e1f6', model: 'claude-3-5-haiku',  taskType: 'extraction',     status: 'ASSIGNED', age: '18s ago' },
  { id: 'req-f3b5', model: 'llama-3-1-8b',      taskType: 'classification', status: 'ROUTED',   age: '24s ago' },
]

// ─── Routing decisions ────────────────────────────────────────────────────────

export const mockRoutingDecisions: RoutingDecisionRow[] = [
  { id: 'dec-3f8a', policyName: 'cost-optimised', selectedModel: 'gpt-4o',          selectedWorker: 'gpu-worker-a', outcome: 'ROUTED',   evalMs: 4,  age: '2s ago'  },
  { id: 'dec-1c2e', policyName: 'cost-optimised', selectedModel: 'claude-haiku',    selectedWorker: 'gpu-worker-b', outcome: 'ROUTED',   evalMs: 3,  age: '5s ago'  },
  { id: 'dec-8e4d', policyName: 'cost-optimised', selectedModel: 'llama-3-1-8b',    selectedWorker: 'cpu-worker-c', outcome: 'ROUTED',   evalMs: 5,  age: '8s ago'  },
  { id: 'dec-7b2f', policyName: 'cost-optimised', selectedModel: 'claude-haiku',    selectedWorker: 'gpu-worker-a', outcome: 'FALLBACK', evalMs: 12, age: '12s ago' },
]

// ─── Worker status ────────────────────────────────────────────────────────────

export const mockWorkers: WorkerCard[] = [
  {
    id:         'wkr-a',
    name:       'gpu-worker-a',
    status:     'IDLE',
    activeJobs: 1,
    maxJobs:    8,
    models:     ['gpt-4o', 'claude-3-5-haiku'],
    region:     'us-east-1',
  },
  {
    id:         'wkr-b',
    name:       'gpu-worker-b',
    status:     'BUSY',
    activeJobs: 5,
    maxJobs:    6,
    models:     ['claude-3-5-haiku', 'llama-3-1-8b'],
    region:     'us-east-1',
  },
  {
    id:         'wkr-c',
    name:       'cpu-worker-c',
    status:     'IDLE',
    activeJobs: 0,
    maxJobs:    4,
    models:     ['llama-3-1-8b'],
    region:     'us-west-2',
  },
]
