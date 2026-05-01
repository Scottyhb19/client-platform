'use client'

/**
 * MilestoneChart — client-portal-style "baseline → latest with delta"
 * rendering. Used by the Phase D.4 publish-flow preview and (in
 * Phase E) by the client portal itself.
 *
 * Per the schema, `client_view_chart === 'milestone'` is the dominant
 * client view for on_publish metrics: it strips the noise of every
 * intermediate session and shows only "where you started" and "where
 * you are now." Direction-of-good colouring on the delta tells the
 * client whether the change is good news (green) or not (red).
 *
 * Layout (mobile-first, fits the eventual client portal):
 *   ┌────────────────────────────────────────────────┐
 *   │ Knee flexion · Left                            │
 *   │                                                 │
 *   │ 38.5°       ↑ +9.0%      42.0°                  │
 *   │ baseline   improvement   latest                  │
 *   │ 12 Jan      from baseline  28 Apr                │
 *   └────────────────────────────────────────────────┘
 *
 * For bilateral metrics, two milestones render side-by-side.
 */

import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react'
import type { MetricHistory } from '@/lib/testing/loader-types'
import type { Side } from '@/lib/testing/types'
import { colourFor, formatPctChange } from '@/lib/testing/direction'
import { formatShortDate, pickBaseline } from '../helpers'

interface MilestoneChartProps {
  metric: MetricHistory
  /** Values captured in the session being previewed. Used as the
   *  "latest" anchor — what the client will see once this publication
   *  is live. For sessions later than this one, see Phase E client
   *  portal logic. */
  thisSessionValues: { left?: number; right?: number; unilateral?: number }
  /** ISO date of the session being previewed. */
  thisSessionDate: string
}

export function MilestoneChart({
  metric,
  thisSessionValues,
  thisSessionDate,
}: MilestoneChartProps) {
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
        <SideMilestone
          label="Left"
          baseline={pickBaseline(metric.points, 'left')}
          latestValue={thisSessionValues.left}
          latestDate={thisSessionDate}
          unit={unit}
          direction={metric.settings.direction_of_good}
        />
        <SideMilestone
          label="Right"
          baseline={pickBaseline(metric.points, 'right')}
          latestValue={thisSessionValues.right}
          latestDate={thisSessionDate}
          unit={unit}
          direction={metric.settings.direction_of_good}
        />
      </div>
    )
  }

  return (
    <SideMilestone
      label={null}
      baseline={pickBaseline(metric.points)}
      latestValue={thisSessionValues.unilateral}
      latestDate={thisSessionDate}
      unit={unit}
      direction={metric.settings.direction_of_good}
    />
  )
}

function SideMilestone({
  label,
  baseline,
  latestValue,
  latestDate,
  unit,
  direction,
}: {
  label: 'Left' | 'Right' | null
  baseline: { value: number; conducted_at: string } | null
  latestValue: number | undefined
  latestDate: string
  unit: string
  direction: MetricHistory['settings']['direction_of_good']
}) {
  if (latestValue === undefined) {
    // The session captured nothing for this side — render an apologetic
    // placeholder. By construction this shouldn't happen often (the
    // builder filters to metrics this session captured), but bilateral
    // metrics with one side captured produce this state for the other.
    return (
      <div
        style={{
          padding: 14,
          background: 'var(--color-surface)',
          border: '1px dashed var(--color-border-subtle)',
          borderRadius: 10,
          color: 'var(--color-text-light)',
          fontSize: '.8rem',
        }}
      >
        {label ? `${label}: ` : ''}Not captured this session
      </div>
    )
  }

  const isFirstCapture = !baseline || baseline.conducted_at === latestDate
  const pct = baseline ? formatPctChange(baseline.value, latestValue) : '—'
  const colour = baseline
    ? colourFor(direction, baseline.value, latestValue)
    : 'var(--color-muted)'
  const arrow =
    baseline && baseline.value !== latestValue ? (
      latestValue > baseline.value ? (
        <ArrowUp size={14} aria-hidden />
      ) : (
        <ArrowDown size={14} aria-hidden />
      )
    ) : (
      <ArrowRight size={14} aria-hidden />
    )

  return (
    <div
      style={{
        padding: 16,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {label && (
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
          {label}
        </div>
      )}
      {isFirstCapture ? (
        <FirstCapture value={latestValue} unit={unit} date={latestDate} />
      ) : (
        <BaselineToLatest
          baseline={baseline!}
          latestValue={latestValue}
          latestDate={latestDate}
          unit={unit}
          arrow={arrow}
          pct={pct}
          colour={colour}
        />
      )}
    </div>
  )
}

function FirstCapture({
  value,
  unit,
  date,
}: {
  value: number
  unit: string
  date: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1.6rem',
            color: 'var(--color-charcoal)',
            lineHeight: 1,
          }}
        >
          {value}
        </span>
        <span
          style={{
            fontSize: '.78rem',
            color: 'var(--color-text-light)',
            fontWeight: 500,
          }}
        >
          {unit}
        </span>
      </div>
      <div style={{ fontSize: '.74rem', color: 'var(--color-muted)' }}>
        First capture · {formatShortDate(date)}
      </div>
    </div>
  )
}

function BaselineToLatest({
  baseline,
  latestValue,
  latestDate,
  unit,
  arrow,
  pct,
  colour,
}: {
  baseline: { value: number; conducted_at: string }
  latestValue: number
  latestDate: string
  unit: string
  arrow: React.ReactNode
  pct: string
  colour: string
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <Endpoint
        value={baseline.value}
        unit={unit}
        date={baseline.conducted_at}
        label="baseline"
        align="left"
      />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 2,
          color: colour,
          fontWeight: 600,
        }}
      >
        {arrow}
        <span style={{ fontSize: '.78rem', whiteSpace: 'nowrap' }}>{pct}</span>
      </div>
      <Endpoint
        value={latestValue}
        unit={unit}
        date={latestDate}
        label="latest"
        align="right"
        bold
      />
    </div>
  )
}

function Endpoint({
  value,
  unit,
  date,
  label,
  align,
  bold = false,
}: {
  value: number
  unit: string
  date: string
  label: string
  align: 'left' | 'right'
  bold?: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        textAlign: align,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 4,
          justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: bold ? '1.5rem' : '1.05rem',
            color: bold
              ? 'var(--color-charcoal)'
              : 'var(--color-text-light)',
            lineHeight: 1,
          }}
        >
          {value}
        </span>
        <span
          style={{
            fontSize: '.74rem',
            color: 'var(--color-muted)',
            fontWeight: 500,
          }}
        >
          {unit}
        </span>
      </div>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: '.6rem',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--color-muted)',
          fontWeight: 700,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: '.7rem', color: 'var(--color-muted)' }}>
        {formatShortDate(date)}
      </div>
    </div>
  )
}
