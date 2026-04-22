'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export type SettingsState = {
  error: string | null
  success: boolean
}

export const initialSettingsState: SettingsState = {
  error: null,
  success: false,
}

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
  const { error } = await supabase
    .from(table)
    .insert({ organization_id: organizationId, name: trimmed })

  if (error) {
    if (error.code === '23505') {
      return { error: `"${trimmed}" already exists.` }
    }
    return { error: `Add failed: ${error.message}` }
  }
  revalidatePath('/settings')
  return { error: null }
}

async function removeLookup(
  table: 'exercise_tags' | 'client_categories',
  id: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from(table)
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
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
  return removeLookup('exercise_tags', id)
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

/* ====================== Helper ====================== */

function nullable(v: FormDataEntryValue | null): string | null {
  if (v === null) return null
  const s = v.toString().trim()
  return s.length === 0 ? null : s
}
