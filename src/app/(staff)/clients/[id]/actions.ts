'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth/require-role'
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
