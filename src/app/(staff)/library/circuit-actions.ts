'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Server actions for the Library Circuits tab (C-4).
 * The circuit ENGINE (save_group_as_circuit / insert_circuit_into_day, both in
 * the session builder) lives in 20260624110000; these are the management
 * actions the Library surfaces — rename + soft-delete. Mirrors
 * program-template-actions.ts.
 */

/**
 * C-4 delete — soft-delete a circuit via the SECURITY DEFINER RPC
 * (20260624110000). A direct UPDATE setting deleted_at fails 42501 against the
 * deleted_at-IS-NULL SELECT policy; the RPC bypasses RLS for the UPDATE and
 * re-checks org/role in-body. Already-placed instances are independent copies,
 * unaffected (copy-on-apply).
 */
export async function deleteCircuitAction(
  circuitId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('soft_delete_circuit', { p_id: circuitId })

  if (error) return { error: `Delete failed: ${error.message}` }

  revalidatePath('/library')
  return { error: null }
}

/**
 * C-4 rename — a direct UPDATE of `name` is safe under RLS (the staff UPDATE
 * policy lets owner/staff write their org's live rows, and we're not touching
 * deleted_at). Case-insensitive duplicate-name guard mirrors
 * save_group_as_circuit's in-RPC guard.
 */
export async function renameCircuitAction(
  circuitId: string,
  rawName: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])

  const name = rawName.trim()
  if (name.length === 0 || name.length > 80) {
    return { error: 'Circuit name must be 1–80 characters.' }
  }

  const supabase = await createSupabaseServerClient()

  // Duplicate-name guard (case-insensitive), excluding this circuit. RLS scopes
  // the read to the caller's org, so we don't filter org explicitly.
  const { data: clash, error: clashErr } = await supabase
    .from('circuits')
    .select('id')
    .ilike('name', name)
    .is('deleted_at', null)
    .neq('id', circuitId)
    .limit(1)
    .maybeSingle()

  if (clashErr) return { error: `Rename failed: ${clashErr.message}` }
  if (clash) return { error: `A circuit called "${name}" already exists.` }

  // .select('id') so a zero-row match (deleted elsewhere / RLS) surfaces as an
  // error instead of a silent fake success.
  const { data: updated, error } = await supabase
    .from('circuits')
    .update({ name })
    .eq('id', circuitId)
    .is('deleted_at', null)
    .select('id')

  if (error) return { error: `Rename failed: ${error.message}` }
  if (!updated || updated.length === 0) {
    return { error: 'This circuit no longer exists — it may have been deleted.' }
  }

  revalidatePath('/library')
  return { error: null }
}
