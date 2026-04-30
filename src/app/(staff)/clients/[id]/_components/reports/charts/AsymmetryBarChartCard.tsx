'use client'

/**
 * AsymmetryBarChartCard — bilateral L/R grouped bars over time.
 *
 * Designed for `default_chart === 'asymmetry_bar'` — a bilateral metric
 * showing both sides side-by-side per session, surfacing left-right
 * asymmetry visually.
 *
 * Per docs/decisions.md D-001 + D-003: hover-to-emphasize on L/R fades the
 * other side. No LSI midline in v1 — the comparison_mode already
 * surfaces LSI in the metric badge above the chart, and a midline at
 * y = some target value would imply a clinical band the schema doesn't
 * yet encode.
 */

import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { MetricHistory } from '@/lib/testing/loader-types'
import {
  AXIS_TICK_STYLE,
  BILATERAL_COLOURS,
  CHART_COLOURS,
  ChartFrame,
  TOOLTIP_ITEM_STYLE,
  TOOLTIP_LABEL_STYLE,
  TOOLTIP_WRAPPER_STYLE,
} from './chart-shared'
import { EmptyChart } from './LineChartCard'
import {
  filterPointsByWindow,
  formatCompactDate,
  formatShortDate,
  type TimeWindow,
} from '../helpers'

interface AsymmetryBarChartCardProps {
  /** Always called with exactly one bilateral metric. */
  metrics: MetricHistory[]
  window: TimeWindow
}

interface AsymRow {
  date: string
  left: number | null
  right: number | null
}

export function AsymmetryBarChartCard({ metrics, window }: AsymmetryBarChartCardProps) {
  const [hovered, setHovered] = useState<'left' | 'right' | null>(null)
  const metric = metrics[0]
  const unit = metric.settings.unit

  const rows = useMemo(() => {
    const filtered = filterPointsByWindow(metric.points, window)
    const rowsByDate = new Map<string, AsymRow>()
    for (const p of filtered) {
      let r = rowsByDate.get(p.conducted_at)
      if (!r) {
        r = { date: p.conducted_at, left: null, right: null }
        rowsByDate.set(p.conducted_at, r)
      }
      if (p.side === 'left') r.left = p.value
      if (p.side === 'right') r.right = p.value
    }
    return Array.from(rowsByDate.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    )
  }, [metric.points, window])

  if (rows.length === 0) {
    return <EmptyChart label="No data in this window." />
  }

  return (
    <ChartFrame ariaLabel={`Bilateral bar chart of ${metric.settings.metric_label}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 4 }} barCategoryGap={'18%'}>
          <CartesianGrid stroke={CHART_COLOURS.borderSubtle} strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(iso: string) => formatCompactDate(iso)}
            tick={AXIS_TICK_STYLE}
            stroke={CHART_COLOURS.borderSubtle}
            tickLine={false}
            minTickGap={20}
          />
          <YAxis
            tick={AXIS_TICK_STYLE}
            stroke={CHART_COLOURS.borderSubtle}
            tickLine={false}
            width={48}
          />
          <Tooltip
            wrapperStyle={{ outline: 'none' }}
            contentStyle={TOOLTIP_WRAPPER_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            itemStyle={TOOLTIP_ITEM_STYLE}
            cursor={{ fill: 'rgba(30,26,24,0.04)' }}
            labelFormatter={(iso) => formatShortDate(String(iso))}
            formatter={((value: unknown, name: unknown) => {
              const label = String(name) === 'left' ? 'Left' : 'Right'
              return [`${value ?? '—'} ${unit}`, label]
            }) as never}
          />
          <Bar
            dataKey="left"
            fill={BILATERAL_COLOURS.left}
            fillOpacity={hovered === 'right' ? 0.25 : 1}
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
            onMouseEnter={() => setHovered('left')}
            onMouseLeave={() => setHovered(null)}
          />
          <Bar
            dataKey="right"
            fill={BILATERAL_COLOURS.right}
            fillOpacity={hovered === 'left' ? 0.25 : 1}
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
            onMouseEnter={() => setHovered('right')}
            onMouseLeave={() => setHovered(null)}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}
