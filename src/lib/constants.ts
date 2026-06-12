/**
 * Platform-wide constants.
 *
 * PRACTICE_TIMEZONE — Q4 of the program-calendar sign-off
 * (docs/polish/program-calendar.md §0.1): the practice runs in one timezone,
 * so a constant is the right cost now. If a second practice or a Settings
 * preferences surface ever lands, this graduates to a `practice_preferences`
 * row (same re-trigger as the Q2 pin-state decision) — callers already go
 * through `todayIsoInPracticeTz()` in src/lib/dates.ts, so the swap is
 * one-file.
 */
export const PRACTICE_TIMEZONE = 'Australia/Sydney'
