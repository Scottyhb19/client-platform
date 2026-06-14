'use client'

import { useSyncExternalStore } from 'react'
import {
  getServerSessionTheme,
  getSessionTheme,
  subscribeSessionTheme,
} from '../../_lib/session-theme'

/**
 * Wraps the in-session screen (the logger, the completion summary, and the
 * error/fallback states under /portal/session/[dayId]) in the themed
 * `.session-screen` container. Section 7 / P1-1: dark by default (brief
 * §6.3.1 — gym-friendly, reduces glare); the client can switch to light on
 * the You tab, persisted per-device in localStorage.
 *
 * Theme is read via useSyncExternalStore: SSR renders the dark default,
 * the client re-renders with the saved preference on hydration. The rare
 * light-preference user gets a one-frame dark→light correction — acceptable
 * for a per-device gym preference (re-trigger: a blocking inline script if
 * the flash is reported as annoying).
 */
export function SessionThemeRoot({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(
    subscribeSessionTheme,
    getSessionTheme,
    getServerSessionTheme,
  )

  return (
    <div className="session-screen" data-theme={theme}>
      {children}
    </div>
  )
}
