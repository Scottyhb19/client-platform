import { SESSION_THEME_KEY } from './portal-helpers'

/**
 * Tiny external store for the in-session screen theme (section 7 / P1-1),
 * read via `useSyncExternalStore` so components stay lint-clean (no
 * setState-in-effect) and SSR-safe. Default dark; persisted per-device in
 * localStorage. `setSessionTheme` notifies subscribers, so the You-tab
 * toggle and a mounted session screen stay in sync.
 */
export type SessionTheme = 'dark' | 'light'

const listeners = new Set<() => void>()

/** Client snapshot — reads the saved preference, defaulting to dark. */
export function getSessionTheme(): SessionTheme {
  try {
    return localStorage.getItem(SESSION_THEME_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

/** SSR snapshot — always the dark default (localStorage is client-only). */
export function getServerSessionTheme(): SessionTheme {
  return 'dark'
}

export function setSessionTheme(theme: SessionTheme): void {
  try {
    localStorage.setItem(SESSION_THEME_KEY, theme)
  } catch {
    /* localStorage blocked (private mode) — won't persist; still notify so
       the current view reflects the choice. */
  }
  for (const listener of listeners) listener()
}

export function subscribeSessionTheme(callback: () => void): () => void {
  listeners.add(callback)
  return () => {
    listeners.delete(callback)
  }
}
