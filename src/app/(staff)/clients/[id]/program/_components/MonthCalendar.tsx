'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react'
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Plus,
  Repeat,
  Trash2,
  X,
} from 'lucide-react'
import {
  MonthYearPicker,
  monthArrowStyle,
  MONTH_LABELS_SHORT,
} from '../../../../_components/MonthYearPicker'
import {
  copyDayAction,
  createProgramDayAction,
  removeProgramDayAction,
  repeatDayWeeklyAction,
  type ConflictEntry,
} from '../day-actions'

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
  // When true (panel open / cells narrower), the day popover stacks
  // its header — icons row on top, Day label beneath — to keep
  // everything inside the cell.
  compactPopover?: boolean
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

// Top-level state machine for day-level operations. Each mode shapes
// the UI: copy-pick changes the click semantics on day cells; repeat-
// pick swaps the day-summary popover for a mini date picker; the
// confirm-* modes show a modal and pause everything else.
type CalendarMode =
  | { kind: 'idle' }
  | {
      kind: 'copy-pick'
      sourceDayId: string
      sourceLabel: string
      sourceDate: string
    }
  | {
      kind: 'repeat-pick'
      sourceDayId: string
      sourceLabel: string
      sourceDate: string
    }
  | {
      kind: 'confirm-copy'
      sourceDayId: string
      targetDate: string
      conflicts: ConflictEntry[]
    }
  | {
      kind: 'confirm-repeat'
      sourceDayId: string
      endDate: string
      conflicts: ConflictEntry[]
      noProgramDates: string[]
    }
  | { kind: 'no-program-toast'; targetDate: string }
  | {
      kind: 'confirm-delete'
      sourceDayId: string
      sourceLabel: string
      sourceDate: string
    }

export function MonthCalendar({
  clientId,
  programs,
  days,
  todayIso,
  compactPopover = false,
}: MonthCalendarProps) {
  const router = useRouter()
  const [, startTransition] = useTransition()
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

  // Single open cell at a time. 'day' opens the DaySummaryPopover for a
  // programmed day; 'empty' opens the EmptyCellPopover (Phase F.0 / D-PROG-004
  // — every in-month cell is interactive in idle mode so the EP can add an
  // ad-hoc session by clicking any blank date).
  const [openCell, setOpenCell] = useState<
    | { kind: 'day'; id: string }
    | { kind: 'empty'; iso: string }
    | null
  >(null)
  const [mode, setMode] = useState<CalendarMode>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)

  // Esc cancels any non-idle mode.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && mode.kind !== 'idle') {
        setMode({ kind: 'idle' })
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mode.kind])

  function gotoMonth(direction: 'prev' | 'next') {
    const delta = direction === 'prev' ? -1 : 1
    const next = new Date(visibleYear, visibleMonth + delta, 1)
    setVisibleYear(next.getFullYear())
    setVisibleMonth(next.getMonth())
    setOpenCell(null)
  }

  function gotoToday() {
    setVisibleYear(todayYear)
    setVisibleMonth(todayMonth)
    setOpenCell(null)
  }

  const isViewingThisMonth =
    visibleYear === todayYear && visibleMonth === todayMonth

  // P2-9 — count distinct training blocks with days in the visible month.
  // Surfaces a quiet eyebrow under the month label when ≥ 2 so the EP
  // knows the calendar is straddling a block boundary.
  const blocksInVisibleMonth = useMemo(() => {
    const prefix = `${visibleYear}-${String(visibleMonth + 1).padStart(2, '0')}`
    const ids = new Set<string>()
    for (const d of days) {
      if (d.scheduled_date.startsWith(prefix)) ids.add(d.program_id)
    }
    return ids.size
  }, [days, visibleYear, visibleMonth])

  // ── Action runners ──────────────────────────────────────────────

  const runCopy = useCallback(
    async (sourceDayId: string, targetDate: string, force: boolean) => {
      setBusy(true)
      try {
        const result = await copyDayAction(clientId, sourceDayId, targetDate, force)
        if ('error' in result) {
          // Surface as a no-program toast for now — same one-liner shape.
          setMode({ kind: 'no-program-toast', targetDate })
          // eslint-disable-next-line no-console
          console.error('copy_program_day error:', result.error)
          return
        }
        switch (result.status) {
          case 'created':
            setMode({ kind: 'idle' })
            startTransition(() => router.refresh())
            break
          case 'conflict':
            setMode({
              kind: 'confirm-copy',
              sourceDayId,
              targetDate,
              conflicts: result.conflicts,
            })
            break
          case 'no_program':
            setMode({ kind: 'no-program-toast', targetDate: result.targetDate })
            break
        }
      } finally {
        setBusy(false)
      }
    },
    [clientId, router],
  )

  const runRepeat = useCallback(
    async (sourceDayId: string, endDate: string, force: boolean) => {
      setBusy(true)
      try {
        const result = await repeatDayWeeklyAction(clientId, sourceDayId, endDate, force)
        if ('error' in result) {
          // eslint-disable-next-line no-console
          console.error('repeat_program_day_weekly error:', result.error)
          setMode({ kind: 'idle' })
          return
        }
        switch (result.status) {
          case 'created':
            setMode({ kind: 'idle' })
            startTransition(() => router.refresh())
            break
          case 'conflict':
            setMode({
              kind: 'confirm-repeat',
              sourceDayId,
              endDate,
              conflicts: result.conflicts,
              noProgramDates: result.noProgramDates,
            })
            break
          case 'invalid_end_date':
            // UI-side validation should prevent this; if it slips
            // through, fall back to idle.
            setMode({ kind: 'idle' })
            break
        }
      } finally {
        setBusy(false)
      }
    },
    [clientId, router],
  )

  const runDelete = useCallback(
    async (sourceDayId: string) => {
      setBusy(true)
      try {
        const result = await removeProgramDayAction(clientId, sourceDayId)
        if ('error' in result) {
          // eslint-disable-next-line no-console
          console.error('soft_delete_program_day error:', result.error)
          setMode({ kind: 'idle' })
          return
        }
        setOpenCell(null)
        setMode({ kind: 'idle' })
        startTransition(() => router.refresh())
      } finally {
        setBusy(false)
      }
    },
    [clientId, router],
  )

  // Phase F.0 — create an ad-hoc session on a chosen empty date. The
  // RPC resolves the active program by date (same shape as copy). On
  // success we navigate straight into the session builder for the new
  // day so the EP can start filling exercises immediately.
  const runCreate = useCallback(
    async (targetDate: string) => {
      setBusy(true)
      try {
        const result = await createProgramDayAction(clientId, targetDate)
        if ('error' in result) {
          // eslint-disable-next-line no-console
          console.error('create_program_day error:', result.error)
          setOpenCell(null)
          return
        }
        switch (result.status) {
          case 'created':
            setOpenCell(null)
            // Navigate to the new day's builder. router.push (not refresh)
            // because we're leaving the calendar surface.
            router.push(`/clients/${clientId}/program/days/${result.newDayId}`)
            break
          case 'no_program':
            // Shouldn't happen — UI only shows the "Add session" button
            // when a covering block exists. Defensive fall-through to
            // the no-program toast.
            setOpenCell(null)
            setMode({ kind: 'no-program-toast', targetDate: result.targetDate })
            break
          case 'conflict':
            // Race: another tab beat us to it. Refresh so the new day
            // shows up; close the popover.
            setOpenCell(null)
            startTransition(() => router.refresh())
            break
        }
      } finally {
        setBusy(false)
      }
    },
    [clientId, router],
  )

  // ── Day-cell click handler — branches on mode ──────────────────

  const handleDayCellClick = useCallback(
    (cellIso: string, day: ProgramDayWithExercises | null) => {
      if (mode.kind === 'copy-pick') {
        // Don't allow copying onto the source itself.
        if (cellIso === mode.sourceDate) {
          setMode({ kind: 'idle' })
          return
        }
        // Don't allow copying onto past dates.
        if (cellIso < todayIso) return
        runCopy(mode.sourceDayId, cellIso, false)
        return
      }
      // Default: toggle the matching popover. Day cells open the day
      // summary; empty cells open the create-session popover.
      if (day) {
        setOpenCell((prev) =>
          prev?.kind === 'day' && prev.id === day.id
            ? null
            : { kind: 'day', id: day.id },
        )
      } else {
        setOpenCell((prev) =>
          prev?.kind === 'empty' && prev.iso === cellIso
            ? null
            : { kind: 'empty', iso: cellIso },
        )
      }
    },
    [mode, runCopy, todayIso],
  )

  return (
    <div>
      {/* ─── Copy-pick banner: shown while the EP is choosing a
          destination day for a copy. ─── */}
      {mode.kind === 'copy-pick' && (
        <CopyPickBanner
          sourceLabel={mode.sourceLabel}
          sourceDate={mode.sourceDate}
          onCancel={() => setMode({ kind: 'idle' })}
        />
      )}

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

          <div style={{ position: 'relative', textAlign: 'center' }}>
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
                transition: 'background 150ms cubic-bezier(0.4, 0, 0.2, 1)',
                textAlign: 'center',
              }}
            >
              {FULL_MONTH_LABELS[visibleMonth]} {visibleYear}
            </button>
            {blocksInVisibleMonth >= 2 && (
              <div
                aria-label={`${blocksInVisibleMonth} training blocks visible`}
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 600,
                  fontSize: '.62rem',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'var(--color-muted)',
                  marginTop: -2,
                }}
              >
                {blocksInVisibleMonth} blocks
              </div>
            )}
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
                  setOpenCell(null)
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
        todayIso={todayIso}
        daysByDate={daysByDate}
        programs={programs}
        programsById={programsById}
        clientId={clientId}
        openCell={openCell}
        mode={mode}
        compactPopover={compactPopover}
        busy={busy}
        onCellClick={handleDayCellClick}
        onClosePopover={() => setOpenCell(null)}
        onCopyDay={(dayId, label, date) => {
          setOpenCell(null)
          setMode({ kind: 'copy-pick', sourceDayId: dayId, sourceLabel: label, sourceDate: date })
        }}
        onRepeatDay={(dayId, label, date) => {
          setOpenCell(null)
          setMode({ kind: 'repeat-pick', sourceDayId: dayId, sourceLabel: label, sourceDate: date })
        }}
        onDeleteDay={(dayId, label, date) => {
          setOpenCell(null)
          setMode({ kind: 'confirm-delete', sourceDayId: dayId, sourceLabel: label, sourceDate: date })
        }}
        onCreateDay={(targetDate) => runCreate(targetDate)}
      />

      {/* ─── Repeat mini-calendar picker (anchored, full-screen) ─── */}
      {mode.kind === 'repeat-pick' && (
        <RepeatEndDatePicker
          sourceDate={mode.sourceDate}
          sourceLabel={mode.sourceLabel}
          onCancel={() => setMode({ kind: 'idle' })}
          onConfirm={(endDate) => runRepeat(mode.sourceDayId, endDate, false)}
          busy={busy}
        />
      )}

      {/* ─── Conflict confirm dialog ─── */}
      {mode.kind === 'confirm-copy' && (
        <ConflictDialog
          title="Day already exists"
          description={`A session is already scheduled for ${formatLongDate(mode.targetDate)}. Overwrite it with the copy?`}
          conflicts={mode.conflicts}
          noProgramDates={[]}
          onCancel={() => setMode({ kind: 'idle' })}
          onConfirm={() =>
            runCopy(mode.sourceDayId, mode.targetDate, true)
          }
          busy={busy}
        />
      )}

      {mode.kind === 'confirm-repeat' && (
        <ConflictDialog
          title="Some dates already have sessions"
          description={`${mode.conflicts.length} of the target dates already have programmed sessions. Overwrite all of them?`}
          conflicts={mode.conflicts}
          noProgramDates={mode.noProgramDates}
          onCancel={() => setMode({ kind: 'idle' })}
          onConfirm={() =>
            runRepeat(mode.sourceDayId, mode.endDate, true)
          }
          busy={busy}
        />
      )}

      {mode.kind === 'no-program-toast' && (
        <ConflictDialog
          title="No active block on that date"
          description={`No active training block covers ${formatLongDate(mode.targetDate)}. Create or extend a block first, then try again.`}
          conflicts={[]}
          noProgramDates={[]}
          onCancel={() => setMode({ kind: 'idle' })}
          onConfirm={() => setMode({ kind: 'idle' })}
          confirmLabel="OK"
          hideCancel
          busy={false}
        />
      )}

      {mode.kind === 'confirm-delete' && (
        <ConflictDialog
          title="Delete this session?"
          description={`Day ${mode.sourceLabel} on ${formatLongDate(mode.sourceDate)} will be removed from the calendar along with its exercises. This can be undone manually if needed.`}
          conflicts={[]}
          noProgramDates={[]}
          onCancel={() => setMode({ kind: 'idle' })}
          onConfirm={() => runDelete(mode.sourceDayId)}
          confirmLabel="Delete"
          busy={busy}
        />
      )}
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
  todayIso: string
  daysByDate: Map<string, ProgramDayWithExercises>
  programs: ProgramSummary[]
  programsById: Map<string, ProgramSummary>
  clientId: string
  openCell:
    | { kind: 'day'; id: string }
    | { kind: 'empty'; iso: string }
    | null
  mode: CalendarMode
  busy: boolean
  onCellClick: (cellIso: string, day: ProgramDayWithExercises | null) => void
  onClosePopover: () => void
  onCopyDay: (dayId: string, label: string, date: string) => void
  onRepeatDay: (dayId: string, label: string, date: string) => void
  onDeleteDay: (dayId: string, label: string, date: string) => void
  onCreateDay: (targetDate: string) => void
  compactPopover: boolean
}

function MonthGrid({
  year,
  month,
  today,
  todayIso,
  daysByDate,
  programs,
  programsById,
  clientId,
  openCell,
  mode,
  busy,
  onCellClick,
  onClosePopover,
  onCopyDay,
  onRepeatDay,
  onDeleteDay,
  onCreateDay,
  compactPopover,
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
                    // 300ms reveal per design system (week-row collapse).
                    transition:
                      'transform 300ms cubic-bezier(0.4, 0, 0.2, 1)',
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
                week.cells.map((c, i) => {
                  const day = c.inMonth ? daysByDate.get(c.iso) ?? null : null
                  const isDayOpen =
                    openCell?.kind === 'day' && day?.id === openCell.id
                  const isEmptyOpen =
                    openCell?.kind === 'empty' && c.iso === openCell.iso
                  // In copy-pick mode, the source cell and past dates
                  // dim out and become unclickable; everything else
                  // shows a copy-cursor on hover.
                  const inCopyPick = mode.kind === 'copy-pick'
                  const isCopySource =
                    inCopyPick && c.iso === mode.sourceDate
                  const isPastInCopy = inCopyPick && c.iso < todayIso
                  const isCopyTarget =
                    inCopyPick && !isCopySource && !isPastInCopy
                  // Resolve the active program covering this date (for the
                  // empty-cell popover). For programmed days, use the
                  // explicit program_id; for empty cells, walk the
                  // programs list.
                  const program = c.inMonth
                    ? day
                      ? programsById.get(day.program_id) ?? null
                      : findCoveringProgram(programs, c.iso)
                    : null
                  return (
                    <DateCell
                      key={c.iso}
                      cell={c}
                      today={today}
                      day={day}
                      isDayOpen={isDayOpen}
                      isEmptyOpen={isEmptyOpen}
                      onClick={() => onCellClick(c.iso, day)}
                      program={program}
                      clientId={clientId}
                      onClose={onClosePopover}
                      onCopy={() =>
                        day && onCopyDay(day.id, day.day_label, day.scheduled_date)
                      }
                      onRepeat={() =>
                        day && onRepeatDay(day.id, day.day_label, day.scheduled_date)
                      }
                      onDelete={() =>
                        day && onDeleteDay(day.id, day.day_label, day.scheduled_date)
                      }
                      onCreate={() => onCreateDay(c.iso)}
                      busy={busy}
                      anchorRight={i >= 4}
                      compactPopover={compactPopover}
                      copyMode={
                        isCopyTarget
                          ? 'target'
                          : isCopySource
                          ? 'source'
                          : isPastInCopy
                          ? 'past'
                          : 'none'
                      }
                    />
                  )
                })
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
  isDayOpen: boolean
  isEmptyOpen: boolean
  onClick: () => void
  program: ProgramSummary | null
  clientId: string
  onClose: () => void
  onCopy: () => void
  onRepeat: () => void
  onDelete: () => void
  onCreate: () => void
  busy: boolean
  anchorRight: boolean
  compactPopover: boolean
  // Visual mode for cells while a copy-pick is in progress.
  // 'target' — clickable destination; 'source' — the day being copied;
  // 'past' — past dates dimmed unclickable; 'none' — normal mode.
  copyMode: 'none' | 'target' | 'source' | 'past'
}

function DateCell({
  cell,
  today,
  day,
  isDayOpen,
  isEmptyOpen,
  onClick,
  program,
  clientId,
  onClose,
  onCopy,
  onRepeat,
  onDelete,
  onCreate,
  busy,
  anchorRight,
  compactPopover,
  copyMode,
}: DateCellProps) {
  const isToday = cell.iso === isoFromDate(today)
  const inCopyPick = copyMode !== 'none'
  const isCopyTarget = copyMode === 'target'
  const isCopySource = copyMode === 'source'
  const isCopyPast = copyMode === 'past'

  if (!cell.inMonth) {
    return (
      <div className="day-cell empty" style={{ opacity: 0.4 }}>
        {/* color comes from .day-cell.empty .day-date — see globals.css P2-1 */}
        <div className="day-date">{cell.date}</div>
      </div>
    )
  }

  // Empty cells (no day): always clickable in idle mode (Phase F.0 —
  // opens the EmptyCellPopover for "Add session"). In copy-pick mode
  // they're clickable as destinations.
  if (!day) {
    return (
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={onClick}
          disabled={isCopyPast}
          className={`day-cell empty ${isToday ? 'today' : ''}`}
          style={{
            cursor: isCopyTarget
              ? 'copy'
              : isCopyPast
              ? 'not-allowed'
              : 'pointer',
            font: 'inherit',
            color: 'inherit',
            width: '100%',
            outline: isEmptyOpen
              ? '2px solid var(--color-primary)'
              : isCopyTarget
              ? '1px dashed var(--color-primary)'
              : undefined,
            background: isCopyTarget ? 'rgba(45, 178, 76, 0.04)' : undefined,
            opacity: isCopyPast ? 0.4 : 1,
          }}
          aria-expanded={isEmptyOpen}
        >
          <div className="day-date">{cell.date}</div>
        </button>

        {isEmptyOpen && !inCopyPick && (
          <EmptyCellPopover
            cellIso={cell.iso}
            program={program}
            onClose={onClose}
            onCreate={onCreate}
            busy={busy}
            anchorRight={anchorRight}
          />
        )}
      </div>
    )
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={onClick}
        className={`day-cell ${isToday ? 'today' : ''}`}
        disabled={isCopyPast || isCopySource}
        style={{
          textAlign: 'left',
          cursor: isCopyTarget
            ? 'copy'
            : isCopyPast || isCopySource
            ? 'not-allowed'
            : 'pointer',
          font: 'inherit',
          color: 'inherit',
          width: '100%',
          outline: isDayOpen
            ? '2px solid var(--color-primary)'
            : isCopyTarget
            ? '1px dashed var(--color-primary)'
            : undefined,
          opacity: isCopyPast || isCopySource ? 0.45 : 1,
          background: isCopyTarget ? 'rgba(45, 178, 76, 0.04)' : undefined,
        }}
        aria-expanded={isDayOpen}
      >
        <div className="day-date">{cell.date}</div>
        <span className="day-tag">{day.day_label}</span>
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

      {isDayOpen && !inCopyPick && (
        <DaySummaryPopover
          day={day}
          program={program}
          clientId={clientId}
          onClose={onClose}
          onCopy={onCopy}
          onRepeat={onRepeat}
          onDelete={onDelete}
          anchorRight={anchorRight}
          compact={compactPopover}
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
  onCopy: () => void
  onRepeat: () => void
  onDelete: () => void
  anchorRight: boolean
  // When true, stack the header so action icons sit above the
  // "Day {label}" caption (saves horizontal room when the side
  // panel is open and cells are narrower).
  compact: boolean
}

function DaySummaryPopover({
  day,
  program,
  clientId,
  onClose,
  onCopy,
  onRepeat,
  onDelete,
  anchorRight,
  compact,
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
      aria-label={`${day.day_label} summary`}
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
        padding: 8,
        zIndex: 25,
      }}
    >
      {/* Header. Default layout: Day badge on the left, action icons on
          the right (single row). Compact layout (when the side panel is
          open and cells are narrow): icons row on top, Day badge below
          — keeps the trash icon inside the cell instead of overflowing. */}
      <div
        style={{
          display: 'flex',
          flexDirection: compact ? 'column' : 'row',
          justifyContent: compact ? 'flex-start' : 'space-between',
          alignItems: compact ? 'stretch' : 'center',
          gap: compact ? 6 : 4,
          marginBottom: 8,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            justifyContent: compact ? 'flex-end' : 'flex-end',
            order: compact ? 0 : 1,
          }}
        >
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
            onClick={onCopy}
            title="Copy this session to another day"
            aria-label="Copy this session"
            style={iconLinkStyle}
          >
            <Copy size={12} aria-hidden />
          </button>
          <button
            type="button"
            onClick={onRepeat}
            title="Repeat weekly until a chosen end date"
            aria-label="Repeat weekly"
            style={iconLinkStyle}
          >
            <Repeat size={12} aria-hidden />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="Delete this session"
            aria-label="Delete this session"
            style={iconDeleteStyle}
          >
            <Trash2 size={12} aria-hidden />
          </button>
        </div>

        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '.85rem',
            color: 'var(--color-charcoal)',
            order: compact ? 1 : 0,
          }}
        >
          {day.day_label}
        </span>
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
                gridTemplateColumns: '16px 1fr',
                gap: 4,
                alignItems: 'baseline',
                padding: '3px 0',
                borderLeft: isSupersetMember
                  ? '2px solid var(--color-accent)'
                  : '2px solid transparent',
                paddingLeft: isSupersetMember ? 4 : 0,
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

// ============================================================================
// EmptyCellPopover — anchored to an empty in-month cell. Same shape as
// DaySummaryPopover but smaller content. Phase F.0 (D-PROG-004): the
// EP can click any blank date and add an ad-hoc session by hitting the
// "Add session" button. When no active block covers the date the
// popover surfaces a clear explanation instead of a CTA.
// ============================================================================

interface EmptyCellPopoverProps {
  cellIso: string
  program: ProgramSummary | null
  onClose: () => void
  onCreate: () => void
  busy: boolean
  anchorRight: boolean
}

function EmptyCellPopover({
  cellIso,
  program,
  onClose,
  onCreate,
  busy,
  anchorRight,
}: EmptyCellPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    function onMouseDown(e: MouseEvent) {
      const el = e.target as HTMLElement
      if (popoverRef.current?.contains(el)) return
      // Don't close if the user clicked the same empty cell that opened
      // this popover — its onClick handles toggling.
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

  const longDate = formatLongDate(cellIso)

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={`Add session for ${longDate}`}
      style={{
        position: 'absolute',
        top: 'calc(100% + 6px)',
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
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: '.85rem',
          color: 'var(--color-charcoal)',
          marginBottom: 4,
        }}
      >
        {longDate}
      </div>

      {program ? (
        <>
          <div
            style={{
              fontSize: '.74rem',
              color: 'var(--color-text-light)',
              lineHeight: 1.45,
              marginBottom: 10,
            }}
          >
            Adds to <strong style={{ color: 'var(--color-charcoal)' }}>{program.name}</strong>.
          </div>
          <button
            type="button"
            onClick={onCreate}
            disabled={busy}
            className="btn primary"
            style={{
              padding: '6px 12px',
              fontSize: '.78rem',
              width: '100%',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <Plus size={12} aria-hidden />
            {busy ? 'Working…' : 'Add session'}
          </button>
        </>
      ) : (
        <div
          style={{
            fontSize: '.74rem',
            color: 'var(--color-muted)',
            lineHeight: 1.45,
          }}
        >
          No active training block covers this date.
        </div>
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
  // 150ms hover/press per design system, with the standard easing.
  transition: 'background 150ms cubic-bezier(0.4, 0, 0.2, 1), color 150ms cubic-bezier(0.4, 0, 0.2, 1)',
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

// Destructive variant for the day-popover delete button — red bin icon
// in place of the redundant close-X (the popover already closes on
// outside-click, Esc, and clicking the same day cell again).
const iconDeleteStyle: React.CSSProperties = {
  ...iconBtnBase,
  border: '1px solid rgba(214, 64, 69, 0.4)',
  background: 'rgba(214, 64, 69, 0.06)',
  color: '#D64045',
}


// ============================================================================
// CopyPickBanner — top-of-calendar banner shown while the EP is
// choosing a destination cell for a copy. Esc cancels too (handled
// at the MonthCalendar level).
// ============================================================================

interface CopyPickBannerProps {
  sourceLabel: string
  sourceDate: string
  onCancel: () => void
}

function CopyPickBanner({ sourceLabel, sourceDate, onCancel }: CopyPickBannerProps) {
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '10px 14px',
        marginBottom: 12,
        background: 'rgba(45, 178, 76, 0.08)',
        border: '1px solid var(--color-primary)',
        borderRadius: 8,
        fontSize: '.86rem',
        color: 'var(--color-charcoal)',
      }}
    >
      <span>
        Copying <strong>Day {sourceLabel}</strong> from{' '}
        <strong>{formatLongDate(sourceDate)}</strong> — click any future day
        on the calendar to paste, or press Esc to cancel.
      </span>
      <button
        type="button"
        onClick={onCancel}
        className="btn outline"
        style={{ padding: '4px 12px', fontSize: '.78rem' }}
      >
        Cancel
      </button>
    </div>
  )
}


// ============================================================================
// RepeatEndDatePicker — full-screen modal with a mini date-grid for
// picking an end date. The user clicks any future date; the system
// repeats the source on the same weekday weekly between source+7
// and the picked end date inclusive.
// ============================================================================

interface RepeatEndDatePickerProps {
  sourceDate: string
  sourceLabel: string
  onCancel: () => void
  onConfirm: (endDate: string) => void
  busy: boolean
}

function RepeatEndDatePicker({
  sourceDate,
  sourceLabel,
  onCancel,
  onConfirm,
  busy,
}: RepeatEndDatePickerProps) {
  const sourceParsed = parseIso(sourceDate)
  const sourceDow = (sourceParsed.getDay() + 6) % 7  // Mon-first 0..6
  const weekdayName = WEEKDAY_LABELS[sourceDow] ?? 'day'

  // Default visible month = source's month; default end-date = source + 28 days.
  const initialEnd = isoFromDate(addDaysTo(sourceParsed, 28))
  const [pickedEnd, setPickedEnd] = useState<string | null>(initialEnd)
  const [visibleYear, setVisibleYear] = useState(sourceParsed.getFullYear())
  const [visibleMonth, setVisibleMonth] = useState(sourceParsed.getMonth())

  const cells = useMemo(
    () => buildMonthCells(visibleYear, visibleMonth),
    [visibleYear, visibleMonth],
  )

  // Compute the list of target dates given the current pick (preview).
  const targetDates = useMemo(() => {
    if (!pickedEnd) return []
    const out: string[] = []
    let d = addDaysTo(sourceParsed, 7)
    const end = parseIso(pickedEnd)
    while (d <= end) {
      out.push(isoFromDate(d))
      d = addDaysTo(d, 7)
    }
    return out
  }, [pickedEnd, sourceParsed])

  function gotoMonth(direction: 'prev' | 'next') {
    const delta = direction === 'prev' ? -1 : 1
    const next = new Date(visibleYear, visibleMonth + delta, 1)
    setVisibleYear(next.getFullYear())
    setVisibleMonth(next.getMonth())
  }

  return (
    <div
      role="dialog"
      aria-label="Pick end date for repeat"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(28, 25, 23, 0.5)',
        display: 'grid',
        placeItems: 'center',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        style={{
          width: 360,
          background: 'var(--color-card)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 14,
          boxShadow: '0 24px 60px rgba(0,0,0,.18)',
          padding: 16,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 8,
            marginBottom: 12,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: '1.1rem',
                color: 'var(--color-charcoal)',
              }}
            >
              Repeat Day {sourceLabel}
            </div>
            <div style={{ fontSize: '.78rem', color: 'var(--color-muted)', marginTop: 2 }}>
              Pick an end date. Repeats on every {weekdayName} between{' '}
              {formatLongDate(isoFromDate(addDaysTo(sourceParsed, 7)))} and the picked date.
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel"
            style={iconCloseStyle}
          >
            <X size={14} aria-hidden />
          </button>
        </div>

        {/* Month nav */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 8,
            marginBottom: 8,
          }}
        >
          <button
            type="button"
            onClick={() => gotoMonth('prev')}
            aria-label="Previous month"
            style={monthArrowStyle}
          >
            <ChevronLeft size={16} aria-hidden />
          </button>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '.95rem',
              color: 'var(--color-charcoal)',
              minWidth: 140,
              textAlign: 'center',
            }}
          >
            {FULL_MONTH_LABELS[visibleMonth]} {visibleYear}
          </div>
          <button
            type="button"
            onClick={() => gotoMonth('next')}
            aria-label="Next month"
            style={monthArrowStyle}
          >
            <ChevronRight size={16} aria-hidden />
          </button>
        </div>

        {/* Weekday header */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: 2,
            marginBottom: 4,
          }}
        >
          {WEEKDAY_LABELS.map((label) => (
            <div
              key={label}
              style={{
                fontSize: '.62rem',
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--color-muted)',
                textAlign: 'center',
                padding: '2px 0',
              }}
            >
              {label}
            </div>
          ))}
        </div>

        {/* Date grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: 2,
          }}
        >
          {cells.map((c) => {
            const isPicked = pickedEnd === c.iso
            const isPastSource = c.iso <= sourceDate
            const isPotentialTarget =
              c.inMonth &&
              !isPastSource &&
              ((parseIso(c.iso).getDay() + 6) % 7) === sourceDow
            const inMonth = c.inMonth
            const dimmed = !inMonth || isPastSource
            return (
              <button
                key={c.iso}
                type="button"
                onClick={() => {
                  if (isPastSource) return
                  setPickedEnd(c.iso)
                }}
                disabled={isPastSource}
                aria-label={c.iso}
                style={{
                  padding: '8px 0',
                  fontSize: '.78rem',
                  fontVariantNumeric: 'tabular-nums',
                  color: dimmed ? 'var(--color-muted)' : 'var(--color-charcoal)',
                  background: isPicked
                    ? 'var(--color-primary)'
                    : isPotentialTarget
                    ? 'rgba(45, 178, 76, 0.06)'
                    : 'transparent',
                  border: 'none',
                  borderRadius: 6,
                  cursor: isPastSource ? 'not-allowed' : 'pointer',
                  opacity: dimmed ? 0.45 : 1,
                  fontWeight: isPicked ? 700 : 400,
                  ...(isPicked && { color: '#fff' }),
                }}
              >
                {c.date}
              </button>
            )
          })}
        </div>

        {/* Preview */}
        <div
          style={{
            marginTop: 12,
            padding: '8px 10px',
            background: 'var(--color-surface)',
            borderRadius: 7,
            fontSize: '.78rem',
            color: 'var(--color-text-light)',
            minHeight: 36,
          }}
        >
          {pickedEnd ? (
            targetDates.length === 0 ? (
              <span>No same-weekday occurrences between source and {formatLongDate(pickedEnd)}.</span>
            ) : (
              <span>
                <strong style={{ color: 'var(--color-charcoal)' }}>
                  {targetDates.length}
                </strong>{' '}
                cop{targetDates.length === 1 ? 'y' : 'ies'} on{' '}
                {weekdayName}s — {formatLongDate(targetDates[0]!)}
                {targetDates.length > 1 &&
                  ` to ${formatLongDate(targetDates[targetDates.length - 1]!)}`}
              </span>
            )
          ) : (
            <span>Pick an end date.</span>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button
            type="button"
            onClick={onCancel}
            className="btn outline"
            style={{ padding: '6px 14px', fontSize: '.82rem' }}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => pickedEnd && onConfirm(pickedEnd)}
            className="btn primary"
            style={{ padding: '6px 14px', fontSize: '.82rem' }}
            disabled={!pickedEnd || targetDates.length === 0 || busy}
          >
            {busy ? 'Working…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}


// ============================================================================
// ConflictDialog — modal for confirming overwrites or surfacing
// "no active block" errors. Cancel / Confirm buttons configurable;
// confirm-only mode (hideCancel) used for read-only acknowledgements.
// ============================================================================

interface ConflictDialogProps {
  title: string
  description: string
  conflicts: ConflictEntry[]
  noProgramDates: string[]
  onCancel: () => void
  onConfirm: () => void
  confirmLabel?: string
  hideCancel?: boolean
  busy: boolean
}

function ConflictDialog({
  title,
  description,
  conflicts,
  noProgramDates,
  onCancel,
  onConfirm,
  confirmLabel = 'Overwrite',
  hideCancel = false,
  busy,
}: ConflictDialogProps) {
  return (
    <div
      role="dialog"
      aria-label={title}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(28, 25, 23, 0.5)',
        display: 'grid',
        placeItems: 'center',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel()
      }}
    >
      <div
        style={{
          width: 420,
          maxWidth: '90vw',
          background: 'var(--color-card)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 14,
          boxShadow: '0 24px 60px rgba(0,0,0,.18)',
          padding: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
          <AlertCircle
            size={18}
            aria-hidden
            style={{ color: 'var(--color-warning, #d97706)', flexShrink: 0, marginTop: 2 }}
          />
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '1.05rem',
              color: 'var(--color-charcoal)',
            }}
          >
            {title}
          </div>
        </div>

        <p style={{ margin: '0 0 12px 28px', fontSize: '.88rem', color: 'var(--color-text)', lineHeight: 1.5 }}>
          {description}
        </p>

        {conflicts.length > 0 && (
          <ul
            style={{
              listStyle: 'none',
              padding: '8px 12px',
              margin: '0 0 12px 28px',
              background: 'var(--color-surface)',
              borderRadius: 8,
              fontSize: '.78rem',
              color: 'var(--color-text-light)',
              maxHeight: 160,
              overflowY: 'auto',
            }}
          >
            {conflicts.map((c) => (
              <li key={c.date} style={{ padding: '2px 0' }}>
                {formatLongDate(c.date)}
              </li>
            ))}
          </ul>
        )}

        {noProgramDates.length > 0 && (
          <p style={{ margin: '0 0 12px 28px', fontSize: '.76rem', color: 'var(--color-muted)' }}>
            {noProgramDates.length} date{noProgramDates.length === 1 ? '' : 's'} fall outside any active block and will be skipped.
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          {!hideCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="btn outline"
              style={{ padding: '6px 14px', fontSize: '.82rem' }}
              disabled={busy}
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={onConfirm}
            className="btn primary"
            style={{ padding: '6px 14px', fontSize: '.82rem' }}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}


// ============================================================================
// Pure helpers
// ============================================================================

function formatLongDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-AU', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(parseIso(iso))
  } catch {
    return iso
  }
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

/**
 * Resolve the active program covering an ISO date for the empty-cell
 * popover. Mirrors the SQL helper `_program_for_date` so the UI can
 * preview "Adds to <BlockName>" before the EP commits. Programs is a
 * short list (1–3 active blocks per client) so the linear scan is fine.
 */
function findCoveringProgram(
  programs: ProgramSummary[],
  iso: string,
): ProgramSummary | null {
  for (const p of programs) {
    const startDate = parseIso(p.start_date)
    const endDate = addDaysTo(startDate, p.duration_weeks * 7)
    const endIso = isoFromDate(endDate)
    if (iso >= p.start_date && iso < endIso) return p
  }
  return null
}

// Re-exports for any consumer that needs the picker from here.
export { MONTH_LABELS_SHORT, MonthYearPicker, monthArrowStyle }
