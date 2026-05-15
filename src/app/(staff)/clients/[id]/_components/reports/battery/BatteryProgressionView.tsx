'use client'

/**
 * BatteryProgressionView — the "Progression" sub-view inside a
 * BatteryCard (Phase M Q-J13 locked; sub-toggle's right segment and
 * default mode).
 *
 * The primary lens of the Test Battery view per the handoff brief:
 * "how does this whole assessment shape up over its repetitions?"
 * Per-test cards filtered to ONLY the sessions where THIS battery was
 * applied. Same `TestCard` component the Category view uses (Q-M5 (a)
 * — no specialised "battery-progression" rendering), so the visual
 * language stays consistent across views.
 *
 * Tests with zero points after filtering are hidden (Q-M5.1 (a)) — a
 * saved battery's `metric_keys` may reference tests/metrics not yet
 * captured for this client; surfacing empty cards adds noise without
 * answering the "how has this battery's data trended" question.
 *
 * Test-level aggregates (`total_sessions`, `most_recent_conducted_at`)
 * are recomputed from the filtered metrics so the per-card subline
 * reflects "in this battery" not "across all batteries".
 */

import type {
  ClientTestHistory,
  MetricHistory,
  PublicationRow,
  SessionInfo,
  TestHistory,
} from '@/lib/testing/loader-types'
import { TestCard } from '../TestCard'
import { filterPointsBySessions } from '../helpers'

interface Props {
  sessions: SessionInfo[]
  history: ClientTestHistory
  publications: PublicationRow[]
  clientId: string
}

export function BatteryProgressionView({
  sessions,
  history,
  publications,
  clientId,
}: Props) {
  const sessionIds = new Set(sessions.map((s) => s.session_id))

  const filteredTests = history.tests
    .map((t) => filterTest(t, sessionIds))
    .filter((t): t is TestHistory => t !== null)

  if (filteredTests.length === 0) {
    return (
      <div
        style={{
          padding: '12px 0 4px',
          fontSize: '.82rem',
          color: 'var(--color-text-light)',
        }}
      >
        No data captured in this battery yet.
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
        gap: 12,
      }}
    >
      {filteredTests.map((t) => (
        <TestCard
          key={t.test_id}
          clientId={clientId}
          test={t}
          history={history}
          publications={publications}
          window="all"
        />
      ))}
    </div>
  )
}

/**
 * Filter a TestHistory's metrics to a session set. Returns null when
 * no metric in the test has any points in the filtered set (so the
 * outer caller can drop the test from the list per Q-M5.1 (a)).
 *
 * Recomputes `total_sessions` and `most_recent_conducted_at` from the
 * filtered metric points — without this the subline on the per-test
 * card would still report counts across ALL batteries, which is
 * misleading inside the Battery view.
 */
function filterTest(
  test: TestHistory,
  sessionIds: Set<string>,
): TestHistory | null {
  const filteredMetrics: MetricHistory[] = test.metrics
    .map((m) => ({
      ...m,
      points: filterPointsBySessions(m.points, sessionIds),
    }))
    .filter((m) => m.points.length > 0)

  if (filteredMetrics.length === 0) return null

  const allPoints = filteredMetrics.flatMap((m) => m.points)
  const distinctSessions = new Set(allPoints.map((p) => p.session_id))
  let mostRecent = allPoints[0].conducted_at
  for (const p of allPoints) {
    if (p.conducted_at > mostRecent) mostRecent = p.conducted_at
  }

  return {
    ...test,
    metrics: filteredMetrics,
    total_sessions: distinctSessions.size,
    most_recent_conducted_at: mostRecent,
  }
}
