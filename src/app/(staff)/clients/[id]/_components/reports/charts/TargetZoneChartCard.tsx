'use client'

/**
 * TargetZoneChartCard — line chart with reserved space for clinical bands.
 *
 * Used for `default_chart === 'target_zone'` metrics (vitals, ratios,
 * body composition with target ranges).
 *
 * Phase D limitation: the schema does not yet encode per-metric clinical
 * target bands (only validation_bounds.json which carries plausibility
 * bounds, not clinical targets). Until those bands are encoded, this
 * chart degrades to a clean line chart — no shaded reference areas. The
 * direction-of-good badge above the chart already returns a neutral
 * verdict for `target_range` metrics in `direction.ts`. When clinical
 * bands land, this component is the place to render them via Recharts'
 * <ReferenceArea>.
 */

import { LineChartCard } from './LineChartCard'
import type { MetricHistory } from '@/lib/testing/loader-types'
import type { TimeWindow } from '../helpers'

interface TargetZoneChartCardProps {
  metrics: MetricHistory[]
  window: TimeWindow
}

export function TargetZoneChartCard(props: TargetZoneChartCardProps) {
  return <LineChartCard {...props} />
}
