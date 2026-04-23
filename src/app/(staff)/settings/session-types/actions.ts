'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export type SessionTypeRow = {
  id: string
  name: string
  color: string
  sort_order: number
}

export type CreateSessionTypeInput = {
  name: string
  color: string
}

export type UpdateSessionTypeInput = {
  id: string
  name: string
  color: string
}

/**
 * Hex color validation. 6-digit `#RRGGBB`. Mirrors the DB CHECK so the UI
 * can surface a friendlier error message than Postgres' default.
 */
const HEX_COLOR = /^#[0-9a-f]{6}$/i

type Normalized =
  | { ok: true; name: string; color: string }
  | { ok: false; error: string }

function normalizeInputs(input: {
  name: string
  color: string
}): Normalized {
  const name = input.name.trim()
  const color = input.color.trim().toLowerCase()
  if (name.length < 1 || name.length > 60) {
    return { ok: false, error: 'Name must be 1–60 characters.' }
  }
  if (!HEX_COLOR.test(color)) {
    return { ok: false, error: 'Color must be a 6-digit hex like #1E1A18.' }
  }
  return { ok: true, name, color }
}

export async function createSessionTypeAction(
  input: CreateSessionTypeInput,
): Promise<{ error: string | null; id: string | null }> {
  const { organizationId } = await requireRole(['owner', 'staff'])
  const normalized = normalizeInputs(input)
  if (!normalized.ok) return { error: normalized.error, id: null }

  const supabase = await createSupabaseServerClient()
  // Append at the end of the list (max sort_order + 10, or 10 if empty).
  const { data: tail } = await supabase
    .from('session_types')
    .select('sort_order')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: false })
    .limit(1)
  const nextOrder = (tail?.[0]?.sort_order ?? 0) + 10

  const { data, error } = await supabase
    .from('session_types')
    .insert({
      organization_id: organizationId,
      name: normalized.name,
      color: normalized.color,
      sort_order: nextOrder,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') {
      return { error: 'A session type with that name already exists.', id: null }
    }
    return { error: `Could not create type: ${error.message}`, id: null }
  }
  revalidatePath('/settings/session-types')
  revalidatePath('/schedule')
  return { error: null, id: data.id }
}

export async function updateSessionTypeAction(
  input: UpdateSessionTypeInput,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const normalized = normalizeInputs(input)
  if ('error' in normalized) return { error: normalized.error }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('session_types')
    .update({
      name: normalized.name,
      color: normalized.color,
    })
    .eq('id', input.id)

  if (error) {
    if (error.code === '23505') {
      return { error: 'A session type with that name already exists.' }
    }
    return { error: `Could not update type: ${error.message}` }
  }
  revalidatePath('/settings/session-types')
  revalidatePath('/schedule')
  return { error: null }
}

/**
 * Hard DELETE. We don't soft-delete here for the same PostgREST reason
 * exercise_tags uses DELETE (`return=representation` re-SELECTs the row
 * after the update, which trips the SELECT policy's `deleted_at IS NULL`
 * clause and surfaces as "new row violates row-level security policy").
 *
 * Existing appointments store the type as free text (not FK) so their
 * labels survive the delete — they'll just render with the fallback
 * status tone colour since the type row is gone.
 */
export async function deleteSessionTypeAction(
  id: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('session_types')
    .delete()
    .eq('id', id)

  if (error) return { error: `Could not delete type: ${error.message}` }
  revalidatePath('/settings/session-types')
  revalidatePath('/schedule')
  return { error: null }
}
