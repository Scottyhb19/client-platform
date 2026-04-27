'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

export type NoteTemplateFieldType =
  Database['public']['Enums']['note_template_field_type']

export type NoteTemplateFieldRow = {
  id: string
  label: string
  field_type: NoteTemplateFieldType
  default_value: string | null
  sort_order: number
}

export type NoteTemplateRow = {
  id: string
  name: string
  sort_order: number
  fields: NoteTemplateFieldRow[]
}

function normalizeName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = raw.trim()
  if (name.length < 1 || name.length > 80) {
    return { ok: false, error: 'Name must be 1–80 characters.' }
  }
  return { ok: true, name }
}

function normalizeLabel(raw: string): { ok: true; label: string } | { ok: false; error: string } {
  const label = raw.trim()
  if (label.length < 1 || label.length > 80) {
    return { ok: false, error: 'Field label must be 1–80 characters.' }
  }
  return { ok: true, label }
}

/* ====================== Templates ====================== */

export async function createNoteTemplateAction(
  name: string,
): Promise<{ error: string | null; id: string | null }> {
  const { organizationId } = await requireRole(['owner', 'staff'])
  const normalized = normalizeName(name)
  if (!normalized.ok) return { error: normalized.error, id: null }

  const supabase = await createSupabaseServerClient()
  // Append at the end of the visible list (max sort_order + 10, else 10).
  const { data: tail } = await supabase
    .from('note_templates')
    .select('sort_order')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: false })
    .limit(1)
  const nextOrder = (tail?.[0]?.sort_order ?? 0) + 10

  const { data, error } = await supabase
    .from('note_templates')
    .insert({
      organization_id: organizationId,
      name: normalized.name,
      sort_order: nextOrder,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') {
      return { error: 'A template with that name already exists.', id: null }
    }
    return { error: `Could not create template: ${error.message}`, id: null }
  }

  revalidatePath('/settings')
  return { error: null, id: data.id }
}

export async function renameNoteTemplateAction(
  id: string,
  name: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const normalized = normalizeName(name)
  if (!normalized.ok) return { error: normalized.error }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('note_templates')
    .update({ name: normalized.name })
    .eq('id', id)

  if (error) {
    if (error.code === '23505') {
      return { error: 'A template with that name already exists.' }
    }
    return { error: `Could not rename template: ${error.message}` }
  }
  revalidatePath('/settings')
  return { error: null }
}

/**
 * Hard DELETE — fields cascade automatically. clinical_notes.template_id
 * is SET NULL on delete; the labels survive in `content_json` so old notes
 * keep rendering. We hard-delete (not soft) for the same PostgREST RLS
 * reason that session_types and exercise_tags hard-delete: a soft-delete
 * UPDATE with `return=representation` re-SELECTs the row after the
 * `deleted_at IS NULL` SELECT policy has already filtered it out.
 */
export async function deleteNoteTemplateAction(
  id: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.from('note_templates').delete().eq('id', id)
  if (error) return { error: `Could not delete template: ${error.message}` }
  revalidatePath('/settings')
  return { error: null }
}

/* ====================== Fields ====================== */

export async function addNoteTemplateFieldAction(
  templateId: string,
  label: string,
): Promise<{ error: string | null; id: string | null }> {
  await requireRole(['owner', 'staff'])
  const normalized = normalizeLabel(label)
  if (!normalized.ok) return { error: normalized.error, id: null }

  const supabase = await createSupabaseServerClient()
  const { data: tail } = await supabase
    .from('note_template_fields')
    .select('sort_order')
    .eq('template_id', templateId)
    .order('sort_order', { ascending: false })
    .limit(1)
  const nextOrder = (tail?.[0]?.sort_order ?? 0) + 10

  // Always long_text — the only type the new UI exposes. The DB enum
  // still allows short_text/number for legacy data, but the editor and
  // create-note form treat every field as a resizable long-text box.
  const { data, error } = await supabase
    .from('note_template_fields')
    .insert({
      template_id: templateId,
      label: normalized.label,
      field_type: 'long_text',
      sort_order: nextOrder,
    })
    .select('id')
    .single()

  if (error) return { error: `Could not add field: ${error.message}`, id: null }
  revalidatePath('/settings')
  return { error: null, id: data.id }
}

export async function updateNoteTemplateFieldAction(
  fieldId: string,
  label: string,
  defaultValue: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const normalized = normalizeLabel(label)
  if (!normalized.ok) return { error: normalized.error }

  // Empty string → NULL so we don't store visually-blank rows that still
  // pre-populate notes with whitespace.
  const trimmed = defaultValue.trim()
  const default_value = trimmed.length === 0 ? null : trimmed

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('note_template_fields')
    .update({
      label: normalized.label,
      default_value,
      // Soft-migrate any legacy short_text/number rows to long_text on
      // first edit — the new UI treats them all the same anyway.
      field_type: 'long_text',
    })
    .eq('id', fieldId)

  if (error) return { error: `Could not update field: ${error.message}` }
  revalidatePath('/settings')
  return { error: null }
}

export async function deleteNoteTemplateFieldAction(
  fieldId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('note_template_fields')
    .delete()
    .eq('id', fieldId)
  if (error) return { error: `Could not delete field: ${error.message}` }
  revalidatePath('/settings')
  return { error: null }
}

/**
 * Move a field up or down in its template by swapping sort_order with the
 * adjacent sibling. Two UPDATEs, no transaction — RLS is per-row anyway,
 * and a partial swap reorders incorrectly but doesn't corrupt anything.
 */
export async function moveNoteTemplateFieldAction(
  fieldId: string,
  direction: 'up' | 'down',
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { data: self, error: selfError } = await supabase
    .from('note_template_fields')
    .select('id, template_id, sort_order')
    .eq('id', fieldId)
    .single()

  if (selfError || !self) {
    return { error: 'Could not find that field to move.' }
  }

  const ascending = direction === 'down'
  const base = supabase
    .from('note_template_fields')
    .select('id, sort_order')
    .eq('template_id', self.template_id)
    .order('sort_order', { ascending })
    .limit(1)

  const { data: target } = ascending
    ? await base.gt('sort_order', self.sort_order).maybeSingle()
    : await base.lt('sort_order', self.sort_order).maybeSingle()

  if (!target) return { error: null } // already at the edge — no-op

  // Swap sort_order values
  const a = supabase
    .from('note_template_fields')
    .update({ sort_order: target.sort_order })
    .eq('id', self.id)
  const b = supabase
    .from('note_template_fields')
    .update({ sort_order: self.sort_order })
    .eq('id', target.id)

  const [{ error: errA }, { error: errB }] = await Promise.all([a, b])
  if (errA || errB) {
    return { error: `Could not reorder field: ${errA?.message ?? errB?.message}` }
  }

  revalidatePath('/settings')
  return { error: null }
}

/* ====================== Bootstrap (one-time seed) ====================== */

const DEFAULT_TEMPLATE_NAME = 'SOAP+'
const DEFAULT_TEMPLATE_FIELDS: Array<{
  label: string
  field_type: NoteTemplateFieldType
}> = [
  { label: 'Subjective', field_type: 'long_text' },
  { label: 'Objective', field_type: 'long_text' },
  { label: 'Assessment', field_type: 'long_text' },
  { label: 'Plan', field_type: 'long_text' },
  { label: 'Pain & symptom report', field_type: 'long_text' },
  { label: 'Session content', field_type: 'long_text' },
  { label: 'Reassessment / outcome', field_type: 'long_text' },
  { label: 'Homework & next session', field_type: 'long_text' },
]

/**
 * Seed the default SOAP+ template if the org has zero templates. Called
 * from the settings page loader on every visit; idempotent because of the
 * `note_templates_org_name_unique` index — a second call inserts no row.
 *
 * No `revalidatePath` here — Next.js 16 forbids that during render. The
 * caller queries `note_templates` immediately after, so the seeded rows
 * are visible in the same render pass.
 */
export async function seedDefaultNoteTemplatesIfEmpty(): Promise<void> {
  const { organizationId } = await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { data: existing } = await supabase
    .from('note_templates')
    .select('id')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .limit(1)

  if (existing && existing.length > 0) return

  const { data: created, error: createErr } = await supabase
    .from('note_templates')
    .insert({
      organization_id: organizationId,
      name: DEFAULT_TEMPLATE_NAME,
      sort_order: 10,
    })
    .select('id')
    .single()

  if (createErr || !created) return

  await supabase.from('note_template_fields').insert(
    DEFAULT_TEMPLATE_FIELDS.map((f, i) => ({
      template_id: created.id,
      label: f.label,
      field_type: f.field_type,
      sort_order: (i + 1) * 10,
    })),
  )
}
