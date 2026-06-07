import 'server-only'

import { sendClientInviteEmail } from '@/lib/email/send-client-invite'
import { getPublicOrigin } from '@/lib/env/site-url'
import { checkAndRecordStaffInvite } from '@/lib/rate-limit'
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server'

export async function sendInviteForClient(args: {
  clientId: string
  organizationId: string
  sendingUserId: string
  firstName: string
  email: string
}): Promise<{ error: string | null }> {
  // Rate limit (C-6, docs/auth.md §7.2): 20 attempts per hour per
  // staff uid, all-attempts semantics. Placed at the TOP of the
  // sendInvite block so when C-5 extracts this block into a shared
  // helper for the Resend-invite UI, the rate-limit gate lifts out
  // cleanly with it and the resend action inherits the limit by
  // construction.
  const rl = await checkAndRecordStaffInvite(args.sendingUserId)
  if (!rl.underLimit) {
    const minutes = Math.max(1, Math.ceil(rl.secondsToReset / 60))
    return {
      error: `Too many invites sent. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    }
  }

  const admin = createSupabaseServiceRoleClient()
  // Anchor the outbound invite URLs to the env-configured canonical
  // origin, not to request headers (host / x-forwarded-proto). Matches
  // the G-11 fail-loud posture in signup/actions.ts and
  // forgot-password/actions.ts; closes the header-trust sibling that
  // G-11 did not reach.
  const origin = getPublicOrigin()
  const welcomeNext = `/welcome?client_id=${args.clientId}`
  const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(welcomeNext)}`

  // Step 1: create the auth user + accept URL without firing Supabase's
  // email. Two paths:
  //   (a) Brand-new email → 'invite' type creates the auth.users row and
  //       returns a one-time accept URL.
  //   (b) Email already in auth.users (returning client; orphan from a
  //       previously-archived clients row; etc.) → 'invite' fails with
  //       "already registered". Fall back to 'magiclink' which generates
  //       a sign-in link for the existing user. The downstream /welcome
  //       flow links the new clients.user_id either way via
  //       client_accept_invite.
  let acceptUrl: string | null = null
  {
    const inviteResult = await admin.auth.admin.generateLink({
      type: 'invite',
      email: args.email,
      options: { redirectTo },
    })
    if (inviteResult.data?.properties?.action_link) {
      acceptUrl = inviteResult.data.properties.action_link
    } else if (isAlreadyRegisteredError(inviteResult.error)) {
      // Existing user — switch to magic-link sign-in. Same redirect target.
      const magicResult = await admin.auth.admin.generateLink({
        type: 'magiclink',
        email: args.email,
        options: { redirectTo },
      })
      if (magicResult.data?.properties?.action_link) {
        acceptUrl = magicResult.data.properties.action_link
      } else {
        return {
          error: `Client saved, but the sign-in link could not be generated: ${
            magicResult.error?.message ?? 'no link returned'
          }. You can resend from the client profile.`,
        }
      }
    } else {
      return {
        error: `Client saved, but the invite link could not be generated: ${
          inviteResult.error?.message ?? 'no link returned'
        }. You can resend from the client profile.`,
      }
    }
  }

  // Step 2: stash the action_link behind a short id and email THAT
  // instead. Defeats Gmail's link prefetcher: the email body now points
  // at /i/<id> on our domain, which renders a click-through button —
  // a prefetcher hits the page, sees no redirect, stops. The Supabase
  // verify URL only fires when the human taps. See migration
  // 20260426100000_invite_tokens.sql for table + RLS detail.
  const tokenInsert = await admin
    .from('invite_tokens')
    .insert({
      organization_id: args.organizationId,
      client_id: args.clientId,
      action_link: acceptUrl,
    })
    .select('id')
    .single()
  if (tokenInsert.error || !tokenInsert.data) {
    return {
      error: `Client saved, but the invite link could not be stored: ${
        tokenInsert.error?.message ?? 'no row returned'
      }. You can resend from the client profile.`,
    }
  }
  const tokenId = tokenInsert.data.id
  const gateUrl = `${origin}/i/${tokenId}`

  // Step 3: pull the practice + practitioner names so the email reads
  // human. Both fall back to gentle defaults — we never block the
  // invite send on a missing display name.
  const [{ data: org }, { data: prof }] = await Promise.all([
    admin
      .from('organizations')
      .select('name')
      .eq('id', args.organizationId)
      .maybeSingle(),
    admin
      .from('user_profiles')
      .select('first_name, last_name')
      .eq('user_id', args.sendingUserId)
      .maybeSingle(),
  ])
  const practiceName = org?.name?.trim() || 'your practice'
  const practitionerName = [prof?.first_name, prof?.last_name]
    .filter((s): s is string => Boolean(s?.trim()))
    .join(' ')
    .trim() || 'Your practitioner'

  // Step 4: send. Soft-fail mirrors the original behaviour — clients
  // row stays, EP can resend. The acceptUrl in the email is the short
  // gate URL, not the raw Supabase verify link.
  const { error: emailErr } = await sendClientInviteEmail({
    to: args.email,
    firstName: args.firstName,
    practiceName,
    practitionerName,
    acceptUrl: gateUrl,
  })
  if (emailErr) {
    return {
      error: `Client saved, but invite email failed: ${emailErr}. You can resend from the client profile.`,
    }
  }

  return { error: null }
}

/**
 * Detect Supabase's "user already exists" error from generateLink({ type: 'invite' }).
 *
 * Supabase has tightened the error shape over versions — newer responses
 * carry a `code: 'email_exists'` field; older ones only set the message.
 * Match both so the magic-link fallback survives an SDK upgrade.
 */
function isAlreadyRegisteredError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: string; message?: string; status?: number }
  if (e.code === 'email_exists') return true
  const msg = e.message?.toLowerCase() ?? ''
  if (msg.includes('already been registered')) return true
  if (msg.includes('already registered')) return true
  if (msg.includes('user already exists')) return true
  return false
}
