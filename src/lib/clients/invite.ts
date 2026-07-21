import 'server-only'

import { logAuthEvent } from '@/lib/auth/events'
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
  // getPublicOrigin() keeps G-11's fail-loud posture at SEND time (a
  // misconfigured origin fails here, in front of the EP — not at the
  // client's tap). The /auth/callback redirectTo itself is rebuilt at mint
  // time by the gate's POST action (C-14 mint-at-POST).
  const origin = getPublicOrigin()

  // Step 1+2 (C-14 mint-at-POST, migration 20260721150000): no Supabase
  // link is generated here any more. The email carries only the short
  // /i/<id> gate URL; the gate's POST action mints the accept URL at the
  // human's tap (see src/app/i/[id]/actions.ts + src/lib/clients/
  // invite-link.ts). Send just records the token row — action_link NULL
  // means "not yet minted". Defeats Gmail's link prefetcher (the gate
  // renders a click-through button) AND body-parsing scanners (there is
  // no live OTP link anywhere until the human POSTs).
  const tokenInsert = await admin
    .from('invite_tokens')
    .insert({
      organization_id: args.organizationId,
      client_id: args.clientId,
      action_link: null,
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

  // Send succeeded. Refresh invited_at so the client profile's
  // "Last invite sent" reflects this send, and so the audit_clients
  // trigger lands an audit_log row for it (the trigger fires on any
  // UPDATE to clients; this is the audit mechanism for a resend).
  // Soft-fail: the email has already gone out, so a failure here must
  // NOT be reported as a send failure — that would prompt a resend and
  // double-email the client. Log and continue; the send succeeded.
  const { error: stampErr } = await admin
    .from('clients')
    .update({ invited_at: new Date().toISOString() })
    .eq('id', args.clientId)
  if (stampErr) {
    console.warn(
      `[invite] send succeeded but invited_at refresh failed: client=${args.clientId} err=${stampErr.message}`,
    )
  }

  // G-6: auth.invite.sent (docs/auth.md §11). Emitted here so every caller
  // (new-client invite AND profile resend) is covered by construction.
  await logAuthEvent('auth.invite.sent', {
    userId: args.sendingUserId,
    organizationId: args.organizationId,
    email: args.email,
    detail: { client_id: args.clientId },
  })

  return { error: null }
}
