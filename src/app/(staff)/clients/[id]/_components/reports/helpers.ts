/**
 * Pure helpers for the staff Reports tab.
 *
 * No DB access, no React state. Anything that takes a MetricHistory or
 * TestHistory and produces a derived view (filtered points, baseline,
 * combined-metric groups) lives here.
 */

import type {
  ClientTestHistory,
  MetricHistory,
  MetricSeriesPoint,
  PublicationRow,
  SessionInfo,
  TestHistory,
} from '@/lib/testing/loader-types'
import type { DirectionOfGood, Side } from '@/lib/testing/types'

// ---------------------------------------------------------------------------
// Time window
// ---------------------------------------------------------------------------

export type TimeWindow = 'all' | '12mo' | '6mo' | '3mo'

export const TIME_WINDOW_OPTIONS: Array<{ value: TimeWindow; label: string }> = [
  { value: 'all', label: 'All time' },
  { value: '12mo', label: '12 months' },
  { value: '6mo', label: '6 months' },
  { value: '3mo', label: '3 months' },
]

export function timeWindowCutoff(window: TimeWindow, now = Date.now()): number | null {
  switch (window) {
    case 'all':
      return null
    case '12mo':
      return now - 365 * 24 * 60 * 60 * 1000
    case '6mo':
      return now - 183 * 24 * 60 * 60 * 1000
    case '3mo':
      return now - 92 * 24 * 60 * 60 * 1000
  }
}

/**
 * Filter points by time window. The cutoff is inclusive — a point on the
 * cutoff date is kept. Order is preserved.
 */
export function filterPointsByWindow(
  points: MetricSeriesPoint[],
  window: TimeWindow,
): MetricSeriesPoint[] {
  const cutoff = timeWindowCutoff(window)
  if (cutoff === null) return points
  return points.filter((p) => new Date(p.conducted_at).getTime() >= cutoff)
}

// ---------------------------------------------------------------------------
// Baseline and latest
// ---------------------------------------------------------------------------

/**
 * Earliest point in the array (or per-side if side is given). Points are
 * already sorted ascending by conducted_at in the loader; we don't re-sort.
 */
export function pickBaseline(
  points: MetricSeriesPoint[],
  side?: Side,
): MetricSeriesPoint | null {
  if (points.length === 0) return null
  if (side === undefined) return points[0]
  return points.find((p) => p.side === side) ?? null
}

/** Latest point (or per-side). */
export function pickLatest(
  points: MetricSeriesPoint[],
  side?: Side,
): MetricSeriesPoint | null {
  if (points.length === 0) return null
  if (side === undefined) return points[points.length - 1]
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].side === side) return points[i]
  }
  return null
}

// ---------------------------------------------------------------------------
// Combined-metric detection — KOOS-style same-shape metrics in one chart
// ---------------------------------------------------------------------------

/**
 * Group metrics within a test by "render shape": same default_chart, same
 * unit, same direction_of_good, same side_left_right. Metrics in a group
 * render as one combined chart (separate series). Metrics not in a group
 * render as their own chart.
 *
 * Per docs/decisions.md D-003 (Q6b sign-off): KOOS-style PROMs render as
 * one combined chart; CMJ's mixed-direction metrics render as separate
 * charts because their shape differs.
 *
 * Returns an array of groups in the metric_id sort order of their first
 * member (preserves the loader's deterministic order).
 */
export interface MetricGroup {
  /** Stable key derived from the group's render shape — used as React key. */
  key: string
  /** True if more than one metric is in the group (i.e. the chart will
   *  render multiple series). */
  combined: boolean
  metrics: MetricHistory[]
}

export function groupMetricsByShape(metrics: MetricHistory[]): MetricGroup[] {
  if (metrics.length === 0) return []

  // Stable shape key per metric.
  const shapeKey = (m: MetricHistory): string =>
    [
      m.settings.default_chart,
      m.settings.unit,
      m.settings.direction_of_good,
      m.settings.side_left_right ? 'bil' : 'uni',
    ].join('|')

  // Walk in order, append to last group if shape matches a group already
  // in the list — otherwise start a new group. We DO NOT merge non-adjacent
  // metrics with matching shape; the loader's metric_id sort already groups
  // logically-equivalent metrics together (e.g. KOOS subscales share a
  // common id prefix).
  const groups: MetricGroup[] = []
  for (const m of metrics) {
    const key = shapeKey(m)
    const last = groups[groups.length - 1]
    if (last && shapeKey(last.metrics[0]) === key) {
      last.metrics.push(m)
    } else {
      groups.push({ key, combined: false, metrics: [m] })
    }
  }
  // Mark groups with >1 metric as combined.
  for (const g of groups) {
    g.combined = g.metrics.length > 1
  }
  return groups
}

// ---------------------------------------------------------------------------
// Test sort within a category
// ---------------------------------------------------------------------------

/** Sort tests by most recent first within a subcategory. */
export function sortTestsByRecency(tests: TestHistory[]): TestHistory[] {
  return [...tests].sort((a, b) =>
    b.most_recent_conducted_at.localeCompare(a.most_recent_conducted_at),
  )
}

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

/** AU short date — "Sat 11 Apr 2026" per design system §02 voice. */
export function formatShortDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-AU', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

/** Compact "12 Jan 2026" — for axis ticks. */
export function formatCompactDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-AU', {
      day: 'numeric',
      month: 'short',
      year: '2-digit',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

// ---------------------------------------------------------------------------
// Phase D.3 — comparison overlay helpers
//
// Pivot ClientTestHistory into a row-per-(test, metric, side) view across
// the selected sessions. Empty rows (no value in any selected session)
// are filtered out so the table stays tight when the EP narrows their
// session selection.
// ---------------------------------------------------------------------------

export interface ComparisonRow {
  test_id: string
  test_name: string
  metric_id: string
  metric_label: string
  side: Side
  unit: string
  direction_of_good: DirectionOfGood
  is_custom: boolean
  /** session_id → value for selected sessions only. Missing keys mean
   *  the metric wasn't captured in that session. */
  values: Record<string, number | undefined>
}

export interface ComparisonView {
  /** Selected sessions in chronological ascending order. */
  sessions: SessionInfo[]
  /** Rows: one per (test, metric, side). Bilateral metrics produce
   *  two rows; unilateral metrics produce one. Empty rows (no value
   *  in any selected session) are excluded. */
  rows: ComparisonRow[]
}

/**
 * Build a ComparisonView from the full history filtered to the
 * selected session ids. Rows with no value across all selected
 * sessions are dropped.
 */
export function buildComparisonRows(
  history: ClientTestHistory,
  selectedSessionIds: Set<string>,
): ComparisonView {
  const sessions = history.sessions.filter((s) =>
    selectedSessionIds.has(s.session_id),
  )

  const rows: ComparisonRow[] = []
  for (const t of history.tests) {
    for (const m of t.metrics) {
      const sides: Side[] = m.settings.side_left_right
        ? ['left', 'right']
        : [null]
      for (const sideKey of sides) {
        const values: Record<string, number | undefined> = {}
        let hasAny = false
        for (const p of m.points) {
          if (p.side !== sideKey) continue
          if (!selectedSessionIds.has(p.session_id)) continue
          values[p.session_id] = p.value
          hasAny = true
        }
        if (!hasAny) continue
        rows.push({
          test_id: t.test_id,
          test_name: t.test_name,
          metric_id: m.settings.metric_id,
          metric_label: m.settings.metric_label,
          side: sideKey,
          unit: m.settings.unit,
          direction_of_good: m.settings.direction_of_good,
          is_custom: t.is_custom,
          values,
        })
      }
    }
  }
  return { sessions, rows }
}

/**
 * For one ComparisonRow, find the earliest and latest values across
 * the selected sessions. Returns nulls if the row has no values.
 */
export function rowBaselineLatest(
  row: ComparisonRow,
  sessions: SessionInfo[],
): { baseline: number | null; latest: number | null } {
  let baseline: number | null = null
  let latest: number | null = null
  for (const s of sessions) {
    const v = row.values[s.session_id]
    if (v === undefined) continue
    if (baseline === null) baseline = v
    latest = v
  }
  return { baseline, latest }
}

// ---------------------------------------------------------------------------
// Phase D.5 — per-test publish helpers
//
// The Phase D.4 PublishTab IA was replaced by an inline per-test publish
// button on each TestCard. The data model is now per-(session, test): one
// publication targets one test inside a session, with its own framing.
//
// Helpers below answer the questions a TestCard asks at render time:
//   - "Does this test have any on_publish metrics?" (controls whether
//      the publish UI surfaces at all)
//   - "What's the latest unpublished session for this test?" (the
//      session the Publish button targets)
//   - "What's the live publication for this test, if any?" (controls
//      whether to show the Published badge + Unpublish action)
//   - "Which on_publish metrics captured values in a given session?"
//      (drives the dialog's preview)
// ---------------------------------------------------------------------------

/** Metric in a test that has client_portal_visibility = 'on_publish'. */
export function isOnPublishMetric(m: MetricHistory): boolean {
  return m.settings.client_portal_visibility === 'on_publish'
}

/** True if this test has at least one on_publish metric — gate for
 *  showing the Publish button on the test card at all. */
export function testHasOnPublishMetrics(test: TestHistory): boolean {
  return test.metrics.some(isOnPublishMetric)
}

/** All distinct session_ids in which this test captured an on_publish
 *  metric, sorted ascending by conducted_at. Used to walk publication
 *  state per session. */
export function onPublishSessionIdsForTest(test: TestHistory): string[] {
  const seen = new Map<string, string>() // session_id -> conducted_at
  for (const m of test.metrics) {
    if (!isOnPublishMetric(m)) continue
    for (const p of m.points) {
      if (!seen.has(p.session_id)) seen.set(p.session_id, p.conducted_at)
    }
  }
  return Array.from(seen.entries())
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([id]) => id)
}

/**
 * Find the latest session that captured this test's on_publish metrics
 * AND has no live publication for this test. This is the session the
 * Publish button on the test card publishes when clicked.
 *
 * Returns null when every on_publish session for this test is already
 * published (or there are none).
 */
export function latestUnpublishedSessionForTest(
  test: TestHistory,
  history: ClientTestHistory | null | undefined,
  publications: PublicationRow[] | null | undefined,
): SessionInfo | null {
  const safeHistory = history ?? { tests: [], categories: [], sessions: [] }
  const safePubs = publications ?? []
  // Set of session_ids where THIS test is already published live.
  const publishedSessions = new Set<string>()
  for (const p of safePubs) {
    if (p.test_id === test.test_id) {
      publishedSessions.add(p.test_session_id)
    }
  }
  const sessionIds = onPublishSessionIdsForTest(test)
  // Walk newest first.
  for (let i = sessionIds.length - 1; i >= 0; i--) {
    const sid = sessionIds[i]
    if (publishedSessions.has(sid)) continue
    const info = safeHistory.sessions.find((s) => s.session_id === sid)
    if (info) return info
  }
  return null
}

/**
 * Find the most recent live publication for this test (across all the
 * test's sessions). Used to render the "Published" badge and the
 * Unpublish action on the test card.
 */
export function latestLivePublicationForTest(
  test: TestHistory,
  publications: PublicationRow[] | null | undefined,
): PublicationRow | null {
  const safePubs = publications ?? []
  let latest: PublicationRow | null = null
  for (const p of safePubs) {
    if (p.test_id !== test.test_id) continue
    if (latest === null || p.published_at > latest.published_at) {
      latest = p
    }
  }
  return latest
}

/** All on_publish metrics for this test that captured a value in the
 *  given session, with the per-side values from that session. Drives
 *  the publish dialog's chart preview. */
export function onPublishMetricsForTestInSession(
  test: TestHistory,
  sessionId: string,
): Array<{
  metric: MetricHistory
  thisSessionValues: { left?: number; right?: number; unilateral?: number }
}> {
  const out: Array<{
    metric: MetricHistory
    thisSessionValues: {
      left?: number
      right?: number
      unilateral?: number
    }
  }> = []
  for (const m of test.metrics) {
    if (!isOnPublishMetric(m)) continue
    const values: { left?: number; right?: number; unilateral?: number } = {}
    let captured = false
    for (const p of m.points) {
      if (p.session_id !== sessionId) continue
      captured = true
      if (p.side === 'left') values.left = p.value
      else if (p.side === 'right') values.right = p.value
      else values.unilateral = p.value
    }
    if (captured) out.push({ metric: m, thisSessionValues: values })
  }
  return out
}

/** True if any session captured an on_publish metric for any test that
 *  hasn't been published yet — used by the eventual dashboard
 *  needs-attention panel. The tab-strip visibility check from Phase D.4
 *  is no longer relevant; this helper is kept for the dashboard. */
export function hasPendingPublishWorkflow(
  history: ClientTestHistory | null | undefined,
  publications: PublicationRow[] | null | undefined,
): boolean {
  const safeHistory = history ?? { tests: [], categories: [], sessions: [] }
  for (const t of safeHistory.tests) {
    if (!testHasOnPublishMetrics(t)) continue
    if (latestUnpublishedSessionForTest(t, safeHistory, publications)) {
      return true
    }
  }
  return false
}

/** Relative-time-ago — "9 days ago", "3 weeks ago". */
export function timeAgo(iso: string, now = Date.now()): string {
  try {
    const ms = now - new Date(iso).getTime()
    if (ms < 0) return formatShortDate(iso)
    const days = Math.floor(ms / (1000 * 60 * 60 * 24))
    if (days === 0) return 'today'
    if (days === 1) return 'yesterday'
    if (days < 14) return `${days} days ago`
    const weeks = Math.floor(days / 7)
    if (weeks < 8) return `${weeks} weeks ago`
    const months = Math.floor(days / 30)
    if (months < 18) return `${months} months ago`
    const years = Math.floor(days / 365)
    return `${years} years ago`
  } catch {
    return iso
  }
}
