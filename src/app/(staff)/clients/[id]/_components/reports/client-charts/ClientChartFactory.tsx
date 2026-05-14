'use client'

/**
 * ClientChartFactory — dispatches on the metric's resolved
 * `client_view_chart` to render what the client portal will eventually
 * show.
 *
 * Used by the Phase D.4 publish-flow preview. Phase E reuses these
 * components inside the actual client portal so the staff preview is
 * pixel-faithful.
 *
 * For `line` and `bar` v1 reuses the staff Recharts components — the
 * type difference is largely cosmetic (less detail, simpler tooltips).
 * Specialised client variants can be layered in later without changing
 * the dispatch surface.
 */

import type { MetricHistory } from '@/lib/testing/loader-types'
import type { ComparisonMode } from '@/lib/testing/comparison'
import { BarChartCard } from '../charts/BarChartCard'
import { LineChartCard } from '../charts/LineChartCard'
import { MilestoneChart } from './MilestoneChart'
import { NarrativeOnly } from './NarrativeOnly'

interface ClientChartFactoryProps {
  metric: MetricHistory
  thisSessionValues: { left?: number; right?: number; unilateral?: number }
  thisSessionDate: string
  framingText: string | null
  /** Per Q-J3 + Q-J4 (c) — only consumed by MilestoneChart. Optional
   *  + default 'baseline' so staff publish-dialog previews (which
   *  don't pass it) keep their previous behaviour. */
  comparisonMode?: ComparisonMode
}

export function ClientChartFactory({
  metric,
  thisSessionValues,
  thisSessionDate,
  framingText,
  comparisonMode,
}: ClientChartFactoryProps) {
  const chart = metric.settings.client_view_chart
  switch (chart) {
    case 'milestone':
      return (
        <MilestoneChart
          metric={metric}
          thisSessionValues={thisSessionValues}
          thisSessionDate={thisSessionDate}
          comparisonMode={comparisonMode}
        />
      )
    case 'narrative_only':
      return (
        <NarrativeOnly
          metric={metric}
          thisSessionValues={thisSessionValues}
          framingText={framingText}
        />
      )
    case 'line':
      // Reuse the staff line chart; client portal will get its own
      // simplified variant in Phase E.
      return <LineChartCard metrics={[metric]} window="all" />
    case 'bar':
      return <BarChartCard metrics={[metric]} window="all" />
    case 'hidden':
      return null
  }
}
