'use client'

import { useSyncExternalStore } from 'react'
import {
  getServerSessionTheme,
  getSessionTheme,
  setSessionTheme,
  subscribeSessionTheme,
} from '../../_lib/session-theme'

/**
 * Per-device preference for the in-session logging screen's theme
 * (section 7 / P1-1). Default dark. Writes the choice to the session-theme
 * store (localStorage); SessionThemeRoot reads it on the session route.
 * This control lives on the (light) You tab and uses the light portal pill
 * style — it sets the *session* theme, it isn't themed by it.
 */
export function SessionThemeToggle() {
  const theme = useSyncExternalStore(
    subscribeSessionTheme,
    getSessionTheme,
    getServerSessionTheme,
  )

  return (
    <div
      className="portal-card is-compact"
      style={{ padding: '14px 16px', marginTop: 18, marginBottom: 8 }}
    >
      <div
        className="portal-eyebrow"
        style={{
          fontSize: '.7rem',
          color: 'var(--color-primary)',
          marginBottom: 8,
        }}
      >
        Session screen
      </div>
      <div
        role="group"
        aria-label="Session screen theme"
        style={{ display: 'flex', gap: 8 }}
      >
        {(['dark', 'light'] as const).map((opt) => {
          const active = theme === opt
          return (
            <button
              key={opt}
              type="button"
              onClick={() => setSessionTheme(opt)}
              aria-pressed={active}
              className={active ? 'portal-tab is-active' : 'portal-tab'}
              style={{ cursor: 'pointer', textTransform: 'capitalize' }}
            >
              {opt}
            </button>
          )
        })}
      </div>
      <div
        style={{
          fontSize: '.74rem',
          color: 'var(--color-text-light)',
          marginTop: 8,
          lineHeight: 1.4,
        }}
      >
        The in-session logging screen. Dark is easier on the eyes in the gym.
      </div>
    </div>
  )
}
