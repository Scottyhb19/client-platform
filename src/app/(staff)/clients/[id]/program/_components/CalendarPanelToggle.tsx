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

const BORDER = '#E2DDD7'
const INK = '#1E1A18'
const MUTED = '#78746F'
const ACCENT = '#2DB24C'

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
        border: `1px solid ${isOpen ? ACCENT : BORDER}`,
        borderRadius: 7,
        background: isOpen ? 'rgba(45,178,76,.06)' : '#fff',
        color: isOpen ? INK : MUTED,
        cursor: 'pointer',
        transition:
          'background 150ms cubic-bezier(0.4,0,0.2,1), border-color 150ms cubic-bezier(0.4,0,0.2,1), color 150ms cubic-bezier(0.4,0,0.2,1)',
      }}
    >
      <PanelRight size={16} aria-hidden />
    </button>
  )
}
