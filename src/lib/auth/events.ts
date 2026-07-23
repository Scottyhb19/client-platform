import { headers } from 'next/headers'

import { createSupabaseServiceRoleClient } from '@/lib/supabase/server'
import { captureException } from '@/lib/observability/sentry'

/**
 * G-6 — structured auth-event audit log (docs/auth.md §11; migration
 * 20260721140000). Server-side only: the auth_events table has no API-role
 * access, so every write goes through the service-role client here.
 *
 * Best-effort by design: an audit write must NEVER block or fail an auth
 * flow. Failures route through the captureException observability seam —
 * the same seam src/lib/comms/log.ts uses — so when the real Sentry SDK
 * lands, audit-write misses alert alongside comms-log misses (G-6 register
 * B-4, closed 2026-07-23). Still swallowed: never rethrown.
 */
export type AuthEventName =
  | 'auth.signup.success'
  | 'auth.signup.failure'
  | 'auth.login.success'
  | 'auth.login.failure'
  | 'auth.password_reset.requested'
  | 'auth.password_reset.completed'
  | 'auth.invite.sent'
  | 'auth.invite.accepted'
  | 'auth.jwt.hook_failure'
  | 'auth.cross_tenant_access_attempt'

/**
 * Requesting client IP, best-effort (G-6 register F-2b — feeds the auth.md
 * §11 per-IP login-failure threshold, so provenance matters: a
 * caller-controlled value would let an attacker spread failures across
 * forged IPs or frame a victim's IP).
 *
 * x-vercel-forwarded-for is the platform-attested value: Vercel stamps it
 * and it is NOT affected by a proxy placed in front of Vercel, unlike
 * x-forwarded-for (vercel.com/docs/headers/request-headers, verified
 * 2026-07-23). The fallbacks matter only off-Vercel (local dev): Vercel
 * overwrites x-forwarded-for and "do[es] not forward external IPs" (only
 * the Enterprise Trusted Proxy add-on changes that), so on this deployment
 * the first hop is Vercel-attested too — but the platform header is
 * preferred so a future proxy-in-front change cannot silently poison the
 * threshold. Returns null outside request scope (scripts) or when no header
 * is present (localhost may still yield ::1 via the dev server). Never
 * throws.
 */
async function requestClientIp(): Promise<string | null> {
  try {
    const h = await headers()
    const attested = h.get('x-vercel-forwarded-for')?.trim()
    if (attested) return attested
    const first = h.get('x-forwarded-for')?.split(',')[0]?.trim()
    return first || h.get('x-real-ip') || null
  } catch {
    return null
  }
}

export async function logAuthEvent(
  event: AuthEventName,
  fields: {
    userId?: string | null
    organizationId?: string | null
    email?: string | null
    detail?: Record<string, unknown>
  } = {},
): Promise<void> {
  try {
    const svc = createSupabaseServiceRoleClient()
    const { error } = await svc.from('auth_events').insert({
      event,
      user_id: fields.userId ?? null,
      organization_id: fields.organizationId ?? null,
      // F-1: survives org teardown (the FK column is ON DELETE SET NULL).
      organization_id_snapshot: fields.organizationId ?? null,
      email: fields.email ?? null,
      client_ip: await requestClientIp(),
      detail: (fields.detail ?? {}) as never,
    })
    if (error) {
      captureException(
        new Error(`auth-events write failed: ${error.message}`),
        { where: 'auth-events:insert', event },
      )
    }
  } catch (e) {
    captureException(e, { where: 'auth-events:insert', event })
  }
}
