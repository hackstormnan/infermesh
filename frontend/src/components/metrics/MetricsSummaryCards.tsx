/**
 * components/metrics/MetricsSummaryCards.tsx
 *
 * Four key-metric cards rendered from a MetricsSummaryViewModel.
 * Handles loading skeletons and error state for the summary section.
 */

import { StatCard } from '../ui/StatCard'
import { SkeletonBlock } from '../ui/LoadingState'
import { ErrorState } from '../ui/ErrorState'
import {
  mapMetricsSummary,
  trendIsPositive,
  trendArrow,
  type MetricsSummaryViewModel,
} from '../../api/mappers/metrics.mapper'
import type { MetricsSummary } from '../../api/types/metrics'
import type { StatCardData } from '../../types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildCards(vm: MetricsSummaryViewModel): StatCardData[] {
  return [
    {
      label:         'Requests (24h)',
      value:         vm.requests24h,
      delta:         `${trendArrow(vm.requestsTrend.direction)} ${vm.requestsTrend.formatted}`,
      deltaPositive: trendIsPositive(vm.requestsTrend),
    },
    {
      label:         'P95 Latency',
      value:         vm.p95LatencyMs,
      delta:         `${trendArrow(vm.latencyTrend.direction)} ${vm.latencyTrend.formatted}`,
      deltaPositive: trendIsPositive(vm.latencyTrend),
    },
    {
      label:         'Success Rate',
      value:         vm.successRate,
      delta:         vm.requestsPerSecond,
      deltaPositive: true,
      deltaIsPolicy: true,
    },
    {
      label:         'Total Cost',
      value:         vm.totalCostUsd,
      delta:         `${trendArrow(vm.costTrend.direction)} ${vm.costTrend.formatted}`,
      deltaPositive: trendIsPositive(vm.costTrend),
    },
  ]
}

// ─── Skeleton placeholder ─────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <div
      style={{
        backgroundColor: 'var(--color-bg-surface)',
        border:          '1px solid var(--color-border)',
        borderRadius:    'var(--radius-lg)',
        padding:         '18px 20px 16px',
        display:         'flex',
        flexDirection:   'column',
        gap:             12,
      }}
    >
      <SkeletonBlock width="50%" height={10} />
      <SkeletonBlock width="65%" height={28} />
      <SkeletonBlock width="40%" height={10} />
    </div>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface MetricsSummaryCardsProps {
  data:    MetricsSummary | null
  loading: boolean
  error:   string | null
  onRetry: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MetricsSummaryCards({
  data,
  loading,
  error,
  onRetry,
}: MetricsSummaryCardsProps) {
  if (error) {
    return (
      <div style={{ gridColumn: '1 / -1' }}>
        <ErrorState
          title="Stats unavailable"
          message={error}
          onRetry={onRetry}
          compact
        />
      </div>
    )
  }

  if (loading || !data) {
    return (
      <>
        {Array.from({ length: 4 }, (_, i) => <CardSkeleton key={i} />)}
      </>
    )
  }

  return (
    <>
      {buildCards(mapMetricsSummary(data)).map(card => (
        <StatCard key={card.label} data={card} />
      ))}
    </>
  )
}
