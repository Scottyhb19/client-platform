'use client'

import { useState } from 'react'
import type {
  MetricHistory,
  TestHistory,
} from '@/lib/testing/loader-types'
import {
  valuesAtSession,
  type ComparisonMode,
} from '@/lib/testing/comparison'
import { ClientChartFactory } from '@/app/(staff)/clients/[id]/_components/reports/client-charts/ClientChartFactory'
import { PortalFramingBlock } from './PortalFramingBlock'

interface Props {
  test: TestHistory
  /** The session-group's anchor session_id. Per Q-J5 (revised
   *  2026-05-14): each card is a frozen snapshot of THIS session, not
   *  the test's latest capture. */
  sessionId: string
  /** Anchor session's conducted_at — passed to ClientChartFactory as
   *  thisSessionDate, used by MilestoneChart to decide first-capture
   *  vs comparison rendering. */
  sessionConductedAt: string
  /** Framing text from the live publication for (sessionId, test_id),
   *  null when the EP wrote no framing for this publication. */
  framing: string | null
}

/**
 * One test card inside a PortalSessionGroup. Owns the per-card
 * comparison toggle (Q-J3 (a) sign-off) — defaults to 'baseline'
 * (Q-J15) and switches to 'previous' on tap. MilestoneChart consumes
 * the mode via ClientChartFactory and swaps its left endpoint
 * accordingly; when 'previous' is selected but no prior point exists
 * on a metric's side, the milestone collapses to its first-capture
 * caption (Q-J4.1).
 *
 * Other client_view_chart variants (line / bar / narrative_only)
 * ignore the mode — out of scope for J-3 per Q-J4 (c).
 */
export function PortalTestCard({
  test,
  sessionId,
  sessionConductedAt,
  framing,
}: Props) {
  const [mode, setMode] = useState<ComparisonMode>('baseline')

  return (
    <article
      className="portal-card is-compact"
      style={{
        padding: '14px 14px 16px',
        marginBottom: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minWidth: 0,
        }}
      >
        <h3
          style={{
            flex: 1,
            margin: 0,
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1.05rem',
            letterSpacing: '-.005em',
            color: 'var(--color-charcoal)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
          }}
        >
          {test.test_name}
        </h3>
        <ComparisonToggle mode={mode} onChange={setMode} />
      </header>

      {framing && <PortalFramingBlock text={framing} />}

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {test.metrics.map((metric) => (
          <MetricBlock
            key={metric.settings.metric_id}
            metric={metric}
            sessionId={sessionId}
            sessionConductedAt={sessionConductedAt}
            mode={mode}
          />
        ))}
      </div>
    </article>
  )
}

function MetricBlock({
  metric,
  sessionId,
  sessionConductedAt,
  mode,
}: {
  metric: MetricHistory
  sessionId: string
  sessionConductedAt: string
  mode: ComparisonMode
}) {
  const values = valuesAtSession(metric, sessionId)
  if (!values) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: '.66rem',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--color-muted)',
          fontWeight: 700,
        }}
      >
        {metric.settings.metric_label}
      </div>
      <ClientChartFactory
        metric={metric}
        thisSessionValues={values}
        thisSessionDate={sessionConductedAt}
        framingText={null}
        comparisonMode={mode}
      />
    </div>
  )
}

/**
 * Two-state segmented control — mirrors the staff session-builder
 * ReportsPanel.tsx visual treatment per Q-J14 sign-off. Slightly
 * larger touch targets than the staff version because the portal
 * is mobile-first.
 */
function ComparisonToggle({
  mode,
  onChange,
}: {
  mode: ComparisonMode
  onChange: (next: ComparisonMode) => void
}) {
  return (
    <div
      role="group"
      aria-label="Comparison mode"
      style={{
        display: 'inline-flex',
        gap: 0,
        background: 'var(--color-surface)',
        borderRadius: 999,
        padding: 2,
        flexShrink: 0,
      }}
    >
      <ToggleSegment
        active={mode === 'baseline'}
        onClick={() => onChange('baseline')}
        label="Baseline"
      />
      <ToggleSegment
        active={mode === 'previous'}
        onClick={() => onChange('previous')}
        label="Previous"
      />
    </div>
  )
}

function ToggleSegment({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        background: active ? '#fff' : 'transparent',
        border: 'none',
        padding: '4px 11px',
        borderRadius: 999,
        fontFamily: 'var(--font-sans)',
        fontSize: '.7rem',
        fontWeight: 600,
        cursor: 'pointer',
        color: active ? 'var(--color-charcoal)' : 'var(--color-muted)',
        boxShadow: active ? '0 1px 3px rgba(0,0,0,.06)' : 'none',
        whiteSpace: 'nowrap',
        transition:
          'background 150ms cubic-bezier(0.4, 0, 0.2, 1), color 150ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      {label}
    </button>
  )
}
