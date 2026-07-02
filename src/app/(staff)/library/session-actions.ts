'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/*
 * Server actions for the in-Library SESSION editor + tab (S-4/S-5/S-6,
 * docs/polish/library-sessions-programs.md). Mirrors the split the session
 * builder uses (clients/[id]/program/days/[dayId]/actions.ts): structural,
 * multi-row, or soft-delete operations route through the SECURITY DEFINER
 * session RPCs (20260624140000); single-row autosave + grouping go through
 * direct RLS writes. Every action is requireRole(['owner','staff']) and
 * RLS-scoped — a session_template belongs to one org.
 */

export type SessionInsertSlot =
  | { kind: 'append' }
  | { kind: 'atStart' }
  | { kind: 'after'; afterId: string }

export type SessionExercisePatch = {
  rest_seconds?: number | null
  tempo?: string | null
  instructions?: string | null
  section_title?: string | null
}
export type SessionSetPatch = {
  reps?: string | null
  optional_metric?: string | null
  optional_value?: string | null
}

const EDITABLE_EXERCISE_FIELDS = new Set<keyof SessionExercisePatch>([
  'rest_seconds',
  'tempo',
  'instructions',
  'section_title',
])
const EDITABLE_SET_FIELDS = new Set<keyof SessionSetPatch>([
  'reps',
  'optional_metric',
  'optional_value',
])

/* ====================== Tab CRUD ====================== */

export type CreateSessionResult =
  | { sessionId: string; error: null }
  | { sessionId: null; error: string }

/** New blank session (author-from-scratch, primary create path). Direct RLS
 * INSERT — mirrors createCircuitAction. Returns the id so the tab routes to
 * the editor. */
export async function createSessionAction(
  rawName: string,
): Promise<CreateSessionResult> {
  const { organizationId, userId } = await requireRole(['owner', 'staff'])
  const name = rawName.trim()
  if (name.length < 1 || name.length > 80) {
    return { sessionId: null, error: 'Session name must be 1–80 characters.' }
  }

  const supabase = await createSupabaseServerClient()

  const { data: dup } = await supabase
    .from('session_templates')
    .select('id')
    .eq('organization_id', organizationId)
    .ilike('name', name)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()
  if (dup) {
    return { sessionId: null, error: `A session called "${name}" already exists.` }
  }

  const { data, error } = await supabase
    .from('session_templates')
    .insert({
      organization_id: organizationId,
      created_by_user_id: userId,
      name,
    })
    .select('id')
    .single()

  if (error || !data) {
    return { sessionId: null, error: `Couldn't create session: ${error?.message ?? 'unknown'}` }
  }

  revalidatePath('/library')
  return { sessionId: data.id, error: null }
}

export async function renameSessionAction(
  sessionId: string,
  rawName: string,
): Promise<{ error: string | null }> {
  const { organizationId } = await requireRole(['owner', 'staff'])
  const name = rawName.trim()
  if (name.length < 1 || name.length > 80) {
    return { error: 'Session name must be 1–80 characters.' }
  }

  const supabase = await createSupabaseServerClient()

  const { data: dup } = await supabase
    .from('session_templates')
    .select('id')
    .eq('organization_id', organizationId)
    .ilike('name', name)
    .is('deleted_at', null)
    .neq('id', sessionId)
    .limit(1)
    .maybeSingle()
  if (dup) {
    return { error: `A session called "${name}" already exists.` }
  }

  const { data, error } = await supabase
    .from('session_templates')
    .update({ name })
    .eq('id', sessionId)
    .is('deleted_at', null)
    .select('id')
  if (error) return { error: `Rename failed: ${error.message}` }
  if (!data || data.length === 0) return { error: 'Session not found.' }

  revalidatePath('/library')
  revalidatePath(`/library/sessions/${sessionId}`)
  return { error: null }
}

export async function deleteSessionAction(
  sessionId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('soft_delete_session_template', {
    p_id: sessionId,
  })
  if (error) return { error: `Delete failed: ${error.message}` }
  revalidatePath('/library')
  return { error: null }
}

/** Apply a session into an existing program day (S-6 "Add session" entry).
 * Copy-on-apply via the RPC. */
export async function applySessionToDayAction(
  sessionId: string,
  programDayId: string,
  clientId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('apply_session_to_program_day', {
    p_session_id: sessionId,
    p_program_day_id: programDayId,
  })
  if (error) return { error: `Couldn't add session: ${error.message}` }
  revalidatePath(`/clients/${clientId}/program/days/${programDayId}`)
  return { error: null }
}

export type SaveDayAsSessionResult =
  | { status: 'created'; sessionId: string }
  | { status: 'duplicate_name' }
  | { error: string }

/** Save a real program_day as a new session template (S-6 save-from-builder).
 * Copy-on-apply via save_day_as_session; duplicate name surfaced for a retry. */
export async function saveDayAsSessionAction(
  programDayId: string,
  rawName: string,
): Promise<SaveDayAsSessionResult> {
  await requireRole(['owner', 'staff'])
  const name = rawName.trim()
  if (name.length < 1 || name.length > 80) {
    return { error: 'Session name must be 1–80 characters.' }
  }
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('save_day_as_session', {
    p_program_day_id: programDayId,
    p_name: name,
  })
  if (error) return { error: `Couldn't save session: ${error.message}` }
  const obj = (data ?? {}) as { status?: string; session_id?: string }
  if (obj.status === 'duplicate_name') return { status: 'duplicate_name' }
  if (obj.status === 'created' && obj.session_id) {
    revalidatePath('/library')
    return { status: 'created', sessionId: obj.session_id }
  }
  return { error: `Unexpected response: ${obj.status ?? 'unknown'}` }
}

/* ====================== Editor — structural (RPC-backed) ====================== */

export async function addSessionExerciseAction(
  sessionId: string,
  exerciseId: string,
  slot: SessionInsertSlot = { kind: 'append' },
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('insert_session_exercise_at', {
    p_session_id: sessionId,
    p_exercise_id: exerciseId,
    p_after_id: (slot.kind === 'after' ? slot.afterId : null) as unknown as string,
    p_slot:
      slot.kind === 'after'
        ? 'after'
        : slot.kind === 'atStart'
          ? 'at_start'
          : 'append',
  })
  if (error) return { error: `Couldn't add exercise: ${error.message}` }
  revalidatePath(`/library/sessions/${sessionId}`)
  return { error: null }
}

export async function removeSessionExerciseAction(
  sessionId: string,
  sessionExerciseId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('soft_delete_session_template_exercise', {
    p_id: sessionExerciseId,
  })
  if (error) return { error: `Remove failed: ${error.message}` }
  revalidatePath(`/library/sessions/${sessionId}`)
  return { error: null }
}

export async function reorderSessionExercisesAction(
  sessionId: string,
  orderedIds: string[],
  movedId: string | null,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('reorder_session_exercises', {
    p_session_id: sessionId,
    p_ordered_ids: orderedIds,
    p_moved_id: movedId as unknown as string,
  })
  if (error) return { error: `Reorder failed: ${error.message}` }
  revalidatePath(`/library/sessions/${sessionId}`)
  return { error: null }
}

/** Up/down arrow — read live ids, swap with the neighbour, hand the new
 * permutation to the reorder RPC (so the arrow inherits group re-derivation,
 * matching the builder's moveProgramExerciseAction). */
export async function moveSessionExerciseAction(
  sessionId: string,
  sessionExerciseId: string,
  direction: 'up' | 'down',
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { data: rows, error: readErr } = await supabase
    .from('session_template_exercises')
    .select('id')
    .eq('session_template_id', sessionId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
  if (readErr) return { error: `Read failed: ${readErr.message}` }
  if (!rows || rows.length === 0) return { error: 'Session has no exercises.' }

  const index = rows.findIndex((r) => r.id === sessionExerciseId)
  if (index === -1) return { error: 'Exercise not found in this session.' }
  const neighbour = direction === 'up' ? index - 1 : index + 1
  if (neighbour < 0 || neighbour >= rows.length) return { error: null }

  const orderedIds = rows.map((r) => r.id)
  ;[orderedIds[index], orderedIds[neighbour]] = [
    orderedIds[neighbour]!,
    orderedIds[index]!,
  ]

  const { error } = await supabase.rpc('reorder_session_exercises', {
    p_session_id: sessionId,
    p_ordered_ids: orderedIds,
    p_moved_id: sessionExerciseId,
  })
  if (error) return { error: `Move failed: ${error.message}` }
  revalidatePath(`/library/sessions/${sessionId}`)
  return { error: null }
}

export async function removeSessionSetAction(
  sessionId: string,
  setId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc(
    'soft_delete_session_template_exercise_set',
    { p_id: setId },
  )
  if (error) return { error: `Remove set failed: ${error.message}` }
  revalidatePath(`/library/sessions/${sessionId}`)
  return { error: null }
}

/* ====================== Editor — single-row (direct RLS) ====================== */

export async function updateSessionExerciseAction(
  sessionId: string,
  sessionExerciseId: string,
  patch: SessionExercisePatch,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const clean: SessionExercisePatch = {}
  for (const key of Object.keys(patch) as Array<keyof SessionExercisePatch>) {
    if (EDITABLE_EXERCISE_FIELDS.has(key)) {
      // @ts-expect-error — narrowing is exhaustive via the allowlist above
      clean[key] = patch[key]
    }
  }
  if (Object.keys(clean).length === 0) return { error: null }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('session_template_exercises')
    .update(clean)
    .eq('id', sessionExerciseId)
    .is('deleted_at', null)
  if (error) return { error: `Update failed: ${error.message}` }
  revalidatePath(`/library/sessions/${sessionId}`)
  return { error: null }
}

export async function updateSessionSetAction(
  sessionId: string,
  setId: string,
  patch: SessionSetPatch,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const clean: SessionSetPatch = {}
  for (const key of Object.keys(patch) as Array<keyof SessionSetPatch>) {
    if (EDITABLE_SET_FIELDS.has(key)) {
      clean[key] = patch[key]
    }
  }
  if (Object.keys(clean).length === 0) return { error: null }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('session_template_exercise_sets')
    .update(clean)
    .eq('id', setId)
    .is('deleted_at', null)
  if (error) return { error: `Update failed: ${error.message}` }
  revalidatePath(`/library/sessions/${sessionId}`)
  return { error: null }
}

/**
 * Column autofill — the session builder's downward follow-the-value rule
 * cloned onto session-template sets (parity capture 2026-07-03): a
 * committed value follows into the cells BELOW the edited set that are
 * empty or still hold its previous value; sets above and customised
 * values never move (8/6/4 enters top-down, wave loading survives). The
 * guards run server-side — see autofillProgramExerciseSetColumnAction
 * (clients/[id]/program/days/[dayId]/actions.ts) for the full rationale.
 */
export async function autofillSessionSetColumnAction(
  sessionId: string,
  sessionExerciseId: string,
  field: 'reps' | 'optional_value',
  value: string,
  previousValue: string | null,
  belowSetNumber: number,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])

  if (field !== 'reps' && field !== 'optional_value') {
    return { error: 'Invalid column.' }
  }
  if (!Number.isFinite(belowSetNumber)) {
    return { error: 'Invalid set number.' }
  }
  const trimmed = value.trim()
  if (trimmed === '') return { error: null }

  const patch: SessionSetPatch = { [field]: trimmed }
  const supabase = await createSupabaseServerClient()

  const { error: fillErr } = await supabase
    .from('session_template_exercise_sets')
    .update(patch)
    .eq('session_template_exercise_id', sessionExerciseId)
    .is('deleted_at', null)
    .gt('set_number', belowSetNumber)
    .is(field, null)
  if (fillErr) return { error: `Autofill failed: ${fillErr.message}` }

  const prev = (previousValue ?? '').trim()
  if (prev !== '' && prev !== trimmed) {
    const { error: followErr } = await supabase
      .from('session_template_exercise_sets')
      .update(patch)
      .eq('session_template_exercise_id', sessionExerciseId)
      .is('deleted_at', null)
      .gt('set_number', belowSetNumber)
      .eq(field, prev)
    if (followErr) return { error: `Autofill failed: ${followErr.message}` }
  }

  revalidatePath(`/library/sessions/${sessionId}`)
  return { error: null }
}

/** Stepper "+" — copy the last live set's values (so a quick count bump
 * inherits the prescription). Mirrors addProgramExerciseSetAction. */
export async function addSessionSetAction(
  sessionId: string,
  sessionExerciseId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { data: lastSet, error: lookupErr } = await supabase
    .from('session_template_exercise_sets')
    .select('set_number, reps, rep_metric, optional_metric, optional_value')
    .eq('session_template_exercise_id', sessionExerciseId)
    .is('deleted_at', null)
    .order('set_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (lookupErr) return { error: `Couldn't read last set: ${lookupErr.message}` }

  const nextSetNumber = (lastSet?.set_number ?? 0) + 1
  const { error } = await supabase.from('session_template_exercise_sets').insert({
    session_template_exercise_id: sessionExerciseId,
    set_number: nextSetNumber,
    reps: lastSet?.reps ?? null,
    rep_metric: lastSet?.rep_metric ?? null,
    optional_metric: lastSet?.optional_metric ?? null,
    optional_value: lastSet?.optional_value ?? null,
  })
  if (error) return { error: `Couldn't add set: ${error.message}` }
  revalidatePath(`/library/sessions/${sessionId}`)
  return { error: null }
}

/** Column-level volume unit (rep_metric) across all live sets of an exercise. */
export async function updateSessionRepMetricAction(
  sessionId: string,
  sessionExerciseId: string,
  repMetric: string | null,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('session_template_exercise_sets')
    .update({ rep_metric: repMetric })
    .eq('session_template_exercise_id', sessionExerciseId)
    .is('deleted_at', null)
  if (error) return { error: `Set measure failed: ${error.message}` }
  revalidatePath(`/library/sessions/${sessionId}`)
  return { error: null }
}

/** Column-level load unit (optional_metric) across all live sets. */
export async function updateSessionMetricAction(
  sessionId: string,
  sessionExerciseId: string,
  metric: string | null,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('session_template_exercise_sets')
    .update({ optional_metric: metric })
    .eq('session_template_exercise_id', sessionExerciseId)
    .is('deleted_at', null)
  if (error) return { error: `Set metric failed: ${error.message}` }
  revalidatePath(`/library/sessions/${sessionId}`)
  return { error: null }
}

/* ====================== Editor — grouping + sections (direct RLS) ====================== */

/** Group the two exercises on either side of an action bar. Four cases,
 * cloned from the builder's groupAcrossActionBarAction; section follows the
 * upper card/group (canonical), matching the builder. */
export async function groupSessionAcrossAction(
  sessionId: string,
  beforeId: string,
  afterId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { data: pair, error: lookupErr } = await supabase
    .from('session_template_exercises')
    .select('id, sort_order, superset_group_id, section_title')
    .eq('session_template_id', sessionId)
    .in('id', [beforeId, afterId])
    .is('deleted_at', null)
  if (lookupErr) return { error: `Lookup failed: ${lookupErr.message}` }
  if (!pair || pair.length !== 2) return { error: 'Adjacent rows not found.' }

  const before = pair.find((p) => p.id === beforeId)
  const after = pair.find((p) => p.id === afterId)
  if (!before || !after) return { error: 'Adjacent rows not found.' }

  const beforeG = before.superset_group_id
  const afterG = after.superset_group_id

  if (beforeG && afterG && beforeG === afterG) return { error: null }

  if (!beforeG && !afterG) {
    const newGroupId = crypto.randomUUID()
    const { error } = await supabase
      .from('session_template_exercises')
      .update({ superset_group_id: newGroupId, section_title: before.section_title })
      .in('id', [beforeId, afterId])
    if (error) return { error: `Group failed: ${error.message}` }
    revalidatePath(`/library/sessions/${sessionId}`)
    return { error: null }
  }

  if (!beforeG && afterG) {
    const { data: groupRow, error: gErr } = await supabase
      .from('session_template_exercises')
      .select('section_title')
      .eq('session_template_id', sessionId)
      .eq('superset_group_id', afterG)
      .is('deleted_at', null)
      .limit(1)
      .single()
    if (gErr) return { error: `Lookup failed: ${gErr.message}` }
    const { error } = await supabase
      .from('session_template_exercises')
      .update({ superset_group_id: afterG, section_title: groupRow.section_title })
      .eq('id', beforeId)
    if (error) return { error: `Group failed: ${error.message}` }
    revalidatePath(`/library/sessions/${sessionId}`)
    return { error: null }
  }

  if (beforeG && !afterG) {
    const { data: groupRow, error: gErr } = await supabase
      .from('session_template_exercises')
      .select('section_title')
      .eq('session_template_id', sessionId)
      .eq('superset_group_id', beforeG)
      .is('deleted_at', null)
      .limit(1)
      .single()
    if (gErr) return { error: `Lookup failed: ${gErr.message}` }
    const { error } = await supabase
      .from('session_template_exercises')
      .update({ superset_group_id: beforeG, section_title: groupRow.section_title })
      .eq('id', afterId)
    if (error) return { error: `Group failed: ${error.message}` }
    revalidatePath(`/library/sessions/${sessionId}`)
    return { error: null }
  }

  // Adjacent different groups → merge into the upper group's id + section.
  const { data: upperRow, error: ugErr } = await supabase
    .from('session_template_exercises')
    .select('section_title')
    .eq('session_template_id', sessionId)
    .eq('superset_group_id', beforeG!)
    .is('deleted_at', null)
    .limit(1)
    .single()
  if (ugErr) return { error: `Lookup failed: ${ugErr.message}` }
  const { error } = await supabase
    .from('session_template_exercises')
    .update({ superset_group_id: beforeG, section_title: upperRow.section_title })
    .eq('session_template_id', sessionId)
    .eq('superset_group_id', afterG!)
    .is('deleted_at', null)
  if (error) return { error: `Merge failed: ${error.message}` }
  revalidatePath(`/library/sessions/${sessionId}`)
  return { error: null }
}

/** Ungroup one card; if its old group is left with a single survivor, that
 * survivor dissolves too. Leaver loses its section; survivor keeps it.
 * Cloned from ungroupFromSupersetAction. */
export async function ungroupSessionExerciseAction(
  sessionId: string,
  sessionExerciseId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { data: target } = await supabase
    .from('session_template_exercises')
    .select('id, session_template_id, superset_group_id')
    .eq('id', sessionExerciseId)
    .is('deleted_at', null)
    .single()
  if (!target || !target.superset_group_id) return { error: null }

  const oldGroupId = target.superset_group_id
  const { error: clearErr } = await supabase
    .from('session_template_exercises')
    .update({ superset_group_id: null, section_title: null })
    .eq('id', sessionExerciseId)
  if (clearErr) return { error: `Ungroup failed: ${clearErr.message}` }

  const { data: remaining } = await supabase
    .from('session_template_exercises')
    .select('id')
    .eq('session_template_id', target.session_template_id)
    .eq('superset_group_id', oldGroupId)
    .is('deleted_at', null)
  if (remaining && remaining.length === 1) {
    await supabase
      .from('session_template_exercises')
      .update({ superset_group_id: null })
      .eq('id', remaining[0]!.id)
  }

  revalidatePath(`/library/sessions/${sessionId}`)
  return { error: null }
}

/** Apply a section title to a card — and to every live member of its superset
 * group when grouped (section is a property of the block). Cloned from
 * updateSectionTitleAction. */
export async function updateSessionSectionTitleAction(
  sessionId: string,
  sessionExerciseId: string,
  value: string | null,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { data: target, error: lookupErr } = await supabase
    .from('session_template_exercises')
    .select('id, session_template_id, superset_group_id')
    .eq('id', sessionExerciseId)
    .is('deleted_at', null)
    .single()
  if (lookupErr || !target) {
    return { error: `Exercise not found: ${lookupErr?.message ?? 'unknown'}` }
  }

  const trimmed = value?.trim() ?? ''
  const newValue = trimmed === '' ? null : trimmed

  if (target.superset_group_id) {
    const { error } = await supabase
      .from('session_template_exercises')
      .update({ section_title: newValue })
      .eq('session_template_id', target.session_template_id)
      .eq('superset_group_id', target.superset_group_id)
      .is('deleted_at', null)
    if (error) return { error: `Update section: ${error.message}` }
  } else {
    const { error } = await supabase
      .from('session_template_exercises')
      .update({ section_title: newValue })
      .eq('id', sessionExerciseId)
    if (error) return { error: `Update section: ${error.message}` }
  }

  revalidatePath(`/library/sessions/${sessionId}`)
  return { error: null }
}

/** Add a section title to the org's section_titles list (the dropdown's
 * "+ Add new section…"). Shared org-level list; cloned from
 * addSectionTitleAction (free-text on the card, so a soft duplicate is fine). */
export async function addSessionSectionTitleAction(
  rawName: string,
): Promise<{ data: { id: string; name: string } | null; error: string | null }> {
  const { organizationId } = await requireRole(['owner', 'staff'])
  const name = rawName.trim()
  if (name.length === 0 || name.length > 60) {
    return { data: null, error: 'Section name must be 1–60 characters.' }
  }

  const supabase = await createSupabaseServerClient()
  const { data: maxRow } = await supabase
    .from('section_titles')
    .select('sort_order')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextOrder = (maxRow?.sort_order ?? 0) + 10

  const { data: inserted, error } = await supabase
    .from('section_titles')
    .insert({ organization_id: organizationId, name, sort_order: nextOrder })
    .select('id, name')
    .single()

  if (error) {
    if (error.code === '23505') {
      return { data: null, error: `A section called "${name}" already exists.` }
    }
    return { data: null, error: `Couldn't add section: ${error.message}` }
  }
  return { data: inserted, error: null }
}
