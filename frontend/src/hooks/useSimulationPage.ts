/**
 * hooks/useSimulationPage.ts
 *
 * Drives the Simulation page. Manages form state, API submission, and result
 * state for both simulation runs and experiment comparisons.
 *
 * Both submit functions are `() => void` — they fire async work internally
 * and reflect progress/errors via the returned state triplets.
 */

import { useState, useCallback } from 'react'
import { apiClient, ApiClientError } from '../api/client'
import type { SimulationRunResult, ExperimentResult } from '../api/types/simulation'
import { mapSimulationRun, mapExperiment } from '../api/mappers/simulation.mapper'
import type { SimulationRunViewModel, ExperimentViewModel } from '../api/mappers/simulation.mapper'

// ─── Simulation run form ───────────────────────────────────────────────────────

export interface SimRunFormValues {
  scenarioName: string
  policyId: string
  requestCount: number
  sourceTag: string
}

const RUN_DEFAULTS: SimRunFormValues = {
  scenarioName: '',
  policyId: '',
  requestCount: 50,
  sourceTag: '',
}

// ─── Experiment form ───────────────────────────────────────────────────────────

export interface TaskDistValues   { chat: string; analysis: string; reasoning: string; [k: string]: string }
export interface SizeDistValues   { small: string; medium: string; large: string; [k: string]: string }
export interface ComplexityDistValues { low: string; medium: string; high: string; [k: string]: string }

export interface ExperimentFormValues {
  experimentName: string
  policiesRaw: string   // newline or comma-separated list
  requestCount: number
  taskDist:       TaskDistValues
  sizeDist:       SizeDistValues
  complexityDist: ComplexityDistValues
  burstEnabled:   boolean
  burstInterval:  number
  burstSize:      number
  randomSeed:     string
  sourceTag:      string
}

const EXP_DEFAULTS: ExperimentFormValues = {
  experimentName: '',
  policiesRaw: '',
  requestCount: 100,
  taskDist:       { chat: '', analysis: '', reasoning: '' },
  sizeDist:       { small: '', medium: '', large: '' },
  complexityDist: { low: '', medium: '', high: '' },
  burstEnabled:   false,
  burstInterval:  10,
  burstSize:      3,
  randomSeed:     '',
  sourceTag:      '',
}

// ─── Public hook types ────────────────────────────────────────────────────────

export type SimTab = 'run' | 'experiment'

export interface UseSimulationPageResult {
  activeTab:    SimTab
  setActiveTab: (t: SimTab) => void

  runForm:       SimRunFormValues
  setRunForm:    (patch: Partial<SimRunFormValues>) => void
  runSubmitting: boolean
  runError:      string | null
  runResult:     SimulationRunViewModel | null
  runRaw:        SimulationRunResult | null
  submitRun:     () => void
  clearRun:      () => void

  expForm:        ExperimentFormValues
  setExpForm:     (patch: Partial<ExperimentFormValues>) => void
  expSubmitting:  boolean
  expError:       string | null
  expResult:      ExperimentViewModel | null
  expRaw:         ExperimentResult | null
  submitExperiment: () => void
  clearExp:         () => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDist(d: Record<string, string>): Record<string, number> | undefined {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(d)) {
    const n = parseFloat(v)
    if (!isNaN(n) && n > 0) out[k] = n
  }
  return Object.keys(out).length > 0 ? out : undefined
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSimulationPage(): UseSimulationPageResult {
  const [activeTab, setActiveTab] = useState<SimTab>('run')

  // ── Run state ───────────────────────────────────────────────────────────────

  const [runForm, setRunFormRaw]   = useState<SimRunFormValues>(RUN_DEFAULTS)
  const [runSubmitting, setRunSub] = useState(false)
  const [runError, setRunError]    = useState<string | null>(null)
  const [runResult, setRunResult]  = useState<SimulationRunViewModel | null>(null)
  const [runRaw, setRunRaw]        = useState<SimulationRunResult | null>(null)

  const setRunForm = useCallback(
    (patch: Partial<SimRunFormValues>) => setRunFormRaw(p => ({ ...p, ...patch })),
    [],
  )

  const submitRun = useCallback(() => {
    if (runSubmitting) return
    if (!runForm.scenarioName.trim()) {
      setRunError('Scenario name is required')
      return
    }
    if (runForm.requestCount < 1 || runForm.requestCount > 1_000) {
      setRunError('Request count must be between 1 and 1,000')
      return
    }

    ;(async () => {
      setRunError(null)
      setRunSub(true)
      setRunResult(null)
      setRunRaw(null)
      try {
        const body: Record<string, unknown> = {
          scenarioName: runForm.scenarioName.trim(),
          requestCount: runForm.requestCount,
        }
        if (runForm.policyId.trim()) body.policyId = runForm.policyId.trim()
        if (runForm.sourceTag.trim()) body.sourceTag = runForm.sourceTag.trim()

        const dto = await apiClient.post<SimulationRunResult>('/simulation/runs', body)
        setRunRaw(dto)
        setRunResult(mapSimulationRun(dto))
      } catch (e) {
        setRunError(e instanceof ApiClientError ? e.message : 'Simulation run failed')
      } finally {
        setRunSub(false)
      }
    })()
  }, [runForm, runSubmitting])

  const clearRun = useCallback(() => {
    setRunResult(null)
    setRunRaw(null)
    setRunError(null)
    setRunFormRaw(RUN_DEFAULTS)
  }, [])

  // ── Experiment state ────────────────────────────────────────────────────────

  const [expForm, setExpFormRaw]   = useState<ExperimentFormValues>(EXP_DEFAULTS)
  const [expSubmitting, setExpSub] = useState(false)
  const [expError, setExpError]    = useState<string | null>(null)
  const [expResult, setExpResult]  = useState<ExperimentViewModel | null>(null)
  const [expRaw, setExpRaw]        = useState<ExperimentResult | null>(null)

  const setExpForm = useCallback(
    (patch: Partial<ExperimentFormValues>) => setExpFormRaw(p => ({ ...p, ...patch })),
    [],
  )

  const submitExperiment = useCallback(() => {
    if (expSubmitting) return

    const policies = expForm.policiesRaw
      .split(/[\n,]+/)
      .map(s => s.trim())
      .filter(Boolean)

    if (!expForm.experimentName.trim()) {
      setExpError('Experiment name is required')
      return
    }
    if (policies.length === 0) {
      setExpError('At least one policy ID or name is required')
      return
    }
    if (expForm.requestCount < 1 || expForm.requestCount > 10_000) {
      setExpError('Request count must be between 1 and 10,000')
      return
    }

    ;(async () => {
      setExpError(null)
      setExpSub(true)
      setExpResult(null)
      setExpRaw(null)
      try {
        const workloadConfig: Record<string, unknown> = {
          requestCount: expForm.requestCount,
        }

        const taskDist = parseDist(expForm.taskDist)
        if (taskDist) workloadConfig.taskDistribution = taskDist

        const sizeDist = parseDist(expForm.sizeDist)
        if (sizeDist) workloadConfig.inputSizeDistribution = sizeDist

        const complexDist = parseDist(expForm.complexityDist)
        if (complexDist) workloadConfig.complexityDistribution = complexDist

        if (expForm.burstEnabled) {
          workloadConfig.burstPattern = {
            burstInterval: expForm.burstInterval,
            burstSize: expForm.burstSize,
          }
        }

        const seed = parseInt(expForm.randomSeed, 10)
        if (!isNaN(seed)) workloadConfig.randomSeed = seed

        const body: Record<string, unknown> = {
          experimentName: expForm.experimentName.trim(),
          policies,
          workloadConfig,
        }
        if (expForm.sourceTag.trim()) body.sourceTag = expForm.sourceTag.trim()

        const dto = await apiClient.post<ExperimentResult>('/simulation/experiments', body)
        setExpRaw(dto)
        setExpResult(mapExperiment(dto))
      } catch (e) {
        setExpError(e instanceof ApiClientError ? e.message : 'Experiment failed')
      } finally {
        setExpSub(false)
      }
    })()
  }, [expForm, expSubmitting])

  const clearExp = useCallback(() => {
    setExpResult(null)
    setExpRaw(null)
    setExpError(null)
    setExpFormRaw(EXP_DEFAULTS)
  }, [])

  return {
    activeTab, setActiveTab,
    runForm, setRunForm, runSubmitting, runError, runResult, runRaw, submitRun, clearRun,
    expForm, setExpForm, expSubmitting, expError, expResult, expRaw, submitExperiment, clearExp,
  }
}
