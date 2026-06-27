'use client'

/**
 * Reports panel — shared between the program calendar side panel and
 * the session-builder right rail. Phase M M-4 redesign per Q-M7
 * refinement (chat 2026-05-15).
 *
 * Layout: single session-grouped feed (mirrors the portal Phase J
 * `DataView` + `PortalSessionGroup` pattern). One collapsible row per
 * session that has a live publication. Header label = battery name
 * when the session applied one, else the test name for single-test
 * standalones, else the date. Newest first.
 *
 * Pinning per Q-M13 (c) — a pinned session-group surfaces above the
 * unpinned feed under a "Pinned" eyebrow. Pin state lives in
 * `localStorage` keyed on `(client_id)` per Q-M12 (b). User_id scoping
 * is on the bench for premortem reconsideration alongside view-mode
 * persistence (see `project_premortem_view_mode_persistence` memory).
 *
 * Expand-in-place test cards per Q-M14 (c) — the previous `ReportReader`
 * deep-drill is gone. Per-card baseline/previous toggle migrates into
 * the inline test card, matching the portal `PortalTestCard` pattern.
 *
 * SessionBuilder.tsx and CalendarSidePanel.tsx remain byte-identical
 * (load-bearing protect rule); both consume `<ReportsPanel reports
 * history />` with the same prop shape this file has carried since
 * Phase L.
 */

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { ChevronDown, Pin } from 'lucide-react'
import {
  colourFor,
  formatPctChange,
} from '@/lib/testing/direction'
import {
  groupHistoryBySession,
  pickPreviousBefore,
  pointAtSession,
  type ComparisonMode,
  type SessionGroup,
} from '@/lib/testing/comparison'
import type {
  ClientTestHistory,
  MetricHistory,
  PublicationRow,
  TestHistory,
} from '@/lib/testing/loader-types'
import type { Side } from '@/lib/testing/types'
import { pickBaseline } from './reports/helpers'

const INK = '#1E1A18'
const MUTED = '#78746F'
const FAINT = '#9C9690'
const BORDER = '#E2DDD7'

const PIN_KEY_PREFIX = 'odyssey:rail-pins:'

export type SessionReport = {
  /** client_publications.id */
  id: string
  /** test_sessions.id — used to group sibling publications. */
  test_session_id: string
  /** Catalog test_id. */
  test_id: string
  /** Friendly test name from the catalog. */
  test_name: string
  /** test_sessions.conducted_at — when the test was actually performed. */
  conducted_at: string
  /** Optional clinician framing, max 280 chars. */
  framing_text: string | null
  /** test_sessions.applied_battery_id — null when no battery template. */
  applied_battery_id: string | null
  /** Pre-resolved battery name; null when no battery applied. */
  battery_name: string | null
}

export function ReportsPanel({
  reports,
  history,
}: {
  reports: SessionReport[]
  history: ClientTestHistory
}) {
  // clientId is the dynamic segment on every route the rail mounts on
  // (`/clients/[id]/program/...`). useParams() avoids adding a prop to
  // the call sites — particularly SessionBuilder.tsx, which is locked.
  const params = useParams<{ id?: string }>()
  const clientId = params?.id ?? ''

  // Pin state — localStorage keyed on clientId (Q-M12 (b)). SSR-safe:
  // start empty, hydrate from localStorage on mount. The effect re-runs
  // when clientId changes (e.g. navigating between clients in the same
  // panel).
  const [pins, setPins] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    if (!clientId) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR-safe localStorage hydration on mount / clientId change; localStorage is unavailable during render, so this cannot be derived or lazily initialised.
    setPins(loadPins(clientId))
  }, [clientId])

  const togglePin = (sessionId: string) => {
    setPins((prev) => {
      const next = new Set(prev)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      if (clientId) savePins(clientId, next)
      return next
    })
  }

  // Synthesize PublicationRow[] from SessionReport[] for the grouping
  // helper. SessionReport carries everything groupHistoryBySession
  // reads (test_session_id, test_id, framing_text). The synthesized
  // fields (published_at, published_by, created_at) are unread by the
  // helper.
  const publications: PublicationRow[] = useMemo(
    () =>
      reports.map((r) => ({
        id: r.id,
        test_session_id: r.test_session_id,
        test_id: r.test_id,
        framing_text: r.framing_text,
        published_at: r.conducted_at,
        published_by: '',
        created_at: r.conducted_at,
      })),
    [reports],
  )

  const groups = useMemo(
    () => groupHistoryBySession(history, publications),
    [history, publications],
  )

  if (groups.length === 0) {
    return <EmptyCard />
  }

  const pinnedGroups = groups.filter((g) => pins.has(g.session_id))
  const unpinnedGroups = groups.filter((g) => !pins.has(g.session_id))

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div
        className="eyebrow"
        style={{ fontSize: '.66rem', padding: '14px 14px 10px' }}
      >
        Published reports
      </div>
      <div style={{ borderTop: `1px solid ${BORDER}` }}>
        {pinnedGroups.length > 0 && (
          <>
            <SectionLabel label="Pinned" />
            {pinnedGroups.map((g) => (
              <SessionGroupRow
                key={g.session_id}
                group={g}
                pinned
                onTogglePin={() => togglePin(g.session_id)}
              />
            ))}
            {unpinnedGroups.length > 0 && (
              <SectionLabel label="All sessions" />
            )}
          </>
        )}
        {unpinnedGroups.map((g) => (
          <SessionGroupRow
            key={g.session_id}
            group={g}
            pinned={false}
            onTogglePin={() => togglePin(g.session_id)}
          />
        ))}
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------
// Empty state
// ----------------------------------------------------------------------

function EmptyCard() {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div
        className="eyebrow"
        style={{ fontSize: '.66rem', marginBottom: 10 }}
      >
        Published reports
      </div>
      <div style={{ fontSize: '.82rem', color: MUTED, lineHeight: 1.5 }}>
        No published reports for this client yet. Publish a test from
        the Reports tab on the client profile and it will appear here.
      </div>
    </div>
  )
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div
      style={{
        padding: '8px 14px 4px',
        fontSize: '.6rem',
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: FAINT,
        background: '#FAF8F4',
        borderBottom: `1px solid ${BORDER}`,
      }}
    >
      {label}
    </div>
  )
}

// ----------------------------------------------------------------------
// Pin storage
// ----------------------------------------------------------------------

function loadPins(clientId: string): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(PIN_KEY_PREFIX + clientId)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? parsed : [])
  } catch {
    return new Set()
  }
}

function savePins(clientId: string, pins: Set<string>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      PIN_KEY_PREFIX + clientId,
      JSON.stringify(Array.from(pins)),
    )
  } catch {
    /* localStorage may be unavailable; fail silently. */
  }
}

// ----------------------------------------------------------------------
// Session group (collapsible row)
// ----------------------------------------------------------------------

function SessionGroupRow({
  group,
  pinned,
  onTogglePin,
}: {
  group: SessionGroup
  pinned: boolean
  onTogglePin: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const contentId = `rail-session-group-${group.session_id}`
  const testCount = group.tests.length

  // Header label: battery name when one was applied, else the test
  // name for a single-test standalone, else fall back to the date.
  const primaryLabel = group.battery_name
    ? group.battery_name
    : testCount === 1
      ? group.tests[0].test.test_name
      : null

  // Subline: always carries the date; appends "N tests" when there's
  // a primary label (otherwise the test count is implied/visible from
  // the body).
  const sublineParts: string[] = [formatShortDate(group.conducted_at)]
  if (primaryLabel) {
    sublineParts.push(`${testCount} test${testCount === 1 ? '' : 's'}`)
  } else if (testCount > 1) {
    sublineParts.push(`${testCount} tests`)
  }

  return (
    <div style={{ borderBottom: `1px solid ${BORDER}` }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '8px 10px 8px 14px',
        }}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={contentId}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            textAlign: 'left',
            color: 'inherit',
            fontFamily: 'inherit',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            minWidth: 0,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: '.82rem',
                fontWeight: 600,
                color: INK,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                lineHeight: 1.3,
              }}
            >
              {primaryLabel ?? formatShortDate(group.conducted_at)}
            </div>
            <div
              style={{
                marginTop: 1,
                fontSize: '.68rem',
                color: FAINT,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {sublineParts.join(' · ')}
            </div>
          </div>
          <ChevronDown
            size={14}
            aria-hidden
            style={{
              color: MUTED,
              flexShrink: 0,
              transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition:
                'transform 300ms cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          />
        </button>
        <PinButton pinned={pinned} onClick={onTogglePin} />
      </div>
      <div
        id={contentId}
        style={{
          display: 'grid',
          gridTemplateRows: expanded ? '1fr' : '0fr',
          transition:
            'grid-template-rows 300ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <div style={{ overflow: 'hidden', minHeight: 0 }}>
          <div
            style={{
              padding: '2px 12px 12px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {group.tests.map(({ test, framing_text }) => (
              <RailTestCard
                key={`${group.session_id}:${test.test_id}`}
                test={test}
                sessionId={group.session_id}
                sessionConductedAt={group.conducted_at}
                framingText={framing_text}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function PinButton({
  pinned,
  onClick,
}: {
  pinned: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      aria-label={pinned ? 'Unpin from top' : 'Pin to top'}
      aria-pressed={pinned}
      title={pinned ? 'Unpin from top' : 'Pin to top'}
      style={{
        background: 'transparent',
        border: 'none',
        padding: 6,
        cursor: 'pointer',
        color: pinned ? 'var(--color-charcoal)' : FAINT,
        display: 'grid',
        placeItems: 'center',
        borderRadius: 4,
        flexShrink: 0,
        transition: 'color 150ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      <Pin
        size={13}
        aria-hidden
        fill={pinned ? 'currentColor' : 'none'}
        strokeWidth={pinned ? 0 : 2}
      />
    </button>
  )
}

// ----------------------------------------------------------------------
// Inline test card (per Q-M14 (c) — replaces the old ReportReader)
// ----------------------------------------------------------------------

function RailTestCard({
  test,
  sessionId,
  sessionConductedAt,
  framingText,
}: {
  test: TestHistory
  sessionId: string
  sessionConductedAt: string
  framingText: string | null
}) {
  const [mode, setMode] = useState<ComparisonMode>('baseline')

  return (
    <div
      style={{
        border: `1px solid ${BORDER}`,
        borderRadius: 8,
        background: '#fff',
        padding: '10px 12px',
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: framingText ? 6 : 10,
          minWidth: 0,
        }}
      >
        <span
          style={{
            flex: 1,
            fontFamily: 'var(--font-display, inherit)',
            fontWeight: 700,
            fontSize: '.84rem',
            color: INK,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
          }}
        >
          {test.test_name}
        </span>
        <ComparisonToggle mode={mode} onChange={setMode} />
      </div>

      {framingText && (
        <div
          style={{
            fontSize: '.7rem',
            color: MUTED,
            lineHeight: 1.4,
            fontStyle: 'italic',
            padding: '0 0 8px',
          }}
        >
          &ldquo;{framingText}&rdquo;
        </div>
      )}

      {test.metrics.length === 0 ? (
        <div
          style={{
            fontSize: '.78rem',
            color: MUTED,
            lineHeight: 1.5,
          }}
        >
          No values captured for this test.
        </div>
      ) : (
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          {test.metrics.map((m) => (
            <MetricBlock
              key={m.settings.metric_id}
              metric={m}
              sessionId={sessionId}
              sessionConductedAt={sessionConductedAt}
              mode={mode}
            />
          ))}
        </div>
      )}
    </div>
  )
}

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
        background: '#EDE8E2',
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
        padding: '3px 9px',
        borderRadius: 999,
        fontSize: '.66rem',
        fontWeight: 600,
        cursor: 'pointer',
        color: active ? INK : MUTED,
        boxShadow: active ? '0 1px 3px rgba(0,0,0,.06)' : 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
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
  const sides: Side[] = metric.settings.side_left_right
    ? ['left', 'right']
    : [null]

  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontFamily: 'var(--font-display, inherit)',
          fontWeight: 700,
          fontSize: '.62rem',
          letterSpacing: '.06em',
          textTransform: 'uppercase',
          color: FAINT,
          marginBottom: 4,
        }}
      >
        {metric.settings.metric_label}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {sides.map((side) => (
          <MetricRow
            key={side ?? 'unilateral'}
            metric={metric}
            side={side}
            sessionId={sessionId}
            sessionConductedAt={sessionConductedAt}
            mode={mode}
          />
        ))}
      </div>
    </div>
  )
}

function MetricRow({
  metric,
  side,
  sessionId,
  sessionConductedAt,
  mode,
}: {
  metric: MetricHistory
  side: Side
  sessionId: string
  sessionConductedAt: string
  mode: ComparisonMode
}) {
  const current = pointAtSession(metric.points, sessionId, side)
  const comparison =
    mode === 'baseline'
      ? pickBaseline(metric.points, side)
      : pickPreviousBefore(metric.points, sessionConductedAt, side)

  if (current === null) {
    return (
      <div style={{ fontSize: '.74rem', color: MUTED }}>
        {sideLabel(side) && <span>{sideLabel(side)} · </span>}
        <span>Not captured</span>
      </div>
    )
  }

  const isFirstCapture =
    comparison === null || comparison.session_id === current.session_id

  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
          minWidth: 0,
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-display, inherit)',
            fontWeight: 700,
            fontSize: '1rem',
            color: INK,
            lineHeight: 1.1,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            minWidth: 0,
          }}
        >
          {sideLabel(side) && (
            <span
              style={{
                fontFamily: 'var(--font-display, inherit)',
                fontWeight: 700,
                fontSize: '.6rem',
                letterSpacing: '.06em',
                textTransform: 'uppercase',
                color: MUTED,
                marginRight: 6,
              }}
            >
              {sideLabel(side)}
            </span>
          )}
          {formatValue(current.value)}
          <span
            style={{
              marginLeft: 4,
              fontSize: '.7rem',
              fontWeight: 500,
              color: FAINT,
            }}
          >
            {metric.settings.unit}
          </span>
        </div>
        {!isFirstCapture && comparison !== null && (
          <div
            style={{
              fontSize: '.74rem',
              fontWeight: 600,
              color: colourFor(
                metric.settings.direction_of_good,
                comparison.value,
                current.value,
              ),
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {formatPctChange(comparison.value, current.value)}
          </div>
        )}
      </div>
      <div
        style={{
          fontSize: '.68rem',
          color: MUTED,
          marginTop: 2,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {isFirstCapture
          ? `First capture · ${formatShortDate(current.conducted_at)}`
          : `${mode === 'baseline' ? 'Baseline' : 'Previous'} ${formatValue(
              comparison!.value,
            )} ${metric.settings.unit} · ${formatShortDate(
              comparison!.conducted_at,
            )}`}
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

function sideLabel(side: Side): string | null {
  if (side === 'left') return 'L'
  if (side === 'right') return 'R'
  return null
}

function formatValue(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(1)
}

function formatShortDate(iso: string): string {
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
