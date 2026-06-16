'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react'
import {
  CalendarPlus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Eye,
  EyeOff,
  FileText,
  Search,
  StickyNote,
  Wrench,
  X,
} from 'lucide-react'
import {
  initialsFor,
  toneFor,
  type AvatarTone,
} from '../../clients/_lib/client-helpers'
import {
  MonthYearPicker,
  monthArrowStyle,
} from '../../_components/MonthYearPicker'
import {
  cancelAppointmentAction,
  createAppointmentAction,
  createClientInlineAction,
  createRecurringAppointmentsAction,
  findNextAvailableSlotAction,
  getCalendarFeedAction,
  getClientNextAppointmentAction,
  regenerateCalendarFeedAction,
  removeUnavailableBlockAction,
  revokeCalendarFeedAction,
  setAppointmentStatusAction,
  updateAppointmentTimeAction,
} from '../actions'
import {
  PractitionerSidebar,
  type StaffMember,
} from './PractitionerSidebar'
import { PRACTICE_TIMEZONE } from '@/lib/constants'
import { wallClockPartsInTimeZone, zonedTimeToInstant } from '@/lib/dates'

export type Appointment = {
  id: string
  start_at: string
  end_at: string
  appointment_type: string
  status: 'pending' | 'confirmed' | 'cancelled' | 'no_show' | 'completed'
  kind: 'appointment' | 'unavailable'
  location: string | null
  notes: string | null
  staff_user_id: string
  created_by_role: 'staff' | 'client_portal' | 'system' | null
  cancelled_by_role: 'staff' | 'client_portal' | 'system' | null
  // null for unavailable-kind blocks (admin / meeting / note time) — P1-7.
  client: {
    id: string
    first_name: string
    last_name: string
    category_name: string | null
  } | null
}

export type BookingClient = {
  id: string
  first_name: string
  last_name: string
  category_name: string | null
}

export type ViewMode = 'day' | 'week'

export type SessionType = {
  id: string
  name: string
  color: string // #RRGGBB
  kind: 'appointment' | 'unavailable'
  default_duration_minutes: number
}

interface WeekViewProps {
  weekStartIso: string
  appointments: Appointment[]
  clients: BookingClient[]
  staff: StaffMember[]
  selectedStaffIds: string[]
  sessionTypes: SessionType[]
  viewMode: ViewMode
  visibleDayIdxs: number[]
  selectedDateIso: string | null
  todayIso: string
  nowIso: string
}

// Grid constants. HOUR_START/END/HOURS are the data range — bookings
// can live anywhere inside them. VISIBLE_HOURS is the default vertical
// window (sized to fit the container); anything outside is reachable by
// scrolling. PX_PER_QUARTER is measured at runtime from the container
// height so the default window always fits regardless of viewport.
const HOUR_START = 5 // 5am — start of bookable range
const HOUR_END = 20 // 8pm (exclusive)
const HOURS = HOUR_END - HOUR_START // 15
const DEFAULT_VIEW_HOUR_START = 7 // 7am — top of default visible window
const VISIBLE_HOURS = 12 // 7am → 7pm sized to fit the container
const QUARTERS_PER_HOUR = 4
const PX_PER_QUARTER_MIN = 6 // below this, 60-min blocks can't show content
const PX_PER_QUARTER_MAX = 20 // cap so the grid doesn't waste space
const PX_PER_QUARTER_DEFAULT = 14 // pre-measure fallback

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// monthArrowStyle is now imported from the shared MonthYearPicker module.

export function WeekView({
  weekStartIso,
  appointments,
  clients,
  staff,
  selectedStaffIds,
  sessionTypes,
  viewMode,
  visibleDayIdxs,
  selectedDateIso,
  todayIso,
  nowIso,
}: WeekViewProps) {
  // Map of type name → hex colour, used to tint each appointment block
  // according to its `appointment_type` column. Names are lowercased so
  // lookup is case-insensitive (the DB stores canonical casing).
  const sessionTypeColors = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of sessionTypes) m.set(t.name.toLowerCase(), t.color)
    return m
  }, [sessionTypes])
  const weekStart = parseIsoDate(weekStartIso)
  const today = parseIsoDate(todayIso)
  const selectedDate = selectedDateIso ? parseIsoDate(selectedDateIso) : null
  const now = new Date(nowIso)
  const router = useRouter()
  const searchParams = useSearchParams()

  // Popover state: which appointment's card is open + viewport coords.
  const [popover, setPopover] = useState<{
    appt: Appointment
    x: number
    y: number
  } | null>(null)

  // Composer state: which slot the user clicked to create a booking.
  const [composer, setComposer] = useState<{ startAt: Date } | null>(null)

  // Client-name filter — dims non-matching appointments to spotlight one
  // client without removing context. Blank → nothing dimmed.
  const [clientFilter, setClientFilter] = useState('')
  const normalisedFilter = clientFilter.trim().toLowerCase()

  // Show/hide cancelled appointments on the grid (P2-8b). Default = show: the
  // operator values seeing a cancelled row beside its replacement (the lanes
  // in computeDayLayout sit them side-by-side). Toggling off strips cancelled
  // blocks AND recomputes lanes, so the survivors reclaim the width.
  const [showCancellations, setShowCancellations] = useState(true)

  // Month / year picker popover — opens under the "April 2026" label.
  const [monthPickerOpen, setMonthPickerOpen] = useState(false)
  const [pickerYear, setPickerYear] = useState(weekStart.getFullYear())

  // Grid container ref — used by AppointmentBlock's drag code to map
  // pointer coords to a day column via elementFromPoint.
  const gridRef = useRef<HTMLDivElement | null>(null)
  // Outer scroll container — measured to size hour rows so 5am-8pm
  // always fits in one glance regardless of viewport height.
  const gridScrollRef = useRef<HTMLDivElement | null>(null)
  const [pxPerQuarter, setPxPerQuarter] = useState(PX_PER_QUARTER_DEFAULT)
  const pxPerHour = pxPerQuarter * QUARTERS_PER_HOUR

  useLayoutEffect(() => {
    const el = gridScrollRef.current
    if (!el) return
    const recompute = () => {
      const available = el.clientHeight
      if (available <= 0) return
      // Size per-quarter so VISIBLE_HOURS (7am–7pm) fits the container.
      // The full data range (5am–8pm) is taller and scrollable.
      const raw = Math.floor(
        available / (VISIBLE_HOURS * QUARTERS_PER_HOUR),
      )
      const clamped = Math.max(
        PX_PER_QUARTER_MIN,
        Math.min(PX_PER_QUARTER_MAX, raw),
      )
      setPxPerQuarter((prev) => (prev === clamped ? prev : clamped))
    }
    recompute()
    const ro = new ResizeObserver(recompute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // On first mount, land at 7am at the top of the viewport. On later
  // pxPerQuarter changes (e.g. window resize), scale scrollTop so the
  // user stays at roughly the same visible time.
  const hasSetInitialScrollRef = useRef(false)
  const prevPxPerQuarterRef = useRef(pxPerQuarter)
  useLayoutEffect(() => {
    const el = gridScrollRef.current
    if (!el) return
    if (!hasSetInitialScrollRef.current) {
      el.scrollTop =
        (DEFAULT_VIEW_HOUR_START - HOUR_START) *
        pxPerQuarter *
        QUARTERS_PER_HOUR
      hasSetInitialScrollRef.current = true
    } else if (prevPxPerQuarterRef.current !== pxPerQuarter) {
      const scale = pxPerQuarter / prevPxPerQuarterRef.current
      el.scrollTop = el.scrollTop * scale
    }
    prevPxPerQuarterRef.current = pxPerQuarter
  }, [pxPerQuarter])

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
      const dayIdx = dayIndexInPracticeTz(a.start_at, weekStartIso)
      if (dayIdx >= 0 && dayIdx < 7) map[dayIdx].push(a)
    }
    return map
  }, [appointments, weekStartIso])

  // What actually renders, after the cancellations toggle (P2-8b). Lanes are
  // computed from this set, so hiding cancellations lets the survivors widen.
  const visibleByDay = useMemo(() => {
    if (showCancellations) return appointmentsByDay
    return appointmentsByDay.map((day) =>
      day.filter((a) => a.status !== 'cancelled'),
    )
  }, [appointmentsByDay, showCancellations])

  const monthLabel = formatMonthYear(weekStart)

  // All toolbar navigation (week arrows, month arrows, Today) funnels
  // through `navigateTo` so `?d=` and `?w=` stay in sync. Without this,
  // the presence of `?d=` overrides `?w=` in page.tsx and the clicks
  // look like no-ops.
  const navigateTo = useCallback(
    (date: Date) => {
      const monday = mondayOfDate(date)
      const params = new URLSearchParams(searchParams.toString())
      params.set('d', toIsoDate(date))
      params.set('w', toIsoDate(monday))
      router.push(`/schedule?${params.toString()}`)
    },
    [router, searchParams],
  )

  function gotoWeek(direction: 'prev' | 'next' | 'today') {
    if (direction === 'today') {
      navigateTo(today)
      return
    }
    const anchor = selectedDate ?? weekStart
    const delta = direction === 'next' ? 7 : -7
    navigateTo(addDays(anchor, delta))
  }

  function gotoMonth(direction: 'prev' | 'next') {
    const delta = direction === 'next' ? 1 : -1
    const targetFirst = new Date(
      weekStart.getFullYear(),
      weekStart.getMonth() + delta,
      1,
    )
    navigateTo(firstMondayOnOrAfter(targetFirst))
  }

  function switchView(next: ViewMode) {
    const params = new URLSearchParams(searchParams.toString())
    if (next === 'week') params.delete('view')
    else params.set('view', next)
    const qs = params.toString()
    router.push(qs ? `/schedule?${qs}` : '/schedule')
  }

  return (
    <div
      style={{
        background: 'var(--color-card)',
        height: 'calc(100vh - 52px)',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          padding: '6px 22px',
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
          <ClientSearchInput
            value={clientFilter}
            onChange={setClientFilter}
          />
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {/* Tools (P2-15): find next available; .ics subscribe lands next. */}
          <ToolsMenu
            sessionTypes={sessionTypes}
            onFoundSlot={(iso) => navigateTo(new Date(iso))}
          />
          {/* Show/hide cancelled bookings (P2-8b). Label states the action;
              default is shown, so it first offers to hide. */}
          <button
            type="button"
            className="btn outline"
            onClick={() => setShowCancellations((v) => !v)}
            title={
              showCancellations
                ? 'Hide cancelled bookings'
                : 'Show cancelled bookings'
            }
          >
            {showCancellations ? (
              <EyeOff size={14} aria-hidden />
            ) : (
              <Eye size={14} aria-hidden />
            )}
            {showCancellations ? 'Hide cancelled' : 'Show cancelled'}
          </button>
          <DaysDropdown value={viewMode} onChange={switchView} />
        </div>
      </div>

      {/* Month header — above the date strip, arrows step by month */}
      <div
        style={{
          padding: '0 22px 0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 14,
          flexShrink: 0,
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
              setPickerYear(weekStart.getFullYear())
              setMonthPickerOpen((v) => !v)
            }}
            aria-haspopup="dialog"
            aria-expanded={monthPickerOpen}
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '1.35rem',
              margin: 0,
              minWidth: 180,
              textAlign: 'center',
              letterSpacing: '0.01em',
              color: 'var(--color-charcoal)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '2px 8px',
              borderRadius: 6,
            }}
          >
            {monthLabel}
          </button>
          {monthPickerOpen && (
            <MonthYearPicker
              year={pickerYear}
              selectedYear={weekStart.getFullYear()}
              selectedMonth={weekStart.getMonth()}
              todayYear={today.getFullYear()}
              todayMonth={today.getMonth()}
              onYearChange={setPickerYear}
              onPick={(year, month) => {
                const targetFirst = new Date(year, month, 1)
                navigateTo(firstMondayOnOrAfter(targetFirst))
                setMonthPickerOpen(false)
              }}
              onClose={() => setMonthPickerOpen(false)}
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

      {/* Date rolodex */}
      <DateRolodex
        weekStart={weekStart}
        today={today}
        selectedDate={selectedDate}
      />

      {/* Day headers */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `52px repeat(${visibleDayIdxs.length}, 1fr)`,
          borderBottom: '1px solid var(--color-border-subtle)',
          flexShrink: 0,
        }}
      >
        <div />
        {visibleDayIdxs.map((dayIdx) => {
          const label = DAY_LABELS[dayIdx]!
          const date = addDays(weekStart, dayIdx)
          const isToday = sameCalendarDay(date, today)
          return (
            <div
              key={dayIdx}
              style={{
                padding: '5px 14px',
                borderLeft: '1px solid var(--color-border-subtle)',
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: '.8rem',
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
        ref={gridScrollRef}
        className="time-grid-scroll"
        style={{
          flex: 1,
          overflow: 'auto',
          position: 'relative',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
      >
        <div
          ref={gridRef}
          style={{
            display: 'grid',
            gridTemplateColumns: `52px repeat(${visibleDayIdxs.length}, 1fr)`,
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
                    height: pxPerHour,
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

          {/* Variable day columns (workDays or single day) */}
          {visibleDayIdxs.map((dayIdx) => {
            const date = addDays(weekStart, dayIdx)
            const isToday = sameCalendarDay(date, today)
            const dayLayout = computeDayLayout(visibleByDay[dayIdx])
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
                      pxPerQuarter={pxPerQuarter}
                      onClick={() =>
                        setComposer({
                          startAt: slotToDate(date, q),
                        })
                      }
                    />
                  ),
                )}

                {/* Appointment blocks */}
                {visibleByDay[dayIdx].map((a) => {
                  const fullName = a.client
                    ? `${a.client.first_name} ${a.client.last_name}`.toLowerCase()
                    : ''
                  const dimmed =
                    normalisedFilter.length > 0 &&
                    !fullName.includes(normalisedFilter)
                  const typeColor =
                    sessionTypeColors.get(a.appointment_type.toLowerCase()) ??
                    null
                  const lay = dayLayout.get(a.id) ?? { lane: 0, lanes: 1 }
                  return (
                    <AppointmentBlock
                      key={a.id}
                      appointment={a}
                      gridRef={gridRef}
                      pxPerQuarter={pxPerQuarter}
                      dimmed={dimmed}
                      typeColor={typeColor}
                      lane={lay.lane}
                      lanes={lay.lanes}
                      onOpenPopover={(ev) =>
                        setPopover({
                          appt: a,
                          x: ev.clientX,
                          y: ev.clientY,
                        })
                      }
                      onCommitted={() => router.refresh()}
                    />
                  )
                })}

                {/* Current-time indicator */}
                {isToday && (
                  <NowLine now={now} pxPerQuarter={pxPerQuarter} />
                )}
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
          onChanged={() => {
            setPopover(null)
            router.refresh()
          }}
          onNavigateToSession={(iso) => {
            setPopover(null)
            navigateTo(new Date(iso))
          }}
        />
      )}

      {/* Booking composer */}
      {composer && (
        <BookingComposer
          startAt={composer.startAt}
          clients={clients}
          sessionTypes={sessionTypes}
          onClose={() => setComposer(null)}
          onCreated={() => {
            setComposer(null)
            router.refresh()
          }}
        />
      )}

      {/* Practitioner filter side-tab */}
      <PractitionerSidebar
        staff={staff}
        selectedStaffIds={selectedStaffIds}
      />
    </div>
  )
}

/* Convert (day, quarter-index) → the instant of that slot in the practice tz. */
function slotToDate(day: Date, quarterIndex: number): Date {
  const totalMin = quarterIndex * 15
  const h = HOUR_START + Math.floor(totalMin / 60)
  const m = totalMin % 60
  // `day` is a date-only anchor, so y/m/d read back the intended calendar day;
  // build the instant in the practice tz so click-to-create lands at the
  // intended clinic-local time on any device (P0-2).
  return zonedTimeToInstant(
    day.getFullYear(),
    day.getMonth() + 1,
    day.getDate(),
    h,
    m,
    PRACTICE_TIMEZONE,
  )
}

/* ====================== Date rolodex ====================== */

/**
 * Horizontal scroll-snapping date rolodex.
 *
 * Renders ±180 days centered on today so the whole month is readable at
 * a glance and the user can two-finger scroll across several months.
 *
 * Visual curve: each cell's scale/opacity is driven by its pixel distance
 * from the viewport centerline — recalculated on every scroll frame via
 * rAF + direct style writes (no React re-render per frame).
 *
 * Scroll-snap (`scroll-snap-align: center` on each cell) gives the flicky
 * per-date feel as the user drags the strip.
 *
 * When the user lands on a date in a new week, a debounced commit pushes
 * the matching `?w=` URL param so the rest of the page (grid, month header)
 * re-aligns.
 */
const ROLODEX_RANGE = 180 // days each side of today → ~1 year total
const ROLODEX_CELL_WIDTH = 38 // px per cell

function DateRolodex({
  weekStart,
  today,
  selectedDate,
}: {
  weekStart: Date
  today: Date
  selectedDate: Date | null
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const scrollRef = useRef<HTMLDivElement>(null)
  const cellRefs = useRef<(HTMLDivElement | null)[]>([])
  const centeredCellRef = useRef<number>(-1)
  const hasMountedRef = useRef(false)
  const pillRef = useRef<HTMLDivElement>(null)
  // Set before router.push in the scroll-end commit; checked by the
  // layout effect to avoid re-nudging scrollLeft when the user has
  // already landed there themselves.
  const suppressScrollAdjustRef = useRef(false)

  const { dates, todayIdx } = useMemo(() => {
    const anchor = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    )
    const startDate = new Date(anchor)
    startDate.setDate(startDate.getDate() - ROLODEX_RANGE)
    const out: Date[] = []
    let tIdx = -1
    for (let i = 0; i <= 2 * ROLODEX_RANGE; i++) {
      const d = new Date(startDate)
      d.setDate(startDate.getDate() + i)
      out.push(d)
      if (sameCalendarDay(d, today)) tIdx = i
    }
    return { dates: out, todayIdx: tIdx }
  }, [today])

  const weekStartIdx = useMemo(
    () => dates.findIndex((d) => sameCalendarDay(d, weekStart)),
    [dates, weekStart],
  )

  const selectedIdx = useMemo(() => {
    if (!selectedDate) return -1
    return dates.findIndex((d) => sameCalendarDay(d, selectedDate))
  }, [dates, selectedDate])

  // Prefer centering on the explicitly selected date when one exists;
  // otherwise fall back to the week's Monday.
  const scrollTargetIdx = selectedIdx !== -1 ? selectedIdx : weekStartIdx

  // On mount or when the scroll target changes, align scroll so the
  // target sits dead-center of the viewport, then paint the curve once.
  //
  // First render: hard set (no animation).
  // Subsequent changes (e.g. scroll-end commit, click, month nav): use
  // smooth scroll so any small post-commit correction glides instead of
  // jerking.
  useLayoutEffect(() => {
    const container = scrollRef.current
    const cell =
      scrollTargetIdx >= 0 ? cellRefs.current[scrollTargetIdx] : null
    if (!container || !cell) return
    const target =
      cell.offsetLeft - container.clientWidth / 2 + cell.clientWidth / 2
    if (!hasMountedRef.current) {
      container.scrollLeft = target
      hasMountedRef.current = true
    } else if (suppressScrollAdjustRef.current) {
      // Scroll-end commit — the user is already at the target. Don't
      // nudge; that would feel like post-scroll lag.
      suppressScrollAdjustRef.current = false
    } else {
      container.scrollTo({ left: target, behavior: 'smooth' })
    }
    applyRolodexCurve(container, cellRefs.current)
    // Seed the "currently centered" tracker so we don't fire a tick on
    // first paint, and re-apply the centered-number colour + pill
    // position after the React render (which resets inline styles).
    const prev = centeredCellRef.current
    centeredCellRef.current = scrollTargetIdx
    paintCenteredNumber(cellRefs.current, scrollTargetIdx, prev)
    paintPill(pillRef.current, dates[scrollTargetIdx] ?? null)
  }, [scrollTargetIdx, dates])

  function selectDate(idx: number) {
    const clicked = dates[idx]
    if (!clicked) return
    const monday = mondayOfDate(clicked)
    const params = new URLSearchParams(searchParams.toString())
    params.set('d', toIsoDate(clicked))
    params.set('w', toIsoDate(monday))
    router.push(`/schedule?${params.toString()}`)
  }

  // Live curve repaint on every scroll frame, per-day tick sound when the
  // centered cell changes, and a debounced URL commit when the user
  // settles on a date in a different week.
  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    let ticking = false
    let commitTimer: ReturnType<typeof setTimeout> | null = null

    const onScroll = () => {
      if (!ticking) {
        ticking = true
        requestAnimationFrame(() => {
          applyRolodexCurve(container, cellRefs.current)
          const nowCentered = closestCellIdx(container, cellRefs.current)
          if (
            nowCentered !== -1 &&
            nowCentered !== centeredCellRef.current
          ) {
            const prev = centeredCellRef.current
            centeredCellRef.current = nowCentered
            paintCenteredNumber(cellRefs.current, nowCentered, prev)
            paintPill(pillRef.current, dates[nowCentered] ?? null)
            pulseRolodexCell(cellRefs.current[nowCentered] ?? null)
          }
          ticking = false
        })
      }
      if (commitTimer) clearTimeout(commitTimer)
      commitTimer = setTimeout(() => {
        const idx = closestCellIdx(container, cellRefs.current)
        if (idx < 0) return
        const landedCell = cellRefs.current[idx]
        if (landedCell) {
          // Free-flow scroll means the user can rest mid-cell. Once
          // momentum has fully died (this debounce fired), smooth-snap
          // so the landed number sits precisely inside the centre
          // circle. Short distance → gentle nudge, not a lag.
          const snapTarget =
            landedCell.offsetLeft -
            container.clientWidth / 2 +
            landedCell.clientWidth / 2
          if (Math.abs(container.scrollLeft - snapTarget) > 1) {
            container.scrollTo({ left: snapTarget, behavior: 'smooth' })
          }
        }
        const landed = dates[idx]!
        const landedIso = toIsoDate(landed)
        const landedMonday = mondayOfDate(landed)
        const selectedIso = selectedDate ? toIsoDate(selectedDate) : null
        // Skip URL push if nothing actually changed.
        if (
          selectedIso === landedIso &&
          sameCalendarDay(landedMonday, weekStart)
        ) {
          return
        }
        const params = new URLSearchParams(searchParams.toString())
        params.set('d', landedIso)
        params.set('w', toIsoDate(landedMonday))
        suppressScrollAdjustRef.current = true
        router.push(`/schedule?${params.toString()}`)
      }, 280)
    }

    container.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', onScroll)
      if (commitTimer) clearTimeout(commitTimer)
    }
  }, [dates, weekStart, selectedDate, router, searchParams])

  return (
    <div style={{ position: 'relative' }}>
      {/* Week pill — anchored to viewport center, shifts horizontally
          based on the centered date's day-of-week so the 7-day span
          always encases the green circle. Sits behind the cells. */}
      <div
        ref={pillRef}
        aria-hidden
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: 7 * ROLODEX_CELL_WIDTH,
          height: 36,
          background: 'rgba(45,178,76,0.12)',
          borderRadius: 18,
          pointerEvents: 'none',
          zIndex: 0,
          transition: 'transform 220ms ease-out',
        }}
      />

      {/* Fixed green circle at the rolodex viewport center. Numbers
          scroll through it; the centered cell's number turns white via
          direct-DOM paint in the scroll handler. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: 30,
          height: 30,
          borderRadius: '50%',
          background: 'var(--color-accent)',
          pointerEvents: 'none',
          zIndex: 1,
        }}
      />

      <div
        ref={scrollRef}
        className="rolodex-scroll"
        style={{
          display: 'flex',
          alignItems: 'center',
          minHeight: 46,
          overflowX: 'auto',
          overflowY: 'hidden',
          padding: '0 0 4px',
          borderBottom: '1px solid var(--color-border-subtle)',
          flexShrink: 0,
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          position: 'relative',
          zIndex: 2,
        }}
      >
        {dates.map((date, i) => (
          <div
            key={i}
            ref={(el) => {
              cellRefs.current[i] = el
            }}
            onClick={() => selectDate(i)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                selectDate(i)
              }
            }}
            style={{
              flex: `0 0 ${ROLODEX_CELL_WIDTH}px`,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              padding: '2px 0',
              transformOrigin: 'center',
              willChange: 'transform, opacity',
              userSelect: 'none',
              cursor: 'pointer',
            }}
          >
            <div
              data-rolodex-number
              style={{
                width: 30,
                height: 30,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--color-text)',
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: '.82rem',
                lineHeight: 1,
                transition: 'color 120ms',
                position: 'relative',
              }}
            >
              {date.getDate()}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Visual "feel" for a rolodex snap — a brief outline-ring pulse on the
 * centred number + a 3 ms haptic on mobile. No audio (browser/driver
 * audio-stack reliability was too flaky on this user's setup; the visual
 * pulse works everywhere).
 *
 * The ring is drawn on the inner `[data-rolodex-number]` element via
 * Web Animations API (box-shadow) so it doesn't conflict with the cell's
 * live `transform: scale(…)` from applyRolodexCurve.
 */
function pulseRolodexCell(cell: HTMLDivElement | null) {
  if (!cell) return
  const number = cell.querySelector<HTMLDivElement>('[data-rolodex-number]')
  if (number && typeof number.animate === 'function') {
    number.animate(
      [
        { boxShadow: '0 0 0 0 rgba(45,178,76,0.55)', offset: 0 },
        { boxShadow: '0 0 0 7px rgba(45,178,76,0)', offset: 1 },
      ],
      { duration: 220, easing: 'ease-out' },
    )
  }
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate?.(3)
    } catch {
      // Some browsers throw when called outside a user-gesture frame.
    }
  }
}

/**
 * Paint the currently-centered cell's number white (readable over the
 * fixed green circle overlay) and revert the previously centered one.
 * Written directly via refs to avoid re-rendering per scroll frame.
 */
function paintCenteredNumber(
  cells: (HTMLDivElement | null)[],
  newIdx: number,
  prevIdx: number,
) {
  if (prevIdx !== -1 && prevIdx !== newIdx) {
    const prev = cells[prevIdx]?.querySelector<HTMLDivElement>(
      '[data-rolodex-number]',
    )
    if (prev) prev.style.color = 'var(--color-text)'
  }
  if (newIdx !== -1) {
    const now = cells[newIdx]?.querySelector<HTMLDivElement>(
      '[data-rolodex-number]',
    )
    if (now) now.style.color = '#fff'
  }
}

/**
 * Shift the week pill so it encases the 7 cells containing the centered
 * date. When Monday is centered, pill extends right; Sunday centered,
 * pill extends left; Thursday centered, pill is symmetric.
 */
function paintPill(pill: HTMLDivElement | null, centeredDate: Date | null) {
  if (!pill || !centeredDate) return
  const dowMon = (centeredDate.getDay() + 6) % 7 // 0=Mon … 6=Sun
  const offsetX = (3 - dowMon) * ROLODEX_CELL_WIDTH
  pill.style.transform = `translate(-50%, -50%) translateX(${offsetX}px)`
}

/**
 * For each cell in the visible strip, write inline transform: scale() and
 * opacity based on pixel distance from the container's horizontal
 * centerline. Written directly via refs to avoid re-rendering on every
 * scroll frame.
 */
function applyRolodexCurve(
  container: HTMLDivElement,
  cells: (HTMLDivElement | null)[],
) {
  const rect = container.getBoundingClientRect()
  const centerX = rect.left + rect.width / 2
  const falloff = rect.width / 2
  for (const cell of cells) {
    if (!cell) continue
    const cRect = cell.getBoundingClientRect()
    // Skip cells well outside the viewport — they won't be seen.
    if (cRect.right < rect.left - 40 || cRect.left > rect.right + 40) {
      continue
    }
    const cellCenter = cRect.left + cRect.width / 2
    const dist = Math.abs(cellCenter - centerX)
    const normalized = Math.min(dist / falloff, 1)
    const curve = Math.pow(normalized, 1.3)
    // Keep edges at base size (1.0); enlarge centre up to 1.3x.
    const scale = 1 + (1 - curve) * 0.3
    const opacity = 1 - curve * 0.85 // 1 → 0.15
    cell.style.transform = `scale(${scale})`
    cell.style.opacity = String(opacity)
  }
}

function closestCellIdx(
  container: HTMLDivElement,
  cells: (HTMLDivElement | null)[],
): number {
  const rect = container.getBoundingClientRect()
  const targetX = rect.left + rect.width / 2
  let bestIdx = -1
  let bestDist = Infinity
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]
    if (!c) continue
    const cRect = c.getBoundingClientRect()
    if (cRect.right < rect.left || cRect.left > rect.right) continue
    const cellCenter = cRect.left + cRect.width / 2
    const dist = Math.abs(cellCenter - targetX)
    if (dist < bestDist) {
      bestDist = dist
      bestIdx = i
    }
  }
  return bestIdx
}

function mondayOfDate(d: Date): Date {
  const day = d.getDay() // 0=Sun, 1=Mon, … 6=Sat
  const offset = day === 0 ? -6 : 1 - day
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset)
}

/* ====================== Quarter cell (hover highlight) ====================== */

function QuarterCell({
  quarterIndex,
  pxPerQuarter,
  onClick,
}: {
  quarterIndex: number
  pxPerQuarter: number
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
        height: pxPerQuarter,
        borderTop,
        background: hover ? 'rgba(45,178,76,0.12)' : 'transparent',
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

/**
 * Odyssey wordmark, scaled down for use as a corner badge on app-booked
 * appointment blocks. Mirrors the brand-mark pattern from the email
 * templates (Barlow Condensed 700 + accent-green dot baked into the
 * period). Inline element — placed in the top-right above the time so
 * it stays visible on short (≤45-min) blocks where a bottom-right
 * placement would be clipped by the resize handle.
 */
function OdysseyMark() {
  return (
    <span
      aria-hidden
      style={{
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        fontSize: 9,
        letterSpacing: '0.01em',
        color: 'var(--color-charcoal)',
        lineHeight: 1,
        pointerEvents: 'none',
      }}
    >
      Odyssey<span style={{ color: 'var(--color-accent)' }}>.</span>
    </span>
  )
}

/**
 * Side-by-side overlap layout (P2-8). Within each cluster of mutually
 * overlapping blocks, assign each a lane (column) so they render beside each
 * other instead of stacking and hiding one another. Returns lane index + total
 * lanes per block id. Half-open: a block starting exactly when another ends
 * does not overlap. Cancelled and unavailable-kind blocks participate too, so a
 * replacement sits beside its cancelled original and a note beside its session.
 */
function computeDayLayout(
  appts: Appointment[],
): Map<string, { lane: number; lanes: number }> {
  const result = new Map<string, { lane: number; lanes: number }>()
  const sorted = [...appts].sort((a, b) => {
    const sa = new Date(a.start_at).getTime()
    const sb = new Date(b.start_at).getTime()
    if (sa !== sb) return sa - sb
    return new Date(a.end_at).getTime() - new Date(b.end_at).getTime()
  })
  let group: Appointment[] = []
  let groupEnd = 0
  const flush = () => {
    if (group.length === 0) return
    const colEnds: number[] = [] // last end (ms) per column
    const colOf = new Map<string, number>()
    for (const a of group) {
      const s = new Date(a.start_at).getTime()
      let col = colEnds.findIndex((end) => end <= s)
      if (col === -1) {
        col = colEnds.length
        colEnds.push(0)
      }
      colEnds[col] = new Date(a.end_at).getTime()
      colOf.set(a.id, col)
    }
    const lanes = colEnds.length
    for (const a of group) {
      result.set(a.id, { lane: colOf.get(a.id) ?? 0, lanes })
    }
    group = []
    groupEnd = 0
  }
  for (const a of sorted) {
    const s = new Date(a.start_at).getTime()
    if (group.length > 0 && s >= groupEnd) flush()
    group.push(a)
    groupEnd = Math.max(groupEnd, new Date(a.end_at).getTime())
  }
  flush()
  return result
}

function AppointmentBlock({
  appointment,
  gridRef,
  pxPerQuarter,
  dimmed,
  typeColor,
  lane,
  lanes,
  onOpenPopover,
  onCommitted,
}: {
  appointment: Appointment
  gridRef: React.RefObject<HTMLDivElement | null>
  pxPerQuarter: number
  dimmed: boolean
  typeColor: string | null
  lane: number
  lanes: number
  onOpenPopover: (ev: React.PointerEvent | React.MouseEvent) => void
  onCommitted: () => void
}) {
  const pxPerHour = pxPerQuarter * QUARTERS_PER_HOUR
  const start = new Date(appointment.start_at)
  const end = new Date(appointment.end_at)
  // Position by the start's wall-clock in the practice tz, not the browser's
  // getHours()/getMinutes() — the grid is a clinic-local canvas (P0-2 / FM-2).
  const startParts = wallClockPartsInTimeZone(start, PRACTICE_TIMEZONE)
  const baseTop =
    (startParts.hour - HOUR_START) * pxPerHour +
    (startParts.minute / 15) * pxPerQuarter
  const baseHeight =
    ((end.getTime() - start.getTime()) / (1000 * 60 * 15)) *
      pxPerQuarter -
    2

  // Colour priority:
  //   1. cancelled / no_show → red tone (overrides the type colour so the
  //      status is unmissable). Cancelled gets the softer .05 fill so it
  //      reads as "softly past tense" rather than "alert"; no_show stays
  //      at .22 because it IS a needs-your-attention flag.
  //   2. appointment has a known session-type colour → use it
  //   3. fallback → status-based tone (default accent green)
  const tone = toneForStatus(appointment.status)
  const statusTone = toneToColors(tone)
  const useTypeColor =
    typeColor !== null &&
    appointment.status !== 'cancelled' &&
    appointment.status !== 'no_show'
  const bg = useTypeColor
    ? hexToRgba(typeColor!, 0.22)
    : appointment.status === 'cancelled'
      ? 'rgba(214,64,69,0.05)'
      : statusTone.bg
  const border = useTypeColor ? typeColor! : statusTone.border
  const isCancelled = appointment.status === 'cancelled'
  const isAppBooked = appointment.created_by_role === 'client_portal'
  const isAppCancellation =
    isCancelled && appointment.cancelled_by_role === 'client_portal'

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

      // Snap vertical to 15-min increments (pxPerQuarter px each).
      const deltaMin = Math.round(dy / pxPerQuarter) * 15

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
      ? `translate(calc(${drag.deltaDays * lanes} * 100%), ${
          (drag.deltaMin / 15) * pxPerQuarter
        }px)`
      : undefined
    : undefined

  const liveHeight =
    drag && drag.mode === 'resize'
      ? Math.max(
          pxPerQuarter - 2,
          baseHeight + (drag.deltaMin / 15) * pxPerQuarter,
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
        // Side-by-side lanes for overlapping blocks (P2-8); full width alone.
        ...(lanes <= 1
          ? { left: 4, right: 4 }
          : {
              left: `calc(${((lane / lanes) * 100).toFixed(3)}% + 2px)`,
              width: `calc(${(100 / lanes).toFixed(3)}% - 4px)`,
            }),
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
        opacity: pending
          ? 0.5
          : drag
            ? 0.85
            : dimmed
              ? 0.18
              : 1,
        boxShadow: drag
          ? '0 6px 18px rgba(0,0,0,.18)'
          : undefined,
        userSelect: 'none',
        touchAction: 'none',
      }}
    >
      {/* Block content. Opacity drops to 0.72 when cancelled so the row
          reads as "past tense" without losing the red border signal. */}
      <div style={{ opacity: isCancelled ? 0.72 : 1 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 6,
            fontSize: '.76rem',
            fontWeight: 600,
            color: 'var(--color-charcoal)',
          }}
        >
          <span
            style={{
              flex: 1,
              minWidth: 0,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              lineHeight: 1.1,
            }}
          >
            {appointment.client
              ? `${appointment.client.first_name} ${appointment.client.last_name}`
              : appointment.appointment_type}
            {isAppCancellation && ' · App Cancellation'}
          </span>
          {/* Right column: Odyssey mark stacks above the time on app-booked
              blocks so it stays visible even on 45-min slots (where a
              bottom-right placement would be clipped by the resize handle). */}
          <div
            style={{
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: 1,
              lineHeight: 1,
            }}
          >
            {isAppBooked && <OdysseyMark />}
            <span
              style={{
                fontSize: '.66rem',
                fontWeight: 600,
                color: 'var(--color-text-light)',
                fontVariantNumeric: 'tabular-nums',
                lineHeight: 1,
              }}
            >
              {formatTime(start)}
            </span>
          </div>
        </div>
        <div
          style={{
            fontSize: '.66rem',
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
  // Practice-tz weekday so the cross-day drag delta is correct on any device.
  return wallClockPartsInTimeZone(new Date(startIso), PRACTICE_TIMEZONE).weekday
}

/* ====================== Current-time line ====================== */

function NowLine({
  now,
  pxPerQuarter,
}: {
  now: Date
  pxPerQuarter: number
}) {
  const { hour, minute } = wallClockPartsInTimeZone(now, PRACTICE_TIMEZONE)
  if (hour < HOUR_START || hour >= HOUR_END) return null
  const pxPerHour = pxPerQuarter * QUARTERS_PER_HOUR
  const top = (hour - HOUR_START) * pxPerHour + (minute / 15) * pxPerQuarter
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

/** A quiet transparent text-button for the popover footer (lifecycle + cancel). */
function FooterAction({
  label,
  color,
  disabled,
  onClick,
}: {
  label: string
  color: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        background: 'transparent',
        border: 'none',
        color,
        fontFamily: 'var(--font-sans)',
        fontSize: '.8rem',
        fontWeight: 600,
        cursor: disabled ? 'wait' : 'pointer',
        padding: '4px 8px',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  )
}

function AppointmentPopover({
  data,
  onClose,
  onChanged,
  onNavigateToSession,
}: {
  data: { appt: Appointment; x: number; y: number }
  onClose: () => void
  // Fires after any persisted change (cancel or a lifecycle transition) —
  // the parent closes the popover and refreshes the grid.
  onChanged: () => void
  // Jump the grid to the client's next session (P2-14).
  onNavigateToSession: (startIso: string) => void
}) {
  const { appt, x, y } = data
  const c = appt.client
  const start = new Date(appt.start_at)
  const end = new Date(appt.end_at)
  const [cancelling, startCancel] = useTransition()
  const [statusPending, startStatus] = useTransition()
  const busy = cancelling || statusPending

  // The client's next booked session after this one (P2-14). undefined = still
  // loading. This hook precedes the no-client early return below, so it stays
  // unconditional (Rules of Hooks); it no-ops for unavailable blocks.
  const [nextSession, setNextSession] = useState<string | null | undefined>(
    undefined,
  )
  useEffect(() => {
    if (!c) return
    let active = true
    getClientNextAppointmentAction(c.id, appt.start_at).then((res) => {
      if (active) setNextSession(res.startIso)
    })
    return () => {
      active = false
    }
  }, [c, appt.start_at])

  function handleCancel() {
    if (
      !confirm(
        c
          ? `Cancel ${c.first_name}'s ${formatTime(start)} ${appt.appointment_type}?`
          : `Remove this ${appt.appointment_type} block?`,
      )
    )
      return
    startCancel(async () => {
      const res = await cancelAppointmentAction(appt.id, null)
      if (res.error) {
        alert(res.error)
        return
      }
      onChanged()
    })
  }

  // P2-8 review fix — removing an Unavailable block soft-deletes it (it
  // disappears) rather than cancelling it (which would leave a cancelled
  // ghost). Client appointments still cancel, above.
  function handleRemoveBlock() {
    if (!confirm(`Remove this ${appt.appointment_type} block?`)) return
    startCancel(async () => {
      const res = await removeUnavailableBlockAction(appt.id)
      if (res.error) {
        alert(res.error)
        return
      }
      onChanged()
    })
  }

  // P2-8c — move the appointment along its lifecycle (complete / no-show /
  // reopen). The reminder trigger auto-handles the reminder on the status flip.
  function handleSetStatus(status: 'completed' | 'no_show' | 'confirmed') {
    startStatus(async () => {
      const res = await setAppointmentStatusAction(appt.id, status)
      if (res.error) {
        alert(res.error)
        return
      }
      onChanged()
    })
  }

  // Clamp the card into the viewport. It can be tall (lifecycle actions + next
  // session), so cap the height and scroll inside rather than letting the
  // footer (no-show / completed) fall off-screen.
  const cardW = 320
  const cardMaxH = Math.min(460, window.innerHeight - 16)
  const left = Math.min(Math.max(x + 12, 8), window.innerWidth - cardW - 8)
  const top = Math.min(Math.max(y + 12, 8), window.innerHeight - cardMaxH - 8)

  // Unavailable-kind block (P1-7): no client. Render the type + note with a
  // Remove action — none of the client-profile actions apply.
  if (!c) {
    return (
      <div
        data-popover-card
        role="dialog"
        aria-label={`${appt.appointment_type} block`}
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
          maxHeight: cardMaxH,
          overflowY: 'auto',
        }}
      >
        <div
          style={{
            padding: '16px 18px',
            borderBottom: '1px solid var(--color-border-subtle)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
          }}
        >
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
              {appt.appointment_type}
            </div>
            <div
              style={{
                fontSize: '.72rem',
                color: 'var(--color-muted)',
                marginTop: 1,
              }}
            >
              Unavailable · not client-visible
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
        <div
          style={{
            padding: '12px 18px',
            fontSize: '.82rem',
            color: 'var(--color-text)',
            lineHeight: 1.5,
          }}
        >
          <div style={{ fontWeight: 600 }}>
            {formatDayDate(start)} · {formatTime(start)}–{formatTime(end)}
          </div>
          {appt.notes && (
            <div style={{ color: 'var(--color-text-light)', marginTop: 4 }}>
              {appt.notes}
            </div>
          )}
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
              onClick={handleRemoveBlock}
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
              {cancelling ? 'Removing…' : 'Remove block'}
            </button>
          </div>
        )}
      </div>
    )
  }

  const tone = toneFor(c.id)

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
        maxHeight: cardMaxH,
        overflowY: 'auto',
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
            {appt.status === 'cancelled' &&
              appt.cancelled_by_role === 'client_portal' &&
              ' · App Cancellation'}
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
        <div
          style={{
            fontSize: '.78rem',
            color: 'var(--color-text-light)',
            marginTop: 4,
          }}
        >
          Next session ·{' '}
          {nextSession === undefined ? (
            '…'
          ) : nextSession ? (
            <button
              type="button"
              onClick={() => onNavigateToSession(nextSession)}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                color: 'var(--color-primary)',
                fontFamily: 'var(--font-sans)',
                fontSize: '.78rem',
                fontWeight: 600,
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              {formatDayDate(new Date(nextSession))} ·{' '}
              {formatTime(new Date(nextSession))}
            </button>
          ) : (
            'none booked'
          )}
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
          href={`/clients/${c.id}?tab=notes&new=1&appointment=${appt.id}`}
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
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {/* Lifecycle (P2-8c): complete / no-show from confirmed-or-pending;
              a mis-marked one reopens to confirmed. */}
          <div style={{ display: 'flex', gap: 2 }}>
            {appt.status === 'completed' || appt.status === 'no_show' ? (
              <FooterAction
                label="Reopen"
                color="var(--color-text-light)"
                disabled={busy}
                onClick={() => handleSetStatus('confirmed')}
              />
            ) : (
              <>
                <FooterAction
                  label="Complete"
                  color="var(--color-accent)"
                  disabled={busy}
                  onClick={() => handleSetStatus('completed')}
                />
                <FooterAction
                  label="No-show"
                  color="var(--color-warning)"
                  disabled={busy}
                  onClick={() => handleSetStatus('no_show')}
                />
              </>
            )}
          </div>
          <FooterAction
            label={cancelling ? 'Cancelling…' : 'Cancel appointment'}
            color="var(--color-alert)"
            disabled={busy}
            onClick={handleCancel}
          />
        </div>
      )}
    </div>
  )
}

/* ====================== Booking composer modal ====================== */

function BookingComposer({
  startAt,
  clients,
  sessionTypes,
  onClose,
  onCreated,
}: {
  startAt: Date
  clients: BookingClient[]
  sessionTypes: SessionType[]
  onClose: () => void
  onCreated: () => void
}) {
  // Clients created inline from this composer are appended locally so the
  // user can pick them without a round-trip page refresh. After the parent
  // server component revalidates, the same row may also show up in `clients`,
  // so dedupe by id to avoid duplicate React keys.
  const [localClients, setLocalClients] = useState<BookingClient[]>([])
  const allClients = useMemo(() => {
    const serverIds = new Set(clients.map((c) => c.id))
    const uniqueLocal = localClients.filter((c) => !serverIds.has(c.id))
    return [...clients, ...uniqueLocal]
  }, [clients, localClients])

  const [clientId, setClientId] = useState(allClients[0]?.id ?? '')
  const [date, setDate] = useState(toIsoDate(startAt))
  const [time, setTime] = useState(toHhMm(startAt))
  const [duration, setDuration] = useState(
    sessionTypes[0]?.default_duration_minutes ?? 60,
  )
  const [type, setType] = useState(sessionTypes[0]?.name ?? 'Session')
  const [location, setLocation] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // Recurrence (P2-14). Off → a single booking (the original path). On →
  // generate concrete rows on the cadence.
  const [repeat, setRepeat] = useState(false)
  const [frequency, setFrequency] = useState<RecurFrequency>('weekly')
  const [endMode, setEndMode] = useState<RecurEndMode>('count')
  // Held as a raw string so the field can be cleared and retyped freely; the
  // clamp to [1, MAX_OCCURRENCES] happens on blur, not on every keystroke
  // (clamping live forced an empty field to "1", blocking typing "20").
  const [countInput, setCountInput] = useState('4')
  const occurrenceCount = Math.min(
    MAX_OCCURRENCES,
    Math.max(1, parseInt(countInput, 10) || 1),
  )
  const [untilDate, setUntilDate] = useState('')
  // Per-instance result after a series save with clashes — shown instead of
  // silently closing, so the EP sees which dates were skipped.
  const [result, setResult] = useState<{
    created: number
    skipped: string[]
    error?: string
  } | null>(null)

  // Concrete occurrence dates (YYYY-MM-DD) the current settings would create.
  const recurrenceDates = useMemo(
    () =>
      repeat
        ? computeRecurrenceDates(
            date,
            frequency,
            endMode,
            occurrenceCount,
            untilDate || null,
          )
        : [date],
    [repeat, date, frequency, endMode, occurrenceCount, untilDate],
  )

  // Inline "new client" sub-form state.
  const [showNewClient, setShowNewClient] = useState(clients.length === 0)
  const [newFirst, setNewFirst] = useState('')
  const [newLast, setNewLast] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newClientError, setNewClientError] = useState<string | null>(null)
  const [creatingClient, startCreateClient] = useTransition()

  function resetNewClient() {
    setNewFirst('')
    setNewLast('')
    setNewEmail('')
    setNewClientError(null)
  }

  function handleCreateClient() {
    setNewClientError(null)
    startCreateClient(async () => {
      const res = await createClientInlineAction({
        firstName: newFirst,
        lastName: newLast,
        email: newEmail,
      })
      if (res.error || !res.client) {
        setNewClientError(res.error ?? 'Unknown error.')
        return
      }
      setLocalClients((prev) => [...prev, res.client!])
      setClientId(res.client.id)
      resetNewClient()
      setShowNewClient(false)
    })
  }

  // ESC closes; backdrop click closes. Once a series result is showing, rows
  // were already created, so dismissing must refresh the grid (onCreated), not
  // just close (onClose).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') (result ? onCreated : onClose)()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, onCreated, result])

  // P1-7: an "unavailable" session type (admin/meeting/note/…) creates a
  // staff-only block with no client.
  const appointmentTypes = sessionTypes.filter((t) => t.kind !== 'unavailable')
  const unavailableTypes = sessionTypes.filter((t) => t.kind === 'unavailable')
  const isUnavailable =
    sessionTypes.find((t) => t.name === type)?.kind === 'unavailable'

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isUnavailable && !clientId) {
      setError('Pick a client.')
      return
    }
    setError(null)

    // Recurring series (P2-14): generate one row per occurrence. Partial
    // success — clashing instances are skipped and reported, not fatal.
    if (repeat) {
      if (recurrenceDates.length === 0) {
        setError('Set an end date on or after the start date.')
        return
      }
      const startAtIsos = recurrenceDates.map((iso) =>
        combineDateTime(iso, time).toISOString(),
      )
      startTransition(async () => {
        const res = await createRecurringAppointmentsAction({
          clientId: isUnavailable ? null : clientId,
          startAtIsos,
          durationMinutes: duration,
          appointmentType: type,
          location: location.trim() || null,
          notes: notes.trim() || null,
          kind: isUnavailable ? 'unavailable' : 'appointment',
        })
        // Nothing booked and a hard error → stay on the form with the message.
        if (res.error && res.created === 0) {
          setError(res.error)
          return
        }
        // Some booked but skips and/or a mid-series abort → show the summary
        // (its Done refreshes the grid). Clean full success → just close.
        if (res.skipped.length > 0 || res.error) {
          setResult({
            created: res.created,
            skipped: res.skipped,
            error: res.error ?? undefined,
          })
          return
        }
        onCreated()
      })
      return
    }

    const startIso = combineDateTime(date, time).toISOString()
    startTransition(async () => {
      const res = await createAppointmentAction({
        clientId: isUnavailable ? null : clientId,
        startAtIso: startIso,
        durationMinutes: duration,
        appointmentType: type,
        location: location.trim() || null,
        notes: notes.trim() || null,
        kind: isUnavailable ? 'unavailable' : 'appointment',
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
        // Backdrop click closes; cards inside stop propagation. A shown result
        // means rows exist, so dismissing refreshes (onCreated).
        if ((e.target as HTMLElement).dataset.backdrop === '1')
          (result ? onCreated : onClose)()
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
      {result ? (
        <RecurResultCard
          created={result.created}
          skipped={result.skipped}
          error={result.error}
          onDone={onCreated}
        />
      ) : (
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
          // Cap to the viewport and let the body scroll, so a tall form (e.g.
          // the Repeat section expanded) keeps the header and the Book button
          // reachable instead of overflowing off-screen.
          maxHeight: 'calc(100vh - 32px)',
          display: 'flex',
          flexDirection: 'column',
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
            flexShrink: 0,
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
              {isUnavailable ? 'Add an unavailable block' : 'Book an appointment'}
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

        {/* Body — scrolls when the form is taller than the viewport. */}
        <div
          style={{
            padding: '20px 22px',
            display: 'grid',
            gap: 14,
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
          }}
        >
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

          {/* Client — appointment-kind only (P1-7); hidden for Unavailable
              blocks, which have no client. */}
          {!isUnavailable && (
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 5,
              }}
            >
              <div
                style={{
                  fontSize: '.64rem',
                  fontWeight: 700,
                  color: 'var(--color-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '.06em',
                }}
              >
                Client
                <span
                  aria-hidden
                  style={{ color: 'var(--color-alert)', marginLeft: 4 }}
                >
                  *
                </span>
              </div>
              {!showNewClient && (
                <button
                  type="button"
                  onClick={() => setShowNewClient(true)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--color-accent)',
                    fontFamily: 'var(--font-sans)',
                    fontSize: '.76rem',
                    fontWeight: 600,
                    padding: 0,
                  }}
                >
                  + New client
                </button>
              )}
            </div>

            {!showNewClient ? (
              allClients.length === 0 ? (
                <div
                  style={{
                    fontSize: '.82rem',
                    color: 'var(--color-muted)',
                    padding: '8px 0',
                  }}
                >
                  No clients yet — use "+ New client" above.
                </div>
              ) : (
                <select
                  name="client_id"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  style={composerInput}
                  required
                >
                  {allClients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.first_name} {c.last_name}
                      {c.category_name ? ` · ${c.category_name}` : ''}
                    </option>
                  ))}
                </select>
              )
            ) : (
              <div
                style={{
                  padding: 12,
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border-subtle)',
                  borderRadius: 8,
                  display: 'grid',
                  gap: 10,
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 10,
                  }}
                >
                  <input
                    type="text"
                    placeholder="First name"
                    value={newFirst}
                    onChange={(e) => setNewFirst(e.target.value)}
                    style={composerInput}
                    autoFocus
                  />
                  <input
                    type="text"
                    placeholder="Last name"
                    value={newLast}
                    onChange={(e) => setNewLast(e.target.value)}
                    style={composerInput}
                  />
                </div>
                <input
                  type="email"
                  placeholder="Email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  style={composerInput}
                />
                {newClientError && (
                  <div
                    role="alert"
                    style={{
                      fontSize: '.78rem',
                      color: 'var(--color-alert)',
                    }}
                  >
                    {newClientError}
                  </div>
                )}
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    justifyContent: 'flex-end',
                  }}
                >
                  {allClients.length > 0 && (
                    <button
                      type="button"
                      className="btn outline"
                      onClick={() => {
                        resetNewClient()
                        setShowNewClient(false)
                      }}
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn primary"
                    disabled={creatingClient}
                    onClick={handleCreateClient}
                  >
                    {creatingClient ? 'Saving…' : 'Save client'}
                  </button>
                </div>
              </div>
            )}
          </div>
          )}

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
                onChange={(e) => {
                  const next = e.target.value
                  setType(next)
                  const t = sessionTypes.find((st) => st.name === next)
                  if (t) setDuration(t.default_duration_minutes)
                }}
                style={composerInput}
              >
                {sessionTypes.length === 0 && (
                  <option value="Session">Session</option>
                )}
                {appointmentTypes.length > 0 && (
                  <optgroup label="Appointment">
                    {appointmentTypes.map((t) => (
                      <option key={t.id} value={t.name}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {unavailableTypes.length > 0 && (
                  <optgroup label="Unavailable (no client)">
                    {unavailableTypes.map((t) => (
                      <option key={t.id} value={t.name}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                )}
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

          {/* Repeat (P2-14) — generate a recurring series of concrete rows. */}
          <div
            style={{
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 8,
              padding: '12px 14px',
              display: 'grid',
              gap: repeat ? 12 : 0,
            }}
          >
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={repeat}
                onChange={(e) => setRepeat(e.target.checked)}
                style={{
                  width: 16,
                  height: 16,
                  accentColor: 'var(--color-accent)',
                  cursor: 'pointer',
                }}
              />
              <span
                style={{
                  fontSize: '.86rem',
                  fontWeight: 600,
                  color: 'var(--color-text)',
                }}
              >
                Repeat this booking
              </span>
            </label>

            {repeat && (
              <>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 12,
                  }}
                >
                  <ComposerField label="Frequency">
                    <select
                      value={frequency}
                      onChange={(e) =>
                        setFrequency(e.target.value as RecurFrequency)
                      }
                      style={composerInput}
                    >
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="fortnightly">Fortnightly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </ComposerField>
                  <ComposerField label="Ends">
                    <select
                      value={endMode}
                      onChange={(e) =>
                        setEndMode(e.target.value as RecurEndMode)
                      }
                      style={composerInput}
                    >
                      <option value="count">After a number of sessions</option>
                      <option value="until">On a date</option>
                    </select>
                  </ComposerField>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 12,
                  }}
                >
                  {endMode === 'count' ? (
                    <ComposerField label="Sessions">
                      <input
                        type="number"
                        min={1}
                        max={MAX_OCCURRENCES}
                        value={countInput}
                        onChange={(e) => setCountInput(e.target.value)}
                        onBlur={() => setCountInput(String(occurrenceCount))}
                        style={composerInput}
                      />
                    </ComposerField>
                  ) : (
                    <ComposerField label="Until">
                      <input
                        type="date"
                        value={untilDate}
                        min={date}
                        onChange={(e) => setUntilDate(e.target.value)}
                        style={composerInput}
                      />
                    </ComposerField>
                  )}
                </div>
                <div
                  style={{
                    fontSize: '.8rem',
                    color:
                      recurrenceDates.length === 0
                        ? 'var(--color-alert)'
                        : 'var(--color-text-light)',
                    lineHeight: 1.5,
                  }}
                >
                  {recurrenceDates.length === 0
                    ? 'Set an end date on or after the start date.'
                    : recurrenceDates.length === 1
                      ? 'Creates 1 session.'
                      : `Creates ${recurrenceDates.length} sessions · ${formatDayDate(
                          parseIsoDate(recurrenceDates[0]!),
                        )} → ${formatDayDate(
                          parseIsoDate(
                            recurrenceDates[recurrenceDates.length - 1]!,
                          ),
                        )}`}
                  {recurrenceDates.length === MAX_OCCURRENCES && ' (max)'}
                </div>
              </>
            )}
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
            flexShrink: 0,
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
            disabled={
              pending ||
              (!isUnavailable && allClients.length === 0) ||
              showNewClient ||
              recurrenceDates.length === 0
            }
          >
            {pending
              ? 'Booking…'
              : repeat
                ? `Book ${recurrenceDates.length} session${
                    recurrenceDates.length === 1 ? '' : 's'
                  }`
                : 'Book appointment'}
          </button>
        </div>
      </form>
      )}
    </div>
  )
}

/** Post-save summary for a recurring series with skipped (clashing) instances. */
function RecurResultCard({
  created,
  skipped,
  error,
  onDone,
}: {
  created: number
  skipped: string[]
  error?: string
  onDone: () => void
}) {
  const total = created + skipped.length
  return (
    <div
      data-composer-card
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        background: 'var(--color-card)',
        borderRadius: 14,
        boxShadow: '0 20px 60px rgba(0,0,0,.25)',
        width: 460,
        maxWidth: 'calc(100vw - 32px)',
        maxHeight: 'calc(100vh - 32px)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '20px 22px',
          display: 'grid',
          gap: 12,
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
        }}
      >
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1.2rem',
            margin: 0,
          }}
        >
          {created > 0
            ? `Booked ${created} of ${total} session${total === 1 ? '' : 's'}`
            : 'No sessions booked'}
        </h2>
        {skipped.length > 0 && (
          <div
            style={{
              fontSize: '.86rem',
              color: 'var(--color-text)',
              lineHeight: 1.5,
            }}
          >
            <div
              style={{
                color: 'var(--color-warning)',
                fontWeight: 600,
                marginBottom: 4,
              }}
            >
              {skipped.length} skipped — already booked at that time:
            </div>
            <div style={{ color: 'var(--color-text-light)' }}>
              {skipped.map((iso) => formatDayDate(new Date(iso))).join(' · ')}
            </div>
          </div>
        )}
        {error && (
          <div style={{ fontSize: '.84rem', color: 'var(--color-alert)' }}>
            {error}
          </div>
        )}
      </div>
      <div
        style={{
          padding: '14px 22px',
          borderTop: '1px solid var(--color-border-subtle)',
          display: 'flex',
          justifyContent: 'flex-end',
          flexShrink: 0,
        }}
      >
        <button type="button" className="btn primary" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  )
}

/* ====================== Tools menu (P2-15) ====================== */

function ToolsMenu({
  sessionTypes,
  onFoundSlot,
}: {
  sessionTypes: SessionType[]
  onFoundSlot: (slotStartIso: string) => void
}) {
  const appointmentTypes = useMemo(
    () => sessionTypes.filter((t) => t.kind !== 'unavailable'),
    [sessionTypes],
  )
  const [open, setOpen] = useState(false)
  const [subscribeOpen, setSubscribeOpen] = useState(false)
  // Default to the first appointment type. Lazy initial state (not an effect) —
  // session types are loaded server-side and stable for the component's life.
  const [typeId, setTypeId] = useState(() => appointmentTypes[0]?.id ?? '')
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const ref = useRef<HTMLDivElement | null>(null)

  // Click-outside / ESC closes the menu.
  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function handleFind() {
    const t = appointmentTypes.find((x) => x.id === typeId)
    const minutes = t?.default_duration_minutes ?? 60
    setMsg(null)
    startTransition(async () => {
      const res = await findNextAvailableSlotAction(minutes)
      if (res.error) {
        setMsg(res.error)
        return
      }
      if (!res.slotStartIso) {
        setMsg('No opening in the next 90 days.')
        return
      }
      setOpen(false)
      onFoundSlot(res.slotStartIso)
    })
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className="btn outline"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Wrench size={14} aria-hidden />
        Tools
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Schedule tools"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 6px)',
            width: 260,
            background: 'var(--color-card)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 10,
            boxShadow: '0 10px 30px rgba(0,0,0,.15)',
            zIndex: 1000,
            padding: 14,
            display: 'grid',
            gap: 8,
          }}
        >
          <div
            style={{
              fontSize: '.64rem',
              fontWeight: 700,
              color: 'var(--color-muted)',
              textTransform: 'uppercase',
              letterSpacing: '.06em',
            }}
          >
            Find next available
          </div>
          <select
            value={typeId}
            onChange={(e) => setTypeId(e.target.value)}
            style={composerInput}
          >
            {appointmentTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {t.default_duration_minutes} min
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn primary"
            onClick={handleFind}
            disabled={pending || appointmentTypes.length === 0}
            style={{ justifyContent: 'center' }}
          >
            {pending ? 'Finding…' : 'Find next opening'}
          </button>
          {msg && (
            <div
              style={{
                fontSize: '.78rem',
                color: 'var(--color-text-light)',
                lineHeight: 1.4,
              }}
            >
              {msg}
            </div>
          )}

          <div
            style={{
              borderTop: '1px solid var(--color-border-subtle)',
              margin: '4px 0 0',
              paddingTop: 10,
            }}
          >
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                setSubscribeOpen(true)
              }}
              style={{
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: 'var(--color-text)',
                fontFamily: 'var(--font-sans)',
                fontSize: '.84rem',
                fontWeight: 600,
              }}
            >
              <CalendarPlus size={15} aria-hidden />
              Subscribe in your calendar
            </button>
          </div>
        </div>
      )}
      {subscribeOpen && (
        <CalendarSubscribe onClose={() => setSubscribeOpen(false)} />
      )}
    </div>
  )
}

/** Calendar-subscribe modal (P2-15 B): the de-identified .ics feed URL. */
function CalendarSubscribe({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined) // undefined = loading
  const [pending, startTransition] = useTransition()
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    getCalendarFeedAction().then((res) => {
      if (active) setUrl(res.url)
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function handleRegenerate() {
    setError(null)
    startTransition(async () => {
      const res = await regenerateCalendarFeedAction()
      if (res.error) {
        setError(res.error)
        return
      }
      setUrl(res.url)
      setCopied(false)
    })
  }

  function handleRevoke() {
    setError(null)
    startTransition(async () => {
      const res = await revokeCalendarFeedAction()
      if (res.error) {
        setError(res.error)
        return
      }
      setUrl(null)
      setCopied(false)
    })
  }

  function handleCopy() {
    if (!url) return
    navigator.clipboard?.writeText(url).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      },
      () => setError('Could not copy — select the link and copy it manually.'),
    )
  }

  return (
    <div
      onMouseDown={(e) => {
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
      <div
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Subscribe in your calendar"
        style={{
          background: 'var(--color-card)',
          borderRadius: 14,
          boxShadow: '0 20px 60px rgba(0,0,0,.25)',
          width: 480,
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100vh - 32px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '16px 22px',
            borderBottom: '1px solid var(--color-border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <div>
            <div className="eyebrow" style={{ marginBottom: 2 }}>
              03 Schedule · Tools
            </div>
            <h2
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: '1.25rem',
                margin: 0,
              }}
            >
              Subscribe in your calendar
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

        <div
          style={{
            padding: '20px 22px',
            display: 'grid',
            gap: 14,
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: '.86rem',
              color: 'var(--color-text)',
              lineHeight: 1.5,
            }}
          >
            Add this link to Google, Apple, or Outlook calendar to see your
            schedule there. It shows session{' '}
            <strong>times, types and locations only</strong> — never client
            names or notes.
          </p>

          {error && (
            <div
              role="alert"
              style={{ fontSize: '.82rem', color: 'var(--color-alert)' }}
            >
              {error}
            </div>
          )}

          {url === undefined ? (
            <div style={{ fontSize: '.86rem', color: 'var(--color-muted)' }}>
              Loading…
            </div>
          ) : url ? (
            <>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  readOnly
                  value={url}
                  onFocus={(e) => e.currentTarget.select()}
                  style={{ ...composerInput, flex: 1, fontSize: '.76rem' }}
                />
                <button
                  type="button"
                  className="btn outline"
                  onClick={handleCopy}
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: '.78rem',
                  color: 'var(--color-text-light)',
                  lineHeight: 1.5,
                }}
              >
                Anyone with this link can view your schedule, so keep it
                private. Regenerate to revoke the old link, or turn the feed off
                entirely.
              </p>
            </>
          ) : (
            <p
              style={{
                margin: 0,
                fontSize: '.84rem',
                color: 'var(--color-text-light)',
                lineHeight: 1.5,
              }}
            >
              No calendar link yet. Create one to subscribe.
            </p>
          )}
        </div>

        <div
          style={{
            padding: '14px 22px',
            borderTop: '1px solid var(--color-border-subtle)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
            flexShrink: 0,
          }}
        >
          {url ? (
            <button
              type="button"
              onClick={handleRevoke}
              disabled={pending}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--color-alert)',
                fontFamily: 'var(--font-sans)',
                fontSize: '.8rem',
                fontWeight: 600,
                cursor: pending ? 'wait' : 'pointer',
                padding: '4px 8px',
              }}
            >
              Turn off
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            className="btn primary"
            onClick={handleRegenerate}
            disabled={pending}
          >
            {pending ? 'Working…' : url ? 'Regenerate link' : 'Create link'}
          </button>
        </div>
      </div>
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

/* ====================== Recurrence (P2-14) ====================== */

type RecurFrequency = 'daily' | 'weekly' | 'fortnightly' | 'monthly'
type RecurEndMode = 'count' | 'until'

const MAX_OCCURRENCES = 52

/**
 * Concrete occurrence DATES (`YYYY-MM-DD`) for a recurrence, capped at 52.
 *
 * Cadence is computed in whole CALENDAR units on the UTC ladder so the
 * wall-clock time-of-day is preserved across a DST change (adding 24h×N would
 * drift by an hour over a transition). The dates are labels; the composer
 * re-attaches the chosen start time to each via combineDateTime. Monthly clamps
 * to the last day of the target month (31 Jan + 1 month → 28/29 Feb), never
 * rolling into the next month. `until` is inclusive and compared
 * lexicographically (valid for YYYY-MM-DD).
 */
function computeRecurrenceDates(
  startIsoDate: string,
  frequency: RecurFrequency,
  endMode: RecurEndMode,
  count: number,
  untilIsoDate: string | null,
): string[] {
  const [y, m, d] = startIsoDate.split('-').map(Number)
  if (!y || !m || !d) return []

  // Monthly keeps the same WEEKDAY and ordinal position as the start (e.g.
  // "3rd Thursday"), not the same day-of-month — booking a session should land
  // on the same day of the week each month. Daily/weekly/fortnightly are whole-
  // day steps, so they already preserve the weekday (fortnightly = +14d).
  const startWeekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0=Sun
  const ordinal = Math.ceil(d / 7) // which occurrence of that weekday: 1..5

  const occurrence = (i: number): string => {
    if (frequency === 'monthly') {
      const totalMonth = m - 1 + i
      const ty = y + Math.floor(totalMonth / 12)
      const tm = ((totalMonth % 12) + 12) % 12 // 0–11
      // First date in the target month falling on the start's weekday, then the
      // ordinal-th occurrence — clamped to the last one when the month has
      // fewer (a 5th Thursday → the 4th in a month with only four).
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

  const out: string[] = []
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

// MonthYearPicker + MONTH_LABELS lifted into the shared
// (staff)/_components/MonthYearPicker module so the program calendar
// can mirror this picker exactly. WeekView imports from there.

/**
 * Small toolbar search field — filters the grid to highlight one
 * client's sessions. Non-matching appointments fade to 18% opacity
 * (see AppointmentBlock's `dimmed` path). Blank filter → nothing fades.
 */
function ClientSearchInput({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  return (
    <div
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
      }}
    >
      <Search
        size={13}
        aria-hidden
        style={{
          position: 'absolute',
          left: 9,
          color: 'var(--color-text-light)',
          pointerEvents: 'none',
        }}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search client"
        aria-label="Search client"
        style={{
          height: 32,
          width: 180,
          padding: '0 28px 0 28px',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 7,
          background: '#fff',
          fontFamily: 'var(--font-sans)',
          fontSize: '.82rem',
          color: 'var(--color-text)',
          outline: 'none',
        }}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange('')}
          style={{
            position: 'absolute',
            right: 4,
            width: 22,
            height: 22,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: 'var(--color-text-light)',
            display: 'grid',
            placeItems: 'center',
            borderRadius: 4,
          }}
        >
          <X size={12} aria-hidden />
        </button>
      )}
    </div>
  )
}

/**
 * "Days" dropdown in the toolbar — toggles between single-day and
 * work-week view. Styled to match the Today/outline button chrome.
 */
function DaysDropdown({
  value,
  onChange,
}: {
  value: ViewMode
  onChange: (next: ViewMode) => void
}) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        position: 'relative',
      }}
    >
      <label
        htmlFor="days-view"
        style={{
          fontSize: '.64rem',
          fontWeight: 700,
          color: 'var(--color-muted)',
          textTransform: 'uppercase',
          letterSpacing: '.06em',
          marginRight: 8,
        }}
      >
        Days
      </label>
      <select
        id="days-view"
        value={value}
        onChange={(e) => onChange(e.target.value as ViewMode)}
        style={{
          height: 32,
          padding: '0 28px 0 10px',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 7,
          background: '#fff',
          fontFamily: 'var(--font-sans)',
          fontSize: '.82rem',
          color: 'var(--color-text)',
          cursor: 'pointer',
          appearance: 'none',
          WebkitAppearance: 'none',
          MozAppearance: 'none',
        }}
      >
        <option value="day">1 day</option>
        <option value="week">Work week</option>
      </select>
      <ChevronDown
        size={14}
        aria-hidden
        style={{
          position: 'absolute',
          right: 8,
          pointerEvents: 'none',
          color: 'var(--color-text-light)',
        }}
      />
    </div>
  )
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

/**
 * Which Mon–Sun column (0–6) an instant falls into, evaluated in the practice
 * timezone (not the browser's) so the grid buckets correctly on any device
 * (P0-2 / FM-2). Compared as UTC-day numbers of the practice-tz calendar date,
 * which is tz-safe.
 */
function dayIndexInPracticeTz(startIso: string, weekStartIso: string): number {
  const p = wallClockPartsInTimeZone(new Date(startIso), PRACTICE_TIMEZONE)
  const apptDay = Date.UTC(p.year, p.month - 1, p.day)
  const [wy, wm, wd] = weekStartIso.split('-').map(Number)
  const weekDay = Date.UTC(wy!, wm! - 1, wd!)
  return Math.floor((apptDay - weekDay) / 86_400_000)
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
    timeZone: PRACTICE_TIMEZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(d)
}

function formatTime(d: Date): string {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: PRACTICE_TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d)
}

function firstMondayOnOrAfter(d: Date): Date {
  const day = d.getDay() // 0=Sun … 6=Sat
  const offset = day === 1 ? 0 : (8 - day) % 7
  const m = new Date(d)
  m.setDate(d.getDate() + offset)
  return m
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

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function toneToColors(tone: AvatarTone): { bg: string; border: string } {
  if (tone === 'r')
    return {
      bg: 'rgba(214,64,69,.22)',
      border: 'var(--color-alert)',
    }
  if (tone === 'a')
    return {
      bg: 'rgba(232,163,23,.24)',
      border: '#E8A317',
    }
  // Default (confirmed/completed) — accent green tint. More saturated
  // than the previous near-transparent dark fill.
  return {
    bg: 'rgba(45,178,76,0.22)',
    border: 'var(--color-accent)',
  }
}
