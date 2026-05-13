/**
 * Shared helpers for the client portal. Kept tiny — the portal is a
 * small surface area so we avoid the abstraction tax.
 */

/** Returns Monday-of-this-week as a Date at 00:00 local time. */
export function mondayOfCurrentWeek(now = new Date()): Date {
  const day = now.getDay() // 0 = Sunday
  const offset = day === 0 ? -6 : 1 - day
  const m = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
  m.setHours(0, 0, 0, 0)
  return m
}

/**
 * Returns the Monday of the calendar week containing the supplied ISO date
 * (YYYY-MM-DD). Tolerates the input being a non-Monday by snapping to the
 * preceding Monday. Returns mondayOfCurrentWeek() when the input is missing
 * or fails to parse — used by the Today page's ?w= query-param navigation.
 */
export function mondayFromIso(iso: string | null | undefined): Date {
  if (!iso) return mondayOfCurrentWeek()
  const parts = iso.split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return mondayOfCurrentWeek()
  }
  const [y, m, d] = parts as [number, number, number]
  const dt = new Date(y, m - 1, d)
  if (Number.isNaN(dt.getTime())) return mondayOfCurrentWeek()
  return mondayOfCurrentWeek(dt)
}

/** YYYY-MM-DD from a Date in local time (no UTC shift). */
export function isoFromDate(d: Date): string {
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${da}`
}

/** 0-indexed day-of-week for display (Mon=0..Sun=6). */
export function weekdayIndex(d: Date): number {
  return (d.getDay() + 6) % 7
}

export function addDays(d: Date, days: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + days)
  return x
}

export function sameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function formatDayLabel(d: Date): string {
  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(d)
}

export function greetingFor(now = new Date()): string {
  const h = now.getHours()
  if (h < 12) return 'Morning'
  if (h < 17) return 'Afternoon'
  return 'Evening'
}

/**
 * Week-strip dot model — one entry per day of the current week. Lives in
 * helpers (not DayScreen.tsx) because both the server page builder and
 * the client component need it; React Server Components forbid importing
 * functions from a 'use client' module into a server file.
 *
 * Phase K (2026-05-13): the dot state stays simple at the strip level per
 * Q-K5 decision — single green dot = "session here." The richer day
 * state machine (skipped vs done, in-progress vs not-started, etc.) lives
 * on the card view via DayState below, not on the strip.
 */
export type WeekDot = {
  date: Date
  dayLabel: string | null
  state: 'rest' | 'done' | 'today' | 'upcoming'
  // program_day_id when this date carries a published programmed day for
  // the client. NULL on rest days. Used by DayScreen to render the cell
  // as a navigation Link to /portal?d=<iso> instead of an inert button —
  // every cell now navigates per Q-K7.
  dayId: string | null
}

/**
 * Per-day completion + in-progress data used both by buildWeekDots (to
 * decide done/upcoming/today) and by deriveDayState (to decide the card's
 * CTA). Keyed by weekdayIndex (Mon=0..Sun=6) on the strip side and by
 * program_day_id on the card side; the server page builds both maps from
 * the same SELECT.
 */
export type DayCompletionEntry = {
  dayLabel: string | null
  done: boolean
  inProgress: boolean
  dayId: string | null
}

export function buildWeekDots(
  weekStart: Date,
  programmedByWeekday: Map<number, DayCompletionEntry>,
): WeekDot[] {
  const out: WeekDot[] = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i)
    const entry = programmedByWeekday.get(weekdayIndex(date))
    const isToday = sameCalendarDay(date, today)
    let state: WeekDot['state'] = 'rest'
    if (entry) {
      // Phase I (§4.5 I-Q4) dropped the `|| isPast` short-circuit so the
      // dot now reflects actual completion, not just "past therefore done."
      // Phase K extends this: in-progress days are also reported as
      // "today/upcoming" on the strip rather than as "done" — the card
      // carries the in-progress nuance, the strip stays at-a-glance.
      if (entry.done) state = 'done'
      else if (isToday) state = 'today'
      else state = 'upcoming'
    }
    out.push({
      date,
      dayLabel: entry?.dayLabel ?? null,
      state,
      dayId: entry?.dayId ?? null,
    })
  }
  return out
}

/**
 * Card-side state machine for the per-day card view. Discriminated union —
 * the DayScreen renders the right CTA via an exhaustive switch over `kind`.
 *
 * Phase K (2026-05-13) introduces this. Pre-Phase-K the card only rendered
 * a "Today, not started OR completed" pair (Phase I I-R3). The card now
 * renders for any day in the week, and the CTA reflects:
 *
 *   today-not-started  →  "Begin session"        → /portal/session/<dayId>
 *   today-in-progress  →  "Resume session"       → /portal/session/<dayId>
 *   today-completed    →  "Session complete · view summary" → /complete
 *   past-completed     →  "View summary"         → /complete
 *   past-skipped       →  inert (no CTA, muted body)
 *   future-scheduled   →  "Begin session early" (confirmation modal)
 *   rest-day           →  no card; PortalEmpty "Rest day" is rendered
 *
 * The kind is computed server-side in page.tsx and handed to the client
 * component as part of the session prop. Doing this server-side means
 * the client component renders a single CTA without conditional ladders.
 */
export type DayState =
  | { kind: 'today-not-started' }
  | { kind: 'today-in-progress' }
  | { kind: 'today-completed' }
  | { kind: 'past-completed' }
  | { kind: 'past-skipped' }
  | { kind: 'future-scheduled'; scheduledLabel: string } // e.g. "Thu 14 May"
  | { kind: 'rest-day' }

/**
 * Compute the card's state for the selected day. Inputs:
 *   - selectedDate     the date the user has selected (today by default)
 *   - hasProgrammedDay whether this date carries a published program_day
 *   - completed        whether that program_day has a completed session
 *   - inProgress       whether that program_day has an in-progress session
 *
 * Pure function — easy to reason about and easy to test in isolation.
 */
export function deriveDayState(
  selectedDate: Date,
  hasProgrammedDay: boolean,
  completed: boolean,
  inProgress: boolean,
): DayState {
  if (!hasProgrammedDay) return { kind: 'rest-day' }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const sel = new Date(selectedDate)
  sel.setHours(0, 0, 0, 0)
  const isToday = sel.getTime() === today.getTime()
  const isPast = sel.getTime() < today.getTime()
  const isFuture = sel.getTime() > today.getTime()

  if (isToday) {
    if (completed) return { kind: 'today-completed' }
    if (inProgress) return { kind: 'today-in-progress' }
    return { kind: 'today-not-started' }
  }
  if (isPast) {
    if (completed) return { kind: 'past-completed' }
    return { kind: 'past-skipped' }
  }
  if (isFuture) {
    return {
      kind: 'future-scheduled',
      scheduledLabel: formatDayLabel(selectedDate),
    }
  }
  // Unreachable — exhaustive above. Defensive fallback.
  return { kind: 'rest-day' }
}
