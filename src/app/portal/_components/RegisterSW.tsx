'use client'

import { useEffect } from 'react'

/**
 * Registers the portal service worker once per mount. Runs only in
 * production (dev's hot-module reloading conflicts with SW caching).
 * The SW scope is limited to /portal/ so the staff side stays free
 * of service-worker caching effects.
 */
export function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator))
      return

    navigator.serviceWorker
      .register('/sw.js', { scope: '/portal/' })
      .catch((err) => {
        // Non-fatal: the portal still works without the SW; it just
        // isn't installable offline.
        console.warn('Service worker registration failed:', err)
      })
  }, [])

  return null
}
