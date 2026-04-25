'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth/require-role'
import { sendClientInviteEmail } from '@/lib/email/send-client-invite'
import {
  createSupabaseServerClient,
  createSupabaseServiceRoleClient,
} from '@/lib/supabase/server'
import type { InviteClientState } from './types'

/**
 * Server action for the "Invite a client" form.
 *
 * Creates a `clients` row scoped to the caller's organization (RLS
 * enforces this — we pass the org id explicitly because the INSERT
 * policy requires a WITH CHECK match).
 *
 * The actual Supabase auth admin invite (magic link email) is NOT
 * called here yet: the /welcome landing page for accepting an invite
 * hasn't been built, so sending real emails would dead-end the client.
 * When /welcome lands we wire `supabase.auth.admin.inviteUserByEmail`
 * per /docs/auth.md §5.3 and flip this behind the `sendInvite` flag.
 */
export async function inviteClientAction(
  _prev: InviteClientState,
  formData: FormData,
): Promise<InviteClientState> {
  const { userId, email: callerEmail, organizationId } = await requireRole(['owner', 'staff'])

  const firstName = (formData.get('first_name') ?? '').toString().trim()
  const lastName = (formData.get('last_name') ?? '').toString().trim()
  const email = (formData.get('email') ?? '').toString().trim().toLowerCase()
  const phone = toNullable(formData.get('phone'))
  const dob = toNullable(formData.get('dob'))
  const categoryId = toNullable(formData.get('category_id'))
  const referralSource = toNullable(formData.get('referral_source'))
  const sendInvite = formData.get('send_invite') === 'on'

  const fieldErrors: InviteClientState['fieldErrors'] = {}
  if (!firstName) fieldErrors.first_name = 'Required.'
  if (!lastName) fieldErrors.last_name = 'Required.'
  if (!email) {
    fieldErrors.email = 'Required.'
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fieldErrors.email = 'Not a valid email address.'
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors }
  }

  // Owner-as-client guard: a practitioner inviting themselves (or another
  // staffer in the same practice) is logically nonsensical — clients are a
  // distinct role and the auth model can't hold both for the same email.
  // Catch it here with a friendly under-field message instead of letting
  // the magic-link flow fail confusingly downstream.
  if (email === callerEmail.toLowerCase()) {
    return {
      error: null,
      fieldErrors: {
        email:
          "You can't invite your own email as a client. Use a different address.",
      },
    }
  }

  // Cross-staff check: any other owner/staff in THIS org with this email.
  // user_profiles doesn't carry email (it lives on auth.users), so we
  // scope by user_organization_roles first and resolve emails via the
  // admin API. The role filter + same-org filter keeps this tiny — for a
  // solo practice this is one cheap query that returns no rows.
  // We DON'T check other organisations: a client legitimately can be a
  // practitioner elsewhere. We DON'T check existing auth.users either:
  // the magic-link fallback already handles a stand-alone existing user.
  const admin = createSupabaseServiceRoleClient()
  const { data: peerRoles } = await admin
    .from('user_organization_roles')
    .select('user_id')
    .eq('organization_id', organizationId)
    .in('role', ['owner', 'staff'])
    .neq('user_id', userId)

  for (const r of peerRoles ?? []) {
    const { data: u } = await admin.auth.admin.getUserById(r.user_id)
    if (u?.user?.email?.toLowerCase() === email) {
      return {
        error: null,
        fieldErrors: {
          email:
            'This email belongs to a practitioner in your practice. Clients need a separate email.',
        },
      }
    }
  }

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('clients')
    .insert({
      organization_id: organizationId,
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      dob,
      category_id: categoryId,
      referral_source: referralSource,
      invited_at: sendInvite ? new Date().toISOString() : null,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') {
      return {
        error: null,
        fieldErrors: {
          email: 'A client with this email already exists in your practice.',
        },
      }
    }
    return {
      error: `Failed to create client: ${error.message}`,
      fieldErrors: {},
    }
  }

  // If the EP opted in, send our own invite email via Resend rather than
  // Supabase's default magic-link email. Two reasons: (1) the email looks
  // like it came from the practice, not "Supabase"; (2) we steer the
  // client to install the PWA on their phone, which the default template
  // can't do. Sequence:
  //   1. admin.generateLink({ type: 'invite' })  — creates auth.users
  //      row + a one-time accept URL, WITHOUT sending Supabase's email.
  //   2. We POST a custom Resend email containing that URL.
  // The accept URL still routes through /auth/callback, which exchanges
  // the token for a session and forwards to /welcome → /welcome/install.
  if (sendInvite) {
    const admin = createSupabaseServiceRoleClient()
    const host = (await headers()).get('host') ?? 'localhost:3000'
    const proto =
      (await headers()).get('x-forwarded-proto') ??
      (host.startsWith('localhost') ? 'http' : 'https')
    const welcomeNext = `/welcome?client_id=${data.id}`
    const redirectTo = `${proto}://${host}/auth/callback?next=${encodeURIComponent(welcomeNext)}`

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
        email,
        options: { redirectTo },
      })
      if (inviteResult.data?.properties?.action_link) {
        acceptUrl = inviteResult.data.properties.action_link
      } else if (isAlreadyRegisteredError(inviteResult.error)) {
        // Existing user — switch to magic-link sign-in. Same redirect target.
        const magicResult = await admin.auth.admin.generateLink({
          type: 'magiclink',
          email,
          options: { redirectTo },
        })
        if (magicResult.data?.properties?.action_link) {
          acceptUrl = magicResult.data.properties.action_link
        } else {
          return {
            error: `Client saved, but the sign-in link could not be generated: ${
              magicResult.error?.message ?? 'no link returned'
            }. You can resend from the client profile.`,
            fieldErrors: {},
          }
        }
      } else {
        return {
          error: `Client saved, but the invite link could not be generated: ${
            inviteResult.error?.message ?? 'no link returned'
          }. You can resend from the client profile.`,
          fieldErrors: {},
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
        organization_id: organizationId,
        client_id: data.id,
        action_link: acceptUrl,
      })
      .select('id')
      .single()
    if (tokenInsert.error || !tokenInsert.data) {
      return {
        error: `Client saved, but the invite link could not be stored: ${
          tokenInsert.error?.message ?? 'no row returned'
        }. You can resend from the client profile.`,
        fieldErrors: {},
      }
    }
    const tokenId = tokenInsert.data.id
    const gateUrl = `${proto}://${host}/i/${tokenId}`

    // Step 3: pull the practice + practitioner names so the email reads
    // human. Both fall back to gentle defaults — we never block the
    // invite send on a missing display name.
    const [{ data: org }, { data: prof }] = await Promise.all([
      admin
        .from('organizations')
        .select('name')
        .eq('id', organizationId)
        .maybeSingle(),
      admin
        .from('user_profiles')
        .select('first_name, last_name')
        .eq('user_id', userId)
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
      to: email,
      firstName,
      practiceName,
      practitionerName,
      acceptUrl: gateUrl,
    })
    if (emailErr) {
      return {
        error: `Client saved, but invite email failed: ${emailErr}. You can resend from the client profile.`,
        fieldErrors: {},
      }
    }
  }

  revalidatePath('/clients')
  redirect(`/clients/${data.id}`)
}

function toNullable(value: FormDataEntryValue | null): string | null {
  if (value === null) return null
  const s = value.toString().trim()
  return s.length === 0 ? null : s
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
