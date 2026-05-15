'use client'

/**
 * BatterySessionsView — the "Sessions" sub-view inside a BatteryCard
 * (Phase M Q-J13 locked; sub-toggle's left segment).
 *
 * Renders one row per session in the group, newest-first (the order
 * comes from `groupHistoryByBattery`). Each row is a clickable button;
 * clicking expands the row in-place (Q-M4 (c)) to show the tests
 * captured in that session and the per-metric values via Phase J's
 * `valuesAtSession` helper.
 *
 * No baseline/previous comparison toggle inside the expansion — this
 * sub-view is the "what was in this session" audit-trail affordance,
 * not the analytical surface. The Progression sub-view is the
 * analytical lens. For richer per-session comparison the EP uses the
 * Compare sessions overlay or the session-builder rail.
 *
 * Expansion animation mirrors the portal Phase J `PortalSessionGroup`
 * pattern: grid-template-rows 1fr ⇄ 0fr with overflow:hidden inner
 * div, 300ms cubic-bezier(0.4, 0, 0.2, 1).
 */

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { valuesAtSession } from '@/lib/testing/comparison'
import type {
  ClientTestHistory,
  MetricHistory,
  SessionInfo,
  TestHistory,
} from '@/lib/testing/loader-types'

interface Props {
  sessions: SessionInfo[]
  history: ClientTestHistory
}

export function BatterySessionsView({ sessions, history }: Props) {
  if (sessions.length === 0) {
    return (
      <div
        style={{
          padding: '8px 0 4px',
          fontSize: '.82rem',
          color: 'var(--color-text-light)',
        }}
      >
        No sessions yet.
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {sessions.map((s, i) => (
        <SessionRow
          key={s.session_id}
          session={s}
          history={history}
          isFirst={i === 0}
        />
      ))}
    </div>
  )
}

function SessionRow({
  session,
  history,
  isFirst,
}: {
  session: SessionInfo
  history: ClientTestHistory
  isFirst: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const contentId = `battery-session-row-${session.session_id}`

  // Tests that captured at least one metric in this session.
  const testsInSession = history.tests
    .map((t) => ({
      test: t,
      capturedMetrics: t.metrics.filter((m) =>
        m.points.some((p) => p.session_id === session.session_id),
      ),
    }))
    .filter((t) => t.capturedMetrics.length > 0)

  const testCount = testsInSession.length

  return (
    <div
      style={{
        borderTop: isFirst ? 'none' : '1px solid var(--color-border-subtle)',
        paddingTop: isFirst ? 0 : 8,
        paddingBottom: 8,
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={contentId}
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          textAlign: 'left',
          color: 'inherit',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: '.82rem',
              fontWeight: 600,
              color: 'var(--color-charcoal)',
              lineHeight: 1.3,
            }}
          >
            {formatDate(session.conducted_at)}
          </div>
          <div
            style={{
              fontSize: '.7rem',
              color: 'var(--color-muted)',
              marginTop: 1,
            }}
          >
            {testCount} test{testCount === 1 ? '' : 's'}
          </div>
        </div>
        <ChevronDown
          size={16}
          aria-hidden
          style={{
            color: 'var(--color-muted)',
            flexShrink: 0,
            transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
            transition: 'transform 300ms cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        />
      </button>
      <div
        id={contentId}
        style={{
          display: 'grid',
          gridTemplateRows: expanded ? '1fr' : '0fr',
          transition: 'grid-template-rows 300ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <div style={{ overflow: 'hidden', minHeight: 0 }}>
          <div
            style={{
              paddingTop: 10,
              paddingLeft: 4,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            {testsInSession.map(({ test, capturedMetrics }) => (
              <TestSummary
                key={test.test_id}
                test={test}
                metrics={capturedMetrics}
                sessionId={session.session_id}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function TestSummary({
  test,
  metrics,
  sessionId,
}: {
  test: TestHistory
  metrics: MetricHistory[]
  sessionId: string
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: '.8rem',
          fontWeight: 700,
          color: 'var(--color-charcoal)',
          marginBottom: 4,
        }}
      >
        {test.test_name}
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
        }}
      >
        {metrics.map((m) => {
          const values = valuesAtSession(m, sessionId)
          if (!values) return null
          return (
            <MetricLine
              key={m.settings.metric_id}
              metric={m}
              values={values}
            />
          )
        })}
      </div>
    </div>
  )
}

function MetricLine({
  metric,
  values,
}: {
  metric: MetricHistory
  values: { left?: number; right?: number; unilateral?: number }
}) {
  const parts: string[] = []
  if (values.left !== undefined) parts.push(`L ${formatValue(values.left)}`)
  if (values.right !== undefined) parts.push(`R ${formatValue(values.right)}`)
  if (values.unilateral !== undefined) {
    parts.push(formatValue(values.unilateral))
  }

  return (
    <div
      style={{
        fontSize: '.76rem',
        color: 'var(--color-charcoal)',
        display: 'flex',
        alignItems: 'baseline',
        gap: 10,
        flexWrap: 'wrap',
      }}
    >
      <span
        style={{
          fontSize: '.68rem',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: 'var(--color-muted)',
          minWidth: 80,
        }}
      >
        {metric.settings.metric_label}
      </span>
      <span style={{ fontWeight: 600 }}>{parts.join('  ·  ')}</span>
      <span style={{ fontSize: '.7rem', color: 'var(--color-muted)' }}>
        {metric.settings.unit}
      </span>
    </div>
  )
}

function formatValue(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(1)
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}
