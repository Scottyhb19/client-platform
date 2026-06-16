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

  const occurrence = (i) => {
    if (frequency === 'monthly') {
      const totalMonth = m - 1 + i
      const ty = y + Math.floor(totalMonth / 12)
      const tm = ((totalMonth % 12) + 12) % 12
      const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate()
      return new Date(Date.UTC(ty, tm, Math.min(d, lastDay))).toISOString().slice(0, 10)
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

// 4. Monthly from the 31st — clamps to each month's last day, never rolls over.
eq(
  'monthly ×4 from Jan 31 (clamp)',
  computeRecurrenceDates('2026-01-31', 'monthly', 'count', 4, null),
  ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'],
)

// 5. Monthly across a year boundary.
eq(
  'monthly ×3 across year end',
  computeRecurrenceDates('2026-11-15', 'monthly', 'count', 3, null),
  ['2026-11-15', '2026-12-15', '2027-01-15'],
)

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
