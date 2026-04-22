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
