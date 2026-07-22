import { createSupabaseServiceRoleClient } from '@/lib/supabase/server'

/**
 * G-6 — structured auth-event audit log (docs/auth.md §11; migration
 * 20260721140000). Server-side only: the auth_events table has no API-role
 * access, so every write goes through the service-role client here.
 *
 * Best-effort by design: an audit write must NEVER block or fail an auth
 * flow. Failures are logged server-side (the same posture as the §12 P1-3
 * send-failure seam) and swallowed.
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
      email: fields.email ?? null,
      detail: (fields.detail ?? {}) as never,
    })
    if (error) {
      console.error(`[auth-events] ${event} write failed: ${error.message}`)
    }
  } catch (e) {
    console.error(`[auth-events] ${event} write threw:`, e)
  }
}
