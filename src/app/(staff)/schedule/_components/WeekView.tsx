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
  ChevronLeft,
  ChevronRight,
  CreditCard,
  FileText,
  Plus,
  Settings as SettingsIcon,
  StickyNote,
  X,
} from 'lucide-react'
import {
  initialsFor,
  toneFor,
  type AvatarTone,
} from '../../clients/_lib/client-helpers'
import {
  cancelAppointmentAction,
  createAppointmentAction,
  updateAppointmentTimeAction,
} from '../actions'

export type Appointment = {
  id: string
  start_at: string
  end_at: string
  appointment_type: string
  status: 'pending' | 'confirmed' | 'cancelled' | 'no_show' | 'completed'
  location: string | null
  notes: string | null
  client: {
    id: string
    first_name: string
    last_name: string
    category_name: string | null
  }
}

export type BookingClient = {
  id: string
  first_name: string
  last_name: string
  category_name: string | null
}

interface WeekViewProps {
  weekStartIso: string
  appointments: Appointment[]
  clients: BookingClient[]
  todayIso: string
  nowIso: string
}

// Grid constants
const HOUR_START = 6 // 6am
const HOUR_END = 20 // 8pm (exclusive)
const HOURS = HOUR_END - HOUR_START // 14
const QUARTERS_PER_HOUR = 4
const PX_PER_QUARTER = 16 // 64px/hour
const PX_PER_HOUR = PX_PER_QUARTER * QUARTERS_PER_HOUR

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function WeekView({
  weekStartIso,
  appointments,
  clients,
  todayIso,
  nowIso,
}: WeekViewProps) {
  const weekStart = parseIsoDate(weekStartIso)
  const today = parseIsoDate(todayIso)
  const now = new Date(nowIso)
  const router = useRouter()

  // Popover state: which appointment's card is open + viewport coords.
  const [popover, setPopover] = useState<{
    appt: Appointment
    x: number
    y: number
  } | null>(null)

  // Composer state: which slot the user clicked to create a booking.
  const [composer, setComposer] = useState<{ startAt: Date } | null>(null)

  // Grid container ref — used by AppointmentBlock's drag code to map
  // pointer coords to a day column via elementFromPoint.
  const gridRef = useRef<HTMLDivElement | null>(null)

  // ESC / outside-click closes the popover.
  useEffect(() => {
    if (!popover) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPopover(null)
    }
    function onClick(e: MouseEvent) {
      const el = e.target as HTMLElement
      if (!el.closest('[data-popover-card]')) {
        setPopover(null)
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [popover])

  // Group appointments by day index (0 = Mon … 6 = Sun)
  const appointmentsByDay = useMemo(() => {
    const map: Appointment[][] = Array.from({ length: 7 }, () => [])
    for (const a of appointments) {
      const start = new Date(a.start_at)
      const dayIdx = dayIndexFromMonday(start, weekStart)
      if (dayIdx >= 0 && dayIdx < 7) map[dayIdx].push(a)
    }
    return map
  }, [appointments, weekStart])

  const monthLabel = formatMonthYear(weekStart)

  function gotoWeek(direction: 'prev' | 'next' | 'today') {
    if (direction === 'today') {
      router.push('/schedule')
      return
    }
    const delta = direction === 'next' ? 7 : -7
    const target = addDays(weekStart, delta)
    router.push(`/schedule?w=${toIsoDate(target)}`)
  }

  return (
    <div
      style={{
        background: 'var(--color-card)',
        height: 'calc(100vh - 52px)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          padding: '14px 22px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid var(--color-border-subtle)',
          flexShrink: 0,
        }}
      >
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 14 }}
        >
          <div style={{ display: 'flex', gap: 0 }}>
            <button
              type="button"
              aria-label="Previous week"
              onClick={() => gotoWeek('prev')}
              style={navArrowStyle('left')}
            >
              <ChevronLeft size={14} aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Next week"
              onClick={() => gotoWeek('next')}
              style={navArrowStyle('right')}
            >
              <ChevronRight size={14} aria-hidden />
            </button>
          </div>
          <button
            type="button"
            className="btn outline"
            onClick={() => gotoWeek('today')}
          >
            Today
          </button>
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '1.2rem',
              margin: 0,
            }}
          >
            {monthLabel}
          </h2>
        </div>

        <div
          style={{ display: 'flex', gap: 10, alignItems: 'center' }}
        >
          <button type="button" className="btn outline" disabled>
            <SettingsIcon size={14} aria-hidden />
            Settings
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => setComposer({ startAt: defaultNewBookingStart(now) })}
          >
            <Plus size={14} aria-hidden />
            New booking
          </button>
        </div>
      </div>

      {/* Date rolodex */}
      <DateRolodex weekStart={weekStart} today={today} />

      {/* Day headers */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `52px repeat(7, 1fr)`,
          borderBottom: '1px solid var(--color-border-subtle)',
          flexShrink: 0,
        }}
      >
        <div />
        {DAY_LABELS.map((label, i) => {
          const date = addDays(weekStart, i)
          const isToday = sameCalendarDay(date, today)
          return (
            <div
              key={label}
              style={{
                padding: '12px 14px',
                borderLeft: '1px solid var(--color-border-subtle)',
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: '.86rem',
                color: isToday
                  ? 'var(--color-primary)'
                  : 'var(--color-charcoal)',
                background: isToday ? 'rgba(30,26,24,.03)' : 'transparent',
              }}
            >
              {label} {date.getDate()}
              {isToday && (
                <span
                  style={{
                    fontSize: '.62rem',
                    fontWeight: 700,
                    color: 'var(--color-accent)',
                    marginLeft: 6,
                    letterSpacing: '.06em',
                  }}
                >
                  TODAY
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* Time grid */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          position: 'relative',
        }}
      >
        <div
          ref={gridRef}
          style={{
            display: 'grid',
            gridTemplateColumns: `52px repeat(7, 1fr)`,
            position: 'relative',
          }}
        >
          {/* Hour labels column */}
          <div>
            {Array.from({ length: HOURS }).map((_, i) => {
              const h = HOUR_START + i
              return (
                <div
                  key={h}
                  style={{
                    height: PX_PER_HOUR,
                    fontSize: '.64rem',
                    color: 'var(--color-muted)',
                    padding: '4px 6px',
                    textAlign: 'right',
                    fontFamily: 'var(--font-display)',
                    fontWeight: 600,
                  }}
                >
                  {formatHour(h)}
                </div>
              )
            })}
          </div>

          {/* 7 day columns */}
          {Array.from({ length: 7 }).map((_, dayIdx) => {
            const date = addDays(weekStart, dayIdx)
            const isToday = sameCalendarDay(date, today)
            return (
              <div
                key={dayIdx}
                data-day-idx={dayIdx}
                style={{
                  position: 'relative',
                  borderLeft: '1px solid var(--color-border-subtle)',
                  background: isToday ? 'rgba(30,26,24,.02)' : '#fff',
                }}
              >
                {/* 15-min cells with hover highlight */}
                {Array.from({ length: HOURS * QUARTERS_PER_HOUR }).map(
                  (_, q) => (
                    <QuarterCell
                      key={q}
                      quarterIndex={q}
                      onClick={() =>
                        setComposer({
                          startAt: slotToDate(date, q),
                        })
                      }
                    />
                  ),
                )}

                {/* Appointment blocks */}
                {appointmentsByDay[dayIdx].map((a) => (
                  <AppointmentBlock
                    key={a.id}
                    appointment={a}
                    gridRef={gridRef}
                    onOpenPopover={(ev) =>
                      setPopover({
                        appt: a,
                        x: ev.clientX,
                        y: ev.clientY,
                      })
                    }
                    onCommitted={() => router.refresh()}
                  />
                ))}

                {/* Current-time indicator */}
                {isToday && <NowLine now={now} />}
              </div>
            )
          })}
        </div>
      </div>

      {appointments.length === 0 && <EmptyWeekHint />}

      {/* Popover */}
      {popover && (
        <AppointmentPopover
          data={popover}
          onClose={() => setPopover(null)}
          onCancelled={() => {
            setPopover(null)
            router.refresh()
          }}
        />
      )}

      {/* Booking composer */}
      {composer && (
        <BookingComposer
          startAt={composer.startAt}
          clients={clients}
          onClose={() => setComposer(null)}
          onCreated={() => {
            setComposer(null)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

/* Convert (day, quarter-index) → Date at that slot in local time. */
function slotToDate(day: Date, quarterIndex: number): Date {
  const totalMin = quarterIndex * 15
  const h = HOUR_START + Math.floor(totalMin / 60)
  const m = totalMin % 60
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0)
}

/* ====================== Date rolodex ====================== */

function DateRolodex({
  weekStart,
  today,
}: {
  weekStart: Date
  today: Date
}) {
  // Show a 14-day strip starting 3 days before the week's Monday so there
  // are peek days on either side. Matches the design's rhythm.
  const rolodexStart = addDays(weekStart, -3)
  return (
    <div
      style={{
        display: 'flex',
        gap: 4,
        padding: '10px 22px',
        borderBottom: '1px solid var(--color-border-subtle)',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {Array.from({ length: 14 }).map((_, i) => {
        const date = addDays(rolodexStart, i)
        const isToday = sameCalendarDay(date, today)
        const dayShort = date.toLocaleDateString('en-AU', {
          weekday: 'narrow',
        })
        return (
          <div
            key={i}
            style={{
              flex: 1,
              textAlign: 'center',
              padding: '6px 0',
              background: isToday
                ? 'var(--color-primary)'
                : 'transparent',
              color: isToday ? '#fff' : 'var(--color-text)',
              borderRadius: 8,
              cursor: 'default',
            }}
          >
            <div
              style={{
                fontSize: '.6rem',
                color: isToday
                  ? 'rgba(255,255,255,.6)'
                  : 'var(--color-muted)',
                fontWeight: 600,
              }}
            >
              {dayShort}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: '.9rem',
              }}
            >
              {date.getDate()}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ====================== Quarter cell (hover highlight) ====================== */

function QuarterCell({
  quarterIndex,
  onClick,
}: {
  quarterIndex: number
  onClick: () => void
}) {
  const [hover, setHover] = useState(false)
  const isHourStart = quarterIndex % 4 === 0
  const isHalfHour = quarterIndex % 4 === 2
  // Subtle rule at the top of every hour, dashed rule at the half-hour.
  const borderTop = isHourStart
    ? '1px solid var(--color-border-subtle)'
    : isHalfHour
      ? '1px dashed #F0EBE5'
      : 'none'
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      style={{
        height: PX_PER_QUARTER,
        borderTop,
        background: hover ? 'rgba(30,26,24,0.08)' : 'transparent',
        cursor: 'copy',
        transition: 'background 80ms',
      }}
    />
  )
}

/* ====================== Appointment block ====================== */

type DragState =
  | null
  | {
      mode: 'move' | 'resize'
      startX: number
      startY: number
      deltaMin: number // time shift (only snapped)
      deltaDays: number // for move only — cross-column shift
      didMove: boolean
    }

const DRAG_THRESHOLD_PX = 4
const RESIZE_HANDLE_HEIGHT = 8

function AppointmentBlock({
  appointment,
  gridRef,
  onOpenPopover,
  onCommitted,
}: {
  appointment: Appointment
  gridRef: React.RefObject<HTMLDivElement | null>
  onOpenPopover: (ev: React.PointerEvent | React.MouseEvent) => void
  onCommitted: () => void
}) {
  const start = new Date(appointment.start_at)
  const end = new Date(appointment.end_at)
  const baseTop =
    (start.getHours() - HOUR_START) * PX_PER_HOUR +
    (start.getMinutes() / 15) * PX_PER_QUARTER
  const baseHeight =
    ((end.getTime() - start.getTime()) / (1000 * 60 * 15)) *
      PX_PER_QUARTER -
    2

  const tone = toneForStatus(appointment.status)
  const { bg, border } = toneToColors(tone)

  const [drag, setDrag] = useState<DragState>(null)
  const dragRef = useRef<DragState>(null)
  const apptRef = useRef(appointment)
  const callbacksRef = useRef({ onOpenPopover, onCommitted })
  const [pending, startTransition] = useTransition()

  // Keep refs fresh so the window-level pointer handlers (installed on
  // drag-start, not per-render) always read the current values.
  useEffect(() => {
    dragRef.current = drag
  }, [drag])
  useEffect(() => {
    apptRef.current = appointment
  }, [appointment])
  useEffect(() => {
    callbacksRef.current = { onOpenPopover, onCommitted }
  }, [onOpenPopover, onCommitted])

  const handleMove = useCallback(
    (ev: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const dx = ev.clientX - d.startX
      const dy = ev.clientY - d.startY
      const moved =
        Math.abs(dx) > DRAG_THRESHOLD_PX ||
        Math.abs(dy) > DRAG_THRESHOLD_PX

      // Snap vertical to 15-min increments (PX_PER_QUARTER px each).
      const deltaMin = Math.round(dy / PX_PER_QUARTER) * 15

      // For 'move', also detect horizontal shift by sniffing the day
      // column under the cursor.
      let deltaDays = d.deltaDays
      if (d.mode === 'move') {
        const underEl = document.elementFromPoint(ev.clientX, ev.clientY)
        const col = underEl?.closest('[data-day-idx]') as HTMLElement | null
        if (col) {
          const hoverIdx = parseInt(col.dataset.dayIdx ?? '', 10)
          const startDayIdx = dayIndexFromStart(
            apptRef.current.start_at,
            gridRef,
          )
          if (Number.isFinite(hoverIdx) && Number.isFinite(startDayIdx)) {
            deltaDays = hoverIdx - startDayIdx
          }
        }
      }

      setDrag({
        ...d,
        deltaMin,
        deltaDays,
        didMove: d.didMove || moved,
      })
    },
    [gridRef],
  )

  const handleUp = useCallback((ev: PointerEvent) => {
    const d = dragRef.current
    window.removeEventListener('pointermove', handleMove)
    window.removeEventListener('pointerup', handleUp)
    window.removeEventListener('pointercancel', handleUp)
    if (!d) {
      setDrag(null)
      return
    }

    if (!d.didMove) {
      // Treat as a click → open popover.
      setDrag(null)
      callbacksRef.current.onOpenPopover({
        clientX: ev.clientX,
        clientY: ev.clientY,
      } as React.MouseEvent)
      return
    }

    // Commit the new start/end to the DB.
    const appt = apptRef.current
    const origStart = new Date(appt.start_at)
    const origEnd = new Date(appt.end_at)

    let newStart = origStart
    let newEnd = origEnd

    if (d.mode === 'move') {
      newStart = addMinutes(addDaysDate(origStart, d.deltaDays), d.deltaMin)
      newEnd = addMinutes(addDaysDate(origEnd, d.deltaDays), d.deltaMin)
    } else {
      newEnd = addMinutes(origEnd, d.deltaMin)
      if (newEnd.getTime() - newStart.getTime() < 15 * 60 * 1000) {
        newEnd = new Date(newStart.getTime() + 15 * 60 * 1000)
      }
    }

    setDrag(null)
    startTransition(async () => {
      const res = await updateAppointmentTimeAction(
        appt.id,
        newStart.toISOString(),
        newEnd.toISOString(),
      )
      if (res.error) alert(res.error)
      callbacksRef.current.onCommitted()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Render-time transform: while dragging, translate or stretch the
  // block so the user sees the preview.
  const transform = drag
    ? drag.mode === 'move'
      ? `translate(calc(${drag.deltaDays} * 100%), ${
          (drag.deltaMin / 15) * PX_PER_QUARTER
        }px)`
      : undefined
    : undefined

  const liveHeight =
    drag && drag.mode === 'resize'
      ? Math.max(
          PX_PER_QUARTER - 2,
          baseHeight + (drag.deltaMin / 15) * PX_PER_QUARTER,
        )
      : baseHeight

  function startDrag(mode: 'move' | 'resize', ev: React.PointerEvent) {
    // Ignore right/middle clicks.
    if (ev.button !== 0) return
    ev.preventDefault()
    const state: DragState = {
      mode,
      startX: ev.clientX,
      startY: ev.clientY,
      deltaMin: 0,
      deltaDays: 0,
      didMove: false,
    }
    dragRef.current = state
    setDrag(state)
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleUp)
  }

  return (
    <div
      onPointerDown={(ev) => startDrag('move', ev)}
      role="button"
      tabIndex={0}
      onKeyDown={(ev) => {
        if (ev.key === 'Enter' || ev.key === ' ')
          onOpenPopover(ev as unknown as React.MouseEvent)
      }}
      style={{
        position: 'absolute',
        top: baseTop + 1,
        left: 4,
        right: 4,
        height: liveHeight,
        background: bg,
        borderLeft: `3px solid ${border}`,
        borderRadius: 6,
        padding: '6px 10px',
        cursor: drag ? 'grabbing' : 'grab',
        overflow: 'hidden',
        color: 'var(--color-text)',
        zIndex: drag ? 3 : 2,
        transform,
        transition: drag ? 'none' : 'transform 120ms, height 120ms',
        opacity: pending ? 0.5 : drag ? 0.85 : 1,
        boxShadow: drag
          ? '0 6px 18px rgba(0,0,0,.18)'
          : undefined,
        userSelect: 'none',
        touchAction: 'none',
      }}
    >
      <div
        style={{
          fontSize: '.76rem',
          fontWeight: 600,
          color: 'var(--color-charcoal)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {appointment.client.first_name} {appointment.client.last_name}
      </div>
      <div
        style={{
          fontSize: '.68rem',
          color: 'var(--color-text-light)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {drag
          ? formatDragPreview(appointment, drag)
          : appointment.appointment_type}
      </div>

      {/* Bottom resize handle */}
      <div
        onPointerDown={(ev) => {
          ev.stopPropagation()
          startDrag('resize', ev)
        }}
        aria-label="Resize appointment"
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: RESIZE_HANDLE_HEIGHT,
          cursor: 'ns-resize',
          background:
            'linear-gradient(to top, rgba(30,26,24,.15), transparent)',
        }}
      />
    </div>
  )
}

function formatDragPreview(
  appointment: Appointment,
  drag: NonNullable<DragState>,
): string {
  const origStart = new Date(appointment.start_at)
  const origEnd = new Date(appointment.end_at)
  if (drag.mode === 'move') {
    const ns = addMinutes(addDaysDate(origStart, drag.deltaDays), drag.deltaMin)
    const ne = addMinutes(addDaysDate(origEnd, drag.deltaDays), drag.deltaMin)
    return `${formatDayDate(ns)} · ${formatTime(ns)}–${formatTime(ne)}`
  }
  const ne = addMinutes(origEnd, drag.deltaMin)
  const clampedEnd =
    ne.getTime() - origStart.getTime() < 15 * 60 * 1000
      ? new Date(origStart.getTime() + 15 * 60 * 1000)
      : ne
  return `${formatTime(origStart)}–${formatTime(clampedEnd)}`
}

function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60 * 1000)
}

function addDaysDate(d: Date, days: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + days)
  return r
}

/**
 * Which Mon–Sun column (0–6) a given ISO timestamp falls into, given
 * the week view's convention (Monday is column 0). The grid always
 * holds 7 consecutive columns starting with the week's Monday, so
 * this is pure calendar math — no DOM walk needed.
 * gridRef is kept in the signature for a future variant that supports
 * non-Mon-first locales.
 */
function dayIndexFromStart(
  startIso: string,
  _gridRef: React.RefObject<HTMLDivElement | null>,
): number {
  const d = new Date(startIso)
  return (d.getDay() + 6) % 7 // Mon=0 … Sun=6
}

/* ====================== Current-time line ====================== */

function NowLine({ now }: { now: Date }) {
  const hour = now.getHours()
  if (hour < HOUR_START || hour >= HOUR_END) return null
  const top =
    (hour - HOUR_START) * PX_PER_HOUR +
    (now.getMinutes() / 15) * PX_PER_QUARTER
  return (
    <div
      style={{
        position: 'absolute',
        top,
        left: 0,
        right: 0,
        height: 2,
        background: 'var(--color-alert)',
        zIndex: 5,
      }}
    >
      <span
        style={{
          position: 'absolute',
          left: -5,
          top: -4,
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: 'var(--color-alert)',
        }}
      />
    </div>
  )
}

/* ====================== Empty-state hint ====================== */

function EmptyWeekHint() {
  return (
    <div
      style={{
        position: 'absolute',
        top: 240,
        left: '50%',
        transform: 'translateX(-50%)',
        textAlign: 'center',
        color: 'var(--color-text-light)',
        pointerEvents: 'none',
        fontSize: '.82rem',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          fontSize: '1rem',
          color: 'var(--color-charcoal)',
          marginBottom: 4,
        }}
      >
        No bookings this week
      </div>
      New booking dialog lands in the next commit. Hover any 15-minute slot
      to preview where it lands.
    </div>
  )
}

/* ====================== Appointment popover card ====================== */

function AppointmentPopover({
  data,
  onClose,
  onCancelled,
}: {
  data: { appt: Appointment; x: number; y: number }
  onClose: () => void
  onCancelled: () => void
}) {
  const { appt, x, y } = data
  const c = appt.client
  const tone = toneFor(c.id)
  const start = new Date(appt.start_at)
  const end = new Date(appt.end_at)
  const [cancelling, startCancel] = useTransition()

  function handleCancel() {
    if (
      !confirm(
        `Cancel ${c.first_name}'s ${formatTime(start)} ${appt.appointment_type}?`,
      )
    )
      return
    startCancel(async () => {
      const res = await cancelAppointmentAction(appt.id, null)
      if (res.error) {
        alert(res.error)
        return
      }
      onCancelled()
    })
  }

  // Clamp the card into the viewport — 320px wide, 280px tall.
  const cardW = 320
  const cardH = 280
  const left = Math.min(Math.max(x + 12, 8), window.innerWidth - cardW - 8)
  const top = Math.min(Math.max(y + 12, 8), window.innerHeight - cardH - 8)

  return (
    <div
      data-popover-card
      role="dialog"
      aria-label={`${c.first_name} ${c.last_name} appointment`}
      style={{
        position: 'fixed',
        top,
        left,
        width: cardW,
        background: 'var(--color-card)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 12,
        boxShadow: '0 10px 30px rgba(0,0,0,.15)',
        zIndex: 1000,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          borderBottom: '1px solid var(--color-border-subtle)',
        }}
      >
        <span
          className={`avatar ${tone}`}
          style={{ width: 42, height: 42, fontSize: 42 * 0.38 }}
        >
          {initialsFor(c.first_name, c.last_name)}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '1.05rem',
              color: 'var(--color-charcoal)',
              lineHeight: 1.2,
            }}
          >
            {c.first_name} {c.last_name}
          </div>
          <div
            style={{
              fontSize: '.72rem',
              color: 'var(--color-muted)',
              marginTop: 1,
            }}
          >
            {c.category_name ?? 'No category'}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--color-muted)',
            cursor: 'pointer',
            padding: 4,
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <X size={16} aria-hidden />
        </button>
      </div>

      {/* Appointment details */}
      <div
        style={{
          padding: '12px 18px',
          borderBottom: '1px solid var(--color-border-subtle)',
          fontSize: '.82rem',
          color: 'var(--color-text)',
          lineHeight: 1.5,
        }}
      >
        <div style={{ fontWeight: 600 }}>
          {formatDayDate(start)} · {formatTime(start)}–{formatTime(end)}
        </div>
        <div
          style={{
            fontSize: '.78rem',
            color: 'var(--color-text-light)',
            marginTop: 2,
          }}
        >
          {appt.appointment_type}
          {appt.location && ` · ${appt.location}`}
          {' · '}
          <StatusPill status={appt.status} />
        </div>
      </div>

      {/* Actions */}
      <div
        style={{
          padding: 12,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
        }}
      >
        <Link
          href={`/clients/${c.id}`}
          className="btn outline"
          style={{ justifyContent: 'center', padding: '8px 10px' }}
        >
          Open profile
        </Link>
        <Link
          href={`/clients/${c.id}/program`}
          className="btn outline"
          style={{ justifyContent: 'center', padding: '8px 10px' }}
        >
          <FileText size={13} aria-hidden />
          Program
        </Link>
        <Link
          href={`/clients/${c.id}?tab=profile`}
          className="btn outline"
          style={{ justifyContent: 'center', padding: '8px 10px' }}
        >
          <StickyNote size={13} aria-hidden />
          Add note
        </Link>
        <button
          type="button"
          className="btn primary"
          disabled
          title="Payments coming with billing module"
          style={{ justifyContent: 'center', padding: '8px 10px' }}
        >
          <CreditCard size={13} aria-hidden />
          Take payment
        </button>
      </div>

      {appt.status !== 'cancelled' && (
        <div
          style={{
            padding: '10px 12px',
            borderTop: '1px solid var(--color-border-subtle)',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            onClick={handleCancel}
            disabled={cancelling}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-alert)',
              fontFamily: 'var(--font-sans)',
              fontSize: '.8rem',
              fontWeight: 600,
              cursor: cancelling ? 'wait' : 'pointer',
              padding: '4px 8px',
            }}
          >
            {cancelling ? 'Cancelling…' : 'Cancel appointment'}
          </button>
        </div>
      )}
    </div>
  )
}

/* ====================== Booking composer modal ====================== */

const APPT_TYPES = [
  'Session',
  'Initial assessment',
  'Review',
  'Telehealth',
]

function BookingComposer({
  startAt,
  clients,
  onClose,
  onCreated,
}: {
  startAt: Date
  clients: BookingClient[]
  onClose: () => void
  onCreated: () => void
}) {
  const [clientId, setClientId] = useState(clients[0]?.id ?? '')
  const [date, setDate] = useState(toIsoDate(startAt))
  const [time, setTime] = useState(toHhMm(startAt))
  const [duration, setDuration] = useState(60)
  const [type, setType] = useState('Session')
  const [location, setLocation] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // ESC closes; backdrop click closes.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!clientId) {
      setError('Pick a client.')
      return
    }
    const startIso = combineDateTime(date, time).toISOString()
    setError(null)
    startTransition(async () => {
      const res = await createAppointmentAction({
        clientId,
        startAtIso: startIso,
        durationMinutes: duration,
        appointmentType: type,
        location: location.trim() || null,
        notes: notes.trim() || null,
      })
      if (res.error) {
        setError(res.error)
        return
      }
      onCreated()
    })
  }

  return (
    <div
      onMouseDown={(e) => {
        // Backdrop click closes; cards inside stop propagation.
        if ((e.target as HTMLElement).dataset.backdrop === '1') onClose()
      }}
      data-backdrop="1"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(30,26,24,.35)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 1100,
      }}
    >
      <form
        data-composer-card
        onSubmit={handleSubmit}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          background: 'var(--color-card)',
          borderRadius: 14,
          boxShadow: '0 20px 60px rgba(0,0,0,.25)',
          width: 520,
          maxWidth: 'calc(100vw - 32px)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 22px',
            borderBottom: '1px solid var(--color-border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div className="eyebrow" style={{ marginBottom: 2 }}>
              03 Schedule · New booking
            </div>
            <h2
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: '1.25rem',
                margin: 0,
              }}
            >
              Book an appointment
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-muted)',
              cursor: 'pointer',
              padding: 6,
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 22px', display: 'grid', gap: 14 }}>
          {error && (
            <div
              role="alert"
              style={{
                padding: '10px 14px',
                background: 'rgba(214,64,69,.08)',
                border: '1px solid rgba(214,64,69,.25)',
                borderRadius: 8,
                color: 'var(--color-alert)',
                fontSize: '.86rem',
              }}
            >
              {error}
            </div>
          )}

          {/* Client */}
          <ComposerField label="Client" required>
            {clients.length === 0 ? (
              <div
                style={{
                  fontSize: '.82rem',
                  color: 'var(--color-muted)',
                  padding: '8px 0',
                }}
              >
                No clients yet — invite one on /clients first.
              </div>
            ) : (
              <select
                name="client_id"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                style={composerInput}
                required
              >
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.first_name} {c.last_name}
                    {c.category_name ? ` · ${c.category_name}` : ''}
                  </option>
                ))}
              </select>
            )}
          </ComposerField>

          {/* Date + time + duration row */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 12,
            }}
          >
            <ComposerField label="Date" required>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                style={composerInput}
              />
            </ComposerField>
            <ComposerField label="Start time" required>
              <input
                type="time"
                step={900}
                value={time}
                onChange={(e) => setTime(e.target.value)}
                required
                style={composerInput}
              />
            </ComposerField>
            <ComposerField label="Duration (min)" required>
              <input
                type="number"
                step={15}
                min={15}
                max={480}
                value={duration}
                onChange={(e) =>
                  setDuration(parseInt(e.target.value, 10) || 0)
                }
                required
                style={composerInput}
              />
            </ComposerField>
          </div>

          {/* Type + location */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
            }}
          >
            <ComposerField label="Type">
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                style={composerInput}
              >
                {APPT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </ComposerField>
            <ComposerField label="Location">
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Studio / Clinic / Online"
                style={composerInput}
              />
            </ComposerField>
          </div>

          {/* Notes */}
          <ComposerField label="Notes (optional)">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Anything staff should see on the day — equipment, prep cues, intake questions."
              style={{
                ...composerInput,
                height: 'auto',
                padding: '10px 12px',
                lineHeight: 1.5,
                resize: 'vertical',
              }}
            />
          </ComposerField>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '14px 22px',
            borderTop: '1px solid var(--color-border-subtle)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            className="btn outline"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn primary"
            disabled={pending || clients.length === 0}
          >
            {pending ? 'Booking…' : 'Book appointment'}
          </button>
        </div>
      </form>
    </div>
  )
}

function ComposerField({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label style={{ display: 'block' }}>
      <div
        style={{
          fontSize: '.64rem',
          fontWeight: 700,
          color: 'var(--color-muted)',
          textTransform: 'uppercase',
          letterSpacing: '.06em',
          marginBottom: 5,
        }}
      >
        {label}
        {required && (
          <span
            aria-hidden
            style={{ color: 'var(--color-alert)', marginLeft: 4 }}
          >
            *
          </span>
        )}
      </div>
      {children}
    </label>
  )
}

const composerInput: React.CSSProperties = {
  width: '100%',
  height: 36,
  padding: '0 12px',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 7,
  background: 'var(--color-surface)',
  fontFamily: 'var(--font-sans)',
  fontSize: '.86rem',
  outline: 'none',
  color: 'var(--color-text)',
}

function combineDateTime(dateIso: string, hhmm: string): Date {
  const [y, m, d] = dateIso.split('-').map(Number)
  const [h, min] = hhmm.split(':').map(Number)
  return new Date(y!, (m ?? 1) - 1, d ?? 1, h ?? 0, min ?? 0, 0, 0)
}

function toHhMm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`
}

/**
 * For the toolbar "New booking" button — snap to the next quarter-hour
 * if we're inside business hours, otherwise default to 9:00am today.
 */
function defaultNewBookingStart(now: Date): Date {
  const d = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours(),
    now.getMinutes(),
  )
  if (d.getHours() < HOUR_START || d.getHours() >= HOUR_END) {
    d.setHours(9, 0, 0, 0)
    return d
  }
  const mod = d.getMinutes() % 15
  if (mod !== 0) d.setMinutes(d.getMinutes() + (15 - mod))
  d.setSeconds(0, 0)
  return d
}

function StatusPill({ status }: { status: Appointment['status'] }) {
  const label = status.replace('_', ' ')
  const color =
    status === 'confirmed' || status === 'completed'
      ? 'var(--color-primary)'
      : status === 'cancelled' || status === 'no_show'
        ? 'var(--color-alert)'
        : '#9A7A0E'
  return (
    <span
      style={{
        fontWeight: 600,
        color,
        textTransform: 'capitalize',
      }}
    >
      {label}
    </span>
  )
}

/* ====================== Helpers ====================== */

function parseIsoDate(iso: string): Date {
  // Treat the ISO date (YYYY-MM-DD) as local midnight — Supabase timezone
  // stays server-side; all display is in the browser's local time.
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y!, (m ?? 1) - 1, d ?? 1)
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
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

function dayIndexFromMonday(d: Date, monday: Date): number {
  const ms = d.getTime() - monday.getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}

function formatHour(h: number): string {
  if (h === 12) return '12pm'
  if (h === 0) return '12am'
  return h > 12 ? `${h - 12}pm` : `${h}am`
}

function formatMonthYear(d: Date): string {
  return new Intl.DateTimeFormat('en-AU', {
    month: 'long',
    year: 'numeric',
  }).format(d)
}

function formatDayDate(d: Date): string {
  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(d)
}

function formatTime(d: Date): string {
  return new Intl.DateTimeFormat('en-AU', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d)
}

function navArrowStyle(side: 'left' | 'right'): React.CSSProperties {
  return {
    width: 30,
    height: 30,
    border: '1px solid var(--color-border-subtle)',
    background: '#fff',
    borderRadius: side === 'left' ? '6px 0 0 6px' : '0 6px 6px 0',
    borderLeftWidth: side === 'right' ? 0 : 1,
    cursor: 'pointer',
    display: 'grid',
    placeItems: 'center',
    color: 'var(--color-text-light)',
  }
}

function toneForStatus(status: Appointment['status']): AvatarTone {
  if (status === 'cancelled' || status === 'no_show') return 'r'
  if (status === 'pending') return 'a'
  return 'g'
}

function toneToColors(tone: AvatarTone): { bg: string; border: string } {
  if (tone === 'r')
    return {
      bg: 'rgba(214,64,69,.08)',
      border: 'var(--color-alert)',
    }
  if (tone === 'a')
    return {
      bg: 'rgba(232,163,23,.08)',
      border: '#E8A317',
    }
  return {
    bg: 'rgba(30,26,24,.06)',
    border: 'var(--color-primary)',
  }
}
