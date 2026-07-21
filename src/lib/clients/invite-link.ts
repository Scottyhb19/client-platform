import 'server-only'

import type { createSupabaseServiceRoleClient } from '@/lib/supabase/server'

type AdminClient = ReturnType<typeof createSupabaseServiceRoleClient>

/**
 * Mint a Supabase accept URL for an invitee — extracted from
 * sendInviteForClient as part of C-14 mint-at-POST (migration
 * 20260721150000): the gate's POST action now calls this at tap time, so
 * the OTP link never exists before the human acts.
 *
 * Two paths, unchanged from the send-time original:
 *   (a) brand-new email → generateLink type 'invite' creates the auth.users
 *       row and returns a one-time accept URL;
 *   (b) email already registered (returning client, orphan from an archived
 *       row, …) → fall back to a 'magiclink' sign-in link. The downstream
 *       /welcome flow links clients.user_id either way via
 *       client_accept_invite.
 */
export async function mintAcceptLink(
  admin: AdminClient,
  email: string,
  redirectTo: string,
): Promise<{ link: string; error: null } | { link: null; error: string }> {
  const inviteResult = await admin.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { redirectTo },
  })
  if (inviteResult.data?.properties?.action_link) {
    return { link: inviteResult.data.properties.action_link, error: null }
  }
  if (isAlreadyRegisteredError(inviteResult.error)) {
    const magicResult = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo },
    })
    if (magicResult.data?.properties?.action_link) {
      return { link: magicResult.data.properties.action_link, error: null }
    }
    return {
      link: null,
      error: magicResult.error?.message ?? 'no link returned',
    }
  }
  return { link: null, error: inviteResult.error?.message ?? 'no link returned' }
}

/**
 * Detect Supabase's "user already exists" error from generateLink({ type: 'invite' }).
 *
 * Supabase has tightened the error shape over versions — newer responses
 * carry a `code: 'email_exists'` field; older ones only set the message.
 * Match both so the magic-link fallback survives an SDK upgrade.
 */
export function isAlreadyRegisteredError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: string; message?: string; status?: number }
  if (e.code === 'email_exists') return true
  const msg = e.message?.toLowerCase() ?? ''
  if (msg.includes('already been registered')) return true
  if (msg.includes('already registered')) return true
  if (msg.includes('user already exists')) return true
  return false
}
