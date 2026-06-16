// ============================================================================
// booking-window-verify.mjs
// ============================================================================
// Section 9 (Scheduling) — P2-1 / FM-8 regression check.
//
// The booking picker (src/app/portal/book/new/page.tsx) used to pass a raw UTC
// window to client_available_slots: p_from = now(), p_to = now() + 28×24h. The
// RPC builds a date-based day grid but filters slots by instant, so the far
// edge (p_to) is a rolling 28×24h span pinned to the time of day the page
// loaded — the final day's *afternoon* slots get truncated, and shrink further
// the later in the day the client opens the picker.
//
// The fix derives the window from whole calendar days in the CLINIC timezone:
//   p_from = now()  (near edge: the past stays unbookable, drops off through
//                    the day — correct, this edge was never the bug)
//   p_to   = midnight at the START of (today + 28) in the clinic tz
//            (far edge: a stable whole-day boundary, independent of load time).
//
// This script has no test runner to host it (the project ships none — same as
// the P0-2 date-algorithm node check), so it is a committed, re-runnable proof:
//   node scripts/booking-window-verify.mjs
//
// The three helpers below MIRROR src/lib/dates.ts (startOfDayInstant /
// addDaysToIsoDate) — keep them in sync. They are tiny and locked (P0-2), so
// drift risk is low and the value (a fixed-clock regression guard + a worked
// proof of the late-evening case) is real.
// ============================================================================

// --- mirror of src/lib/dates.ts -------------------------------------------

function wallClockPartsInTimeZone(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant)
  const get = (t) => Number(parts.find((p) => p.type === t)?.value ?? '0')
  const year = get('year')
  const month = get('month')
  const day = get('day')
  const hour = get('hour') % 24
  const minute = get('minute')
  return { year, month, day, hour, minute }
}

function zonedTimeToInstant(year, month, day, hour, minute, timeZone) {
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

function startOfDayInstant(isoDate, timeZone) {
  const [y, m, d] = isoDate.split('-').map(Number)
  return zonedTimeToInstant(y, m, d, 0, 0, timeZone)
}

function addDaysToIsoDate(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

// ISO YYYY-MM-DD of an instant in a tz (en-CA == YYYY-MM-DD), mirrors
// todayIsoInTimeZone but taking an explicit instant so the clock is fixed.
function isoDateInTz(instant, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)
}

// --- the window computations ----------------------------------------------

// NEW (shipped): far edge = clinic-tz midnight of (today + 28).
function bookingWindow(nowInstant, tz) {
  const fromIso = nowInstant.toISOString()
  const todayIso = isoDateInTz(nowInstant, tz)
  const toIso = startOfDayInstant(addDaysToIsoDate(todayIso, 28), tz).toISOString()
  return { fromIso, toIso }
}

// OLD (buggy): far edge = now + 28×24h.
function oldBookingWindow(nowInstant) {
  return {
    fromIso: nowInstant.toISOString(),
    toIso: new Date(nowInstant.getTime() + 28 * 24 * 60 * 60 * 1000).toISOString(),
  }
}

// --- assertions -----------------------------------------------------------

let pass = 0
let fail = 0
function check(label, cond) {
  if (cond) {
    pass++
    console.log(`  ok   ${label}`)
  } else {
    fail++
    console.log(`  FAIL ${label}`)
  }
}

const TZ = 'Australia/Sydney'

// A clinic day in each DST regime: 2026-07-15 is AEST (UTC+10), 2026-01-15 is
// AEDT (UTC+11). For each, take two loads on the SAME clinic day — early
// morning (08:00) and late evening (23:30, the gap-doc's late offset).
const cases = [
  { regime: 'AEST', y: 2026, mo: 7, d: 15 },
  { regime: 'AEDT', y: 2026, mo: 1, d: 15 },
]

for (const c of cases) {
  console.log(`\n${c.regime} — clinic day ${c.y}-${String(c.mo).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`)

  const morning = zonedTimeToInstant(c.y, c.mo, c.d, 8, 0, TZ)
  const evening = zonedTimeToInstant(c.y, c.mo, c.d, 23, 30, TZ)

  const wMorning = bookingWindow(morning, TZ)
  const wEvening = bookingWindow(evening, TZ)
  const oMorning = oldBookingWindow(morning)
  const oEvening = oldBookingWindow(evening)

  // 1. THE FIX: the new far edge is identical regardless of load time of day.
  check(
    'new far edge stable across 08:00 vs 23:30 load',
    wMorning.toIso === wEvening.toIso,
  )

  // 2. THE BUG (demonstrated): the old far edge moved with the load time —
  //    15h30m apart, so the late load truncated the far day's afternoon.
  check(
    'old far edge MOVED with load time (the bug we fixed)',
    oMorning.toIso !== oEvening.toIso,
  )

  // 3. CORRECT BOUNDARY: the far edge is clinic-tz midnight of (today + 28).
  const expectedEnd = startOfDayInstant(
    addDaysToIsoDate(`${c.y}-${String(c.mo).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`, 28),
    TZ,
  ).toISOString()
  check('far edge == clinic midnight of (today + 28)', wEvening.toIso === expectedEnd)

  // 4. LAST DAY FULLY BOOKABLE: a slot at 23:00 on day+27 (ends 23:30) fits
  //    under the far edge; a 00:00 slot on day+28 does not — so the last
  //    bookable day is today+27 (28 whole days), not a half-truncated day+28.
  const day27Iso = addDaysToIsoDate(`${c.y}-${String(c.mo).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`, 27)
  const lateSlotStart = startOfDayInstant(day27Iso, TZ).getTime() + 23 * 60 * 60 * 1000
  const lateSlotEnd = lateSlotStart + 30 * 60 * 1000
  check('day+27 23:00–23:30 slot fits under the far edge', lateSlotEnd <= new Date(wEvening.toIso).getTime())

  const day28Iso = addDaysToIsoDate(`${c.y}-${String(c.mo).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`, 28)
  const day28Midnight = startOfDayInstant(day28Iso, TZ).getTime()
  check('day+28 00:00 slot is excluded (>= far edge)', day28Midnight >= new Date(wEvening.toIso).getTime())

  // 5. NEAR EDGE unchanged: p_from is still "now" (past stays unbookable).
  check('near edge == now (late load)', wEvening.fromIso === evening.toISOString())
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
