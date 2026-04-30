'use client'

/**
 * LineChartCard — renders one or more line series over time.
 *
 * Single metric: one line, primary colour.
 * Bilateral metric: two lines (L primary, R muted) with hover-to-emphasize.
 * Combined (KOOS-style): N lines from SERIES_PALETTE.
 */

import { useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
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
import {
  filterPointsByWindow,
  formatCompactDate,
  formatShortDate,
  type TimeWindow,
} from '../helpers'

interface LineChartCardProps {
  metrics: MetricHistory[]
  window: TimeWindow
}

interface ChartRow {
  /** ISO timestamp — used as the X-axis key. */
  date: string
  /** Series values keyed by series id (e.g. "left", "right", or metric_id). */
  [seriesKey: string]: number | string | null
}

export function LineChartCard({ metrics, window }: LineChartCardProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const isBilateral = metrics.length === 1 && metrics[0].settings.side_left_right
  const isCombined = metrics.length > 1

  const { rows, series } = useMemo(
    () => buildChartRows(metrics, window),
    [metrics, window],
  )

  const unit = metrics[0].settings.unit

  if (rows.length === 0) {
    return (
      <EmptyChart label="No data in this window." />
    )
  }

  return (
    <ChartFrame ariaLabel={`Line chart of ${metrics.map((m) => m.settings.metric_label).join(', ')}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
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
            labelFormatter={(iso) => formatShortDate(String(iso))}
            formatter={((value: unknown, name: unknown) => [
              `${value ?? '—'} ${unit}`,
              labelFor(String(name), isBilateral, isCombined, metrics),
            ]) as never}
          />
          {series.map((s) => {
            const dim =
              hovered !== null && hovered !== s.key ? 0.18 : 1
            return (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={s.colour}
                strokeWidth={2}
                strokeOpacity={dim}
                dot={{ r: 3, strokeWidth: 1.5, stroke: s.colour, fill: '#fff', strokeOpacity: dim }}
                activeDot={{ r: 5, strokeWidth: 2, stroke: s.colour, fill: '#fff' }}
                isAnimationActive={false}
                connectNulls
                onMouseEnter={() => setHovered(s.key)}
                onMouseLeave={() => setHovered(null)}
              />
            )
          })}
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

function buildChartRows(
  metrics: MetricHistory[],
  window: TimeWindow,
): { rows: ChartRow[]; series: Array<{ key: string; colour: string }> } {
  const isBilateral = metrics.length === 1 && metrics[0].settings.side_left_right
  const isCombined = metrics.length > 1

  // Map of session date → row. We key by conducted_at so that L and R
  // captured in the same session land on the same x-tick.
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
    const series: Array<{ key: string; colour: string }> = [
      { key: 'left', colour: BILATERAL_COLOURS.left },
      { key: 'right', colour: BILATERAL_COLOURS.right },
    ]
    return {
      rows: Array.from(rowsByDate.values()).sort((a, b) =>
        String(a.date).localeCompare(String(b.date)),
      ),
      series,
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
        if (p.side !== null) continue // combined metrics aren't bilateral by definition
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

  // Single unilateral metric.
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

export function EmptyChart({ label }: { label: string }) {
  return (
    <div
      style={{
        width: '100%',
        height: 220,
        display: 'grid',
        placeItems: 'center',
        background: 'var(--color-surface)',
        border: '1px dashed var(--color-border-subtle)',
        borderRadius: 8,
        color: 'var(--color-text-light)',
        fontSize: '.82rem',
      }}
    >
      {label}
    </div>
  )
}
