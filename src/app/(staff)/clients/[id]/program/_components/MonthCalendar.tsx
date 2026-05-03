'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Repeat,
  X,
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
// MonthCalendar — single month visible at a time. Header carries the
// month label (click for picker), prev/next arrows, and a Today button.
// Body is a Mon-first 7×6 grid for the visible month. Programmed days
// open a popover anchored to the cell that stays inside the column,
// so the rest of the week stays clickable underneath.
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

  // Visible month — defaults to today's month. Prev/next arrows and
  // the picker move it; a Today button jumps back.
  const [visibleYear, setVisibleYear] = useState(todayYear)
  const [visibleMonth, setVisibleMonth] = useState(todayMonth)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerYear, setPickerYear] = useState(todayYear)

  // Group days by date string for fast lookup inside cells.
  const daysByDate = useMemo(() => {
    const map = new Map<string, ProgramDayWithExercises>()
    for (const d of days) map.set(d.scheduled_date, d)
    return map
  }, [days])

  const programsById = useMemo(() => {
    const m = new Map<string, ProgramSummary>()
    for (const p of programs) m.set(p.id, p)
    return m
  }, [programs])

  // Single open day at a time keeps focus on one summary popover.
  const [openDayId, setOpenDayId] = useState<string | null>(null)

  function gotoMonth(direction: 'prev' | 'next') {
    const delta = direction === 'prev' ? -1 : 1
    const next = new Date(visibleYear, visibleMonth + delta, 1)
    setVisibleYear(next.getFullYear())
    setVisibleMonth(next.getMonth())
    setOpenDayId(null)
  }

  function gotoToday() {
    setVisibleYear(todayYear)
    setVisibleMonth(todayMonth)
    setOpenDayId(null)
  }

  const isViewingThisMonth =
    visibleYear === todayYear && visibleMonth === todayMonth

  return (
    <div>
      {/* ─── Top header: month label centered with prev/next; Today
          tucked to the right edge so the centered group stays visually
          balanced. ─── */}
      <div
        style={{
          position: 'relative',
          marginBottom: 16,
          minHeight: 44,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            margin: '0 auto',
          }}
        >
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => gotoMonth('prev')}
            style={monthArrowStyle}
          >
            <ChevronLeft size={18} aria-hidden />
          </button>

          <div style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => {
                setPickerYear(visibleYear)
                setPickerOpen((v) => !v)
              }}
              aria-haspopup="dialog"
              aria-expanded={pickerOpen}
              style={{
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                padding: '6px 12px',
                borderRadius: 8,
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: '1.4rem',
                color: 'var(--color-charcoal)',
                letterSpacing: '-0.005em',
                transition: 'background 120ms',
                textAlign: 'center',
              }}
            >
              {FULL_MONTH_LABELS[visibleMonth]} {visibleYear}
            </button>
            {pickerOpen && (
              <MonthYearPicker
                year={pickerYear}
                selectedYear={visibleYear}
                selectedMonth={visibleMonth}
                todayYear={todayYear}
                todayMonth={todayMonth}
                onYearChange={setPickerYear}
                onPick={(y, m) => {
                  setVisibleYear(y)
                  setVisibleMonth(m)
                  setOpenDayId(null)
                  setPickerOpen(false)
                }}
                onClose={() => setPickerOpen(false)}
              />
            )}
          </div>

          <button
            type="button"
            aria-label="Next month"
            onClick={() => gotoMonth('next')}
            style={monthArrowStyle}
          >
            <ChevronRight size={18} aria-hidden />
          </button>
        </div>

        <div
          style={{
            position: 'absolute',
            right: 0,
            top: '50%',
            transform: 'translateY(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          {!isViewingThisMonth && (
            <button
              type="button"
              onClick={gotoToday}
              className="btn outline"
              style={{ padding: '6px 14px', fontSize: '.82rem' }}
            >
              Today
            </button>
          )}
          {isViewingThisMonth && (
            <span className="tag active">This month</span>
          )}
        </div>
      </div>

      {/* ─── Calendar grid for the visible month ─── */}
      <MonthGrid
        year={visibleYear}
        month={visibleMonth}
        today={today}
        daysByDate={daysByDate}
        programsById={programsById}
        clientId={clientId}
        openDayId={openDayId}
        onToggleDay={(dayId) =>
          setOpenDayId((prev) => (prev === dayId ? null : dayId))
        }
      />
    </div>
  )
}


// ============================================================================
// MonthGrid — 7-col grid of dates for one month. Mon-first; prior /
// next month dates greyed at 40% opacity. The popover for an open day
// is rendered alongside the grid (positioned absolutely relative to a
// containing wrapper) so it doesn't reflow the grid.
// ============================================================================

interface MonthGridProps {
  year: number
  month: number
  today: Date
  daysByDate: Map<string, ProgramDayWithExercises>
  programsById: Map<string, ProgramSummary>
  clientId: string
  openDayId: string | null
  onToggleDay: (dayId: string) => void
}

function MonthGrid({
  year,
  month,
  today,
  daysByDate,
  programsById,
  clientId,
  openDayId,
  onToggleDay,
}: MonthGridProps) {
  const cells = useMemo(() => buildMonthCells(year, month), [year, month])

  // Six week rows of seven cells each. Each row collapses
  // independently so the EP can hide weeks they don't care about
  // and focus on the active one. Default: all weeks expanded.
  const weeks = useMemo(() => {
    const rows: { ord: number; cells: typeof cells }[] = []
    for (let i = 0; i < cells.length; i += 7) {
      rows.push({ ord: i / 7, cells: cells.slice(i, i + 7) })
    }
    return rows
  }, [cells])

  const [collapsedWeeks, setCollapsedWeeks] = useState<Set<number>>(new Set())

  // Reset collapsed state when the month changes.
  useEffect(() => {
    setCollapsedWeeks(new Set())
  }, [year, month])

  const gridTemplate = '24px repeat(7, 1fr)'

  return (
    <div
      className="card"
      style={{
        position: 'relative',
        padding: 12,
        background: '#f5f0ea',
      }}
    >
      {/* Weekday header — left-padded by the chevron column so labels
          align with the cells below. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: gridTemplate,
          gap: 6,
          marginBottom: 6,
        }}
      >
        <div /> {/* spacer to align with the chevron column */}
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
      </div>

      {/* One row per calendar week. Chevron in col 1; cells (or
          collapsed-summary span) in cols 2–8. */}
      <div
        style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
      >
        {weeks.map((week) => {
          const collapsed = collapsedWeeks.has(week.ord)
          const inMonthCells = week.cells.filter((c) => c.inMonth)
          const programmedThisWeek = inMonthCells.filter(
            (c) => daysByDate.get(c.iso),
          ).length
          const firstInMonth = inMonthCells[0]
          const lastInMonth = inMonthCells[inMonthCells.length - 1]

          return (
            <div
              key={`week-${week.ord}`}
              style={{
                display: 'grid',
                gridTemplateColumns: gridTemplate,
                gap: 6,
                alignItems: 'stretch',
              }}
            >
              <button
                type="button"
                onClick={() =>
                  setCollapsedWeeks((prev) => {
                    const next = new Set(prev)
                    if (next.has(week.ord)) next.delete(week.ord)
                    else next.add(week.ord)
                    return next
                  })
                }
                aria-label={collapsed ? 'Expand week' : 'Collapse week'}
                aria-expanded={!collapsed}
                style={{
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'grid',
                  placeItems: 'center',
                  color: 'var(--color-muted)',
                  alignSelf: 'flex-start',
                  marginTop: collapsed ? 0 : 4,
                  height: collapsed ? 28 : 'auto',
                }}
              >
                <ChevronRight
                  size={14}
                  aria-hidden
                  style={{
                    transition:
                      'transform 200ms cubic-bezier(0.4, 0, 0.2, 1)',
                    transform: collapsed ? 'none' : 'rotate(90deg)',
                  }}
                />
              </button>

              {collapsed ? (
                <div
                  style={{
                    gridColumn: '2 / -1',
                    background: 'var(--color-card)',
                    border: '1px solid var(--color-border-subtle)',
                    borderRadius: 7,
                    padding: '6px 12px',
                    fontSize: '.74rem',
                    color: 'var(--color-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--color-charcoal)' }}>
                    {firstInMonth && lastInMonth
                      ? `${firstInMonth.date} – ${lastInMonth.date}`
                      : 'Adjacent month'}
                  </span>
                  <span>
                    {programmedThisWeek}{' '}
                    {programmedThisWeek === 1 ? 'session' : 'sessions'}
                  </span>
                </div>
              ) : (
                week.cells.map((c, i) => (
                  <DateCell
                    key={c.iso}
                    cell={c}
                    today={today}
                    day={c.inMonth ? daysByDate.get(c.iso) ?? null : null}
                    isOpen={
                      openDayId !== null && daysByDate.get(c.iso)?.id === openDayId
                    }
                    onToggle={onToggleDay}
                    program={
                      c.inMonth
                        ? programsById.get(daysByDate.get(c.iso)?.program_id ?? '')
                          ?? null
                        : null
                    }
                    clientId={clientId}
                    onClose={() => onToggleDay(openDayId!)}
                    // Anchor popover toward the LEFT for cells in the left
                    // half of the row; toward the RIGHT for cells in the
                    // right half. Avoids overflowing the calendar's edge.
                    anchorRight={i >= 4}
                  />
                ))
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}


// ============================================================================
// DateCell — one calendar date plus its summary popover (rendered as a
// child of the cell so absolute positioning is relative to the cell).
// ============================================================================

interface DateCellProps {
  cell: { iso: string; date: number; inMonth: boolean }
  today: Date
  day: ProgramDayWithExercises | null
  isOpen: boolean
  onToggle: (dayId: string) => void
  program: ProgramSummary | null
  clientId: string
  onClose: () => void
  anchorRight: boolean
}

function DateCell({
  cell,
  today,
  day,
  isOpen,
  onToggle,
  program,
  clientId,
  onClose,
  anchorRight,
}: DateCellProps) {
  const isToday = cell.iso === isoFromDate(today)

  if (!cell.inMonth) {
    return (
      <div className="day-cell empty" style={{ opacity: 0.4 }}>
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
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => onToggle(day.id)}
        className={`day-cell ${isToday ? 'today' : ''}`}
        style={{
          textAlign: 'left',
          cursor: 'pointer',
          font: 'inherit',
          color: 'inherit',
          width: '100%',
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

      {isOpen && (
        <DaySummaryPopover
          day={day}
          program={program}
          clientId={clientId}
          onClose={onClose}
          anchorRight={anchorRight}
        />
      )}
    </div>
  )
}


// ============================================================================
// DaySummaryPopover — anchored to the day cell. Drops below the cell;
// fixed width 360px; Esc and outside-click dismiss; doesn't reflow
// the calendar grid (other days in the same week stay clickable).
// ============================================================================

interface DaySummaryPopoverProps {
  day: ProgramDayWithExercises
  program: ProgramSummary | null
  clientId: string
  onClose: () => void
  anchorRight: boolean
}

function DaySummaryPopover({
  day,
  program,
  clientId,
  onClose,
  anchorRight,
}: DaySummaryPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const sequence = useMemo(() => buildSequence(day.exercises), [day.exercises])

  // ESC + outside click close.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    function onMouseDown(e: MouseEvent) {
      const el = e.target as HTMLElement
      if (popoverRef.current?.contains(el)) return
      // Don't close if the user clicked the same day cell that opened
      // this popover — the cell's onClick handles toggling.
      if ((el.closest('.day-cell') as HTMLElement | null)?.getAttribute('aria-expanded') === 'true') {
        return
      }
      onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onMouseDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [onClose])

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={`Day ${day.day_label} summary`}
      style={{
        position: 'absolute',
        top: 'calc(100% + 6px)',
        // Width matches the day cell (the wrapper around DateCell).
        // Anchored either to the left or right edge of that wrapper.
        // box-sizing keeps padding INSIDE the 100% width so the popover
        // stays exactly the cell's width and doesn't overflow.
        ...(anchorRight ? { right: 0 } : { left: 0 }),
        width: '100%',
        boxSizing: 'border-box',
        background: 'var(--color-card)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 10,
        boxShadow: '0 12px 28px rgba(0,0,0,.12)',
        padding: 10,
        zIndex: 25,
      }}
    >
      {/* Header: Day badge on the left, action icons + close on the right.
          The action icons sit inline so the popover stays as compact as
          the day cell underneath. */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 4,
          marginBottom: 8,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '.85rem',
            color: 'var(--color-charcoal)',
          }}
        >
          Day {day.day_label}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Link
            href={`/clients/${clientId}/program/days/${day.id}`}
            aria-label="Open session builder"
            title="Open"
            style={iconLinkStyle}
          >
            <ExternalLink size={12} aria-hidden />
          </Link>
          <button
            type="button"
            disabled
            title="Copy session — coming in Phase C"
            aria-label="Copy session"
            style={iconBtnStyle}
          >
            <Copy size={12} aria-hidden />
          </button>
          <button
            type="button"
            disabled
            title="Repeat weekly — coming in Phase C"
            aria-label="Repeat weekly"
            style={iconBtnStyle}
          >
            <Repeat size={12} aria-hidden />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close summary"
            style={iconCloseStyle}
          >
            <X size={12} aria-hidden />
          </button>
        </div>
      </div>

      {day.exercises.length === 0 ? (
        <div
          style={{
            fontSize: '.74rem',
            color: 'var(--color-muted)',
            padding: '2px 0 4px',
          }}
        >
          No exercises programmed yet.
        </div>
      ) : (
        <ol
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            maxHeight: 280,
            overflowY: 'auto',
          }}
        >
          {sequence.map(({ exercise, label, isSupersetMember }) => (
            <li
              key={exercise.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '20px 1fr',
                gap: 6,
                alignItems: 'baseline',
                padding: '3px 0',
                borderLeft: isSupersetMember
                  ? '2px solid var(--color-accent)'
                  : '2px solid transparent',
                paddingLeft: isSupersetMember ? 6 : 0,
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 700,
                  fontSize: '.66rem',
                  color: isSupersetMember
                    ? 'var(--color-primary)'
                    : 'var(--color-text-light)',
                }}
              >
                {label}
              </span>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1,
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    fontSize: '.74rem',
                    lineHeight: 1.25,
                    color: 'var(--color-text)',
                    overflowWrap: 'break-word',
                  }}
                  title={exercise.exercise?.name ?? 'Exercise'}
                >
                  {exercise.exercise?.name ?? 'Exercise'}
                </span>
                <span
                  style={{
                    fontSize: '.66rem',
                    color: 'var(--color-text-light)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {formatPrescription(exercise) || '—'}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

// Compact icon-button styles tuned for the popover header — sized so
// four icons + the day-label badge fit within a single calendar cell.
const iconBtnBase: React.CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: 5,
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
  transition: 'background 120ms, color 120ms',
}

const iconLinkStyle: React.CSSProperties = {
  ...iconBtnBase,
  color: 'var(--color-charcoal)',
  background: 'transparent',
  border: '1px solid var(--color-border-subtle)',
  textDecoration: 'none',
}

const iconBtnStyle: React.CSSProperties = {
  ...iconBtnBase,
  border: '1px solid var(--color-border-subtle)',
  background: 'var(--color-card)',
  cursor: 'not-allowed',
  color: 'var(--color-muted)',
  opacity: 0.5,
}

const iconCloseStyle: React.CSSProperties = {
  ...iconBtnBase,
  border: 'none',
  background: 'transparent',
  color: 'var(--color-muted)',
}


// ============================================================================
// Pure helpers
// ============================================================================

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

// Re-exports for any consumer that needs the picker from here.
export { MONTH_LABELS_SHORT, MonthYearPicker, monthArrowStyle }
