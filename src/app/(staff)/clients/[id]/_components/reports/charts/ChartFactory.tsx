'use client'

/**
 * ChartFactory — switch on the metric's resolved `default_chart` and
 * render the appropriate chart component. The resolver is the single
 * source of truth; no other chart-type mapping lives anywhere.
 *
 * `radar` is reserved in the schema but no metric currently uses it —
 * we degrade to LineChartCard if it appears, with a console warning so
 * we notice when a metric flips to radar.
 */

import type { MetricHistory } from '@/lib/testing/loader-types'
import { AsymmetryBarChartCard } from './AsymmetryBarChartCard'
import { BarChartCard } from './BarChartCard'
import { LineChartCard } from './LineChartCard'
import { TargetZoneChartCard } from './TargetZoneChartCard'
import type { TimeWindow } from '../helpers'

interface ChartFactoryProps {
  metrics: MetricHistory[]
  window: TimeWindow
}

export function ChartFactory({ metrics, window }: ChartFactoryProps) {
  if (metrics.length === 0) return null
  const chartType = metrics[0].settings.default_chart

  switch (chartType) {
    case 'line':
      return <LineChartCard metrics={metrics} window={window} />
    case 'bar':
      return <BarChartCard metrics={metrics} window={window} />
    case 'asymmetry_bar':
      return <AsymmetryBarChartCard metrics={metrics} window={window} />
    case 'target_zone':
      return <TargetZoneChartCard metrics={metrics} window={window} />
    case 'radar':
      // Reserved — degrade to line until any metric actually uses radar.
      if (typeof console !== 'undefined') {
        console.warn(
          `ChartFactory: radar chart requested for ${metrics[0].settings.test_id}::${metrics[0].settings.metric_id} — degrading to line.`,
        )
      }
      return <LineChartCard metrics={metrics} window={window} />
  }
}
