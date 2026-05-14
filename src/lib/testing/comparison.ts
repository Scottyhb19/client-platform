/**
 * Comparison helpers for the testing module.
 *
 * Pure functions, no DB access, no React state. Anything that takes a
 * MetricSeriesPoint stream or a ClientTestHistory + publications pair
 * and produces a derived "compare against another moment" view lives
 * here.
 *
 * Used by:
 * - the session-builder right-rail Reports panel (staff-side, frozen
 *   per-publication snapshot — baseline-vs-previous toggle)
 * - the portal Data tab from Phase J onwards (session-grouped tests
 *   with the same baseline-vs-previous toggle)
 *
 * Sibling to `direction.ts` — both consume MetricHistory shapes and
 * produce comparison metadata without touching the DB.
 *
 * No 'server-only' import — these helpers must work in both server
 * and client components.
 */

import type {
  ClientTestHistory,
  MetricSeriesPoint,
  PublicationRow,
  SessionInfo,
  TestHistory,
} from './loader-types'
import type { Side } from './types'

// ---------------------------------------------------------------------------
// Comparison mode
// ---------------------------------------------------------------------------

/**
 * Two-state segmented control over per-card comparison anchor:
 * - 'baseline' — first-ever capture for that metric/side
 * - 'previous' — the session immediately before the anchor session
 *
 * Whichever mode is active, the anchor stays fixed on the current view's
 * session — only the comparison endpoint moves.
 */
export type ComparisonMode = 'baseline' | 'previous'

// ---------------------------------------------------------------------------
// Previous-before-a-moment picker
// ---------------------------------------------------------------------------

/**
 * The point captured at a specific session, on a specific side, if
 * present. Returns null when this session captured nothing for this
 * side of this metric (bilateral with one side missing, or unilateral
 * accessed by side='left' incorrectly, etc.).
 */
export function pointAtSession(
  points: MetricSeriesPoint[],
  sessionId: string,
  side: Side,
): MetricSeriesPoint | null {
  for (const p of points) {
    if (p.session_id === sessionId && p.side === side) return p
  }
  return null
}

/**
 * Latest point with `conducted_at` strictly less than the anchor, on
 * the same side. Returns null if no earlier point exists on that side.
 *
 * The loader sorts points ASC by conducted_at, but we don't rely on it
 * here — walk the array and keep the running max-below-anchor so a
 * future reorder doesn't silently change the answer.
 */
export function pickPreviousBefore(
  points: MetricSeriesPoint[],
  anchorConductedAt: string,
  side: Side,
): MetricSeriesPoint | null {
  let best: MetricSeriesPoint | null = null
  for (const p of points) {
    if (p.side !== side) continue
    if (p.conducted_at >= anchorConductedAt) continue
    if (best === null || p.conducted_at > best.conducted_at) best = p
  }
  return best
}

// ---------------------------------------------------------------------------
// Session grouping for the portal Data tab (Phase J)
// ---------------------------------------------------------------------------

/**
 * One session-as-battery group for the portal Data tab. The header
 * carries the battery name (or null when no battery template was
 * applied) and the session's conducted_at; the tests inside are the
 * tests whose most-recent live publication landed in this session.
 *
 * Per Q-J1 sign-off (chat 2026-05-14): each test appears in exactly
 * one group, anchored on its most-recent live publication. Same
 * battery captured 5× produces 5 distinct groups, distinguished by
 * date — the date IS the disambiguator (EP rationale).
 */
export interface SessionGroup {
  /** Anchor session's id — used as a React key. */
  session_id: string
  /** Session's conducted_at, used for the group header. */
  conducted_at: string
  /** Battery template name when one was applied; null for standalone
   *  captures (per Q-J6 sign-off: render as a one-test group, no
   *  special bucket). */
  battery_name: string | null
  /** Tests anchored on this session, in catalog order (preserve the
   *  loader's metric_id sort within each test). */
  tests: TestHistory[]
}

/**
 * Pivot ClientTestHistory + publications into session-grouped tests
 * for the portal Data tab. One session-group per session that has at
 * least one live publication; each group lists the tests with live
 * publications for that session.
 *
 * Per Q-J5 sign-off (revised 2026-05-14): per-publication
 * frozen-snapshot semantic, mirror staff `ReportsPanel.tsx`. A test
 * with publications across N sessions appears in N groups — each
 * group is a "what was tested in this session" snapshot for the
 * client, so hiding a test from an older group would make the older
 * session look like it was missing a test.
 *
 * Reconciliation captured in docs/polish/client-portal-data-tab.md
 * §9.2.
 *
 * Groups sorted newest-first by conducted_at (Q-J1.1). Groups with
 * no published tests are not emitted (RLS-hidden auto path also
 * skipped — post-D.6 no schema metric is `auto`, so the strict
 * publication-required behaviour is the only path that matters).
 */
export function groupHistoryBySession(
  history: ClientTestHistory,
  publications: PublicationRow[],
): SessionGroup[] {
  // 1. Group publications by test_session_id.
  const pubsBySession = new Map<string, PublicationRow[]>()
  for (const p of publications) {
    const list = pubsBySession.get(p.test_session_id) ?? []
    list.push(p)
    pubsBySession.set(p.test_session_id, list)
  }

  // 2. Index test_id -> TestHistory for fast lookup.
  const testById = new Map<string, TestHistory>()
  for (const t of history.tests) {
    testById.set(t.test_id, t)
  }

  // 3. Index session_id -> SessionInfo for the group header metadata.
  const sessionById = new Map<string, SessionInfo>()
  for (const s of history.sessions) {
    sessionById.set(s.session_id, s)
  }

  // 4. Emit one group per session_id with at least one live publication.
  const groups: SessionGroup[] = []
  for (const [sid, sessionPubs] of pubsBySession.entries()) {
    const info = sessionById.get(sid)
    if (!info) continue

    // Dedupe by test_id within the session (defensive — the
    // unique-active partial index on client_publications already
    // enforces one live publication per (session, test) pair).
    const seenTestIds = new Set<string>()
    const tests: TestHistory[] = []
    for (const pub of sessionPubs) {
      if (seenTestIds.has(pub.test_id)) continue
      const test = testById.get(pub.test_id)
      if (!test) continue
      seenTestIds.add(pub.test_id)
      tests.push(test)
    }
    if (tests.length === 0) continue

    groups.push({
      session_id: sid,
      conducted_at: info.conducted_at,
      battery_name: info.battery_name,
      tests,
    })
  }

  // 5. Newest first per Q-J1.1.
  groups.sort((a, b) => b.conducted_at.localeCompare(a.conducted_at))
  return groups
}
