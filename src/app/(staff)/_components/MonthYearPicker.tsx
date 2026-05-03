'use client'

import { useEffect } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export const MONTH_LABELS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

export const monthArrowStyle: React.CSSProperties = {
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

interface MonthYearPickerProps {
  year: number
  selectedYear: number
  selectedMonth: number
  todayYear: number
  todayMonth: number
  onYearChange: (next: number) => void
  onPick: (year: number, month: number) => void
  onClose: () => void
}

/**
 * Popover picker for month + year selection.
 *
 * Year header (chevron < year > chevron) above a 4×3 month grid. The
 * currently-displayed month fills accent green; today's month gets a
 * green ring so the user always has a visual home base. ESC and
 * outside-click both dismiss.
 *
 * Originally lived inside WeekView.tsx (the schedule's week-grid). Lifted
 * here so the program calendar can mirror the same picker exactly,
 * without duplicating the shape.
 */
export function MonthYearPicker({
  year,
  selectedYear,
  selectedMonth,
  todayYear,
  todayMonth,
  onYearChange,
  onPick,
  onClose,
}: MonthYearPickerProps) {
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
        {MONTH_LABELS_SHORT.map((label, idx) => {
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
