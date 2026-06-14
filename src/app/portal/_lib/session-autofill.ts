import { PORTAL_AUTOFILL_COOKIE } from './portal-helpers'

/**
 * Persist the in-session "autofill" preference to a 1-year cookie (client
 * only). Isolated in a plain module — not inline in the component — so the
 * React Compiler doesn't flag the `document.cookie` write, the same way
 * session-theme.ts isolates its storage access. Lax + path-wide so the
 * session page reads it on the next visit. Section 7 / P1-2 follow-up.
 */
export function setAutofillEnabled(on: boolean): void {
  document.cookie =
    `${PORTAL_AUTOFILL_COOKIE}=${on ? 'on' : 'off'}` +
    `; path=/; max-age=31536000; samesite=lax`
}
