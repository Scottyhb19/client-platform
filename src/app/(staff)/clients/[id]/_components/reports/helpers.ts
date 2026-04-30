/**
 * Pure helpers for the staff Reports tab.
 *
 * No DB access, no React state. Anything that takes a MetricHistory or
 * TestHistory and produces a derived view (filtered points, baseline,
 * combined-metric groups) lives here.
 */

import type {
  MetricHistory,
  MetricSeriesPoint,
  TestHistory,
} from '@/lib/testing/loader-types'
import type { Side } from '@/lib/testing/types'

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
