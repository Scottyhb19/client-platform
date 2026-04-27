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
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  FileText,
  Search,
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
  createClientInlineAction,
  updateAppointmentTimeAction,
} from '../actions'
import {
  PractitionerSidebar,
  type StaffMember,
} from './PractitionerSidebar'

export type Appointment = {
  id: string
  start_at: string
  end_at: string
  appointment_type: string
  status: 'pending' | 'confirmed' | 'cancelled' | 'no_show' | 'completed'
  location: string | null
  notes: string | null
  staff_user_id: string
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

export type ViewMode = 'day' | 'week'

export type SessionType = {
  id: string
  name: string
  color: string // #RRGGBB
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

const monthArrowStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  border: 'none',
  background: 'transparent',
  borderRadius: 8,
  cursor: 'pointer',
  color: 'var(--color-text-light)',
  display: 'grid',
  placeItems: 'center',
  transition: 'background 120ms, color 120ms',
}

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
      const start = new Date(a.start_at)
      const dayIdx = dayIndexFromMonday(start, weekStart)
      if (dayIdx >= 0 && dayIdx < 7) map[dayIdx].push(a)
    }
    return map
  }, [appointments, weekStart])

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
                {appointmentsByDay[dayIdx].map((a) => {
                  const fullName = `${a.client.first_name} ${a.client.last_name}`.toLowerCase()
                  const dimmed =
                    normalisedFilter.length > 0 &&
                    !fullName.includes(normalisedFilter)
                  const typeColor =
                    sessionTypeColors.get(a.appointment_type.toLowerCase()) ??
                    null
                  return (
                    <AppointmentBlock
                      key={a.id}
                      appointment={a}
                      gridRef={gridRef}
                      pxPerQuarter={pxPerQuarter}
                      dimmed={dimmed}
                      typeColor={typeColor}
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

/* Convert (day, quarter-index) → Date at that slot in local time. */
function slotToDate(day: Date, quarterIndex: number): Date {
  const totalMin = quarterIndex * 15
  const h = HOUR_START + Math.floor(totalMin / 60)
  const m = totalMin % 60
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0)
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

function AppointmentBlock({
  appointment,
  gridRef,
  pxPerQuarter,
  dimmed,
  typeColor,
  onOpenPopover,
  onCommitted,
}: {
  appointment: Appointment
  gridRef: React.RefObject<HTMLDivElement | null>
  pxPerQuarter: number
  dimmed: boolean
  typeColor: string | null
  onOpenPopover: (ev: React.PointerEvent | React.MouseEvent) => void
  onCommitted: () => void
}) {
  const pxPerHour = pxPerQuarter * QUARTERS_PER_HOUR
  const start = new Date(appointment.start_at)
  const end = new Date(appointment.end_at)
  const baseTop =
    (start.getHours() - HOUR_START) * pxPerHour +
    (start.getMinutes() / 15) * pxPerQuarter
  const baseHeight =
    ((end.getTime() - start.getTime()) / (1000 * 60 * 15)) *
      pxPerQuarter -
    2

  // Colour priority:
  //   1. cancelled / no_show → red tone (overrides the type colour so the
  //      status is unmissable)
  //   2. appointment has a known session-type colour → use it
  //   3. fallback → status-based tone (default accent green)
  const tone = toneForStatus(appointment.status)
  const statusTone = toneToColors(tone)
  const useTypeColor =
    typeColor !== null &&
    appointment.status !== 'cancelled' &&
    appointment.status !== 'no_show'
  const bg = useTypeColor ? hexToRgba(typeColor!, 0.22) : statusTone.bg
  const border = useTypeColor ? typeColor! : statusTone.border

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
      ? `translate(calc(${drag.deltaDays} * 100%), ${
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
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
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
          }}
        >
          {appointment.client.first_name} {appointment.client.last_name}
        </span>
        <span
          style={{
            flexShrink: 0,
            fontSize: '.66rem',
            fontWeight: 600,
            color: 'var(--color-text-light)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {formatTime(start)}
        </span>
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

function NowLine({
  now,
  pxPerQuarter,
}: {
  now: Date
  pxPerQuarter: number
}) {
  const hour = now.getHours()
  if (hour < HOUR_START || hour >= HOUR_END) return null
  const pxPerHour = pxPerQuarter * QUARTERS_PER_HOUR
  const top =
    (hour - HOUR_START) * pxPerHour +
    (now.getMinutes() / 15) * pxPerQuarter
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
  const [duration, setDuration] = useState(60)
  const [type, setType] = useState(sessionTypes[0]?.name ?? 'Session')
  const [location, setLocation] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

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

          {/* Client — with inline "+ New client" affordance */}
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
                {sessionTypes.length === 0 && (
                  <option value="Session">Session</option>
                )}
                {sessionTypes.map((t) => (
                  <option key={t.id} value={t.name}>
                    {t.name}
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
            disabled={pending || allClients.length === 0 || showNewClient}
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

const MONTH_LABELS = [
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
]

/**
 * Popover picker shown under the month label. Year bar up top with
 * prev/next arrows; 4×3 grid of months below. The currently-displayed
 * month is highlighted; today's month gets a subtle ring so the user
 * always has a visual home base.
 */
function MonthYearPicker({
  year,
  selectedYear,
  selectedMonth,
  todayYear,
  todayMonth,
  onYearChange,
  onPick,
  onClose,
}: {
  year: number
  selectedYear: number
  selectedMonth: number
  todayYear: number
  todayMonth: number
  onYearChange: (next: number) => void
  onPick: (year: number, month: number) => void
  onClose: () => void
}) {
  // ESC + outside click close.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    function onMouseDown(e: MouseEvent) {
      const el = e.target as HTMLElement
      if (!el.closest('[data-month-picker]')) onClose()
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
      data-month-picker
      role="dialog"
      aria-label="Choose a month"
      style={{
        position: 'absolute',
        top: 'calc(100% + 6px)',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 280,
        background: 'var(--color-card)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 12,
        boxShadow: '0 12px 28px rgba(0,0,0,.12)',
        padding: 10,
        zIndex: 30,
      }}
    >
      {/* Year header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          padding: '4px 0 10px',
          borderBottom: '1px solid var(--color-border-subtle)',
          marginBottom: 10,
        }}
      >
        <button
          type="button"
          aria-label="Previous year"
          onClick={() => onYearChange(year - 1)}
          style={monthArrowStyle}
        >
          <ChevronLeft size={16} aria-hidden />
        </button>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1.15rem',
            minWidth: 72,
            textAlign: 'center',
            color: 'var(--color-charcoal)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {year}
        </div>
        <button
          type="button"
          aria-label="Next year"
          onClick={() => onYearChange(year + 1)}
          style={monthArrowStyle}
        >
          <ChevronRight size={16} aria-hidden />
        </button>
      </div>

      {/* 4×3 month grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 6,
        }}
      >
        {MONTH_LABELS.map((label, idx) => {
          const isCurrent = year === selectedYear && idx === selectedMonth
          const isToday = year === todayYear && idx === todayMonth
          return (
            <button
              key={label}
              type="button"
              onClick={() => onPick(year, idx)}
              style={{
                padding: '8px 0',
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: '.82rem',
                letterSpacing: '0.02em',
                background: isCurrent
                  ? 'var(--color-accent)'
                  : 'transparent',
                color: isCurrent ? '#fff' : 'var(--color-charcoal)',
                border: isToday && !isCurrent
                  ? '1px solid var(--color-accent)'
                  : '1px solid transparent',
                borderRadius: 7,
                cursor: 'pointer',
                transition: 'background 120ms, color 120ms',
              }}
            >
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

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
