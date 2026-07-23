/**
 * G-15 (2026-07-23): the auth-gated route prefixes consumed by the proxy
 * middleware (src/lib/supabase/middleware.ts). Listed there so a logged-out
 * deep link to any of them redirects with ?next=<path> and SURVIVES login.
 * The middleware only checks user PRESENCE; requireRole stays the sole
 * authority for the claimless (/onboarding/org) and wrong-role
 * (/unauthorized) branches.
 *
 * Kept as a pure module (no framework imports) so the maintenance coupling
 * named at the G-15 sign-off is MACHINE-CHECKED, not comment-checked:
 * protected-routes.test.ts asserts STAFF_ROUTE_PREFIXES equals the actual
 * src/app/(staff)/ route-directory set, so a new top-level staff route that
 * skips this list fails `npm test` instead of silently dropping its
 * deep-links.
 */

/** One prefix per top-level route directory under src/app/(staff)/. */
export const STAFF_ROUTE_PREFIXES = [
  '/dashboard',
  '/analytics',
  '/clients',
  '/contacts',
  '/library',
  '/messages',
  '/schedule',
  '/settings',
] as const

/** Auth-gated prefixes that live outside the (staff) group. */
export const OTHER_PROTECTED_PREFIXES = ['/portal', '/onboarding'] as const

const ALL_PROTECTED: readonly string[] = [
  ...STAFF_ROUTE_PREFIXES,
  ...OTHER_PROTECTED_PREFIXES,
]

export function isProtectedPath(path: string): boolean {
  return ALL_PROTECTED.some((prefix) => path.startsWith(prefix))
}
