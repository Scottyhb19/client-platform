'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export type ApplyTemplateResult =
  | { status: 'created'; clientId: string }
  | { status: 'overlap' }
  | { error: string }

/**
 * LPT-4 + per-day-dates (2026-06-24) — instantiate a template as a new active
 * program for a client, with an EXPLICIT date per day (dayDates: template_day_id
 * → 'YYYY-MM-DD'). Wraps create_program_from_template_on_dates so the EP picks
 * each day's real date rather than one start date + auto weekday-offset.
 * Date-range collisions with an existing active block return status='overlap'.
 */
export async function applyProgramTemplateAction(
  templateId: string,
  clientId: string,
  dayDates: Record<string, string>,
): Promise<ApplyTemplateResult> {
  await requireRole(['owner', 'staff'])

  if (!clientId) return { error: 'Pick a client.' }
  const entries = Object.entries(dayDates)
  if (entries.length === 0) return { error: 'Pick a date for every day.' }
  for (const [, d] of entries) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { error: 'Pick a date for every day.' }
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('create_program_from_template_on_dates', {
    p_template_id: templateId,
    p_client_id: clientId,
    p_day_dates: dayDates,
  })

  if (error) return { error: `Couldn't apply the template: ${error.message}` }

  const obj = (data ?? {}) as { status?: string }
  if (obj.status === 'overlap') return { status: 'overlap' }
  if (obj.status === 'created') {
    revalidatePath(`/clients/${clientId}/program`)
    return { status: 'created', clientId }
  }
  return { error: `Unexpected response: ${obj.status ?? 'unknown'}` }
}

/**
 * Server actions for the Library Programs tab (program templates).
 * LPT-5 (rename) + LPT-6 (delete) of docs/polish/library-program-templates.md.
 *
 * The template ENGINE (save_program_as_template / create_program_from_template)
 * already exists; these are the management actions the Library surfaces.
 */

/**
 * LPT-6 — soft-delete a program template via the SECURITY DEFINER RPC
 * (20260623130000). Direct UPDATE setting deleted_at fails 42501 against the
 * deleted_at-IS-NULL SELECT policy; the RPC bypasses RLS for the UPDATE and
 * re-checks org/role in-body. Children are left intact; programs instantiated
 * from the template keep their template_id (ON DELETE SET NULL never fires on
 * a soft delete).
 */
export async function deleteProgramTemplateAction(
  templateId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('soft_delete_program_template', {
    p_id: templateId,
  })

  if (error) return { error: `Delete failed: ${error.message}` }

  revalidatePath('/library')
  return { error: null }
}

/**
 * LPT-5 — rename a template. A direct UPDATE of `name` (not `deleted_at`) is
 * safe under RLS — the staff UPDATE policy lets owner/staff write their org's
 * live rows, and we're not touching the soft-delete column. Mirrors the
 * duplicate-name guard `save_program_as_template` uses (names are unique by
 * convention, enforced in the app, not a DB constraint).
 */
export async function renameProgramTemplateAction(
  templateId: string,
  rawName: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])

  const name = rawName.trim()
  if (name.length === 0 || name.length > 200) {
    return { error: 'Template name must be 1–200 characters.' }
  }

  const supabase = await createSupabaseServerClient()

  // Duplicate-name guard (case-insensitive), excluding this template. RLS
  // scopes the read to the caller's org, so we don't filter org explicitly.
  const { data: clash, error: clashErr } = await supabase
    .from('program_templates')
    .select('id')
    .ilike('name', name)
    .is('deleted_at', null)
    .neq('id', templateId)
    .limit(1)
    .maybeSingle()

  if (clashErr) return { error: `Rename failed: ${clashErr.message}` }
  if (clash) return { error: `A template called "${name}" already exists.` }

  // .select('id') so a zero-row match (deleted elsewhere / RLS) surfaces as an
  // error instead of a silent fake success.
  const { data: updated, error } = await supabase
    .from('program_templates')
    .update({ name })
    .eq('id', templateId)
    .is('deleted_at', null)
    .select('id')

  if (error) return { error: `Rename failed: ${error.message}` }
  if (!updated || updated.length === 0) {
    return { error: 'This template no longer exists — it may have been deleted.' }
  }

  revalidatePath('/library')
  return { error: null }
}
