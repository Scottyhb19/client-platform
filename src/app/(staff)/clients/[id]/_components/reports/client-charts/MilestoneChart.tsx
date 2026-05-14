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
import {
  pickPreviousBefore,
  type ComparisonMode,
} from '@/lib/testing/comparison'
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
  /** Per Q-J3 + Q-J4 (c) sign-off: the per-card comparison toggle on
   *  the portal Data tab swaps the left endpoint between the first
   *  capture (`baseline`) and the most recent prior session
   *  (`previous`). Default `baseline` matches the staff session-
   *  builder Reports panel and the previous portal behaviour. The
   *  staff publish-dialog preview keeps the default — no toggle
   *  there. */
  comparisonMode?: ComparisonMode
}

export function MilestoneChart({
  metric,
  thisSessionValues,
  thisSessionDate,
  comparisonMode = 'baseline',
}: MilestoneChartProps) {
  const isBilateral = metric.settings.side_left_right
  const unit = metric.settings.unit

  // Per-side comparison endpoint picker. In 'previous' mode this can
  // return null when the anchor session is itself the first capture
  // on that side — SideMilestone treats null/equal-to-anchor as the
  // first-capture case and renders the compact caption (Q-J4.1).
  function pickComparisonFor(side: Side) {
    if (comparisonMode === 'previous') {
      return pickPreviousBefore(metric.points, thisSessionDate, side)
    }
    return pickBaseline(metric.points, side ?? undefined)
  }

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
          comparisonPoint={pickComparisonFor('left')}
          comparisonMode={comparisonMode}
          latestValue={thisSessionValues.left}
          latestDate={thisSessionDate}
          unit={unit}
          direction={metric.settings.direction_of_good}
        />
        <SideMilestone
          label="Right"
          comparisonPoint={pickComparisonFor('right')}
          comparisonMode={comparisonMode}
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
      comparisonPoint={pickComparisonFor(null)}
      comparisonMode={comparisonMode}
      latestValue={thisSessionValues.unilateral}
      latestDate={thisSessionDate}
      unit={unit}
      direction={metric.settings.direction_of_good}
    />
  )
}

function SideMilestone({
  label,
  comparisonPoint,
  comparisonMode,
  latestValue,
  latestDate,
  unit,
  direction,
}: {
  label: 'Left' | 'Right' | null
  /** Either the baseline (first capture) or the previous session's
   *  point depending on the parent's comparisonMode. Null when no
   *  prior point exists on this side; treated as first capture. */
  comparisonPoint: { value: number; conducted_at: string } | null
  comparisonMode: ComparisonMode
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

  const isFirstCapture =
    !comparisonPoint || comparisonPoint.conducted_at === latestDate
  const pct = comparisonPoint
    ? formatPctChange(comparisonPoint.value, latestValue)
    : '—'
  const colour = comparisonPoint
    ? colourFor(direction, comparisonPoint.value, latestValue)
    : 'var(--color-muted)'
  const arrow =
    comparisonPoint && comparisonPoint.value !== latestValue ? (
      latestValue > comparisonPoint.value ? (
        <ArrowUp size={14} aria-hidden />
      ) : (
        <ArrowDown size={14} aria-hidden />
      )
    ) : (
      <ArrowRight size={14} aria-hidden />
    )

  // Per Q-J10b sign-off (chat 2026-05-14): first-capture renders as a
  // compact two-line layout — label + value + unit inline on row 1,
  // small "First capture · {date}" caption on row 2. No bordered box.
  // Q-J4.1 reuses this branch when `comparisonMode === 'previous'`
  // but the metric has no prior point on this side — the message is
  // still "First capture" because that's what it factually is.
  if (isFirstCapture) {
    return (
      <FirstCapture
        label={label}
        value={latestValue}
        unit={unit}
        date={latestDate}
      />
    )
  }

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
      <BaselineToLatest
        comparisonPoint={comparisonPoint!}
        comparisonMode={comparisonMode}
        latestValue={latestValue}
        latestDate={latestDate}
        unit={unit}
        arrow={arrow}
        pct={pct}
        colour={colour}
      />
    </div>
  )
}

function FirstCapture({
  label,
  value,
  unit,
  date,
}: {
  label: 'Left' | 'Right' | null
  value: number
  unit: string
  date: string
}) {
  // Compact two-line layout per Q-J10b. Label (when present) sits
  // inline with value+unit on row 1 — `LEFT  -5 deg`; small caption
  // on row 2 — `First capture · 14 May 2026`. No bordered box.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 6,
          flexWrap: 'wrap',
        }}
      >
        {label && (
          <span
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
          </span>
        )}
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1.25rem',
            color: 'var(--color-charcoal)',
            lineHeight: 1.1,
          }}
        >
          {value}
        </span>
        <span
          style={{
            fontSize: '.74rem',
            color: 'var(--color-text-light)',
            fontWeight: 500,
          }}
        >
          {unit}
        </span>
      </div>
      <div style={{ fontSize: '.7rem', color: 'var(--color-muted)' }}>
        First capture · {formatShortDate(date)}
      </div>
    </div>
  )
}

function BaselineToLatest({
  comparisonPoint,
  comparisonMode,
  latestValue,
  latestDate,
  unit,
  arrow,
  pct,
  colour,
}: {
  comparisonPoint: { value: number; conducted_at: string }
  comparisonMode: ComparisonMode
  latestValue: number
  latestDate: string
  unit: string
  arrow: React.ReactNode
  pct: string
  colour: string
}) {
  // Lowercase label per the design — sits below the value as a small
  // muted caption. "baseline" when comparing against the first capture,
  // "previous" when comparing against the immediate prior session.
  const comparisonLabel =
    comparisonMode === 'previous' ? 'previous' : 'baseline'

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
        value={comparisonPoint.value}
        unit={unit}
        date={comparisonPoint.conducted_at}
        label={comparisonLabel}
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
