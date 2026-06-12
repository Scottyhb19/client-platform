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
