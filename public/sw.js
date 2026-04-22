// Odyssey portal service worker — v1 scope only.
//
// We register this SW strictly to meet the installable PWA criteria
// (manifest + service worker + https + start URL). Caching is
// deliberately MINIMAL in v1 — clinical data changes often enough
// that stale-while-revalidate without invalidation would do more
// harm than good. When we add offline session logging, this file
// gets real.

const VERSION = 'odyssey-v1'

self.addEventListener('install', (event) => {
  // Activate immediately on the next navigation.
  self.skipWaiting()
  event.waitUntil(Promise.resolve())
})

self.addEventListener('activate', (event) => {
  // Claim all open clients so the SW controls them without a reload.
  event.waitUntil(self.clients.claim())
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith('odyssey-') && k !== VERSION)
          .map((k) => caches.delete(k)),
      ),
    ),
  )
})

// Network-first passthrough. No offline fallback yet; if the network
// fails the browser shows its normal error. That's fine for v1 — the
// portal is useless without a server round-trip anyway.
self.addEventListener('fetch', () => {
  // No-op: let the browser handle every request.
})
