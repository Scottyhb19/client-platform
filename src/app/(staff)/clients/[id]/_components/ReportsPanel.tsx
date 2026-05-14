'use client'

/**
 * Published test reports panel — shared between the program calendar and
 * the session builder right rail.
 *
 * List ⇆ reader pattern, mirrored from the rail's NotesPanel so the two
 * tabs feel identical: a compact list of clickable rows, click → reader
 * showing summary cards (the clicked test plus any sibling published
 * tests from the same session, when a battery was applied).
 *
 * Each summary card shows recent score + percentage change for every
 * metric in that test. Direction-of-good colour rule respected via
 * `colourFor` from `@/lib/testing/direction`. A per-card toggle in the
 * card's top-right flips the comparison between "vs Baseline"
 * (first-ever capture for that metric/side) and "vs Previous" (the
 * session immediately before the one being viewed). Both modes are
 * frozen-snapshot — they always anchor on THIS session's value, not on
 * the latest available reading. See docs/polish/session-builder.md §12.
 *
 * Read-only. The publish/unpublish surface lives on the client profile's
 * Reports tab.
 */

import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import {
  colourFor,
  formatPctChange,
} from '@/lib/testing/direction'
import {
  pickPreviousBefore,
  pointAtSession,
  type ComparisonMode,
} from '@/lib/testing/comparison'
import type {
  ClientTestHistory,
  MetricHistory,
  TestHistory,
} from '@/lib/testing/loader-types'
import type { Side } from '@/lib/testing/types'
import { pickBaseline } from './reports/helpers'

const INK = '#1E1A18'
const MUTED = '#78746F'
const FAINT = '#9C9690'
const BORDER = '#E2DDD7'

export type SessionReport = {
  /** client_publications.id */
  id: string
  /** test_sessions.id — used to group sibling publications inside the reader. */
  test_session_id: string
  /** Catalog test_id (resolved to test_name when possible). */
  test_id: string
  /** Friendly test name from the catalog; falls back to test_id on miss. */
  test_name: string
  /** test_sessions.conducted_at — when the test was actually performed. */
  conducted_at: string
  /** Optional clinician framing, max 280 chars. */
  framing_text: string | null
  /** test_sessions.applied_battery_id — null when no battery template was used. */
  applied_battery_id: string | null
  /** Pre-resolved battery name (for the chip); null when no battery applied. */
  battery_name: string | null
}

export function ReportsPanel({
  reports,
  history,
}: {
  reports: SessionReport[]
  history: ClientTestHistory
}) {
  const [openPubId, setOpenPubId] = useState<string | null>(null)

  if (reports.length === 0) {
    return (
      <div className="card" style={{ padding: 18 }}>
        <div className="eyebrow" style={{ fontSize: '.66rem', marginBottom: 10 }}>
          Published reports
        </div>
        <div style={{ fontSize: '.82rem', color: MUTED, lineHeight: 1.5 }}>
          No published reports for this client yet. Publish a test from
          the Reports tab on the client profile and it will appear here.
        </div>
      </div>
    )
  }

  const openReport =
    openPubId === null
      ? null
      : reports.find((r) => r.id === openPubId) ?? null

  if (openReport) {
    return (
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <ReportReader
          report={openReport}
          history={history}
          siblings={reports.filter(
            (r) =>
              r.test_session_id === openReport.test_session_id &&
              r.id !== openReport.id,
          )}
          onBack={() => setOpenPubId(null)}
        />
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div
        className="eyebrow"
        style={{
          fontSize: '.66rem',
          padding: '14px 14px 10px',
        }}
      >
        Published reports
      </div>
      <div style={{ borderTop: `1px solid ${BORDER}` }}>
        {reports.map((r) => (
          <ReportRow
            key={r.id}
            report={r}
            onOpen={() => setOpenPubId(r.id)}
          />
        ))}
      </div>
    </div>
  )
}

function ReportRow({
  report,
  onOpen,
}: {
  report: SessionReport
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display: 'block',
        width: '100%',
        background: 'transparent',
        border: 'none',
        borderBottom: `1px solid ${BORDER}`,
        padding: '10px 14px',
        textAlign: 'left',
        cursor: 'pointer',
        color: 'inherit',
        fontFamily: 'inherit',
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap',
          rowGap: 4,
          fontSize: '.8rem',
          fontWeight: 600,
          color: INK,
          minWidth: 0,
        }}
      >
        <span
          style={{
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '100%',
          }}
        >
          {report.test_name}
        </span>
        {report.battery_name && (
          <span
            style={{
              fontSize: '.66rem',
              fontWeight: 600,
              color: MUTED,
              background: '#EDE8E2',
              padding: '1px 6px',
              borderRadius: 4,
              whiteSpace: 'nowrap',
            }}
          >
            {report.battery_name}
          </span>
        )}
      </div>
      <div
        style={{
          marginTop: 2,
          fontSize: '.72rem',
          color: FAINT,
        }}
      >
        {formatShortDate(report.conducted_at)}
      </div>
    </button>
  )
}

function ReportReader({
  report,
  history,
  siblings,
  onBack,
}: {
  report: SessionReport
  history: ClientTestHistory
  siblings: SessionReport[]
  onBack: () => void
}) {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 10px',
          borderBottom: `1px solid ${BORDER}`,
          background: 'var(--color-surface, #fff)',
        }}
      >
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to reports list"
          style={{
            background: 'transparent',
            border: 'none',
            padding: 4,
            cursor: 'pointer',
            color: FAINT,
            display: 'grid',
            placeItems: 'center',
            borderRadius: 4,
          }}
        >
          <ArrowLeft size={14} aria-hidden />
        </button>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-display, inherit)',
              fontWeight: 700,
              fontSize: '.8rem',
              color: INK,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {formatShortDate(report.conducted_at)}
          </div>
          {report.battery_name && (
            <div
              style={{
                fontSize: '.66rem',
                fontWeight: 600,
                color: MUTED,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {report.battery_name} · {1 + siblings.length} test
              {1 + siblings.length === 1 ? '' : 's'}
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: 12, maxHeight: 480, overflowY: 'auto' }}>
        {report.framing_text && (
          <div
            style={{
              fontSize: '.74rem',
              color: MUTED,
              lineHeight: 1.4,
              fontStyle: 'italic',
              padding: '0 4px 10px',
            }}
          >
            &ldquo;{report.framing_text}&rdquo;
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <TestCard report={report} history={history} />
          {siblings.map((s) => (
            <TestCard key={s.id} report={s} history={history} />
          ))}
        </div>
      </div>
    </div>
  )
}

function TestCard({
  report,
  history,
}: {
  report: SessionReport
  history: ClientTestHistory
}) {
  const [mode, setMode] = useState<ComparisonMode>('baseline')

  const test = history.tests.find((t) => t.test_id === report.test_id) ?? null

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
          marginBottom: 10,
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
          {report.test_name}
        </span>
        <ComparisonToggle mode={mode} onChange={setMode} />
      </div>

      {test === null || test.metrics.length === 0 ? (
        <div style={{ fontSize: '.78rem', color: MUTED, lineHeight: 1.5 }}>
          No values captured for this test yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {test.metrics.map((m) => (
            <MetricBlock
              key={m.settings.metric_id}
              metric={m}
              sessionId={report.test_session_id}
              sessionConductedAt={report.conducted_at}
              mode={mode}
              testRecency={test}
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
  // Two-state segmented control. Width budget ~110px; both labels fit.
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
  testRecency,
}: {
  metric: MetricHistory
  sessionId: string
  sessionConductedAt: string
  mode: ComparisonMode
  testRecency: TestHistory
}) {
  // Suppress unused-var (kept for future "freshness" badge — nudges the
  // EP if the latest test in the catalog is much older than this one).
  void testRecency
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

  // No value captured for this metric/side in this session — show a
  // muted "—" so the metric still appears (helps the EP see what was
  // expected but not measured).
  if (current === null) {
    return (
      <div style={{ fontSize: '.74rem', color: MUTED }}>
        {sideLabel(side) && <span>{sideLabel(side)} · </span>}
        <span>Not captured</span>
      </div>
    )
  }

  // First-capture path: this metric has no prior point on this side, OR
  // this session IS the first point. Either way, no Δ to show.
  const isFirstCapture =
    comparison === null ||
    comparison.session_id === current.session_id

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

// ---------- helpers ----------

function sideLabel(side: Side): string | null {
  if (side === 'left') return 'L'
  if (side === 'right') return 'R'
  return null
}

function formatValue(value: number): string {
  // Trim trailing zeros after a single decimal place so 38 stays 38, not
  // 38.0. Three-significant-digits would be cleaner long-term but the
  // testing module's units are heterogeneous (kg, %, ms, m) and a fixed
  // 1-dp readout is what the profile's MetricBadge does today.
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
