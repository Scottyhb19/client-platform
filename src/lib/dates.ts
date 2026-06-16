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

/**
 * Wall-clock parts of an instant as observed in a given IANA timezone.
 *
 * The staff schedule grid (section 9, P0-2) positions every block and the
 * now-line by hour/minute. Reading those off a Date via getHours()/getMinutes()
 * uses the *browser's* timezone, so the grid renders wrong on any off-tz device
 * (a travelling EP, an interstate collaborator). Resolving the parts in
 * PRACTICE_TIMEZONE makes the grid render in clinic-local wall-clock regardless
 * of where the server or the viewer's browser sits.
 *
 * `weekday` is normalised to the project convention 0=Mon … 6=Sun and is
 * derived from y/m/d (locale-independent), not parsed from a localised string.
 */
export type WallClockParts = {
  year: number
  month: number // 1–12
  day: number // 1–31
  hour: number // 0–23
  minute: number
  weekday: number // 0=Mon … 6=Sun
}

export function wallClockPartsInTimeZone(
  instant: Date,
  timeZone: string,
): WallClockParts {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant)
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === t)?.value ?? '0')
  const year = get('year')
  const month = get('month')
  const day = get('day')
  // Some engines emit '24' for midnight under hour12:false; normalise to 0.
  const hour = get('hour') % 24
  const minute = get('minute')
  const jsDow = new Date(Date.UTC(year, month - 1, day)).getUTCDay() // 0=Sun
  return { year, month, day, hour, minute, weekday: (jsDow + 6) % 7 }
}

/**
 * The UTC instant at which a given wall-clock time occurs in `timeZone` — the
 * inverse of wallClockPartsInTimeZone. Used to turn a clicked grid slot (write
 * path) and the practice-tz day boundaries of the appointments query window
 * into real instants without hard-coding the AEST/AEDT offset.
 *
 * Algorithm: guess the instant as if the wall-clock were UTC, measure what
 * wall-clock that guess actually shows in `timeZone`, and correct by the
 * difference (the zone's offset at that moment). Exact outside the ~1h
 * DST-transition window — Sydney transitions at 02:00–03:00, so clinic hours
 * and midnight boundaries are unaffected.
 */
export function zonedTimeToInstant(
  year: number,
  month: number, // 1–12
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0, 0)
  const wall = wallClockPartsInTimeZone(new Date(guess), timeZone)
  const wallAsUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    0,
    0,
  )
  const offsetMs = wallAsUtc - guess
  return new Date(guess - offsetMs)
}

/** Midnight (00:00) of an ISO `YYYY-MM-DD` in `timeZone`, as a UTC instant. */
export function startOfDayInstant(isoDate: string, timeZone: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number)
  return zonedTimeToInstant(y!, m!, d!, 0, 0, timeZone)
}

/**
 * An ISO `YYYY-MM-DD` shifted by `days` whole calendar days.
 *
 * Pure calendar arithmetic done on the UTC ladder (`Date.UTC` normalises month
 * and year rollover), so it never drifts with the server or browser timezone —
 * the input and output are *date labels*, not instants, so there is no DST or
 * offset to get wrong. Used to derive the far edge of the booking window
 * (today + 28 days) before resolving it to a clinic-tz midnight via
 * startOfDayInstant (P2-1).
 */
export function addDaysToIsoDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10)
}
