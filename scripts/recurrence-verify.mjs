// ============================================================================
// recurrence-verify.mjs
// ============================================================================
// Section 9 (Scheduling) — P2-14 cadence check.
//
// computeRecurrenceDates (in WeekView.tsx) turns a start date + frequency +
// end-rule into the concrete occurrence DATES a recurring booking creates. It
// works in whole CALENDAR units on the UTC ladder so the wall-clock time-of-day
// is preserved across a DST change (the composer re-attaches the chosen time to
// each date via combineDateTime — so adding calendar days, not 24h×N, is what
// keeps "9:00am" at 9:00am over a transition). Monthly clamps to the last day
// of the target month rather than rolling forward.
//
// No test runner ships (same as the P0-2 / P2-1 node checks), so this is the
// committed proof:  node scripts/recurrence-verify.mjs
//
// The function below MIRRORS WeekView.tsx's computeRecurrenceDates — keep in
// sync.
// ============================================================================

const MAX_OCCURRENCES = 52

function computeRecurrenceDates(startIsoDate, frequency, endMode, count, untilIsoDate) {
  const [y, m, d] = startIsoDate.split('-').map(Number)
  if (!y || !m || !d) return []

  const startWeekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0=Sun
  const ordinal = Math.ceil(d / 7) // which occurrence of that weekday: 1..5

  const occurrence = (i) => {
    if (frequency === 'monthly') {
      const totalMonth = m - 1 + i
      const ty = y + Math.floor(totalMonth / 12)
      const tm = ((totalMonth % 12) + 12) % 12
      const firstDow = new Date(Date.UTC(ty, tm, 1)).getUTCDay()
      const firstDate = 1 + ((startWeekday - firstDow + 7) % 7)
      const daysInMonth = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate()
      const count = Math.floor((daysInMonth - firstDate) / 7) + 1
      const targetDate = firstDate + (Math.min(ordinal, count) - 1) * 7
      return new Date(Date.UTC(ty, tm, targetDate)).toISOString().slice(0, 10)
    }
    const step = frequency === 'daily' ? 1 : frequency === 'weekly' ? 7 : 14
    return new Date(Date.UTC(y, m - 1, d + i * step)).toISOString().slice(0, 10)
  }

  const out = []
  if (endMode === 'count') {
    const n = Math.max(1, Math.min(MAX_OCCURRENCES, Math.floor(count) || 1))
    for (let i = 0; i < n; i++) out.push(occurrence(i))
  } else {
    if (!untilIsoDate) return []
    for (let i = 0; i < MAX_OCCURRENCES; i++) {
      const iso = occurrence(i)
      if (iso > untilIsoDate) break
      out.push(iso)
    }
  }
  return out
}

let pass = 0
let fail = 0
function eq(label, got, want) {
  const g = JSON.stringify(got)
  const w = JSON.stringify(want)
  if (g === w) {
    pass++
    console.log(`  ok   ${label}`)
  } else {
    fail++
    console.log(`  FAIL ${label}\n        got  ${g}\n        want ${w}`)
  }
}

// 1. Weekly, count 4 — 7 days apart, across a month boundary.
eq(
  'weekly ×4',
  computeRecurrenceDates('2026-07-13', 'weekly', 'count', 4, null),
  ['2026-07-13', '2026-07-20', '2026-07-27', '2026-08-03'],
)

// 2. Daily, count 3 — consecutive days.
eq(
  'daily ×3',
  computeRecurrenceDates('2026-07-13', 'daily', 'count', 3, null),
  ['2026-07-13', '2026-07-14', '2026-07-15'],
)

// 3. Fortnightly, count 3 — 14 days apart.
eq(
  'fortnightly ×3',
  computeRecurrenceDates('2026-07-13', 'fortnightly', 'count', 3, null),
  ['2026-07-13', '2026-07-27', '2026-08-10'],
)

// 4. Monthly keeps the WEEKDAY, not the day-of-month. 2026-06-18 is the 3rd
//    Thursday → the 3rd Thursday of each following month (all Thursdays), not
//    the 18th (which drifts across weekdays). This is the operator's scenario.
eq(
  'monthly ×4 = 3rd Thursday each month',
  computeRecurrenceDates('2026-06-18', 'monthly', 'count', 4, null),
  ['2026-06-18', '2026-07-16', '2026-08-20', '2026-09-17'],
)

// 5. Monthly clamps the ordinal: 2026-06-29 is the 5th Monday; July has only
//    four Mondays, so it lands on the last (4th) — never spilling into August.
eq(
  'monthly 5th-Monday clamps to last',
  computeRecurrenceDates('2026-06-29', 'monthly', 'count', 2, null),
  ['2026-06-29', '2026-07-27'],
)

// 5b. Property: weekly, fortnightly AND monthly all keep the start's weekday.
const weekdayOf = (iso) => {
  const [yy, mm, dd] = iso.split('-').map(Number)
  return new Date(Date.UTC(yy, mm - 1, dd)).getUTCDay()
}
for (const freq of ['weekly', 'fortnightly', 'monthly']) {
  const dates = computeRecurrenceDates('2026-06-18', freq, 'count', 6, null)
  const startDow = weekdayOf(dates[0])
  eq(
    `${freq} every occurrence is the same weekday`,
    dates.every((iso) => weekdayOf(iso) === startDow),
    true,
  )
}

// 6. Until — inclusive of the end date.
eq(
  'weekly until 2026-08-03 (inclusive)',
  computeRecurrenceDates('2026-07-13', 'weekly', 'until', 0, '2026-08-03'),
  ['2026-07-13', '2026-07-20', '2026-07-27', '2026-08-03'],
)

// 7. Until before the start — zero occurrences (composer blocks submit).
eq(
  'until before start → none',
  computeRecurrenceDates('2026-07-13', 'weekly', 'until', 0, '2026-07-12'),
  [],
)

// 8. Count is capped at 52.
eq(
  'count 100 capped to 52',
  computeRecurrenceDates('2026-07-13', 'weekly', 'count', 100, null).length,
  52,
)

// 9. Until far in the future is capped at 52.
eq(
  'until far future capped to 52',
  computeRecurrenceDates('2026-07-13', 'daily', 'until', 0, '2030-01-01').length,
  52,
)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
