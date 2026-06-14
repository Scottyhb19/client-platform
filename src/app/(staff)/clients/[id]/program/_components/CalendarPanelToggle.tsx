'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { PanelRight } from 'lucide-react'

/**
 * Toggle button for the calendar's side panel.
 *
 * Uses router.replace so the URL flip preserves MonthCalendar's local
 * state (visible month, open day, copy/repeat modes). Server-side, page.tsx
 * reads searchParams.panel to decide whether to fetch + render the panel.
 *
 * Open  -> ?panel=notes
 * Close -> no param
 */

export function CalendarPanelToggle() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const isOpen = searchParams.get('panel') === 'notes'

  function toggle() {
    const params = new URLSearchParams(searchParams.toString())
    if (isOpen) {
      params.delete('panel')
    } else {
      params.set('panel', 'notes')
    }
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isOpen ? 'Close clinical side panel' : 'Open clinical side panel'}
      aria-pressed={isOpen}
      title={isOpen ? 'Hide notes & reports' : 'Show notes & reports'}
      style={{
        display: 'inline-grid',
        placeItems: 'center',
        width: 36,
        height: 36,
        // P2-2: ACCENT/BORDER/INK/MUTED/#fff literals → tokens. The active
        // tint stays an inline literal — it's accent green at 6% alpha, and
        // the only accent-tint token is 10% (--color-accent-soft); a 4/6/8%
        // scale is a design-layer decision, surfaced not invented.
        border: `1px solid ${isOpen ? 'var(--color-accent)' : 'var(--color-border-hairline)'}`,
        borderRadius: 'var(--radius-button)',
        background: isOpen ? 'rgba(45,178,76,.06)' : 'var(--color-card)',
        color: isOpen ? 'var(--color-primary)' : 'var(--color-muted)',
        cursor: 'pointer',
        transition:
          'background 150ms cubic-bezier(0.4,0,0.2,1), border-color 150ms cubic-bezier(0.4,0,0.2,1), color 150ms cubic-bezier(0.4,0,0.2,1)',
      }}
    >
      <PanelRight size={16} aria-hidden />
    </button>
  )
}
