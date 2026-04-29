'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

type FieldType = Database['public']['Enums']['note_template_field_type']

export type NoteFieldValue = {
  label: string
  type: FieldType
  value: string
}

export type CreateClinicalNoteInput = {
  clientId: string
  templateId: string | null
  appointmentId: string | null
  fields: NoteFieldValue[]
  /**
   * Optional link to a test_session that was captured alongside this note.
   * Single FK per /docs/testing-module-schema.md §14 Q2 sign-off; the
   * note narrative survives if the session is later removed.
   */
  testSessionId?: string | null
}

export type UpdateClinicalNoteInput = {
  noteId: string
  templateId: string | null
  appointmentId: string | null
  fields: NoteFieldValue[]
  testSessionId?: string | null
  /** Last-read version, threaded through for OCC. */
  version: number
}

/**
 * The content_json shape stored on clinical_notes. Fields are denormalized
 * with their label + type so historical notes render correctly even after
 * the template that produced them is edited or deleted.
 */
type ContentJson = {
  fields: NoteFieldValue[]
}

const ALLOWED_TYPES: FieldType[] = ['short_text', 'long_text', 'number']

function sanitizeFields(raw: NoteFieldValue[]): NoteFieldValue[] {
  return raw
    .map((f) => ({
      label: f.label.trim(),
      type: ALLOWED_TYPES.includes(f.type) ? f.type : ('long_text' as FieldType),
      value: f.value.trim(),
    }))
    .filter((f) => f.label.length > 0)
}

function hasAnyValue(fields: NoteFieldValue[]): boolean {
  return fields.some((f) => f.value.length > 0)
}

/**
 * The note's "session date" is the date of the linked appointment if one
 * is selected, otherwise today. The full timestamp lives in
 * appointments.start_at — note_date is just the date column for sorting.
 *
 * Returns the resolved date string, or `{ notFound: true }` only when an
 * appointment id was supplied but couldn't be found in the caller's org.
 */
async function resolveNoteDate(
  appointmentId: string | null,
  organizationId: string,
): Promise<{ date: string } | { notFound: true }> {
  if (!appointmentId) {
    return { date: new Date().toISOString().slice(0, 10) }
  }
  const supabase = await createSupabaseServerClient()
  const { data: appt } = await supabase
    .from('appointments')
    .select('id, start_at, organization_id')
    .eq('id', appointmentId)
    .maybeSingle()

  if (!appt) return { notFound: true }
  if (appt.organization_id !== organizationId) return { notFound: true }
  return { date: appt.start_at.slice(0, 10) }
}

/* ====================== Create ====================== */

export async function createClinicalNoteAction(
  input: CreateClinicalNoteInput,
): Promise<{ error: string | null; id: string | null }> {
  const { userId, organizationId } = await requireRole(['owner', 'staff'])

  const cleaned = sanitizeFields(input.fields)
  if (cleaned.length === 0) {
    return { error: 'Add at least one labelled field.', id: null }
  }
  if (!hasAnyValue(cleaned)) {
    return { error: 'Fill in at least one field before saving.', id: null }
  }

  const resolved = await resolveNoteDate(input.appointmentId, organizationId)
  if ('notFound' in resolved) {
    return { error: 'That appointment could not be found.', id: null }
  }
  const noteDate = resolved.date

  const supabase = await createSupabaseServerClient()

  // One note per appointment. Defence-in-depth: the UI already disables
  // Save in this case, but a stale tab or a direct API call would slip
  // through without this check.
  if (input.appointmentId) {
    const { data: existing } = await supabase
      .from('clinical_notes')
      .select('id')
      .eq('appointment_id', input.appointmentId)
      .is('deleted_at', null)
      .limit(1)
    if (existing && existing.length > 0) {
      return {
        error:
          'This session already has a note. Edit the existing note instead.',
        id: null,
      }
    }
  }

  const content: ContentJson = { fields: cleaned }

  const { data, error } = await supabase
    .from('clinical_notes')
    .insert({
      organization_id: organizationId,
      client_id: input.clientId,
      author_user_id: userId,
      note_type: 'progress_note',
      note_date: noteDate,
      template_id: input.templateId,
      appointment_id: input.appointmentId,
      content_json: content,
      test_session_id: input.testSessionId ?? null,
    })
    .select('id')
    .single()

  if (error) {
    return { error: `Could not save note: ${error.message}`, id: null }
  }

  revalidatePath(`/clients/${input.clientId}`)
  return { error: null, id: data.id }
}

/* ====================== Archive ====================== */

/**
 * Soft-archive a clinical note via the soft_delete_clinical_note RPC.
 *
 * The RPC is SECURITY DEFINER and replicates the author-only check
 * inside the database (org match + role IN (owner, staff) + author
 * matches caller). Practice owner has no override — clinical-record
 * integrity. Migration 20260429120000_soft_delete_rpcs.sql owns the gate.
 *
 * Why an RPC and not a direct UPDATE: the SELECT policy filters
 * `deleted_at IS NULL`, so an UPDATE that sets it fails 42501 on the
 * post-update SELECT-policy re-evaluation. The RPC bypasses RLS for the
 * single mutation while keeping the auth check authoritative.
 *
 * The previous service-role workaround re-implemented the author check
 * in TypeScript and wrote with the service-role client. Routing through
 * the RPC moves the gate into the database and removes one
 * service-role-bypass surface.
 */
export async function archiveClinicalNoteAction(
  noteId: string,
): Promise<{ error: string | null }> {
  const { userId } = await requireRole(['owner', 'staff'])

  const supabase = await createSupabaseServerClient()

  // Look up the note for client_id (we need it for revalidatePath after).
  // Visibility is RLS-gated, so a not-found result here also covers
  // cross-org and not-archived; the RPC will give the canonical error
  // shape if its preconditions aren't met.
  const { data: note } = await supabase
    .from('clinical_notes')
    .select('id, client_id, author_user_id')
    .eq('id', noteId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!note) return { error: 'Note not found.' }
  if (note.author_user_id !== userId) {
    return {
      error: `Only the practitioner who wrote this note can archive it. This note's author was user ${note.author_user_id.slice(0, 8)}…; you are signed in as ${userId.slice(0, 8)}…. If you have multiple practitioner accounts, sign in with the one that wrote this note.`,
    }
  }

  const { error } = await supabase.rpc('soft_delete_clinical_note', {
    p_id: noteId,
  })

  if (error) {
    return { error: `Could not archive note: ${error.message}` }
  }

  revalidatePath(`/clients/${note.client_id}`)
  return { error: null }
}

/* ====================== Pin / unpin ====================== */

/**
 * Toggle the pin flag on a clinical note. RLS now enforces author-only
 * updates, so this only succeeds for notes the caller wrote. We don't
 * `.select()` back the row to dodge the soft-delete-style PostgREST
 * gotcha (UPDATE returning the row through the SELECT policy).
 */
export async function toggleClinicalNotePinAction(
  noteId: string,
  isPinned: boolean,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { data: note, error: lookupError } = await supabase
    .from('clinical_notes')
    .select('id, client_id')
    .eq('id', noteId)
    .maybeSingle()

  if (lookupError) return { error: `Could not find note: ${lookupError.message}` }
  if (!note) return { error: 'Note not found.' }

  const { error } = await supabase
    .from('clinical_notes')
    .update({ is_pinned: isPinned })
    .eq('id', noteId)

  if (error) {
    if (error.code === '42501' || error.message.toLowerCase().includes('row-level security')) {
      return { error: 'Only the practitioner who wrote this note can pin or unpin it.' }
    }
    return { error: `Could not update pin: ${error.message}` }
  }

  revalidatePath(`/clients/${note.client_id}`)
  return { error: null }
}

/* ====================== Update ====================== */

export async function updateClinicalNoteAction(
  input: UpdateClinicalNoteInput,
): Promise<{ error: string | null }> {
  const { organizationId } = await requireRole(['owner', 'staff'])

  const cleaned = sanitizeFields(input.fields)
  if (cleaned.length === 0) {
    return { error: 'Add at least one labelled field.' }
  }
  if (!hasAnyValue(cleaned)) {
    return { error: 'Fill in at least one field before saving.' }
  }

  const resolved = await resolveNoteDate(input.appointmentId, organizationId)
  if ('notFound' in resolved) {
    return { error: 'That appointment could not be found.' }
  }
  const noteDate = resolved.date

  const supabase = await createSupabaseServerClient()

  // One note per appointment — same as create. Excludes the note being
  // edited from the conflict check (re-saving with the same link is fine).
  if (input.appointmentId) {
    const { data: existing } = await supabase
      .from('clinical_notes')
      .select('id')
      .eq('appointment_id', input.appointmentId)
      .neq('id', input.noteId)
      .is('deleted_at', null)
      .limit(1)
    if (existing && existing.length > 0) {
      return {
        error: 'Another note already exists for that session.',
      }
    }
  }

  const content: ContentJson = { fields: cleaned }

  // OCC: refuse the write if version moved underneath us. The trigger
  // bumps version on every UPDATE, so the next read will see the new one.
  // testSessionId is included only when the caller provided it explicitly
  // — `undefined` keeps the existing value, an explicit `null` clears it.
  const baseUpdate = {
    template_id: input.templateId,
    appointment_id: input.appointmentId,
    note_date: noteDate,
    content_json: content,
    // Clear legacy SOAP columns so we don't render stale duplicate
    // content alongside the new field set.
    subjective: null,
    objective: null,
    assessment: null,
    plan: null,
    body_rich: null,
  } as const
  const update =
    input.testSessionId === undefined
      ? baseUpdate
      : { ...baseUpdate, test_session_id: input.testSessionId }
  const { data, error } = await supabase
    .from('clinical_notes')
    .update(update)
    .eq('id', input.noteId)
    .eq('version', input.version)
    .select('id, client_id')
    .maybeSingle()

  if (error) return { error: `Could not save note: ${error.message}` }
  if (!data) {
    return {
      error:
        'Someone else edited this note while you were typing. Reload the page and try again.',
    }
  }

  revalidatePath(`/clients/${data.client_id}`)
  return { error: null }
}
