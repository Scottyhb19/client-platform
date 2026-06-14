'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { PORTAL_TZ_COOKIE } from '../_lib/portal-helpers'

/**
 * Reports the device's current IANA timezone to the server via the
 * `portal_tz` cookie, so server-rendered "today" matches where the client
 * physically is — and auto-corrects when they travel (the browser reports
 * the new zone, we rewrite the cookie and refresh). Section 7 / Q2.
 *
 * Renders nothing. Refreshes only when the detected zone differs from the
 * cookie, so there is no refresh loop in the steady state. Imports the
 * cookie name from portal-helpers (a server-import-free module) so this
 * client component doesn't drag `next/headers` into the bundle.
 */
export function TimezoneSync() {
  const router = useRouter()

  useEffect(() => {
    let detected: string
    try {
      detected = Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
      return
    }
    if (!detected) return
    if (readCookie(PORTAL_TZ_COOKIE) === detected) return

    // 1-year cookie; Lax so it rides top-level navigations; path-wide so the
    // session route (/portal/session/*) sees it too.
    document.cookie =
      `${PORTAL_TZ_COOKIE}=${encodeURIComponent(detected)}` +
      `; path=/; max-age=31536000; samesite=lax`
    router.refresh()
  }, [router])

  return null
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(
    new RegExp('(?:^|; )' + name + '=([^;]*)'),
  )
  return match ? decodeURIComponent(match[1]!) : null
}
