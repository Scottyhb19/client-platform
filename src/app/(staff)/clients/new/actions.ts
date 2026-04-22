'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth/require-role'
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
  const { organizationId } = await requireRole(['owner', 'staff'])

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

  // If the EP opted in, send the real invite email via Supabase Admin API.
  // Per /docs/auth.md §5.3 this is the service-role bridge — it creates
  // (or finds) the auth.users row and dispatches the magic link. The
  // email's redirect lands on /auth/callback?token_hash=...&next=/welcome
  // where the new user sets a password + we link the clients.user_id.
  if (sendInvite) {
    const admin = await createSupabaseServiceRoleClient()
    const host = (await headers()).get('host') ?? 'localhost:3000'
    const proto =
      (await headers()).get('x-forwarded-proto') ??
      (host.startsWith('localhost') ? 'http' : 'https')
    const welcomeNext = `/welcome?client_id=${data.id}`
    const redirectTo = `${proto}://${host}/auth/callback?next=${encodeURIComponent(welcomeNext)}`

    const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
      email,
      { redirectTo },
    )
    if (inviteErr) {
      // Soft-fail: the clients row is saved. Surface the error so the
      // EP can resend. Don't roll back — re-inviting is cheaper than
      // re-entering details.
      return {
        error: `Client saved, but invite email failed: ${inviteErr.message}. You can resend from the client profile.`,
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
