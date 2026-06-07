import type { UserRole } from '@/lib/auth/require-role'
import { safeNext } from '@/lib/auth/safe-next'

/**
 * Map an authenticated user's role to the path they should land on after a
 * successful sign-in or password set. Pure, synchronous, total over
 * UserRole | null — no I/O, no awaits.
 *
 * Clients always land on /portal regardless of any `next` query param (so a
 * shared link can't strand a client on /dashboard, the staff home). Staff
 * and owner land on a safeNext-validated `next` or fall back to /dashboard.
 * The helper owns the safeNext call; callers pass the raw `next` string.
 *
 * Closes C-4 — see docs/polish/auth-onboarding-client.md.
 */
export function postAuthLanding(
  role: UserRole | null,
  next: string,
): string {
  if (role === 'client') return '/portal'
  if (role === 'owner' || role === 'staff') return safeNext(next, '/dashboard')

  // Null role — the JWT carries no user_role claim. This is the stale-JWT
  // state: either the Custom Access Token Hook is disabled (Track A G-1
  // territory) or the JWT was issued before a user_organization_roles row
  // existed and has not been refreshed since (C-1 territory). Route to
  // /portal because the portal layout re-checks role on the next request
  // (portal/layout.tsx) and self-corrects — a freshly-claimed staff/owner
  // JWT is cross-redirected to /dashboard there, and a client whose claim
  // is still missing is routed onward to /unauthorized where C-1's R-5
  // recovery affordance can pick them up. /dashboard would instead
  // dead-end a stale-JWT client at /unauthorized via the staff-layout
  // requireRole gate, which is the failure mode C-4 is closing.
  return '/portal'
}
