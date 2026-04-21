'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ChevronRight } from 'lucide-react'

export type DayData = {
  id: string
  day_label: string
  day_of_week: number | null
  sort_order: number
}

export type WeekData = {
  id: string
  week_number: number
  days: DayData[]
}

interface ProgramCalendarProps {
  clientId: string
  programName: string
  daysPerWeek: number
  weeks: WeekData[]
  startDateIso: string | null
  todayIso: string
}

/**
 * Program calendar rendering:
 *   - one collapsible strip per program_week
 *   - each strip opens to a 7-cell Mon→Sun grid
 *   - programmed days (program_days) get a letter label + link to the
 *     Session Builder; rest days render as empty dashed cells
 *
 * The current week (the one containing today) is open by default; all
 * other weeks collapse so scanning a 12-week mesocycle stays tractable.
 */
export function ProgramCalendar({
  clientId,
  programName,
  daysPerWeek,
  weeks,
  startDateIso,
  todayIso,
}: ProgramCalendarProps) {
  const today = new Date(todayIso)
  const startDate = startDateIso ? new Date(startDateIso) : null

  const activeWeekNumber = startDate
    ? findActiveWeekNumber(startDate, today, weeks.length)
    : 1

  const [openWeeks, setOpenWeeks] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(weeks.map((w) => [w.week_number, w.week_number === activeWeekNumber])),
  )

  return (
    <div>
      {weeks.map((week) => {
        const weekStart = startDate
          ? addDays(startDate, (week.week_number - 1) * 7)
          : null
        const weekEnd = weekStart ? addDays(weekStart, 6) : null
        const isThisWeek =
          weekStart && weekEnd && today >= weekStart && today <= weekEnd
        const isOpen = openWeeks[week.week_number] ?? false

        return (
          <div key={week.id} className="wk-strip">
            <button
              type="button"
              className="wk-head"
              style={{
                width: '100%',
                border: 'none',
                textAlign: 'left',
              }}
              onClick={() =>
                setOpenWeeks((prev) => ({
                  ...prev,
                  [week.week_number]: !prev[week.week_number],
                }))
              }
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <ChevronRight
                  size={16}
                  aria-hidden
                  className={`wk-caret ${isOpen ? 'open' : ''}`}
                />
                <span className="wk-label">Week {week.week_number}</span>
                {weekStart && weekEnd && (
                  <span
                    style={{ fontSize: '.78rem', color: 'var(--color-muted)' }}
                  >
                    {formatRange(weekStart, weekEnd)}
                  </span>
                )}
                {isThisWeek && <span className="tag active">This week</span>}
              </div>
              <div className="wk-meta">
                <span>{week.days.length} sessions</span>
                <span>{daysPerWeek} day split</span>
              </div>
            </button>

            {isOpen && (
              <div className="wk-body">
                {renderWeekCells(
                  week,
                  weekStart,
                  today,
                  clientId,
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* Footer caption */}
      <div
        style={{
          fontSize: '.76rem',
          color: 'var(--color-muted)',
          marginTop: 14,
          lineHeight: 1.5,
        }}
      >
        {programName} · click any labelled day to open the Session Builder.
      </div>
    </div>
  )
}

function renderWeekCells(
  week: WeekData,
  weekStart: Date | null,
  today: Date,
  clientId: string,
): React.ReactNode {
  // Monday-first display order: [1,2,3,4,5,6,0]
  const weekdayOrder = [1, 2, 3, 4, 5, 6, 0]
  const daysByDow = new Map<number, DayData>()
  for (const d of week.days) {
    if (d.day_of_week !== null) daysByDow.set(d.day_of_week, d)
  }

  return weekdayOrder.map((dow, i) => {
    const programmed = daysByDow.get(dow) ?? null
    const date = weekStart ? addDays(weekStart, i) : null
    const isToday =
      date && sameCalendarDay(date, today)

    if (!programmed) {
      return (
        <div key={dow} className="day-cell empty">
          {date && (
            <div
              className="day-date"
              style={{ color: 'var(--color-muted)' }}
            >
              {date.getDate()}
            </div>
          )}
        </div>
      )
    }

    return (
      <Link
        key={dow}
        href={`/clients/${clientId}/program/days/${programmed.id}`}
        className={`day-cell ${isToday ? 'today' : ''}`}
        style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
      >
        {date && <div className="day-date">{date.getDate()}</div>}
        <span className="day-tag">Day {programmed.day_label}</span>
      </Link>
    )
  })
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function sameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function formatRange(start: Date, end: Date): string {
  const sameMonth = start.getMonth() === end.getMonth()
  const startPart = new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    ...(sameMonth ? {} : { month: 'short' }),
  }).format(start)
  const endPart = new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
  }).format(end)
  return `${startPart} – ${endPart}`
}

function findActiveWeekNumber(
  start: Date,
  today: Date,
  totalWeeks: number,
): number {
  const diffMs = today.getTime() - start.getTime()
  if (diffMs < 0) return 1
  const weeksIn = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 7)) + 1
  return Math.min(Math.max(weeksIn, 1), totalWeeks)
}
