'use client'

import { useEffect } from 'react'

/**
 * Tiny client component that fires the browser's native print dialog
 * once the note content has rendered. Keeps the surrounding page server-
 * rendered (faster paint, RLS-enforced fetch) while still getting the
 * "open new tab → save as PDF" behaviour the side rail's Export button
 * relies on.
 */
export function PrintTrigger() {
  useEffect(() => {
    // Defer to after first paint so the browser shows the dialog over
    // the rendered note rather than over a blank frame.
    const id = window.setTimeout(() => {
      window.print()
    }, 200)
    return () => window.clearTimeout(id)
  }, [])

  return (
    <button type="button" onClick={() => window.print()}>
      Open print dialog
    </button>
  )
}
