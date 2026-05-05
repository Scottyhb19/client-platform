'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { SettingsState } from './_state'

/* ====================== Practice info ====================== */

export async function updatePracticeInfoAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const { organizationId } = await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const name = (formData.get('name') ?? '').toString().trim()
  if (!name) {
    return { error: 'Practice name is required.', success: false }
  }

  const payload = {
    name,
    email: nullable(formData.get('email')),
    phone: nullable(formData.get('phone')),
    address: nullable(formData.get('address')),
    abn: nullable(formData.get('abn')),
    provider_number: nullable(formData.get('provider_number')),
    timezone:
      (formData.get('timezone') ?? '').toString().trim() ||
      'Australia/Sydney',
  }

  const { error } = await supabase
    .from('organizations')
    .update(payload)
    .eq('id', organizationId)

  if (error) return { error: `Save failed: ${error.message}`, success: false }

  revalidatePath('/settings')
  return { error: null, success: true }
}

/* ====================== Notifications ====================== */

export async function updateNotificationsAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const { organizationId } = await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const emailOn = formData.get('email_notifications_enabled') === 'on'
  const smsOn = formData.get('sms_notifications_enabled') === 'on'
  const leadRaw = (formData.get('reminder_lead_hours') ?? '').toString().trim()
  const lead = parseInt(leadRaw, 10)

  if (!Number.isFinite(lead) || lead < 1 || lead > 168) {
    return {
      error: 'Reminder lead time must be between 1 and 168 hours.',
      success: false,
    }
  }

  const { error } = await supabase
    .from('organizations')
    .update({
      email_notifications_enabled: emailOn,
      sms_notifications_enabled: smsOn,
      reminder_lead_hours: lead,
    })
    .eq('id', organizationId)

  if (error) return { error: `Save failed: ${error.message}`, success: false }

  revalidatePath('/settings')
  return { error: null, success: true }
}

/* ====================== Tags + categories ====================== */

/** Shared add-by-name helper — exercise_tags and client_categories are
 *  structurally identical (id, organization_id, name, sort_order,
 *  deleted_at) so we thread the table name through. */
async function addLookup(
  table: 'exercise_tags' | 'client_categories',
  name: string,
): Promise<{ error: string | null }> {
  const { organizationId } = await requireRole(['owner', 'staff'])
  const trimmed = name.trim()
  if (!trimmed) return { error: 'Name is required.' }

  const supabase = await createSupabaseServerClient()

  // Append: take MAX(sort_order) + 10 so new rows land at the end of the
  // list. Matches the seeded gap pattern (10/20/30/…) and leaves room
  // between values for a future drag-reorder UI without renumbering.
  const { data: maxRow } = await supabase
    .from(table)
    .select('sort_order')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextSortOrder = (maxRow?.sort_order ?? 0) + 10

  const { error } = await supabase
    .from(table)
    .insert({
      organization_id: organizationId,
      name: trimmed,
      sort_order: nextSortOrder,
    })

  if (error) {
    if (error.code === '23505') {
      return { error: `"${trimmed}" already exists.` }
    }
    return { error: `Add failed: ${error.message}` }
  }
  revalidatePath('/settings')
  return { error: null }
}

/** Hard DELETE removal for client_categories only. The cascade behaviour
 *  is intentional: clients.category_id → ON DELETE SET NULL, so removed
 *  category just becomes "uncategorized" on existing clients — no data
 *  destroyed. exercise_tags moved to soft-delete via RPC (see
 *  removeExerciseTagAction below) so that historical tag assignments on
 *  exercises survive the removal. */
async function removeLookup(
  table: 'client_categories',
  id: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.from(table).delete().eq('id', id)
  if (error) return { error: `Remove failed: ${error.message}` }
  revalidatePath('/settings')
  return { error: null }
}

export async function addExerciseTagAction(
  name: string,
): Promise<{ error: string | null }> {
  return addLookup('exercise_tags', name)
}

export async function removeExerciseTagAction(
  id: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()
  // Soft-delete via SECURITY DEFINER RPC. Preserves exercise_tag_assignments
  // rows (CASCADE only fires on hard DELETE), so the historical record of
  // which tag was applied to which exercise survives the removal. The tag
  // disappears from filter chips, the create/edit picker, and the per-card
  // chip render (all filter deleted_at IS NULL).
  const { error } = await supabase.rpc('soft_delete_exercise_tag', {
    p_id: id,
  })
  if (error) return { error: `Remove failed: ${error.message}` }
  revalidatePath('/settings')
  revalidatePath('/library')
  return { error: null }
}

export async function addClientCategoryAction(
  name: string,
): Promise<{ error: string | null }> {
  return addLookup('client_categories', name)
}

export async function removeClientCategoryAction(
  id: string,
): Promise<{ error: string | null }> {
  return removeLookup('client_categories', id)
}

/* ====================== Movement patterns ====================== */

/** Movement patterns use the soft-delete RPC instead of hard DELETE: the
 *  RESTRICT FK on exercises.movement_pattern_id would block hard delete
 *  the moment any exercise references the pattern. Soft-delete preserves
 *  the FK so existing exercises still resolve the pattern name; the
 *  pattern just disappears from filter chips and pickers. */
export async function addMovementPatternAction(
  name: string,
): Promise<{ error: string | null }> {
  const { organizationId } = await requireRole(['owner', 'staff'])
  const trimmed = name.trim()
  if (!trimmed) return { error: 'Name is required.' }

  const supabase = await createSupabaseServerClient()

  // Append: take the current MAX(sort_order) + 10. The seeded patterns are
  // spaced 10/20/30/…; matching the gap leaves room between values for a
  // future drag-reorder UI without renumbering every row.
  const { data: maxRow } = await supabase
    .from('movement_patterns')
    .select('sort_order')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextSortOrder = (maxRow?.sort_order ?? 0) + 10

  const { error } = await supabase
    .from('movement_patterns')
    .insert({
      organization_id: organizationId,
      name: trimmed,
      sort_order: nextSortOrder,
    })

  if (error) {
    if (error.code === '23505') {
      return { error: `"${trimmed}" already exists.` }
    }
    return { error: `Add failed: ${error.message}` }
  }
  revalidatePath('/settings')
  return { error: null }
}

export async function removeMovementPatternAction(
  id: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('soft_delete_movement_pattern', {
    p_id: id,
  })
  if (error) return { error: `Remove failed: ${error.message}` }
  revalidatePath('/settings')
  return { error: null }
}

/* ====================== Helper ====================== */

function nullable(v: FormDataEntryValue | null): string | null {
  if (v === null) return null
  const s = v.toString().trim()
  return s.length === 0 ? null : s
}
