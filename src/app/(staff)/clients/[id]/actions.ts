'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth/require-role'
import { sendInviteForClient } from '@/lib/clients/invite'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Archive a client.
 *
 * "Archive" not "delete": clinical records have retention obligations under
 * the Australian Privacy Principles + AHPRA record-keeping rules (typically
 * 7 years post-last-contact). The row stays in the database; the
 * soft_delete_client RPC sets deleted_at and archived_at so:
 *
 *   - The active client list (filtered by deleted_at IS NULL) hides them.
 *   - The partial unique index `clients_org_email_unique` releases the
 *     email so the same address can be re-invited later.
 *   - Audit log + clinical_notes etc. remain joinable for compliance.
 *
 * Routes through the soft_delete_client SECURITY DEFINER RPC (migration
 * 20260429130000). Direct UPDATE setting deleted_at fails 42501 because
 * the SELECT policy filters deleted_at IS NULL; the RPC bypasses RLS
 * for the UPDATE and re-implements the org+role check inside.
 */
export async function archiveClientAction(
  clientId: string,
): Promise<{ error: string | null }> {
  const { organizationId, role } = await requireRole(['owner', 'staff'])

  // Confirm the target row belongs to the caller's org via the user-scoped
  // (RLS-respecting) client. Lets us short-circuit on already-archived
  // (idempotent redirect) before invoking the RPC.
  const supabase = await createSupabaseServerClient()
  const { data: target } = await supabase
    .from('clients')
    .select('id, organization_id, deleted_at')
    .eq('id', clientId)
    .maybeSingle()

  if (!target) {
    return { error: 'Client not found in your practice.' }
  }
  if (target.deleted_at) {
    // Idempotent: already archived. Just bounce back to the list.
    revalidatePath('/clients')
    redirect('/clients')
  }

  const { error: archiveErr } = await supabase.rpc('soft_delete_client', {
    p_id: clientId,
  })

  if (archiveErr) {
    return { error: `Couldn't archive client: ${archiveErr.message}` }
  }

  console.info(
    `[archive] client=${clientId} by=${role} org=${organizationId} at=${new Date().toISOString()}`,
  )

  revalidatePath('/clients')
  revalidatePath(`/clients/${clientId}`)
  redirect('/clients')
}

export type UpdateClientDetailsInput = {
  clientId: string
  /** Last-read clients.version, threaded through for OCC. */
  version: number
  firstName: string
  lastName: string
  phone: string
  /** 'YYYY-MM-DD' or '' for none. */
  dob: string
  sex: string
  address: string
  categoryId: string | null
  referralSource: string
  referredBy: string
  emergencyContactName: string
  emergencyContactPhone: string
}

const OCC_CONFLICT_MESSAGE =
  'These details changed since you opened the form — close it and reopen to load the latest.'

/**
 * CN-5 — edit a client's personal details and goals.
 *
 * Email is deliberately NOT editable here: it is the invite/login identity
 * (client_accept_invite matches on it; the C-12 sync keyed off it). A
 * proper email-change flow is its own future gap.
 *
 * OCC via clients.version (pre-check + version-scoped UPDATE; the
 * bump_version_and_touch trigger ticks it on every write). The UPDATE goes
 * through RLS ("staff update clients in own org"); the cross-org category
 * guard (clients_enforce_category_org) and the dob/name CHECKs back up the
 * app-side validation at the DB layer.
 *
 * Name edits on an onboarded client propagate to user_profiles via the
 * sync_client_profile_name SECURITY DEFINER RPC (20260611130000) — the
 * user_profiles UPDATE policy is self-only, so a direct UPDATE from a
 * staff session would be silently filtered to zero rows.
 */
export async function updateClientDetailsAction(
  input: UpdateClientDetailsInput,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])

  const firstName = input.firstName.trim()
  const lastName = input.lastName.trim()
  if (firstName.length < 1 || firstName.length > 100) {
    return { error: 'First name is required (1–100 characters).' }
  }
  if (lastName.length < 1 || lastName.length > 100) {
    return { error: 'Last name is required (1–100 characters).' }
  }

  // Mirrors the clients_dob_sane CHECK (1900-01-01 .. today).
  let dob: string | null = null
  const rawDob = input.dob.trim()
  if (rawDob !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDob)) {
      return { error: 'Date of birth must be a valid date.' }
    }
    const today = new Date().toISOString().slice(0, 10)
    if (rawDob < '1900-01-01' || rawDob > today) {
      return { error: 'Date of birth must be between 1900 and today.' }
    }
    dob = rawDob
  }

  // Optional free-text fields: trimmed, empty saves as NULL (consistent
  // with how /clients/new writes them).
  const clean = (s: string): string | null => {
    const t = s.trim()
    return t.length > 0 ? t : null
  }

  const supabase = await createSupabaseServerClient()

  // RLS-gated read: missing, cross-org, and archived clients all surface
  // identically as not-found. Carries user_id + current names for the
  // portal-sync decision and version for the OCC pre-check.
  const { data: target } = await supabase
    .from('clients')
    .select('id, version, user_id, first_name, last_name')
    .eq('id', input.clientId)
    .maybeSingle()

  if (!target) {
    return { error: 'Client not found in your practice.' }
  }
  if (target.version !== input.version) {
    return { error: OCC_CONFLICT_MESSAGE }
  }

  const { data: updated, error: updateErr } = await supabase
    .from('clients')
    .update({
      first_name: firstName,
      last_name: lastName,
      phone: clean(input.phone),
      dob,
      sex: clean(input.sex),
      address: clean(input.address),
      category_id: input.categoryId,
      referral_source: clean(input.referralSource),
      referred_by: clean(input.referredBy),
      emergency_contact_name: clean(input.emergencyContactName),
      emergency_contact_phone: clean(input.emergencyContactPhone),
    })
    .eq('id', input.clientId)
    .eq('version', input.version)
    .select('id')

  if (updateErr) {
    return { error: `Could not save details: ${updateErr.message}` }
  }
  if (!updated || updated.length === 0) {
    // Raced past the pre-check — same record saved from a second tab
    // between our read and our write.
    return { error: OCC_CONFLICT_MESSAGE }
  }

  // Keep the 1:1 portal profile in step when the client has onboarded.
  // Skipped when the name didn't change — the only fields user_profiles
  // mirrors.
  const nameChanged =
    firstName !== target.first_name || lastName !== target.last_name
  if (nameChanged && target.user_id) {
    const { error: syncErr } = await supabase.rpc('sync_client_profile_name', {
      p_client_id: input.clientId,
    })
    if (syncErr) {
      // The clinical record saved; only the portal mirror is behind.
      // Surface it honestly — a re-save retries the sync.
      return {
        error: `Details saved, but the portal profile name could not be updated (${syncErr.message}). Save again to retry.`,
      }
    }
  }

  revalidatePath('/clients')
  revalidatePath(`/clients/${input.clientId}`)
  return { error: null }
}

/**
 * Edit a client's goals in isolation — the Profile tab's Goals card has its
 * own edit dialog, separate from the Contact "Edit details" form. Goals lives
 * on `clients`, so it shares the OCC version with the details edit; both write
 * `clients` and bump the same version, but they never co-edit (separate
 * dialogs), so a stale-version save surfaces the standard OCC message.
 */
export async function updateClientGoalsAction(input: {
  clientId: string
  version: number
  goals: string
}): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])

  const supabase = await createSupabaseServerClient()

  const { data: target } = await supabase
    .from('clients')
    .select('id, version')
    .eq('id', input.clientId)
    .maybeSingle()

  if (!target) {
    return { error: 'Client not found in your practice.' }
  }
  if (target.version !== input.version) {
    return { error: OCC_CONFLICT_MESSAGE }
  }

  const trimmed = input.goals.trim()
  const { data: updated, error: updateErr } = await supabase
    .from('clients')
    .update({ goals: trimmed.length > 0 ? trimmed : null })
    .eq('id', input.clientId)
    .eq('version', input.version)
    .select('id')

  if (updateErr) {
    return { error: `Could not save goals: ${updateErr.message}` }
  }
  if (!updated || updated.length === 0) {
    return { error: OCC_CONFLICT_MESSAGE }
  }

  revalidatePath(`/clients/${input.clientId}`)
  return { error: null }
}

/**
 * Resend a client's invite (C-5, closes F-5).
 *
 * Surfaced on the client profile when the client is pre-onboarding
 * (user_id IS NULL) and an invite was previously sent (invited_at IS NOT
 * NULL). The button's visibility is computed server-side in page.tsx, but
 * this action re-enforces every precondition: the endpoint is callable
 * directly regardless of whether the button renders.
 *
 * Authorization is two-layered. The cookie-scoped read below is RLS-gated
 * to the caller's org (policy "select clients in own org": organization_id
 * matches AND deleted_at IS NULL AND role in owner/staff), so a missing,
 * cross-org, or archived client all surface identically as not-found. The
 * explicit organization_id assertion that follows is redundant under that
 * RLS *by design* — it is a defense-in-depth backstop on the cross-tenant
 * surface (R-4), retained deliberately so a future RLS regression cannot
 * silently open a cross-org resend. Do NOT remove it as dead code.
 *
 * No deleted_at gate: archived clients are filtered by the SELECT policy
 * and surface as not-found above, so the gate would be unreachable.
 *
 * The send itself (rate-gate, link generation, token, Resend send, and the
 * invited_at refresh that lands the audit_log row via the audit_clients
 * trigger) is owned by sendInviteForClient. This action authorizes, then
 * delegates; it does not reach around the helper.
 */
export async function resendInviteAction(
  clientId: string,
): Promise<{ error: string | null }> {
  const { userId, organizationId, role } = await requireRole(['owner', 'staff'])

  const supabase = await createSupabaseServerClient()
  const { data: target } = await supabase
    .from('clients')
    .select('id, organization_id, user_id, invited_at, email, first_name')
    .eq('id', clientId)
    .maybeSingle()

  if (!target) {
    return { error: 'Client not found in your practice.' }
  }

  // Defense-in-depth on the cross-tenant surface — redundant under the
  // SELECT RLS by design; retained as a backstop. Do not remove.
  if (target.organization_id !== organizationId) {
    return { error: 'Client not found in your practice.' }
  }

  if (target.user_id) {
    return { error: 'This client has already accepted their invite.' }
  }

  if (!target.invited_at) {
    return { error: 'No invite has been sent to this client yet.' }
  }

  const result = await sendInviteForClient({
    clientId,
    organizationId: target.organization_id,
    sendingUserId: userId,
    firstName: target.first_name,
    email: target.email,
  })

  if (result.error) {
    return { error: result.error }
  }

  console.info(
    `[resend-invite] client=${clientId} by=${role} org=${organizationId} at=${new Date().toISOString()}`,
  )

  revalidatePath('/clients')
  revalidatePath(`/clients/${clientId}`)

  return { error: null }
}
