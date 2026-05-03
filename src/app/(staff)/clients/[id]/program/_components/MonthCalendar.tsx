'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import {
  ChevronRight,
  Copy,
  ExternalLink,
  Repeat,
} from 'lucide-react'
import {
  MonthYearPicker,
  monthArrowStyle,
  MONTH_LABELS_SHORT,
} from '../../../../_components/MonthYearPicker'

// ============================================================================
// Types
// ============================================================================

export interface ProgramSummary {
  id: string
  name: string
  start_date: string       // ISO date 'YYYY-MM-DD'
  duration_weeks: number
}

export interface ProgramExerciseWithMeta {
  id: string
  sort_order: number
  sets: number | null
  reps: string | null
  optional_value: string | null
  optional_metric: string | null
  rpe: number | null
  rest_seconds: number | null
  tempo: string | null
  instructions: string | null
  section_title: string | null
  superset_group_id: string | null
  exercise: { name: string; video_url: string | null } | null
}

export interface ProgramDayWithExercises {
  id: string
  program_id: string
  scheduled_date: string   // ISO date 'YYYY-MM-DD'
  day_label: string
  sort_order: number
  exercises: ProgramExerciseWithMeta[]
}

interface MonthCalendarProps {
  clientId: string
  programs: ProgramSummary[]
  days: ProgramDayWithExercises[]
  todayIso: string
}

// ============================================================================
// MonthCalendar — top level
//
// Phase B (D-PROG-001..003): real calendar months replace week numbers.
// Each month in any program's date range is its own collapsible section.
// The current month auto-expands; the rest start closed. Inside an
// expanded month, weeks render as 7-column Mon-first rows; a programmed
// day cell can be clicked to expand a full-width inline summary with
// the session's exercises and an Open button to enter the Session
// Builder. Copy and Repeat icons are wired but disabled — Phase C
// implements them.
// ============================================================================

const FULL_MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function MonthCalendar({
  clientId,
  programs,
  days,
  todayIso,
}: MonthCalendarProps) {
  const today = parseIso(todayIso)
  const todayMonth = today.getMonth()
  const todayYear = today.getFullYear()

  // Compute the visible month range from the programs' date ranges.
  // Render every month in [earliest start, latest end], inclusive.
  const months = useMemo(
    () => generateMonthSections(programs, today),
    [programs, todayIso],
  )

  // Group days by date string for fast lookup inside cells.
  const daysByDate = useMemo(() => {
    const map = new Map<string, ProgramDayWithExercises>()
    for (const d of days) map.set(d.scheduled_date, d)
    return map
  }, [days])

  // Single open day at a time keeps the calendar readable when the
  // EP is comparing sessions — clicking a new day collapses the prior.
  const [openDayId, setOpenDayId] = useState<string | null>(null)

  // Per-month open/closed state. Default: current month open.
  const [openMonths, setOpenMonths] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const m of months) {
      init[monthKey(m.year, m.month)] = m.year === todayYear && m.month === todayMonth
    }
    return init
  })

  return (
    <div>
      {months.map((m) => {
        const key = monthKey(m.year, m.month)
        const isOpen = openMonths[key] ?? false
        const monthDays = daysInMonth(daysByDate, m.year, m.month)
        const isCurrentMonth = m.year === todayYear && m.month === todayMonth

        return (
          <MonthSection
            key={key}
            year={m.year}
            month={m.month}
            today={today}
            sessionsCount={monthDays.length}
            isCurrentMonth={isCurrentMonth}
            isOpen={isOpen}
            onToggle={() =>
              setOpenMonths((prev) => ({ ...prev, [key]: !isOpen }))
            }
            onJumpToMonth={(y, mo) => {
              // Picker wants to jump to a specific month — open that
              // section and close all others. Smooth-scroll to it.
              setOpenMonths((prev) => {
                const next: Record<string, boolean> = {}
                for (const k of Object.keys(prev)) next[k] = false
                next[monthKey(y, mo)] = true
                return next
              })
              // Defer the scroll until the section has expanded.
              requestAnimationFrame(() => {
                const el = document.getElementById(`month-${monthKey(y, mo)}`)
                el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              })
            }}
            todayMonth={todayMonth}
            todayYear={todayYear}
          >
            <MonthGrid
              year={m.year}
              month={m.month}
              today={today}
              daysByDate={daysByDate}
              programs={programs}
              clientId={clientId}
              openDayId={openDayId}
              onToggleDay={(dayId) =>
                setOpenDayId((prev) => (prev === dayId ? null : dayId))
              }
            />
          </MonthSection>
        )
      })}

      {months.length === 0 && (
        <div
          className="card"
          style={{
            padding: 24,
            textAlign: 'center',
            color: 'var(--color-text-light)',
            fontSize: '.92rem',
          }}
        >
          No programs scheduled in any month yet.
        </div>
      )}
    </div>
  )
}


// ============================================================================
// MonthSection — one month, collapsible. Header carries the month label
// and a click target that opens the MonthYearPicker. Body is the
// 7-col grid passed in as children.
// ============================================================================

interface MonthSectionProps {
  year: number
  month: number
  today: Date
  sessionsCount: number
  isCurrentMonth: boolean
  isOpen: boolean
  onToggle: () => void
  onJumpToMonth: (year: number, month: number) => void
  todayYear: number
  todayMonth: number
  children: React.ReactNode
}

function MonthSection({
  year,
  month,
  sessionsCount,
  isCurrentMonth,
  isOpen,
  onToggle,
  onJumpToMonth,
  todayYear,
  todayMonth,
  children,
}: MonthSectionProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerYear, setPickerYear] = useState(year)

  return (
    <section
      id={`month-${monthKey(year, month)}`}
      className="wk-strip"
      style={{ marginBottom: 12 }}
    >
      <div
        className="wk-head"
        style={{ width: '100%', textAlign: 'left', cursor: 'default' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            onClick={onToggle}
            aria-label={isOpen ? 'Collapse month' : 'Expand month'}
            aria-expanded={isOpen}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              padding: 0,
              display: 'grid',
              placeItems: 'center',
              color: 'var(--color-muted)',
            }}
          >
            <ChevronRight
              size={16}
              aria-hidden
              className={`wk-caret ${isOpen ? 'open' : ''}`}
            />
          </button>

          {/* Month label is itself a button that opens the picker. */}
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setPickerYear(year)
                setPickerOpen((v) => !v)
              }}
              aria-haspopup="dialog"
              aria-expanded={pickerOpen}
              style={{
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                padding: '4px 8px',
                margin: '-4px -8px',
                borderRadius: 7,
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: '1rem',
                color: 'var(--color-charcoal)',
                letterSpacing: '0.005em',
                transition: 'background 120ms',
              }}
            >
              {FULL_MONTH_LABELS[month]} {year}
            </button>
            {pickerOpen && (
              <MonthYearPicker
                year={pickerYear}
                selectedYear={year}
                selectedMonth={month}
                todayYear={todayYear}
                todayMonth={todayMonth}
                onYearChange={(next) => setPickerYear(next)}
                onPick={(y, m) => {
                  setPickerOpen(false)
                  onJumpToMonth(y, m)
                }}
                onClose={() => setPickerOpen(false)}
              />
            )}
          </div>

          {isCurrentMonth && (
            <span className="tag active">This month</span>
          )}
        </div>

        <div className="wk-meta">
          <span>
            {sessionsCount} {sessionsCount === 1 ? 'session' : 'sessions'}
          </span>
        </div>
      </div>

      {isOpen && (
        <div
          className="wk-body"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: 6,
          }}
        >
          {/* Weekday header row */}
          {WEEKDAY_LABELS.map((label) => (
            <div
              key={label}
              style={{
                fontSize: '.66rem',
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--color-muted)',
                textAlign: 'center',
                padding: '4px 0',
              }}
            >
              {label}
            </div>
          ))}
          {children}
        </div>
      )}
    </section>
  )
}


// ============================================================================
// MonthGrid — 7-col grid of dates for one month. Mon-first; prior /
// next month dates greyed. A single expanded day spans grid-column
// 1 / -1 inserted right after that day's calendar week.
// ============================================================================

interface MonthGridProps {
  year: number
  month: number
  today: Date
  daysByDate: Map<string, ProgramDayWithExercises>
  programs: ProgramSummary[]
  clientId: string
  openDayId: string | null
  onToggleDay: (dayId: string) => void
}

function MonthGrid({
  year,
  month,
  today,
  daysByDate,
  programs,
  clientId,
  openDayId,
  onToggleDay,
}: MonthGridProps) {
  // Build the calendar grid from the Monday-on-or-before the 1st of
  // the month through the Sunday-on-or-after the last day. Always 6
  // weeks so the layout doesn't jitter between months.
  const cells = useMemo(() => buildMonthCells(year, month), [year, month])
  const programsById = useMemo(() => {
    const m = new Map<string, ProgramSummary>()
    for (const p of programs) m.set(p.id, p)
    return m
  }, [programs])

  // Group cells into weeks for inserting expanded summaries
  // immediately after the week the open day sits in.
  const weeks: { ord: number; cells: typeof cells }[] = []
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push({ ord: i / 7, cells: cells.slice(i, i + 7) })
  }

  return (
    <>
      {weeks.map((week) => {
        const expandedInThisWeek = week.cells.find((c) => {
          if (!c.inMonth) return false
          const day = daysByDate.get(c.iso)
          return day && day.id === openDayId
        })
        const expandedDay = expandedInThisWeek
          ? daysByDate.get(expandedInThisWeek.iso)!
          : null

        return (
          <FragmentRow key={`wk-${week.ord}`}>
            {week.cells.map((c) => (
              <DateCell
                key={c.iso}
                cell={c}
                today={today}
                day={c.inMonth ? daysByDate.get(c.iso) ?? null : null}
                isOpen={openDayId !== null && daysByDate.get(c.iso)?.id === openDayId}
                onToggle={onToggleDay}
              />
            ))}
            {expandedDay && (
              <DaySummary
                day={expandedDay}
                program={programsById.get(expandedDay.program_id) ?? null}
                clientId={clientId}
                onClose={() => onToggleDay(expandedDay.id)}
              />
            )}
          </FragmentRow>
        )
      })}
    </>
  )
}

// React.Fragment with a key but no DOM node — keeps the grid layout flat.
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}


// ============================================================================
// DateCell — one calendar date. Empty if outside the month or no
// programmed day on that date. Programmed cells get the day_label
// badge and a click handler.
// ============================================================================

interface DateCellProps {
  cell: { iso: string; date: number; inMonth: boolean }
  today: Date
  day: ProgramDayWithExercises | null
  isOpen: boolean
  onToggle: (dayId: string) => void
}

function DateCell({ cell, today, day, isOpen, onToggle }: DateCellProps) {
  const isToday = sameIso(cell.iso, isoFromDate(today))

  if (!cell.inMonth) {
    return (
      <div
        className="day-cell empty"
        style={{ opacity: 0.4 }}
      >
        <div className="day-date" style={{ color: 'var(--color-muted)' }}>
          {cell.date}
        </div>
      </div>
    )
  }

  if (!day) {
    return (
      <div className={`day-cell empty ${isToday ? 'today' : ''}`}>
        <div className="day-date">{cell.date}</div>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onToggle(day.id)}
      className={`day-cell ${isToday ? 'today' : ''}`}
      style={{
        textAlign: 'left',
        cursor: 'pointer',
        font: 'inherit',
        color: 'inherit',
        outline: isOpen ? '2px solid var(--color-primary)' : undefined,
      }}
      aria-expanded={isOpen}
    >
      <div className="day-date">{cell.date}</div>
      <span className="day-tag">Day {day.day_label}</span>
      {day.exercises.length > 0 && (
        <div
          style={{
            fontSize: '.66rem',
            color: 'var(--color-muted)',
            marginTop: 4,
          }}
        >
          {day.exercises.length}{' '}
          {day.exercises.length === 1 ? 'exercise' : 'exercises'}
        </div>
      )}
    </button>
  )
}


// ============================================================================
// DaySummary — full-width inline expansion under the week containing
// the open day. Lists exercises with sequencing badges, sets×reps,
// and the controls (Open / Copy / Repeat). Copy and Repeat are
// rendered but disabled; Phase C wires them.
// ============================================================================

interface DaySummaryProps {
  day: ProgramDayWithExercises
  program: ProgramSummary | null
  clientId: string
  onClose: () => void
}

function DaySummary({ day, program, clientId, onClose }: DaySummaryProps) {
  const sequence = useMemo(() => buildSequence(day.exercises), [day.exercises])

  return (
    <div
      style={{
        gridColumn: '1 / -1',
        background: 'var(--color-card)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 10,
        padding: '14px 16px',
        marginTop: 2,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '1.05rem',
              color: 'var(--color-charcoal)',
            }}
          >
            Day {day.day_label}
          </span>
          <span style={{ fontSize: '.78rem', color: 'var(--color-muted)' }}>
            {formatLongDate(day.scheduled_date)}
          </span>
          {program && (
            <span style={{ fontSize: '.72rem', color: 'var(--color-muted)' }}>
              · {program.name}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            disabled
            title="Copy this session — coming in Phase C"
            aria-label="Copy this session"
            style={iconBtnStyle}
          >
            <Copy size={14} aria-hidden />
          </button>
          <button
            type="button"
            disabled
            title="Repeat weekly — coming in Phase C"
            aria-label="Repeat weekly"
            style={iconBtnStyle}
          >
            <Repeat size={14} aria-hidden />
          </button>
          <Link
            href={`/clients/${clientId}/program/days/${day.id}`}
            className="btn outline"
            style={{ padding: '6px 12px', fontSize: '.78rem', gap: 6 }}
          >
            <ExternalLink size={14} aria-hidden />
            Open
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close summary"
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              padding: '6px 10px',
              fontSize: '.78rem',
              color: 'var(--color-muted)',
              borderRadius: 7,
            }}
          >
            Close
          </button>
        </div>
      </div>

      {day.exercises.length === 0 ? (
        <div
          style={{
            fontSize: '.85rem',
            color: 'var(--color-muted)',
            padding: '8px 0',
          }}
        >
          No exercises programmed yet — click Open to start building this session.
        </div>
      ) : (
        <ol
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {sequence.map(({ exercise, label, isSupersetMember }) => (
            <li
              key={exercise.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '36px 1fr auto',
                gap: 12,
                alignItems: 'baseline',
                padding: '6px 0',
                borderLeft: isSupersetMember
                  ? '2px solid var(--color-accent)'
                  : '2px solid transparent',
                paddingLeft: isSupersetMember ? 8 : 0,
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 700,
                  fontSize: '.78rem',
                  color: isSupersetMember
                    ? 'var(--color-primary)'
                    : 'var(--color-text-light)',
                }}
              >
                {label}
              </span>
              <span
                style={{
                  fontSize: '.92rem',
                  color: 'var(--color-text)',
                }}
              >
                {exercise.exercise?.name ?? 'Exercise'}
              </span>
              <span
                style={{
                  fontSize: '.82rem',
                  color: 'var(--color-text-light)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {formatPrescription(exercise)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

const iconBtnStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  border: '1px solid var(--color-border-subtle)',
  background: 'var(--color-card)',
  borderRadius: 7,
  cursor: 'not-allowed',
  display: 'grid',
  placeItems: 'center',
  color: 'var(--color-muted)',
  opacity: 0.55,
}


// ============================================================================
// Pure helpers
// ============================================================================

function generateMonthSections(programs: ProgramSummary[], today: Date) {
  if (programs.length === 0) {
    // Empty state — show today's month so the calendar header still renders
    return [{ year: today.getFullYear(), month: today.getMonth() }]
  }

  // Earliest start to latest end across all active programs.
  let earliest = parseIso(programs[0]!.start_date)
  let latest = addDaysTo(earliest, programs[0]!.duration_weeks * 7 - 1)

  for (const p of programs) {
    const start = parseIso(p.start_date)
    const end = addDaysTo(start, p.duration_weeks * 7 - 1)
    if (start < earliest) earliest = start
    if (end > latest) latest = end
  }

  // Always include today's month so "This month" is visible even when
  // it's outside any program's range.
  if (today < earliest) earliest = today
  if (today > latest) latest = today

  const months: { year: number; month: number }[] = []
  let cur = new Date(earliest.getFullYear(), earliest.getMonth(), 1)
  const last = new Date(latest.getFullYear(), latest.getMonth(), 1)
  while (cur <= last) {
    months.push({ year: cur.getFullYear(), month: cur.getMonth() })
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
  }
  return months
}

function buildMonthCells(year: number, month: number) {
  // Mon-first calendar grid covering the whole month + leading/trailing
  // days from the adjacent months. Always six rows for layout stability.
  const firstOfMonth = new Date(year, month, 1)
  const dowOfFirst = (firstOfMonth.getDay() + 6) % 7  // Mon = 0
  const start = addDaysTo(firstOfMonth, -dowOfFirst)

  const cells: { iso: string; date: number; inMonth: boolean }[] = []
  for (let i = 0; i < 42; i++) {
    const d = addDaysTo(start, i)
    cells.push({
      iso: isoFromDate(d),
      date: d.getDate(),
      inMonth: d.getMonth() === month && d.getFullYear() === year,
    })
  }
  return cells
}

function daysInMonth(
  daysByDate: Map<string, ProgramDayWithExercises>,
  year: number,
  month: number,
): ProgramDayWithExercises[] {
  const result: ProgramDayWithExercises[] = []
  for (const d of daysByDate.values()) {
    const dt = parseIso(d.scheduled_date)
    if (dt.getFullYear() === year && dt.getMonth() === month) {
      result.push(d)
    }
  }
  return result
}

function buildSequence(exercises: ProgramExerciseWithMeta[]) {
  // Build A1 / A2 / B1 / B2 sequence labels. Adjacent exercises with
  // the same superset_group_id share a letter. Solo exercises get the
  // next letter with index 1.
  const sorted = [...exercises].sort((a, b) => a.sort_order - b.sort_order)
  const out: {
    exercise: ProgramExerciseWithMeta
    label: string
    isSupersetMember: boolean
  }[] = []

  let letterIdx = 0
  let lastGroupId: string | null = null
  let withinGroupIdx = 0

  for (const ex of sorted) {
    if (ex.superset_group_id && ex.superset_group_id === lastGroupId) {
      withinGroupIdx += 1
    } else {
      letterIdx += 1
      withinGroupIdx = 1
      lastGroupId = ex.superset_group_id ?? null
    }
    const letter = letterFor(letterIdx - 1)
    out.push({
      exercise: ex,
      label: `${letter}${withinGroupIdx}`,
      isSupersetMember: ex.superset_group_id !== null,
    })
  }
  return out
}

function letterFor(idx: number): string {
  // 0 → A, 1 → B, ..., 25 → Z, 26 → AA, etc.
  if (idx < 26) return String.fromCharCode(65 + idx)
  const high = Math.floor(idx / 26) - 1
  const low = idx % 26
  return String.fromCharCode(65 + high) + String.fromCharCode(65 + low)
}

function formatPrescription(ex: ProgramExerciseWithMeta): string {
  const parts: string[] = []
  if (ex.sets !== null && ex.reps !== null) {
    parts.push(`${ex.sets} × ${ex.reps}`)
  } else if (ex.sets !== null) {
    parts.push(`${ex.sets} sets`)
  } else if (ex.reps !== null) {
    parts.push(ex.reps)
  }
  if (ex.rpe !== null) parts.push(`RPE ${ex.rpe}`)
  if (ex.rest_seconds !== null && ex.rest_seconds > 0) {
    parts.push(`${ex.rest_seconds}s rest`)
  }
  return parts.join(' · ')
}

function parseIso(iso: string): Date {
  // Local-time interpretation; avoids the UTC-shift that 'new Date(iso)'
  // can introduce for date-only strings near midnight in non-UTC zones.
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y!, (m ?? 1) - 1, d ?? 1)
}

function isoFromDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDaysTo(d: Date, days: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + days)
  return r
}

function sameIso(a: string, b: string): boolean {
  return a === b
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

function formatLongDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-AU', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(parseIso(iso))
  } catch {
    return iso
  }
}

// MONTH_LABELS_SHORT re-exported for any consumer that needs the three-
// letter labels without re-importing from the picker module.
export { MONTH_LABELS_SHORT, MonthYearPicker, monthArrowStyle }
