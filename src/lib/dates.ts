import { PRACTICE_TIMEZONE } from './constants'

/**
 * ISO `YYYY-MM-DD` for "today" in the practice timezone.
 *
 * Never derive today via `new Date().toISOString().slice(0, 10)` — that is
 * UTC, and the server clock (Vercel) is UTC too, so between local midnight
 * and ~10–11am AEST/AEDT it returns *yesterday* for an Australian practice:
 * wrong today-ring, wrong copy-paste target gating, wrong current-block
 * resolution, exactly when the EP programs. (P0-2 / FM-1,
 * docs/polish/program-calendar.md.)
 *
 * en-CA is the one locale whose date format is YYYY-MM-DD exactly, which
 * makes Intl do the timezone conversion and the formatting in one step.
 */
export function todayIsoInPracticeTz(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PRACTICE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/**
 * True when `tz` is an IANA timezone name `Intl` accepts. Used to sanitise
 * the client-supplied `portal_tz` cookie before trusting it — an unknown
 * zone makes `Intl.DateTimeFormat` throw `RangeError`, which would 500 the
 * page, so we validate first and fall back to the org timezone. (Section 7
 * / Q2, docs/polish/client-portal-pwa.md P0-1.)
 */
export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false
  try {
    // Throws RangeError for an unknown zone; cheap and side-effect-free.
    new Intl.DateTimeFormat('en-CA', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/**
 * ISO `YYYY-MM-DD` for "today" in an arbitrary IANA timezone — the
 * parameterised sibling of todayIsoInPracticeTz(). The client portal
 * resolves the zone per-request from the device (cookie) so "today"
 * follows the user on travel, falling back to the org timezone (Q2).
 */
export function todayIsoInTimeZone(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/**
 * Current hour (0–23) in an IANA timezone — used for the portal greeting,
 * which was previously derived from a UTC `getHours()` and so was off by
 * the AEST offset. `hour12: false` yields a 24h hour; "24" at midnight in
 * some engines is normalised to 0.
 */
export function hourInTimeZone(timeZone: string): number {
  const h = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hour12: false,
  }).format(new Date())
  return Number(h) % 24
}
