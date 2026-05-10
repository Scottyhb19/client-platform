/**
 * Formatting helpers shared between the booking picker, the upcoming-
 * bookings view, and the email templates. All formatting is in the
 * organisation's timezone (passed in from the caller) so an EP in
 * Australia/Brisbane and an EP in Australia/Perth render distinct local
 * times for the same UTC instant.
 *
 * Australian English conventions per CLAUDE.md voice & copy:
 *   - "Sat 16 May 2026" date line.
 *   - "7:00am – 8:00am" time range with en dash, lowercase am/pm.
 *   - No leading zero on the hour ("7" not "07").
 */

const WEEKDAY_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const MONTH_LABEL = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

interface DateParts {
  year: number
  month: number // 1-12
  day: number // 1-31
  weekday: number // 0=Sun..6=Sat (matches Date.getDay() convention)
  hour: number // 0-23
  minute: number // 0-59
}

/**
 * Returns the date components of `iso` rendered in `timeZone`. Uses
 * Intl.DateTimeFormat under the hood, which is the only built-in way to
 * pull tz-aware components without an external lib.
 */
function partsInTz(iso: string, timeZone: string): DateParts {
  const d = new Date(iso)
  const fmt = new Intl.DateTimeFormat('en-AU', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(d)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? ''
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  }
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday: weekdayMap[get('weekday')] ?? 0,
    hour: Number(get('hour')) % 24, // hour12:false in en-AU returns 0-23
    minute: Number(get('minute')),
  }
}

/** "Sat 16 May 2026" */
export function formatBookingDateLine(iso: string, timeZone: string): string {
  const p = partsInTz(iso, timeZone)
  return `${WEEKDAY_LABEL[p.weekday]} ${p.day} ${MONTH_LABEL[p.month - 1]} ${p.year}`
}

/** "7:00am" — no leading zero, lowercase am/pm. */
export function formatBookingTime(iso: string, timeZone: string): string {
  const p = partsInTz(iso, timeZone)
  const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12
  const meridiem = p.hour < 12 ? 'am' : 'pm'
  const minutes = p.minute.toString().padStart(2, '0')
  return `${hour12}:${minutes}${meridiem}`
}

/** "7:00am – 8:00am" with an en dash. */
export function formatBookingTimeRange(
  startIso: string,
  endIso: string,
  timeZone: string,
): string {
  return `${formatBookingTime(startIso, timeZone)} – ${formatBookingTime(endIso, timeZone)}`
}

/** ISO date in the org timezone — used as a stable URL key for "which day". */
export function isoDateInTz(iso: string, timeZone: string): string {
  const p = partsInTz(iso, timeZone)
  const m = p.month.toString().padStart(2, '0')
  const d = p.day.toString().padStart(2, '0')
  return `${p.year}-${m}-${d}`
}

/** "Mon 12 May" — short label for day cards (no year). */
export function formatBookingDayShort(
  iso: string,
  timeZone: string,
): string {
  const p = partsInTz(iso, timeZone)
  return `${WEEKDAY_LABEL[p.weekday]} ${p.day} ${MONTH_LABEL[p.month - 1]}`
}
