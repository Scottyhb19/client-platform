'use client'

/**
 * BarChartCard — bars per session over time.
 *
 * Used for combined-metric tests (KOOS subscales etc.) where each subscale
 * is a series; one group of bars per session.
 *
 * For single-metric line-chart-style data we use LineChartCard. This
 * component is specifically for `default_chart === 'bar'`.
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
  SERIES_PALETTE,
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

interface BarChartCardProps {
  metrics: MetricHistory[]
  window: TimeWindow
}

interface ChartRow {
  date: string
  [seriesKey: string]: number | string | null
}

export function BarChartCard({ metrics, window }: BarChartCardProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const isBilateral = metrics.length === 1 && metrics[0].settings.side_left_right
  const isCombined = metrics.length > 1
  const unit = metrics[0].settings.unit

  const { rows, series } = useMemo(
    () => buildRows(metrics, window),
    [metrics, window],
  )

  if (rows.length === 0) {
    return <EmptyChart label="No data in this window." />
  }

  return (
    <ChartFrame ariaLabel={`Bar chart of ${metrics.map((m) => m.settings.metric_label).join(', ')}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
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
            formatter={((value: unknown, name: unknown) => [
              `${value ?? '—'} ${unit}`,
              labelFor(String(name), isBilateral, isCombined, metrics),
            ]) as never}
          />
          {series.map((s) => {
            const dim = hovered !== null && hovered !== s.key ? 0.25 : 1
            return (
              <Bar
                key={s.key}
                dataKey={s.key}
                fill={s.colour}
                fillOpacity={dim}
                radius={[3, 3, 0, 0]}
                isAnimationActive={false}
                onMouseEnter={() => setHovered(s.key)}
                onMouseLeave={() => setHovered(null)}
              />
            )
          })}
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

function buildRows(
  metrics: MetricHistory[],
  window: TimeWindow,
): { rows: ChartRow[]; series: Array<{ key: string; colour: string }> } {
  const isBilateral = metrics.length === 1 && metrics[0].settings.side_left_right
  const isCombined = metrics.length > 1
  const rowsByDate = new Map<string, ChartRow>()

  if (isBilateral) {
    const filtered = filterPointsByWindow(metrics[0].points, window)
    for (const p of filtered) {
      let row = rowsByDate.get(p.conducted_at)
      if (!row) {
        row = { date: p.conducted_at }
        rowsByDate.set(p.conducted_at, row)
      }
      const sideKey = p.side ?? 'unilateral'
      row[sideKey] = p.value
    }
    return {
      rows: Array.from(rowsByDate.values()).sort((a, b) =>
        String(a.date).localeCompare(String(b.date)),
      ),
      series: [
        { key: 'left', colour: BILATERAL_COLOURS.left },
        { key: 'right', colour: BILATERAL_COLOURS.right },
      ],
    }
  }

  if (isCombined) {
    const series: Array<{ key: string; colour: string }> = []
    metrics.forEach((m, i) => {
      series.push({
        key: m.settings.metric_id,
        colour: SERIES_PALETTE[i % SERIES_PALETTE.length],
      })
      const filtered = filterPointsByWindow(m.points, window)
      for (const p of filtered) {
        if (p.side !== null) continue
        let row = rowsByDate.get(p.conducted_at)
        if (!row) {
          row = { date: p.conducted_at }
          rowsByDate.set(p.conducted_at, row)
        }
        row[m.settings.metric_id] = p.value
      }
    })
    return {
      rows: Array.from(rowsByDate.values()).sort((a, b) =>
        String(a.date).localeCompare(String(b.date)),
      ),
      series,
    }
  }

  const filtered = filterPointsByWindow(metrics[0].points, window)
  for (const p of filtered) {
    rowsByDate.set(p.conducted_at, { date: p.conducted_at, value: p.value })
  }
  return {
    rows: Array.from(rowsByDate.values()).sort((a, b) =>
      String(a.date).localeCompare(String(b.date)),
    ),
    series: [{ key: 'value', colour: CHART_COLOURS.primary }],
  }
}

function labelFor(
  seriesKey: string,
  isBilateral: boolean,
  isCombined: boolean,
  metrics: MetricHistory[],
): string {
  if (isBilateral) {
    if (seriesKey === 'left') return 'Left'
    if (seriesKey === 'right') return 'Right'
  }
  if (isCombined) {
    const m = metrics.find((x) => x.settings.metric_id === seriesKey)
    return m?.settings.metric_label ?? seriesKey
  }
  return metrics[0].settings.metric_label
}
