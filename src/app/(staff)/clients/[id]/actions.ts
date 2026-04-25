'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth/require-role'
import {
  createSupabaseServerClient,
  createSupabaseServiceRoleClient,
} from '@/lib/supabase/server'

/**
 * Archive a client.
 *
 * "Archive" not "delete": clinical records have retention obligations under
 * the Australian Privacy Principles + AHPRA record-keeping rules (typically
 * 7 years post-last-contact). The row stays in the database; we set
 * deleted_at and archived_at so:
 *
 *   - The active client list (filtered by deleted_at IS NULL) hides them.
 *   - The partial unique index `clients_org_email_unique` releases the
 *     email so the same address can be re-invited later.
 *   - Audit log + clinical_notes etc. remain joinable for compliance.
 *
 * We bypass RLS via the service-role client because the SELECT policy
 * filters on deleted_at IS NULL — once we set it, PostgREST's RETURNING
 * would yield no row and the call would error (the documented soft-delete
 * RLS gotcha). Authorization is enforced explicitly: we re-check that the
 * caller is staff/owner in the same org as the client before writing.
 */
export async function archiveClientAction(
  clientId: string,
): Promise<{ error: string | null }> {
  const { organizationId, role } = await requireRole(['owner', 'staff'])

  // Confirm the target row belongs to the caller's org via the user-scoped
  // (RLS-respecting) client. If it doesn't, RLS already returns null.
  const supabase = await createSupabaseServerClient()
  const { data: target } = await supabase
    .from('clients')
    .select('id, organization_id, deleted_at')
    .eq('id', clientId)
    .maybeSingle()

  if (!target) {
    return { error: 'Client not found in your practice.' }
  }
  if (target.organization_id !== organizationId) {
    // Defence-in-depth — RLS should have hidden this already.
    return { error: 'Not authorised to archive this client.' }
  }
  if (target.deleted_at) {
    // Idempotent: already archived. Just bounce back to the list.
    revalidatePath('/clients')
    redirect('/clients')
  }

  // Service-role write to dodge the soft-delete RETURNING gotcha.
  const admin = await createSupabaseServiceRoleClient()
  const now = new Date().toISOString()
  const { error: archiveErr } = await admin
    .from('clients')
    .update({ deleted_at: now, archived_at: now })
    .eq('id', clientId)

  if (archiveErr) {
    return { error: `Couldn't archive client: ${archiveErr.message}` }
  }

  // Audit-log style breadcrumb so we can see who archived what + when.
  // The audit_log triggers fire automatically on UPDATE — no extra insert
  // needed here. Just a server log line for the dev console.
  console.info(
    `[archive] client=${clientId} by=${role} org=${organizationId} at=${now}`,
  )

  revalidatePath('/clients')
  revalidatePath(`/clients/${clientId}`)
  redirect('/clients')
}
