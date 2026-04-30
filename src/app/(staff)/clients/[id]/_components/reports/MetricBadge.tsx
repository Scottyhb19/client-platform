'use client'

/**
 * MetricBadge — baseline + latest + %-change strip rendered above each
 * chart inside a TestCard.
 *
 * Per docs/decisions.md D-003 (Q7 sign-off):
 * - Baseline shown as a small numeric label, never as a chart line
 * - %-change colour-coded by direction_of_good (green/red/amber/grey)
 * - For bilateral metrics, two strips (L and R) — same logic per side
 */

import type { MetricHistory } from '@/lib/testing/loader-types'
import { colourFor, formatDelta, formatPctChange } from '@/lib/testing/direction'
import {
  filterPointsByWindow,
  pickBaseline,
  pickLatest,
  formatShortDate,
  type TimeWindow,
} from './helpers'

interface MetricBadgeProps {
  metric: MetricHistory
  window: TimeWindow
}

export function MetricBadge({ metric, window }: MetricBadgeProps) {
  const points = filterPointsByWindow(metric.points, window)
  const isBilateral = metric.settings.side_left_right
  const unit = metric.settings.unit

  if (isBilateral) {
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
        }}
      >
        <SideBadge
          sideLabel="Left"
          baseline={pickBaseline(points, 'left')}
          latest={pickLatest(points, 'left')}
          unit={unit}
          direction={metric.settings.direction_of_good}
        />
        <SideBadge
          sideLabel="Right"
          baseline={pickBaseline(points, 'right')}
          latest={pickLatest(points, 'right')}
          unit={unit}
          direction={metric.settings.direction_of_good}
        />
      </div>
    )
  }

  return (
    <SideBadge
      sideLabel={null}
      baseline={pickBaseline(points)}
      latest={pickLatest(points)}
      unit={unit}
      direction={metric.settings.direction_of_good}
    />
  )
}

function SideBadge({
  sideLabel,
  baseline,
  latest,
  unit,
  direction,
}: {
  sideLabel: 'Left' | 'Right' | null
  baseline: { value: number; conducted_at: string } | null
  latest: { value: number; conducted_at: string } | null
  unit: string
  direction: MetricHistory['settings']['direction_of_good']
}) {
  if (!latest) {
    return (
      <div
        style={{
          fontSize: '.74rem',
          color: 'var(--color-text-light)',
          fontStyle: 'italic',
        }}
      >
        {sideLabel ? `${sideLabel}: ` : ''}No data
      </div>
    )
  }
  const pct = baseline ? formatPctChange(baseline.value, latest.value) : '—'
  const delta = baseline ? formatDelta(baseline.value, latest.value) : null
  const colour = baseline
    ? colourFor(direction, baseline.value, latest.value)
    : 'var(--color-muted)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      {sideLabel && (
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '.62rem',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--color-muted)',
            fontWeight: 700,
          }}
        >
          {sideLabel}
        </div>
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          flexWrap: 'wrap',
          minWidth: 0,
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1.4rem',
            color: 'var(--color-charcoal)',
            lineHeight: 1,
            whiteSpace: 'nowrap',
          }}
        >
          {latest.value}
          <span
            style={{
              marginLeft: 4,
              fontSize: '.74rem',
              fontWeight: 500,
              color: 'var(--color-text-light)',
            }}
          >
            {unit}
          </span>
        </div>
        {baseline && (
          <div
            style={{
              fontSize: '.74rem',
              fontWeight: 600,
              color: colour,
              whiteSpace: 'nowrap',
            }}
            title={delta ? `${delta} ${unit}` : ''}
          >
            {pct}
          </div>
        )}
      </div>
      {baseline ? (
        <div
          style={{
            fontSize: '.7rem',
            color: 'var(--color-muted)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          Baseline {baseline.value}
          {unit} · {formatShortDate(baseline.conducted_at)}
        </div>
      ) : (
        <div
          style={{
            fontSize: '.7rem',
            color: 'var(--color-muted)',
          }}
        >
          First capture · {formatShortDate(latest.conducted_at)}
        </div>
      )}
    </div>
  )
}
