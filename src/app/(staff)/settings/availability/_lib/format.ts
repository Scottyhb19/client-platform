// Display helpers for the availability editor.
// AU English: lowercase am/pm attached to the number ("8am", "5:30pm");
// dates as "Sat 23 May 2026"; weekdays Mon=0…Sun=6 to match the rest of
// the codebase (client_available_slots line 481, schedule/page.tsx:79).

const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
const DAY_LONG = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const
const MONTH_SHORT = [
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

export function dayShort(dayOfWeek: number): string {
  return DAY_SHORT[dayOfWeek] ?? '—'
}

export function dayLong(dayOfWeek: number): string {
  return DAY_LONG[dayOfWeek] ?? '—'
}

// "08:00:00" / "08:00" → "8am"; "17:30:00" → "5:30pm".
export function formatTime(hhmmss: string): string {
  const [h, m] = hhmmss.split(':').map(Number)
  if (Number.isNaN(h)) return hhmmss
  const period = h >= 12 ? 'pm' : 'am'
  const hour = h === 0 ? 12 : h > 12 ? h - 12 : h
  return m === 0
    ? `${hour}${period}`
    : `${hour}:${m.toString().padStart(2, '0')}${period}`
}

// "2026-05-23" → "Sat 23 May 2026". Parses as local date (no timezone shift).
export function formatDate(yyyymmdd: string): string {
  const d = new Date(`${yyyymmdd}T00:00:00`)
  if (Number.isNaN(d.getTime())) return yyyymmdd
  // JS Date.getDay() returns 0=Sun…6=Sat; convert to 0=Mon…6=Sun.
  const dayName = DAY_SHORT[(d.getDay() + 6) % 7]
  const day = d.getDate()
  const month = MONTH_SHORT[d.getMonth()]
  const year = d.getFullYear()
  return `${dayName} ${day} ${month} ${year}`
}

// Today as YYYY-MM-DD in the browser's local timezone — used for date-input
// defaults. The DB column has DEFAULT CURRENT_DATE; this is purely UX.
export function todayIso(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  return `${y}-${m}-${day}`
}
