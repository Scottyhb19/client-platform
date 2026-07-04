'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require-role'
import { assertClientLive } from '@/lib/clients/archive-guard'
import { sanitizeRichTextValue } from '@/lib/rich-text-server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

/**
 * Bust the router cache for every staff route that surfaces this client's
 * clinical notes. Without this, pinning or saving a note from the profile
 * leaves a stale prefetched render of the program calendar and the session
 * builder's right-panel Notes tab. The day-page pattern is dynamic so
 * we revalidate the route segment, not a specific dayId — broader than
 * ideal, but Next.js can't target a single dayId without that segment in
 * hand here.
 */
function revalidateClinicalNoteSurfaces(clientId: string): void {
  revalidatePath(`/clients/${clientId}`)
  revalidatePath(`/clients/${clientId}/program`)
  revalidatePath('/clients/[id]/program/days/[dayId]', 'page')
}

type FieldType = Database['public']['Enums']['note_template_field_type']
type NoteType = Database['public']['Enums']['note_type']

/** The two note types the CN-1 flag control can create. */
export type ClinicalFlagType = Extract<
  NoteType,
  'injury_flag' | 'contraindication'
>

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
      // XSS boundary: rich-text HTML is allowlist-sanitised (and collapsed
      // to '' when it has no visible text); plain text passes through.
      value: sanitizeRichTextValue(f.value),
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

  // CN-7 (P1-4): archived clients are read-only — no new notes.
  const live = await assertClientLive(supabase, input.clientId)
  if (live.error) return { error: live.error, id: null }

  // CN-3: the template decides the note_type. An "Initial assessment"
  // template stamps initial_assessment; everything else defaults to
  // progress_note. Flag types can't come through here — the
  // note_templates_type_not_flag CHECK excludes them at the DB layer and
  // flags are created via createClinicalFlagAction.
  let noteType: NoteType = 'progress_note'
  if (input.templateId) {
    const { data: tpl } = await supabase
      .from('note_templates')
      .select('note_type')
      .eq('id', input.templateId)
      .maybeSingle()
    if (!tpl) {
      return { error: 'That template could not be found.', id: null }
    }
    noteType = tpl.note_type
  }

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
      note_type: noteType,
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

  revalidateClinicalNoteSurfaces(input.clientId)
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

  // CN-7 (P1-4): archived clients are read-only — no note archival either.
  const live = await assertClientLive(supabase, note.client_id)
  if (live.error) return { error: live.error }

  const { error } = await supabase.rpc('soft_delete_clinical_note', {
    p_id: noteId,
  })

  if (error) {
    return { error: `Could not archive note: ${error.message}` }
  }

  revalidateClinicalNoteSurfaces(note.client_id)
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

  // CN-7 (P1-4): archived clients are read-only — pin state included.
  const live = await assertClientLive(supabase, note.client_id)
  if (live.error) return { error: live.error }

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

  revalidateClinicalNoteSurfaces(note.client_id)
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

  // CN-3: flag notes keep their note_type (and their flag columns) no
  // matter which template the edit form had selected — editing a flag's
  // note text must never turn it back into a progress note, because the
  // injury-flag CHECK would reject the row (flag fields present on a
  // non-flag type) and the flag would vanish from every flag surface.
  // Non-flag notes re-stamp from the chosen template, same as create.
  const { data: current } = await supabase
    .from('clinical_notes')
    .select('id, note_type, client_id')
    .eq('id', input.noteId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!current) return { error: 'Note not found.' }

  // CN-7 (P1-4): archived clients are read-only — no note edits.
  const live = await assertClientLive(supabase, current.client_id)
  if (live.error) return { error: live.error }

  const isFlagNote =
    current.note_type === 'injury_flag' ||
    current.note_type === 'contraindication'

  let noteType: NoteType = 'progress_note'
  if (!isFlagNote && input.templateId) {
    const { data: tpl } = await supabase
      .from('note_templates')
      .select('note_type')
      .eq('id', input.templateId)
      .maybeSingle()
    if (!tpl) return { error: 'That template could not be found.' }
    noteType = tpl.note_type
  }

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
  const baseUpdate: Database['public']['Tables']['clinical_notes']['Update'] = {
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
  }
  if (!isFlagNote) baseUpdate.note_type = noteType
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

  revalidateClinicalNoteSurfaces(data.client_id)
  return { error: null }
}

/* ====================== Flags (CN-1) ====================== */

export type CreateClinicalFlagInput = {
  clientId: string
  flagType: ClinicalFlagType
  /** Free text — anatomy for injuries ("L knee"), system for systemic
   *  contraindications ("Cardiovascular"). The banner headline. */
  bodyRegion: string
  /** 1–5 or null. */
  severity: number | null
  /** Optional short clinical context; stored as the note's single
   *  content_json field so it renders everywhere notes render. */
  note: string
}

/**
 * Create an injury flag or contraindication. Flags are clinical_notes
 * rows (note_type = injury_flag | contraindication) with the structured
 * flag columns populated; they surface as the design-system flag banner
 * on the client profile and in the shared NotesPanel (session builder +
 * program calendar), and feed the dashboard needs-attention panel.
 *
 * Deliberately not template-driven: a flag is a ten-second structured
 * marker, not a long-form document. The note_templates_type_not_flag
 * CHECK enforces the same split from the other side.
 */
export async function createClinicalFlagAction(
  input: CreateClinicalFlagInput,
): Promise<{ error: string | null; id: string | null }> {
  const { userId, organizationId } = await requireRole(['owner', 'staff'])

  if (
    input.flagType !== 'injury_flag' &&
    input.flagType !== 'contraindication'
  ) {
    return { error: 'Unknown flag type.', id: null }
  }
  const bodyRegion = input.bodyRegion.trim()
  if (bodyRegion.length < 1 || bodyRegion.length > 120) {
    return { error: 'Body region is required (1–120 characters).', id: null }
  }
  let severity: number | null = null
  if (input.severity !== null && input.severity !== undefined) {
    if (
      !Number.isInteger(input.severity) ||
      input.severity < 1 ||
      input.severity > 5
    ) {
      return { error: 'Severity must be a whole number from 1 to 5.', id: null }
    }
    severity = input.severity
  }
  const noteText = input.note.trim()

  const supabase = await createSupabaseServerClient()

  // CN-7 (P1-4): archived clients are read-only — no new flags.
  const liveFlag = await assertClientLive(supabase, input.clientId)
  if (liveFlag.error) return { error: liveFlag.error, id: null }

  // content_json must be non-null (clinical_notes_content_present); an
  // empty fields array is the honest shape for a flag with no extra note.
  const content: ContentJson = {
    fields: noteText
      ? [{ label: 'Note', type: 'long_text', value: noteText }]
      : [],
  }

  const { data, error } = await supabase
    .from('clinical_notes')
    .insert({
      organization_id: organizationId,
      client_id: input.clientId,
      author_user_id: userId,
      note_type: input.flagType,
      note_date: new Date().toISOString().slice(0, 10),
      flag_body_region: bodyRegion,
      flag_severity: severity,
      content_json: content,
    })
    .select('id')
    .single()

  if (error) {
    return { error: `Could not save flag: ${error.message}`, id: null }
  }

  revalidateClinicalNoteSurfaces(input.clientId)
  return { error: null, id: data.id }
}

/**
 * Shared precondition for the flag lifecycle actions (CN-4): the row must
 * be a live flag note in the caller's reach (RLS-gated SELECT), and the
 * caller must be its author — the RLS UPDATE policy is author-locked, and
 * a blocked UPDATE surfaces as zero rows, so we check up front to give a
 * human error instead of a silent no-op.
 */
async function lookupFlagForWrite(
  noteId: string,
  userId: string,
): Promise<
  | {
      error: null
      note: {
        id: string
        client_id: string
        note_type: NoteType
        flag_resolved_at: string | null
        version: number
      }
    }
  | { error: string }
> {
  const supabase = await createSupabaseServerClient()
  const { data: note } = await supabase
    .from('clinical_notes')
    .select('id, client_id, note_type, author_user_id, flag_resolved_at, version')
    .eq('id', noteId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!note) return { error: 'Flag not found.' }
  if (note.note_type !== 'injury_flag' && note.note_type !== 'contraindication') {
    return { error: 'That note is not a flag.' }
  }
  if (note.author_user_id !== userId) {
    return {
      error:
        'Only the practitioner who created this flag can change it.',
    }
  }

  // CN-7 (P1-4): archived clients are read-only — the whole flag lifecycle
  // (resolve / mark reviewed / edit) is refused for an archived client's
  // record; this shared precondition covers all three actions.
  const live = await assertClientLive(supabase, note.client_id)
  if (live.error) return { error: live.error }

  return { error: null, note }
}

/**
 * Resolve a flag: the injury recovered or the contraindication no longer
 * applies. The note is NOT deleted — it stays in the client's history
 * with its resolved date (clinical-record integrity); it just stops being
 * active, so it leaves the profile banner, the NotesPanel "Active flags"
 * section, and the dashboard needs-attention panel. A flag created by
 * mistake is archived instead (archiveClinicalNoteAction — flags are
 * clinical_notes rows).
 *
 * Idempotent: resolving an already-resolved flag is a no-op success.
 */
export async function resolveClinicalFlagAction(
  noteId: string,
): Promise<{ error: string | null }> {
  const { userId } = await requireRole(['owner', 'staff'])
  const looked = await lookupFlagForWrite(noteId, userId)
  if (looked.error !== null) return { error: looked.error }
  if (looked.note.flag_resolved_at !== null) return { error: null }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('clinical_notes')
    .update({ flag_resolved_at: new Date().toISOString() })
    .eq('id', noteId)
    .is('flag_resolved_at', null)

  if (error) return { error: `Could not resolve flag: ${error.message}` }

  revalidateClinicalNoteSurfaces(looked.note.client_id)
  return { error: null }
}

/**
 * Mark a flag reviewed (CN-4 / brief §6.8.2): stamps flag_reviewed_at =
 * now, which clears it from the dashboard needs-attention panel for the
 * next 14 days. Always overwrites — "reviewed" means reviewed just now.
 */
export async function markClinicalFlagReviewedAction(
  noteId: string,
): Promise<{ error: string | null }> {
  const { userId } = await requireRole(['owner', 'staff'])
  const looked = await lookupFlagForWrite(noteId, userId)
  if (looked.error !== null) return { error: looked.error }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('clinical_notes')
    .update({ flag_reviewed_at: new Date().toISOString() })
    .eq('id', noteId)

  if (error) return { error: `Could not mark reviewed: ${error.message}` }

  revalidateClinicalNoteSurfaces(looked.note.client_id)
  return { error: null }
}

export type UpdateClinicalFlagInput = {
  noteId: string
  bodyRegion: string
  severity: number | null
  note: string
  /** Last-read version, threaded through for OCC. */
  version: number
}

/**
 * Edit a flag's body region / severity / note text. The flag's type and
 * dates are untouched. Same validation as create; OCC via version.
 */
export async function updateClinicalFlagAction(
  input: UpdateClinicalFlagInput,
): Promise<{ error: string | null }> {
  const { userId } = await requireRole(['owner', 'staff'])

  const bodyRegion = input.bodyRegion.trim()
  if (bodyRegion.length < 1 || bodyRegion.length > 120) {
    return { error: 'Body region is required (1–120 characters).' }
  }
  let severity: number | null = null
  if (input.severity !== null && input.severity !== undefined) {
    if (
      !Number.isInteger(input.severity) ||
      input.severity < 1 ||
      input.severity > 5
    ) {
      return { error: 'Severity must be a whole number from 1 to 5.' }
    }
    severity = input.severity
  }
  const noteText = input.note.trim()

  const looked = await lookupFlagForWrite(input.noteId, userId)
  if (looked.error !== null) return { error: looked.error }

  const content: ContentJson = {
    fields: noteText
      ? [{ label: 'Note', type: 'long_text', value: noteText }]
      : [],
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('clinical_notes')
    .update({
      flag_body_region: bodyRegion,
      flag_severity: severity,
      content_json: content,
    })
    .eq('id', input.noteId)
    .eq('version', input.version)
    .select('id, client_id')
    .maybeSingle()

  if (error) return { error: `Could not update flag: ${error.message}` }
  if (!data) {
    return {
      error:
        'This flag changed while you were editing. Close the dialog and try again.',
    }
  }

  revalidateClinicalNoteSurfaces(data.client_id)
  return { error: null }
}
