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
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Plus,
  Repeat,
  Send,
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
  copyWeekAction,
  createProgramDayAction,
  publishAllProgramDaysAction,
  removeProgramDayAction,
  repeatDayWeeklyAction,
  repeatWeekAction,
  type ConflictEntry,
} from '../day-actions'
import { ConfirmDialog } from '@/app/(staff)/_components/ConfirmDialog'
import { publishProgramDayAction } from '../days/[dayId]/actions'

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
  superset_group_id: string | null
  exercise: { name: string; video_url: string | null } | null
  // One-line prescription summary (e.g. "3 × 8 · 80kg · 90s rest"), built
  // server-side from the per-set program_exercise_sets rows via
  // summarisePrescription so the volume/load units can't drift from the
  // builder. Empty string when nothing is prescribed yet → the row shows '—'.
  prescription: string
}

export interface ProgramDayWithExercises {
  id: string
  program_id: string
  scheduled_date: string   // ISO date 'YYYY-MM-DD'
  day_label: string
  sort_order: number
  // Assigned (published) state — NULL until the EP assigns the day to the
  // client's portal. Drives the per-tile "Assigned" marker and the
  // "Assign all" header count.
  published_at: string | null
  // Completed state — true when the client has logged a completed session
  // against this day (sessions.completed_at). Drives the per-tile
  // "Completed" glyph, which supersedes the "Assigned" marker (a completed
  // day was necessarily assigned). A single binary status glyph only — the
  // logged performance data stays on the client profile.
  completed: boolean
  exercises: ProgramExerciseWithMeta[]
}

interface MonthCalendarProps {
  clientId: string
  clientFirstName: string
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
  // P1-1 — week-level batch operations. Pick modes mirror the day-level
  // shapes: week-copy-pick turns every week row into a destination
  // target; week-repeat-pick opens the end-date picker in week mode.
  | { kind: 'week-copy-pick'; sourceWeekStart: string }
  | { kind: 'week-repeat-pick'; sourceWeekStart: string }
  | {
      kind: 'confirm-week-copy'
      sourceWeekStart: string
      targetWeekStart: string
      conflicts: ConflictEntry[]
      noProgramDates: string[]
    }
  | {
      kind: 'confirm-week-repeat'
      sourceWeekStart: string
      endDate: string
      conflicts: ConflictEntry[]
      noProgramDates: string[]
    }
  // Honest generic-failure surface (P1-2 mechanism, introduced with the
  // week ops): network/RLS failures get a factual one-button dialog
  // instead of a silent console.error or a mislabeled no-program toast.
  | { kind: 'error-toast'; title: string; message: string }

export function MonthCalendar({
  clientId,
  clientFirstName,
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

  // "Assign all" (item 1) — bulk-publish every unassigned day that has at
  // least one exercise, across all of the client's active blocks. The count
  // drives the header button's visibility + label; empty days are excluded
  // because they can't be published (same rule as the single-day path).
  const [assignAllOpen, setAssignAllOpen] = useState(false)
  const [assignAllBusy, setAssignAllBusy] = useState(false)
  const [assignAllError, setAssignAllError] = useState<string | null>(null)
  const unassignedCount = useMemo(
    () =>
      days.filter((d) => d.published_at === null && d.exercises.length > 0)
        .length,
    [days],
  )

  const runAssignAll = useCallback(async () => {
    setAssignAllBusy(true)
    setAssignAllError(null)
    try {
      const res = await publishAllProgramDaysAction(clientId)
      if ('error' in res) {
        setAssignAllError(res.error)
        return
      }
      setAssignAllOpen(false)
      startTransition(() => router.refresh())
    } finally {
      setAssignAllBusy(false)
    }
  }, [clientId, router])

  // Single-day assign from a tile's top-right paper-plane (item 3 — assign
  // without opening the day, mirroring the preview affordance). Publishes
  // immediately, matching the in-builder AssignButton (no confirm; Unassign
  // is the undo).
  const [assigningId, setAssigningId] = useState<string | null>(null)
  const runAssignOne = useCallback(
    async (dayId: string) => {
      setAssigningId(dayId)
      try {
        const res = await publishProgramDayAction(clientId, dayId)
        if (res.error) {
          setMode({
            kind: 'error-toast',
            title: 'Assign failed',
            message: res.error,
          })
          return
        }
        startTransition(() => router.refresh())
      } finally {
        setAssigningId(null)
      }
    },
    [clientId, router],
  )

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
          console.error('copy_program_day error:', result.error)
          // P1-2 — a generic failure used to masquerade as the
          // no-program toast (wrong explanation for a network/auth
          // error). Factual dialog instead.
          setMode({
            kind: 'error-toast',
            title: 'Copy failed',
            message:
              'The session could not be copied. Check your connection and try again.',
          })
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
          console.error('repeat_program_day_weekly error:', result.error)
          // P1-2 — was a silent return to idle; the EP saw nothing.
          setMode({
            kind: 'error-toast',
            title: 'Repeat failed',
            message:
              'The session could not be repeated. Check your connection and try again.',
          })
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

  // P1-1 — week-level runners. Same shape as the day runners, but with
  // honest failure surfacing from birth (error-toast mode): a network or
  // auth failure tells the EP what happened instead of doing nothing.
  const runCopyWeek = useCallback(
    async (sourceWeekStart: string, targetWeekStart: string, force: boolean) => {
      setBusy(true)
      try {
        const result = await copyWeekAction(
          clientId,
          sourceWeekStart,
          targetWeekStart,
          force,
        )
        if ('error' in result) {
          console.error('copy_program_week error:', result.error)
          setMode({
            kind: 'error-toast',
            title: 'Copy failed',
            message:
              'The week could not be copied. Check your connection and try again.',
          })
          return
        }
        switch (result.status) {
          case 'created':
            setMode({ kind: 'idle' })
            startTransition(() => router.refresh())
            break
          case 'conflict':
            setMode({
              kind: 'confirm-week-copy',
              sourceWeekStart,
              targetWeekStart,
              conflicts: result.conflicts,
              noProgramDates: result.noProgramDates,
            })
            break
          case 'empty_week':
            // Shouldn't happen — the week buttons disable at 0 sessions.
            setMode({
              kind: 'error-toast',
              title: 'Nothing to copy',
              message: 'That week has no sessions.',
            })
            break
          case 'invalid_week':
            setMode({
              kind: 'error-toast',
              title: 'Copy failed',
              message: 'Pick a destination week other than the source week.',
            })
            break
        }
      } finally {
        setBusy(false)
      }
    },
    [clientId, router],
  )

  const runRepeatWeek = useCallback(
    async (sourceWeekStart: string, endDate: string, force: boolean) => {
      setBusy(true)
      try {
        const result = await repeatWeekAction(
          clientId,
          sourceWeekStart,
          endDate,
          force,
        )
        if ('error' in result) {
          console.error('repeat_program_week error:', result.error)
          setMode({
            kind: 'error-toast',
            title: 'Repeat failed',
            message:
              'The week could not be repeated. Check your connection and try again.',
          })
          return
        }
        switch (result.status) {
          case 'created':
            setMode({ kind: 'idle' })
            startTransition(() => router.refresh())
            break
          case 'conflict':
            setMode({
              kind: 'confirm-week-repeat',
              sourceWeekStart,
              endDate,
              conflicts: result.conflicts,
              noProgramDates: result.noProgramDates,
            })
            break
          case 'empty_week':
            setMode({
              kind: 'error-toast',
              title: 'Nothing to repeat',
              message: 'That week has no sessions.',
            })
            break
          case 'invalid_week':
          case 'invalid_end_date':
            // UI-side validation should prevent both; fall back to a
            // factual message rather than silence.
            setMode({
              kind: 'error-toast',
              title: 'Repeat failed',
              message: 'Pick an end date after the source week.',
            })
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
          console.error('soft_delete_program_day error:', result.error)
          // P1-2 — was a silent return to idle.
          setMode({
            kind: 'error-toast',
            title: 'Delete failed',
            message:
              'The session could not be deleted. Check your connection and try again.',
          })
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
          console.error('create_program_day error:', result.error)
          // P1-2 — was a silent popover close.
          setOpenCell(null)
          setMode({
            kind: 'error-toast',
            title: 'Add session failed',
            message:
              'The session could not be created. Check your connection and try again.',
          })
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
      // P1-1 — clicking ANY cell while week-copy-picking selects that
      // cell's whole Mon–Sun week as the destination.
      if (mode.kind === 'week-copy-pick') {
        const targetWeekStart = mondayOf(cellIso)
        if (targetWeekStart === mode.sourceWeekStart) return
        if (targetWeekStart < mondayOf(todayIso)) return
        runCopyWeek(mode.sourceWeekStart, targetWeekStart, false)
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
    [mode, runCopy, runCopyWeek, todayIso],
  )

  return (
    <div>
      {/* ─── Copy-pick banner: shown while the EP is choosing a
          destination day for a copy. ─── */}
      {mode.kind === 'copy-pick' && (
        <CopyPickBanner onCancel={() => setMode({ kind: 'idle' })}>
          Copying <strong>Day {mode.sourceLabel}</strong> from{' '}
          <strong>{formatLongDate(mode.sourceDate)}</strong> — click any
          future day on the calendar to paste, or press Esc to cancel.
        </CopyPickBanner>
      )}

      {/* P1-1 — week-copy-pick banner. */}
      {mode.kind === 'week-copy-pick' && (
        <CopyPickBanner onCancel={() => setMode({ kind: 'idle' })}>
          Copying the week of{' '}
          <strong>{formatLongDate(mode.sourceWeekStart)}</strong> — click any
          future week to paste into, or press Esc to cancel.
        </CopyPickBanner>
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
          {/* "Assign all" (item 1) — only when there's an unassigned backlog
              with exercises. Mirrors the single-day AssignButton's primary +
              Send treatment so the assign vocabulary is consistent. */}
          {unassignedCount > 0 && mode.kind === 'idle' && (
            <button
              type="button"
              onClick={() => {
                setAssignAllError(null)
                setAssignAllOpen(true)
              }}
              className="btn primary"
              style={{
                padding: '6px 14px',
                fontSize: '.82rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Send size={13} aria-hidden />
              Assign all · {unassignedCount}
            </button>
          )}
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
        onCopyWeek={(weekStart) => {
          setOpenCell(null)
          setMode({ kind: 'week-copy-pick', sourceWeekStart: weekStart })
        }}
        onRepeatWeek={(weekStart) => {
          setOpenCell(null)
          setMode({ kind: 'week-repeat-pick', sourceWeekStart: weekStart })
        }}
        onAssignDay={runAssignOne}
        assigningDayId={assigningId}
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

      {/* ─── P1-1 — week-repeat end-date picker (same component, week
          copy). sourceDate is the week's Monday, so the weekly stepping
          maths is identical. ─── */}
      {mode.kind === 'week-repeat-pick' && (
        <RepeatEndDatePicker
          sourceDate={mode.sourceWeekStart}
          sourceLabel=""
          weekMode
          onCancel={() => setMode({ kind: 'idle' })}
          onConfirm={(endDate) =>
            runRepeatWeek(mode.sourceWeekStart, endDate, false)
          }
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

      {/* ─── P1-1 — week-operation confirm dialogs ─── */}
      {mode.kind === 'confirm-week-copy' && (
        <ConflictDialog
          title="Some dates already have sessions"
          description={`${mode.conflicts.length} of the destination dates already ${mode.conflicts.length === 1 ? 'has a programmed session' : 'have programmed sessions'}. Overwrite ${mode.conflicts.length === 1 ? 'it' : 'all of them'} with the copied week?`}
          conflicts={mode.conflicts}
          noProgramDates={mode.noProgramDates}
          onCancel={() => setMode({ kind: 'idle' })}
          onConfirm={() =>
            runCopyWeek(mode.sourceWeekStart, mode.targetWeekStart, true)
          }
          busy={busy}
        />
      )}

      {mode.kind === 'confirm-week-repeat' && (
        <ConflictDialog
          title="Some dates already have sessions"
          description={`${mode.conflicts.length} of the target dates already ${mode.conflicts.length === 1 ? 'has a programmed session' : 'have programmed sessions'}. Overwrite ${mode.conflicts.length === 1 ? 'it' : 'all of them'}?`}
          conflicts={mode.conflicts}
          noProgramDates={mode.noProgramDates}
          onCancel={() => setMode({ kind: 'idle' })}
          onConfirm={() =>
            runRepeatWeek(mode.sourceWeekStart, mode.endDate, true)
          }
          busy={busy}
        />
      )}

      {/* ─── Honest generic-failure dialog (P1-2 mechanism) ─── */}
      {mode.kind === 'error-toast' && (
        <ConflictDialog
          title={mode.title}
          description={mode.message}
          conflicts={[]}
          noProgramDates={[]}
          onCancel={() => setMode({ kind: 'idle' })}
          onConfirm={() => setMode({ kind: 'idle' })}
          confirmLabel="OK"
          hideCancel
          busy={false}
        />
      )}

      {/* ─── "Assign all" confirm (item 1) — tone='primary' because
          publishing is recoverable (each day can be unassigned), not
          destructive. The count is the publishable backlog; empty days are
          already excluded from it. A failure surfaces inside the dialog. ─── */}
      {assignAllOpen && (
        <ConfirmDialog
          title="Assign all sessions?"
          body={
            <>
              {unassignedCount}{' '}
              {unassignedCount === 1 ? 'session' : 'sessions'} will be assigned
              to {clientFirstName} and appear in their portal. Days with no
              exercises are skipped.
            </>
          }
          confirmLabel={`Assign ${unassignedCount}`}
          tone="primary"
          busy={assignAllBusy}
          error={assignAllError}
          onCancel={() => {
            if (assignAllBusy) return
            setAssignAllOpen(false)
            setAssignAllError(null)
          }}
          onConfirm={runAssignAll}
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
  onCopyWeek: (weekStartIso: string) => void
  onRepeatWeek: (weekStartIso: string) => void
  onAssignDay: (dayId: string) => void
  assigningDayId: string | null
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
  onCopyWeek,
  onRepeatWeek,
  onAssignDay,
  assigningDayId,
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

  // Reset collapsed state when the month changes. Done during render via the
  // previous-month-key pattern (not an effect) to satisfy
  // react-hooks/set-state-in-effect; behaviour is identical — a newly shown
  // month starts fully expanded.
  const monthKey = `${year}-${month}`
  const [prevMonthKey, setPrevMonthKey] = useState(monthKey)
  if (prevMonthKey !== monthKey) {
    setPrevMonthKey(monthKey)
    setCollapsedWeeks(new Set())
  }

  // P2-3 / FM-7 — one toggle shared by the chevron gutter AND the collapsed
  // summary strip, so the collapse affordance is the whole row edge / strip,
  // not just the small chevron glyph. Default stays expanded (accepted
  // deviation from §2.1: collapsed-by-default would hide the month at a
  // glance in the operator-validated single-month grid).
  function toggleWeek(ord: number) {
    setCollapsedWeeks((prev) => {
      const next = new Set(prev)
      if (next.has(ord)) next.delete(ord)
      else next.add(ord)
      return next
    })
  }

  const gridTemplate = '24px repeat(7, 1fr)'

  return (
    <div
      className="card"
      style={{
        position: 'relative',
        padding: 12,
        // P2-2 TODO: no design token exists for this calendar cream surface
        // (#f5f0ea — distinct from --color-surface #f7f4f0 / --color-surface-2
        // #ede8e2). Adding one edits the design-system layer, an operator/design
        // decision — surfaced, not invented here. Same posture for the accent
        // tints (4/6/8% — only 10% is tokenised), the modal scrim
        // rgba(28,25,23,0.5), and the off-system 5/6/8px radii. See the P2-2
        // closing note for the full surfaced inventory.
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
          // P1-1 — week-level operations key off the row's Monday. The
          // session count for enable/disable spans the FULL Mon–Sun range
          // (a boundary week can hold adjacent-month days the in-month
          // count above doesn't see — the operation copies those too).
          const weekStartIso = week.cells[0]!.iso
          const weekSessionCount = week.cells.filter((c) =>
            daysByDate.get(c.iso),
          ).length
          const mondayOfToday = mondayOf(todayIso)
          const inWeekPick = mode.kind === 'week-copy-pick'
          const weekIsPickSource =
            inWeekPick && weekStartIso === mode.sourceWeekStart
          const weekIsPickPast = inWeekPick && weekStartIso < mondayOfToday
          const weekIsPickTarget =
            inWeekPick && !weekIsPickSource && !weekIsPickPast

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
                onClick={() => toggleWeek(week.ord)}
                aria-label={collapsed ? 'Expand week' : 'Collapse week'}
                aria-expanded={!collapsed}
                title={collapsed ? 'Expand week' : 'Collapse week'}
                style={{
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'grid',
                  // Expanded: the chevron sits at the top, but the whole
                  // gutter column stretches to a full-height click target
                  // (P2-3 — widen the affordance beyond the glyph).
                  // Collapsed: a compact centred hit area on the strip row.
                  placeItems: collapsed ? 'center' : 'start center',
                  color: 'var(--color-muted)',
                  alignSelf: collapsed ? 'flex-start' : 'stretch',
                  paddingTop: collapsed ? 0 : 4,
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
                  onClick={
                    weekIsPickTarget
                      ? () => onCellClick(weekStartIso, null)
                      : mode.kind === 'idle'
                      ? () => toggleWeek(week.ord)
                      : undefined
                  }
                  title={
                    !weekIsPickTarget && mode.kind === 'idle'
                      ? 'Expand week'
                      : undefined
                  }
                  style={{
                    gridColumn: '2 / -1',
                    background: weekIsPickTarget
                      ? 'rgba(45, 178, 76, 0.04)'
                      : 'var(--color-card)',
                    border: weekIsPickTarget
                      ? '1px dashed var(--color-primary)'
                      : '1px solid var(--color-border-subtle)',
                    borderRadius: 'var(--radius-button)',
                    padding: '6px 12px',
                    fontSize: '.74rem',
                    color: 'var(--color-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    // P2-3 — the whole collapsed strip expands the week (not
                    // just the chevron). Copy/Repeat buttons stopPropagation,
                    // so they still act independently. Suppressed during any
                    // pick mode so it can't hijack an in-progress copy.
                    cursor: weekIsPickTarget
                      ? 'copy'
                      : mode.kind === 'idle'
                      ? 'pointer'
                      : undefined,
                    opacity:
                      weekIsPickSource || weekIsPickPast ? 0.4 : 1,
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
                  {/* P1-1 — week-level Copy / Repeat (Q1 amendment: the
                      affordance lives on the collapsed week row, next to
                      the session count). Disabled with a factual title
                      when the full Mon–Sun range has no sessions. Hidden
                      during any pick mode so they can't hijack an
                      in-progress copy. */}
                  {mode.kind === 'idle' && (
                    <span
                      style={{
                        marginLeft: 'auto',
                        display: 'flex',
                        gap: 6,
                      }}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onCopyWeek(weekStartIso)
                        }}
                        disabled={weekSessionCount === 0 || busy}
                        aria-label="Copy week"
                        title={
                          weekSessionCount === 0
                            ? 'No sessions in this week to copy'
                            : 'Copy week — pick a destination week'
                        }
                        style={{
                          ...iconLinkStyle,
                          opacity: weekSessionCount === 0 ? 0.4 : 1,
                          cursor:
                            weekSessionCount === 0
                              ? 'not-allowed'
                              : 'pointer',
                        }}
                      >
                        <Copy size={13} aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onRepeatWeek(weekStartIso)
                        }}
                        disabled={weekSessionCount === 0 || busy}
                        aria-label="Repeat week"
                        title={
                          weekSessionCount === 0
                            ? 'No sessions in this week to repeat'
                            : 'Repeat week — weekly until an end date'
                        }
                        style={{
                          ...iconLinkStyle,
                          opacity: weekSessionCount === 0 ? 0.4 : 1,
                          cursor:
                            weekSessionCount === 0
                              ? 'not-allowed'
                              : 'pointer',
                        }}
                      >
                        <Repeat size={13} aria-hidden />
                      </button>
                    </span>
                  )}
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
                  // shows a copy-cursor on hover. Week-copy-pick reuses
                  // the same visual states at whole-row granularity.
                  const inCopyPick = mode.kind === 'copy-pick'
                  const isCopySource =
                    (inCopyPick && c.iso === mode.sourceDate) ||
                    weekIsPickSource
                  const isPastInCopy =
                    (inCopyPick && c.iso < todayIso) || weekIsPickPast
                  const isCopyTarget =
                    (inCopyPick && !isCopySource && !isPastInCopy) ||
                    weekIsPickTarget
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
                      onAssign={() => day && onAssignDay(day.id)}
                      assigning={assigningDayId === day?.id}
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
  // Item 3 — assign this day directly from its tile corner (no need to open).
  onAssign: () => void
  // True while THIS day's single-tile assign is in flight.
  assigning: boolean
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
  onAssign,
  assigning,
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

      {/* Top-right corner (items 2 & 3) — absolutely positioned so it never
          changes the tile's height. Precedence: completed → a stronger green
          "Completed" tick (the client has logged it); assigned → a quiet green
          check; not yet assigned but has exercises → a paper-plane that assigns
          the day in one click (no need to open it). Hidden during a copy-pick so
          it can't be mistaken for a paste target. */}
      {!inCopyPick &&
        (day.completed || day.published_at !== null || day.exercises.length > 0) && (
        <div style={{ position: 'absolute', top: 6, right: 6, zIndex: 3 }}>
          {day.completed ? (
            <span
              aria-label="Completed"
              title="Completed"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 7px',
                borderRadius: 999,
                // Stronger accent tint than the "Assigned" pill so completion
                // reads as a step beyond assignment — matches the schedule's
                // completed status pip. Green is the sanctioned completion
                // colour; the small-size text stays soft per the design rule.
                background: 'var(--color-accent-soft-strong)',
                color: 'var(--color-text-light)',
                fontFamily: 'var(--font-sans)',
                fontSize: '.62rem',
                fontWeight: 500,
                whiteSpace: 'nowrap',
              }}
            >
              <Check
                size={11}
                strokeWidth={3}
                aria-hidden
                style={{ color: 'var(--color-accent)' }}
              />
              Completed
            </span>
          ) : day.published_at !== null ? (
            <span
              aria-label="Assigned"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 7px',
                borderRadius: 999,
                background: 'var(--color-accent-soft)',
                color: 'var(--color-text-light)',
                fontFamily: 'var(--font-sans)',
                fontSize: '.62rem',
                fontWeight: 500,
                whiteSpace: 'nowrap',
              }}
            >
              <Check
                size={11}
                aria-hidden
                style={{ color: 'var(--color-accent)' }}
              />
              Assigned
            </span>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                onAssign()
              }}
              disabled={assigning}
              title="Assign to client"
              aria-label="Assign session"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 7px',
                borderRadius: 999,
                border: '1px solid var(--color-border-subtle)',
                background: 'var(--color-card)',
                color: 'var(--color-primary)',
                fontFamily: 'var(--font-sans)',
                fontSize: '.62rem',
                fontWeight: 500,
                whiteSpace: 'nowrap',
                cursor: assigning ? 'wait' : 'pointer',
                opacity: assigning ? 0.5 : 1,
                transition: 'background 150ms cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            >
              <Send size={11} aria-hidden />
              {assigning ? 'Assigning…' : 'Assign'}
            </button>
          )}
        </div>
      )}

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
        borderRadius: 'var(--radius-card-dense)',
        // Accepted floating-overlay elevation (Phase F P2-4) — a popover must
        // lift off the grid. NOT the banned button/menu shadow; no shadow
        // token exists, so the literal stays, named here.
        boxShadow: '0 12px 28px rgba(0,0,0,.12)',
        padding: 8,
        zIndex: 25,
      }}
    >
      {/* P2-1 / FM-6 — quiet block-name eyebrow so any day self-identifies
          its training block. Without it a month spanning two blocks reads
          identically across the boundary; this lets the EP confirm which
          block a day belongs to the moment they open it. Truncates with a
          title fallback for long block names. */}
      {program && (
        <div
          title={program.name}
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontSize: '.62rem',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--color-muted)',
            marginBottom: 6,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {program.name}
        </div>
      )}

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
                  {exercise.prescription || '—'}
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
        borderRadius: 'var(--radius-card-dense)',
        // Accepted floating-overlay elevation (see DaySummaryPopover).
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
        // Item 3 — no covering block: still offer plain "Add session". The
        // create RPC attaches it to the client's loose container behind the
        // scenes, so a date with no block doesn't need one first.
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
  color: 'var(--color-alert)',
}


// ============================================================================
// CopyPickBanner — top-of-calendar banner shown while the EP is
// choosing a destination cell for a copy. Esc cancels too (handled
// at the MonthCalendar level).
// ============================================================================

interface CopyPickBannerProps {
  onCancel: () => void
  // The banner message — day and week copy modes phrase it differently,
  // so the caller owns the copy.
  children: React.ReactNode
}

function CopyPickBanner({ onCancel, children }: CopyPickBannerProps) {
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
      <span>{children}</span>
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
  // P1-1 — week mode: sourceDate is a week's Monday and the whole week
  // repeats. Same weekly date maths; only the copy changes.
  weekMode?: boolean
}

function RepeatEndDatePicker({
  sourceDate,
  sourceLabel,
  onCancel,
  onConfirm,
  busy,
  weekMode = false,
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
          borderRadius: 'var(--radius-card)',
          // Accepted floating-overlay elevation (Phase F P2-4) — a centred
          // modal dialog lifts above the scrim. Not a button/menu shadow.
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
              {weekMode ? 'Repeat week' : `Repeat Day ${sourceLabel}`}
            </div>
            <div style={{ fontSize: '.78rem', color: 'var(--color-muted)', marginTop: 2 }}>
              {weekMode ? (
                <>
                  Pick an end date. The whole week of{' '}
                  {formatLongDate(sourceDate)} repeats weekly through the
                  picked date.
                </>
              ) : (
                <>
                  Pick an end date. Repeats on every {weekdayName} between{' '}
                  {formatLongDate(isoFromDate(addDaysTo(sourceParsed, 7)))} and the picked date.
                </>
              )}
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
            borderRadius: 'var(--radius-input)',
            fontSize: '.78rem',
            color: 'var(--color-text-light)',
            minHeight: 36,
          }}
        >
          {pickedEnd ? (
            targetDates.length === 0 ? (
              <span>
                {weekMode
                  ? `No whole weeks between source and ${formatLongDate(pickedEnd)}.`
                  : `No same-weekday occurrences between source and ${formatLongDate(pickedEnd)}.`}
              </span>
            ) : weekMode ? (
              <span>
                <strong style={{ color: 'var(--color-charcoal)' }}>
                  {targetDates.length}
                </strong>{' '}
                week{targetDates.length === 1 ? '' : 's'} — starting{' '}
                {formatLongDate(targetDates[0]!)}
                {targetDates.length > 1 &&
                  ` to ${formatLongDate(targetDates[targetDates.length - 1]!)}`}
              </span>
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
          borderRadius: 'var(--radius-card)',
          // Accepted floating-overlay elevation (see RepeatEndDatePicker).
          boxShadow: '0 24px 60px rgba(0,0,0,.18)',
          padding: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
          <AlertCircle
            size={18}
            aria-hidden
            style={{ color: 'var(--color-warning)', flexShrink: 0, marginTop: 2 }}
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

// Monday of the Mon-first week containing the given date (P1-1 — week
// operations key off week-start Mondays, matching the grid's rows).
function mondayOf(iso: string): string {
  const d = parseIso(iso)
  const offset = (d.getDay() + 6) % 7 // Mon=0 .. Sun=6
  return isoFromDate(addDaysTo(d, -offset))
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
