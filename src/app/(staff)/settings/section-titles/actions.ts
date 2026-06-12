'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Section-title settings actions (G-5 of the program-engine polish pass,
 * 2026-06-12; brief §6.5.1 — "practitioners can add, remove, reorder,
 * and rename section titles in settings").
 *
 * Safe by construction: program_exercises.section_title is a plain text
 * column copied at prescribe time, not an FK — every action here changes
 * the builder's dropdown only and never touches existing program data
 * (the section_titles table comment documents this contract). Renames
 * deliberately do NOT rewrite history: the program is a living document
 * and historical labels stand.
 *
 * DELETE is a hard delete, mirroring session_types: PostgREST's
 * return=representation re-SELECT after a soft-delete UPDATE trips the
 * SELECT policy's `deleted_at IS NULL` clause, and the staff DELETE
 * policy on this lookup table exists precisely for this.
 */

export type SectionTitleRow = {
  id: string
  name: string
  sort_order: number
}

function normalizeName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = raw.trim()
  if (name.length < 1 || name.length > 60) {
    return { ok: false, error: 'Name must be 1–60 characters.' }
  }
  return { ok: true, name }
}

export async function createSectionTitleSettingAction(
  name: string,
): Promise<{ error: string | null; id: string | null }> {
  const { organizationId } = await requireRole(['owner', 'staff'])
  const normalized = normalizeName(name)
  if (!normalized.ok) return { error: normalized.error, id: null }

  const supabase = await createSupabaseServerClient()
  const { data: tail } = await supabase
    .from('section_titles')
    .select('sort_order')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: false })
    .limit(1)
  const nextOrder = (tail?.[0]?.sort_order ?? 0) + 10

  const { data, error } = await supabase
    .from('section_titles')
    .insert({
      organization_id: organizationId,
      name: normalized.name,
      sort_order: nextOrder,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') {
      return { error: 'A section title with that name already exists.', id: null }
    }
    return { error: `Could not add title: ${error.message}`, id: null }
  }
  revalidatePath('/settings')
  return { error: null, id: data.id }
}

export async function renameSectionTitleAction(
  id: string,
  name: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const normalized = normalizeName(name)
  if (!normalized.ok) return { error: normalized.error }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('section_titles')
    .update({ name: normalized.name })
    .eq('id', id)

  if (error) {
    if (error.code === '23505') {
      return { error: 'A section title with that name already exists.' }
    }
    return { error: `Could not rename title: ${error.message}` }
  }
  revalidatePath('/settings')
  return { error: null }
}

export async function deleteSectionTitleAction(
  id: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.from('section_titles').delete().eq('id', id)

  if (error) return { error: `Could not delete title: ${error.message}` }
  revalidatePath('/settings')
  return { error: null }
}

/**
 * Move a title one slot up or down. Implementation renumbers the whole
 * live list (10, 20, 30, …) around the move rather than swapping two
 * rows — self-healing for any legacy duplicate sort_orders (the builder's
 * inline add and the bootstrap seed used different spacing). The list is
 * ~10 rows; N sequential UPDATEs on a single-user settings surface is
 * fine, and a half-applied renumber only co-sorts rows until the next
 * move repairs it.
 */
export async function moveSectionTitleAction(
  id: string,
  direction: 'up' | 'down',
): Promise<{ error: string | null }> {
  const { organizationId } = await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { data: rows, error: readErr } = await supabase
    .from('section_titles')
    .select('id, sort_order')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('sort_order')
    .order('name')

  if (readErr) return { error: `Could not load titles: ${readErr.message}` }
  const list = rows ?? []
  const index = list.findIndex((r) => r.id === id)
  if (index === -1) return { error: 'Title not found — it may have been deleted in another tab.' }

  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= list.length) return { error: null } // edge no-op

  const reordered = [...list]
  const [moved] = reordered.splice(index, 1)
  reordered.splice(target, 0, moved!)

  for (let i = 0; i < reordered.length; i++) {
    const desired = (i + 1) * 10
    if (reordered[i]!.sort_order === desired) continue
    const { error } = await supabase
      .from('section_titles')
      .update({ sort_order: desired })
      .eq('id', reordered[i]!.id)
    if (error) return { error: `Could not reorder: ${error.message}` }
  }

  revalidatePath('/settings')
  return { error: null }
}
