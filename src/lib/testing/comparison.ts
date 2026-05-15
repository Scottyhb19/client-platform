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
  BatteryRow,
  ClientTestHistory,
  MetricHistory,
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
 * A test within a session-group, paired with the framing_text from
 * the live publication that put it in this group. Per Q-J5 (revised
 * 2026-05-14) the framing comes from THIS publication, not the
 * latest publication for this test_id — different sessions can carry
 * different framings.
 *
 * `framing_text` is null when the publication carried no framing OR
 * when the EP wrote an empty string. The portal renderer treats
 * both as "no framing block to render."
 */
export interface SessionGroupTest {
  test: TestHistory
  framing_text: string | null
}

/**
 * One session-as-battery group for the portal Data tab. The header
 * carries the battery name (or null when no battery template was
 * applied) and the session's conducted_at; the tests inside are the
 * tests with a live publication for this session.
 *
 * Per Q-J5 sign-off (revised 2026-05-14): per-publication
 * frozen-snapshot. A test with N live publications appears in N
 * groups — each group is a "what was tested in this session"
 * snapshot. Hiding a test from an older group would make that
 * session look like it was missing a test.
 *
 * Per Q-J6 (a): standalone captures (no battery_name) render as a
 * single-test group with no special bucket label — degenerate case
 * of the same shape.
 */
export interface SessionGroup {
  /** Anchor session's id — used as a React key. */
  session_id: string
  /** Session's conducted_at, used for the group header. */
  conducted_at: string
  /** Battery template name when one was applied; null for standalone
   *  captures. */
  battery_name: string | null
  /** Tests with live publications in this session, paired with each
   *  publication's framing_text. */
  tests: SessionGroupTest[]
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
    // enforces one live publication per (session, test) pair). Each
    // test carries the framing_text from its publication; empty
    // strings collapse to null.
    const seenTestIds = new Set<string>()
    const tests: SessionGroupTest[] = []
    for (const pub of sessionPubs) {
      if (seenTestIds.has(pub.test_id)) continue
      const test = testById.get(pub.test_id)
      if (!test) continue
      seenTestIds.add(pub.test_id)
      const framing =
        pub.framing_text && pub.framing_text.trim() !== ''
          ? pub.framing_text
          : null
      tests.push({ test, framing_text: framing })
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

// ---------------------------------------------------------------------------
// Battery grouping for the staff Reports tab Battery view (Phase M)
// ---------------------------------------------------------------------------

/**
 * One saved-battery (or orphan pseudo-) group on the staff Reports tab
 * Battery view.
 *
 * Per Phase M Q-M9 (a): every active saved battery in `batteries[]`
 * produces a group, even when no sessions have applied it — the empty
 * group renders the "Not yet applied" muted state.
 *
 * Per Q-J12 (locked): sessions with `applied_battery_id = NULL` collect
 * into a single orphan pseudo-group at the end, displayed as "Not in a
 * saved battery", emitted iff at least one such session exists.
 *
 * Archived batteries (sessions reference a battery id not present in
 * the active `batteries[]` list) are emitted as their own groups in
 * between, using the joined `battery_name` on the session as the
 * label. They are not orphans — the EP did tag the session at capture
 * time; the battery was simply retired later.
 */
export interface BatteryGroup {
  /** Saved battery id, or null for the orphan pseudo-group. */
  battery_id: string | null
  /** Display name — saved battery name, archived battery's joined name,
   *  or "Not in a saved battery" for the orphan group. */
  battery_name: string
  /** True iff this is the orphan pseudo-group. */
  is_orphan: boolean
  /** True iff battery_id is non-null but not in the active batteries
   *  list — preserves the historical tag when an EP archives a battery
   *  template later. */
  is_archived: boolean
  /** Sessions for this group, newest-first by conducted_at. May be
   *  empty for an active saved battery that has not yet been applied
   *  to this client (Q-M9 (a)). */
  sessions: SessionInfo[]
}

/**
 * Pivot the per-client test history into one group per saved battery
 * (plus an optional orphan pseudo-group at the end). Drives the staff
 * Reports tab Battery view (Phase M M-2 onwards).
 *
 * Order:
 * 1. Active saved batteries from `batteries[]`, alphabetical by name.
 *    Empty session lists allowed (Q-M9 (a)).
 * 2. Archived batteries (id seen in sessions but not in `batteries[]`),
 *    alphabetical by joined name.
 * 3. Orphan pseudo-group (`applied_battery_id = NULL`), emitted iff
 *    non-empty (Q-J12).
 *
 * Pure function. No DB, no React state. Importable from server and
 * client components.
 */
export function groupHistoryByBattery(
  history: ClientTestHistory,
  batteries: BatteryRow[],
): BatteryGroup[] {
  // 1. Bucket every session by applied_battery_id (null = orphan).
  //    Also record the joined name for any non-null id we see — we
  //    fall back to this when a session points at an archived battery
  //    that's no longer in `batteries[]`.
  const byBatteryId = new Map<string | null, SessionInfo[]>()
  const seenNames = new Map<string, string>() // battery_id -> battery_name
  for (const s of history.sessions) {
    const key = s.applied_battery_id
    const list = byBatteryId.get(key) ?? []
    list.push(s)
    byBatteryId.set(key, list)
    if (key !== null && s.battery_name !== null) {
      seenNames.set(key, s.battery_name)
    }
  }

  const sortNewestFirst = (xs: SessionInfo[]): SessionInfo[] =>
    [...xs].sort((a, b) => b.conducted_at.localeCompare(a.conducted_at))

  // 2. Active saved batteries — emit a group even with zero sessions.
  const activeIds = new Set(batteries.map((b) => b.id))
  const sortedBatteries = [...batteries].sort((a, b) =>
    a.name.localeCompare(b.name),
  )
  const groups: BatteryGroup[] = sortedBatteries.map((b) => ({
    battery_id: b.id,
    battery_name: b.name,
    is_orphan: false,
    is_archived: false,
    sessions: sortNewestFirst(byBatteryId.get(b.id) ?? []),
  }))

  // 3. Archived batteries — referenced by sessions but not in the
  //    active list. Preserves the historical tag.
  const archivedIds = Array.from(byBatteryId.keys())
    .filter((id): id is string => id !== null && !activeIds.has(id))
    .sort((a, b) =>
      (seenNames.get(a) ?? '').localeCompare(seenNames.get(b) ?? ''),
    )
  for (const id of archivedIds) {
    groups.push({
      battery_id: id,
      battery_name: seenNames.get(id) ?? 'Archived battery',
      is_orphan: false,
      is_archived: true,
      sessions: sortNewestFirst(byBatteryId.get(id) ?? []),
    })
  }

  // 4. Orphan pseudo-group — emitted iff at least one such session
  //    exists. Q-J12 keeps the gap visible to encourage tagging;
  //    suppressing it when empty avoids a meaningless "0 sessions" card.
  const orphans = byBatteryId.get(null) ?? []
  if (orphans.length > 0) {
    groups.push({
      battery_id: null,
      battery_name: 'Not in a saved battery',
      is_orphan: true,
      is_archived: false,
      sessions: sortNewestFirst(orphans),
    })
  }

  return groups
}

// ---------------------------------------------------------------------------
// Per-(metric, session) value bundling — for ClientChartFactory input
// ---------------------------------------------------------------------------

/**
 * Bundle of this-session values for a metric, grouped by side. Mirrors
 * the shape ClientChartFactory consumes (`thisSessionValues`). Returns
 * null when this session captured no values for this metric (e.g. the
 * test wasn't part of this session, or a bilateral metric was captured
 * on neither side — defensive; the per-publication grouping in
 * groupHistoryBySession already excludes such tests).
 */
export function valuesAtSession(
  metric: MetricHistory,
  sessionId: string,
): { left?: number; right?: number; unilateral?: number } | null {
  const sides: Side[] = metric.settings.side_left_right
    ? ['left', 'right']
    : [null]
  const result: { left?: number; right?: number; unilateral?: number } = {}
  let hasAny = false
  for (const side of sides) {
    const point = pointAtSession(metric.points, sessionId, side)
    if (!point) continue
    if (side === 'left') result.left = point.value
    else if (side === 'right') result.right = point.value
    else result.unilateral = point.value
    hasAny = true
  }
  return hasAny ? result : null
}
