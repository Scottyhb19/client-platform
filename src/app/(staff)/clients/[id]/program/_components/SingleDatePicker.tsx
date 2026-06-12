'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { todayIsoInPracticeTz } from '@/lib/dates'

/*
 * SingleDatePicker — modal date picker for a one-off "pick a future date"
 * flow. Phase I of the session-builder polish pass uses it for the
 * Duplicate button in the page header.
 *
 * Shape mirrors RepeatEndDatePicker in MonthCalendar.tsx (same modal
 * chrome, same month-grid styling) but without the same-weekday
 * highlighting / repeat-preview that's specific to the repeat flow.
 *
 * The calendar grid helpers (parseIso, isoFromDate, addDaysTo,
 * buildMonthCells, formatLongDate) are inlined rather than exported
 * from MonthCalendar.tsx — they're 20 lines total and Phase I is a
 * polish round, not a shared-utility refactor. If a third caller
 * needs them, lift them into a shared util at that point.
 */

interface SingleDatePickerProps {
  /** Optional ISO date that frames the picker. Defaults to today. */
  anchorDate?: string
  /** Optional ISO floor — dates strictly before this are disabled. Defaults to today. */
  minDate?: string
  title: string
  description?: string
  confirmLabel?: string
  busy?: boolean
  onCancel: () => void
  onConfirm: (date: string) => void
}

const FULL_MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function SingleDatePicker({
  anchorDate,
  minDate,
  title,
  description,
  confirmLabel = 'Confirm',
  busy = false,
  onCancel,
  onConfirm,
}: SingleDatePickerProps) {
  // Practice-timezone today (P0-2) — the browser clock is only right while
  // the browser is physically in the practice timezone.
  const todayIso = todayIsoInPracticeTz()
  const floorIso = minDate ?? todayIso
  const initialIso = anchorDate ?? todayIso
  const initialParsed = parseIso(initialIso)

  const [picked, setPicked] = useState<string | null>(null)
  const [visibleYear, setVisibleYear] = useState(initialParsed.getFullYear())
  const [visibleMonth, setVisibleMonth] = useState(initialParsed.getMonth())

  const cells = useMemo(
    () => buildMonthCells(visibleYear, visibleMonth),
    [visibleYear, visibleMonth],
  )

  function gotoMonth(direction: 'prev' | 'next') {
    const delta = direction === 'prev' ? -1 : 1
    const next = new Date(visibleYear, visibleMonth + delta, 1)
    setVisibleYear(next.getFullYear())
    setVisibleMonth(next.getMonth())
  }

  // Disable navigation back into months whose last day is before floor.
  // Simple guard: if the visible month is the floor's month-of-year, the
  // prev arrow is disabled. (Keeping it loose — the EP isn't going to
  // pick a date in 1998 by accident.)
  const floorParsed = parseIso(floorIso)
  const atFloorMonth =
    visibleYear === floorParsed.getFullYear() &&
    visibleMonth === floorParsed.getMonth()

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
              {title}
            </div>
            {description && (
              <div
                style={{
                  fontSize: '.78rem',
                  color: 'var(--color-muted)',
                  marginTop: 2,
                }}
              >
                {description}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel"
            disabled={busy}
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
            disabled={atFloorMonth}
            aria-label="Previous month"
            style={{
              ...monthArrowStyle,
              opacity: atFloorMonth ? 0.35 : 1,
              cursor: atFloorMonth ? 'not-allowed' : 'pointer',
            }}
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
            const isPicked = picked === c.iso
            const isBeforeFloor = c.iso < floorIso
            const dimmed = !c.inMonth || isBeforeFloor
            return (
              <button
                key={c.iso}
                type="button"
                onClick={() => {
                  if (isBeforeFloor) return
                  setPicked(c.iso)
                }}
                disabled={isBeforeFloor}
                aria-label={c.iso}
                style={{
                  padding: '8px 0',
                  fontSize: '.78rem',
                  fontVariantNumeric: 'tabular-nums',
                  color: isPicked
                    ? '#fff'
                    : dimmed
                    ? 'var(--color-muted)'
                    : 'var(--color-charcoal)',
                  background: isPicked ? 'var(--color-primary)' : 'transparent',
                  border: 'none',
                  borderRadius: 6,
                  cursor: isBeforeFloor ? 'not-allowed' : 'pointer',
                  opacity: dimmed ? 0.45 : 1,
                  fontWeight: isPicked ? 700 : 400,
                }}
              >
                {c.date}
              </button>
            )
          })}
        </div>

        {/* Footer — picked-date readback + actions */}
        <div
          style={{
            marginTop: 12,
            padding: '8px 10px',
            background: 'var(--color-surface)',
            borderRadius: 7,
            fontSize: '.78rem',
            color: 'var(--color-text-light)',
            minHeight: 36,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {picked ? (
            <span>
              <strong style={{ color: 'var(--color-charcoal)' }}>
                {formatLongDate(picked)}
              </strong>
            </span>
          ) : (
            <span>Pick a date.</span>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            marginTop: 14,
          }}
        >
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
            onClick={() => picked && onConfirm(picked)}
            className="btn primary"
            style={{ padding: '6px 14px', fontSize: '.82rem' }}
            disabled={busy || !picked}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Local helpers — mirror the private helpers in MonthCalendar.tsx
// (parseIso, isoFromDate, addDaysTo, buildMonthCells, formatLongDate). If a
// third caller needs these, lift into a shared util at that point.
// ---------------------------------------------------------------------------

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

function buildMonthCells(year: number, month: number) {
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

const monthArrowStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  display: 'grid',
  placeItems: 'center',
  background: 'transparent',
  border: 'none',
  color: 'var(--color-muted)',
  borderRadius: 4,
  padding: 0,
}

const iconCloseStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  display: 'grid',
  placeItems: 'center',
  background: 'transparent',
  border: 'none',
  color: 'var(--color-muted)',
  borderRadius: 4,
  cursor: 'pointer',
}
