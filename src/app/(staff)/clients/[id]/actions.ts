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
