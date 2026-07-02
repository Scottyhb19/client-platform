'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/*
 * Server actions for the in-Library PROGRAM-TEMPLATE editor (P-1/P-2,
 * docs/polish/library-sessions-programs.md, edit-existing v1). Same split as
 * the session editor: structural / multi-row / soft-delete operations route
 * through the SECURITY DEFINER template RPCs (20260624150000); single-row
 * autosave + grouping are direct RLS writes. Every action takes the template
 * id so it can revalidate the editor route (/library/programs/[templateId]),
 * and operates on the template_* tables by day / exercise / set id (RLS scopes
 * each to the caller's org). Week management is out of scope (v1).
 */

const revalidate = (templateId: string) =>
  revalidatePath(`/library/programs/${templateId}`)

export type TemplateInsertSlot =
  | { kind: 'append' }
  | { kind: 'atStart' }
  | { kind: 'after'; afterId: string }

export type TemplateExercisePatch = {
  rest_seconds?: number | null
  tempo?: string | null
  instructions?: string | null
  section_title?: string | null
}
export type TemplateSetPatch = {
  reps?: string | null
  optional_metric?: string | null
  optional_value?: string | null
}

const EDITABLE_EXERCISE_FIELDS = new Set<keyof TemplateExercisePatch>([
  'rest_seconds',
  'tempo',
  'instructions',
  'section_title',
])
const EDITABLE_SET_FIELDS = new Set<keyof TemplateSetPatch>([
  'reps',
  'optional_metric',
  'optional_value',
])

/* ====================== Day management (within existing weeks) ====================== */

/** Add a blank day to an existing week. Direct RLS INSERT; sort_order appends. */
export async function addTemplateDayAction(
  templateId: string,
  weekId: string,
  rawLabel: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const label = rawLabel.trim()
  if (label.length < 1 || label.length > 30) {
    return { error: 'Day name must be 1–30 characters.' }
  }
  const supabase = await createSupabaseServerClient()

  const { data: maxRow } = await supabase
    .from('template_days')
    .select('sort_order')
    .eq('template_week_id', weekId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextSort = (maxRow?.sort_order ?? -1) + 1

  const { error } = await supabase
    .from('template_days')
    .insert({ template_week_id: weekId, day_label: label, sort_order: nextSort })
  if (error) return { error: `Couldn't add day: ${error.message}` }
  revalidate(templateId)
  return { error: null }
}

export async function renameTemplateDayAction(
  templateId: string,
  dayId: string,
  rawLabel: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const label = rawLabel.trim()
  if (label.length < 1 || label.length > 30) {
    return { error: 'Day name must be 1–30 characters.' }
  }
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('template_days')
    .update({ day_label: label })
    .eq('id', dayId)
    .is('deleted_at', null)
  if (error) return { error: `Rename failed: ${error.message}` }
  revalidate(templateId)
  return { error: null }
}

/** Move a day up/down within its week (sort_order swap with its neighbour). */
export async function moveTemplateDayAction(
  templateId: string,
  weekId: string,
  dayId: string,
  direction: 'up' | 'down',
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { data: rows, error: readErr } = await supabase
    .from('template_days')
    .select('id, sort_order')
    .eq('template_week_id', weekId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
  if (readErr) return { error: `Read failed: ${readErr.message}` }
  if (!rows || rows.length === 0) return { error: 'Week has no days.' }

  const index = rows.findIndex((r) => r.id === dayId)
  if (index === -1) return { error: 'Day not found in this week.' }
  const neighbour = direction === 'up' ? index - 1 : index + 1
  if (neighbour < 0 || neighbour >= rows.length) return { error: null }

  const a = rows[index]!
  const b = rows[neighbour]!
  // Two-step swap via a sentinel to dodge any (week, sort_order) collision.
  const SENTINEL = -1
  const s1 = await supabase
    .from('template_days')
    .update({ sort_order: SENTINEL })
    .eq('id', a.id)
  if (s1.error) return { error: `Move failed: ${s1.error.message}` }
  const s2 = await supabase
    .from('template_days')
    .update({ sort_order: a.sort_order })
    .eq('id', b.id)
  if (s2.error) return { error: `Move failed: ${s2.error.message}` }
  const s3 = await supabase
    .from('template_days')
    .update({ sort_order: b.sort_order })
    .eq('id', a.id)
  if (s3.error) return { error: `Move failed: ${s3.error.message}` }

  revalidate(templateId)
  return { error: null }
}

export async function deleteTemplateDayAction(
  templateId: string,
  dayId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('soft_delete_template_day', { p_id: dayId })
  if (error) return { error: `Delete failed: ${error.message}` }
  revalidate(templateId)
  return { error: null }
}

export async function duplicateTemplateDayAction(
  templateId: string,
  dayId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('duplicate_template_day', {
    p_source_day_id: dayId,
  })
  if (error) return { error: `Duplicate failed: ${error.message}` }
  revalidate(templateId)
  return { error: null }
}

/* ====================== Editor — structural (RPC-backed) ====================== */

export async function addTemplateExerciseAction(
  templateId: string,
  dayId: string,
  exerciseId: string,
  slot: TemplateInsertSlot = { kind: 'append' },
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('insert_template_exercise_at', {
    p_day_id: dayId,
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
  revalidate(templateId)
  return { error: null }
}

export async function removeTemplateExerciseAction(
  templateId: string,
  templateExerciseId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('soft_delete_template_exercise', {
    p_id: templateExerciseId,
  })
  if (error) return { error: `Remove failed: ${error.message}` }
  revalidate(templateId)
  return { error: null }
}

export async function reorderTemplateExercisesAction(
  templateId: string,
  dayId: string,
  orderedIds: string[],
  movedId: string | null,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('reorder_template_exercises', {
    p_day_id: dayId,
    p_ordered_ids: orderedIds,
    p_moved_id: movedId as unknown as string,
  })
  if (error) return { error: `Reorder failed: ${error.message}` }
  revalidate(templateId)
  return { error: null }
}

export async function moveTemplateExerciseAction(
  templateId: string,
  dayId: string,
  templateExerciseId: string,
  direction: 'up' | 'down',
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { data: rows, error: readErr } = await supabase
    .from('template_exercises')
    .select('id')
    .eq('template_day_id', dayId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
  if (readErr) return { error: `Read failed: ${readErr.message}` }
  if (!rows || rows.length === 0) return { error: 'Day has no exercises.' }

  const index = rows.findIndex((r) => r.id === templateExerciseId)
  if (index === -1) return { error: 'Exercise not found in this day.' }
  const neighbour = direction === 'up' ? index - 1 : index + 1
  if (neighbour < 0 || neighbour >= rows.length) return { error: null }

  const orderedIds = rows.map((r) => r.id)
  ;[orderedIds[index], orderedIds[neighbour]] = [
    orderedIds[neighbour]!,
    orderedIds[index]!,
  ]

  const { error } = await supabase.rpc('reorder_template_exercises', {
    p_day_id: dayId,
    p_ordered_ids: orderedIds,
    p_moved_id: templateExerciseId,
  })
  if (error) return { error: `Move failed: ${error.message}` }
  revalidate(templateId)
  return { error: null }
}

export async function removeTemplateSetAction(
  templateId: string,
  setId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('soft_delete_template_exercise_set', {
    p_id: setId,
  })
  if (error) return { error: `Remove set failed: ${error.message}` }
  revalidate(templateId)
  return { error: null }
}

/* ====================== Editor — single-row (direct RLS) ====================== */

export async function updateTemplateExerciseAction(
  templateId: string,
  templateExerciseId: string,
  patch: TemplateExercisePatch,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const clean: TemplateExercisePatch = {}
  for (const key of Object.keys(patch) as Array<keyof TemplateExercisePatch>) {
    if (EDITABLE_EXERCISE_FIELDS.has(key)) {
      // @ts-expect-error — narrowing is exhaustive via the allowlist above
      clean[key] = patch[key]
    }
  }
  if (Object.keys(clean).length === 0) return { error: null }
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('template_exercises')
    .update(clean)
    .eq('id', templateExerciseId)
    .is('deleted_at', null)
  if (error) return { error: `Update failed: ${error.message}` }
  revalidate(templateId)
  return { error: null }
}

export async function updateTemplateSetAction(
  templateId: string,
  setId: string,
  patch: TemplateSetPatch,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const clean: TemplateSetPatch = {}
  for (const key of Object.keys(patch) as Array<keyof TemplateSetPatch>) {
    if (EDITABLE_SET_FIELDS.has(key)) {
      clean[key] = patch[key]
    }
  }
  if (Object.keys(clean).length === 0) return { error: null }
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('template_exercise_sets')
    .update(clean)
    .eq('id', setId)
    .is('deleted_at', null)
  if (error) return { error: `Update failed: ${error.message}` }
  revalidate(templateId)
  return { error: null }
}

/**
 * Column autofill — the session builder's downward follow-the-value rule
 * cloned onto program-template sets (parity capture 2026-07-03). See
 * autofillSessionSetColumnAction / autofillProgramExerciseSetColumnAction.
 */
export async function autofillTemplateSetColumnAction(
  templateId: string,
  templateExerciseId: string,
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

  const patch: TemplateSetPatch = { [field]: trimmed }
  const supabase = await createSupabaseServerClient()

  const { error: fillErr } = await supabase
    .from('template_exercise_sets')
    .update(patch)
    .eq('template_exercise_id', templateExerciseId)
    .is('deleted_at', null)
    .gt('set_number', belowSetNumber)
    .is(field, null)
  if (fillErr) return { error: `Autofill failed: ${fillErr.message}` }

  const prev = (previousValue ?? '').trim()
  if (prev !== '' && prev !== trimmed) {
    const { error: followErr } = await supabase
      .from('template_exercise_sets')
      .update(patch)
      .eq('template_exercise_id', templateExerciseId)
      .is('deleted_at', null)
      .gt('set_number', belowSetNumber)
      .eq(field, prev)
    if (followErr) return { error: `Autofill failed: ${followErr.message}` }
  }

  revalidate(templateId)
  return { error: null }
}

export async function addTemplateSetAction(
  templateId: string,
  templateExerciseId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { data: lastSet, error: lookupErr } = await supabase
    .from('template_exercise_sets')
    .select('set_number, reps, rep_metric, optional_metric, optional_value')
    .eq('template_exercise_id', templateExerciseId)
    .is('deleted_at', null)
    .order('set_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (lookupErr) return { error: `Couldn't read last set: ${lookupErr.message}` }

  const nextSetNumber = (lastSet?.set_number ?? 0) + 1
  const { error } = await supabase.from('template_exercise_sets').insert({
    template_exercise_id: templateExerciseId,
    set_number: nextSetNumber,
    reps: lastSet?.reps ?? null,
    rep_metric: lastSet?.rep_metric ?? null,
    optional_metric: lastSet?.optional_metric ?? null,
    optional_value: lastSet?.optional_value ?? null,
  })
  if (error) return { error: `Couldn't add set: ${error.message}` }
  revalidate(templateId)
  return { error: null }
}

export async function updateTemplateRepMetricAction(
  templateId: string,
  templateExerciseId: string,
  repMetric: string | null,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('template_exercise_sets')
    .update({ rep_metric: repMetric })
    .eq('template_exercise_id', templateExerciseId)
    .is('deleted_at', null)
  if (error) return { error: `Set measure failed: ${error.message}` }
  revalidate(templateId)
  return { error: null }
}

export async function updateTemplateMetricAction(
  templateId: string,
  templateExerciseId: string,
  metric: string | null,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('template_exercise_sets')
    .update({ optional_metric: metric })
    .eq('template_exercise_id', templateExerciseId)
    .is('deleted_at', null)
  if (error) return { error: `Set metric failed: ${error.message}` }
  revalidate(templateId)
  return { error: null }
}

/* ====================== Editor — grouping + sections (direct RLS) ====================== */

export async function groupTemplateAcrossAction(
  templateId: string,
  dayId: string,
  beforeId: string,
  afterId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { data: pair, error: lookupErr } = await supabase
    .from('template_exercises')
    .select('id, sort_order, superset_group_id, section_title')
    .eq('template_day_id', dayId)
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
      .from('template_exercises')
      .update({ superset_group_id: newGroupId, section_title: before.section_title })
      .in('id', [beforeId, afterId])
    if (error) return { error: `Group failed: ${error.message}` }
    revalidate(templateId)
    return { error: null }
  }

  if (!beforeG && afterG) {
    const { data: groupRow, error: gErr } = await supabase
      .from('template_exercises')
      .select('section_title')
      .eq('template_day_id', dayId)
      .eq('superset_group_id', afterG)
      .is('deleted_at', null)
      .limit(1)
      .single()
    if (gErr) return { error: `Lookup failed: ${gErr.message}` }
    const { error } = await supabase
      .from('template_exercises')
      .update({ superset_group_id: afterG, section_title: groupRow.section_title })
      .eq('id', beforeId)
    if (error) return { error: `Group failed: ${error.message}` }
    revalidate(templateId)
    return { error: null }
  }

  if (beforeG && !afterG) {
    const { data: groupRow, error: gErr } = await supabase
      .from('template_exercises')
      .select('section_title')
      .eq('template_day_id', dayId)
      .eq('superset_group_id', beforeG)
      .is('deleted_at', null)
      .limit(1)
      .single()
    if (gErr) return { error: `Lookup failed: ${gErr.message}` }
    const { error } = await supabase
      .from('template_exercises')
      .update({ superset_group_id: beforeG, section_title: groupRow.section_title })
      .eq('id', afterId)
    if (error) return { error: `Group failed: ${error.message}` }
    revalidate(templateId)
    return { error: null }
  }

  // Adjacent different groups → merge into the upper group's id + section.
  const { data: upperRow, error: ugErr } = await supabase
    .from('template_exercises')
    .select('section_title')
    .eq('template_day_id', dayId)
    .eq('superset_group_id', beforeG!)
    .is('deleted_at', null)
    .limit(1)
    .single()
  if (ugErr) return { error: `Lookup failed: ${ugErr.message}` }
  const { error } = await supabase
    .from('template_exercises')
    .update({ superset_group_id: beforeG, section_title: upperRow.section_title })
    .eq('template_day_id', dayId)
    .eq('superset_group_id', afterG!)
    .is('deleted_at', null)
  if (error) return { error: `Merge failed: ${error.message}` }
  revalidate(templateId)
  return { error: null }
}

export async function ungroupTemplateExerciseAction(
  templateId: string,
  templateExerciseId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { data: target } = await supabase
    .from('template_exercises')
    .select('id, template_day_id, superset_group_id')
    .eq('id', templateExerciseId)
    .is('deleted_at', null)
    .single()
  if (!target || !target.superset_group_id) return { error: null }

  const oldGroupId = target.superset_group_id
  const { error: clearErr } = await supabase
    .from('template_exercises')
    .update({ superset_group_id: null, section_title: null })
    .eq('id', templateExerciseId)
  if (clearErr) return { error: `Ungroup failed: ${clearErr.message}` }

  const { data: remaining } = await supabase
    .from('template_exercises')
    .select('id')
    .eq('template_day_id', target.template_day_id)
    .eq('superset_group_id', oldGroupId)
    .is('deleted_at', null)
  if (remaining && remaining.length === 1) {
    await supabase
      .from('template_exercises')
      .update({ superset_group_id: null })
      .eq('id', remaining[0]!.id)
  }

  revalidate(templateId)
  return { error: null }
}

export async function updateTemplateSectionTitleAction(
  templateId: string,
  templateExerciseId: string,
  value: string | null,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { data: target, error: lookupErr } = await supabase
    .from('template_exercises')
    .select('id, template_day_id, superset_group_id')
    .eq('id', templateExerciseId)
    .is('deleted_at', null)
    .single()
  if (lookupErr || !target) {
    return { error: `Exercise not found: ${lookupErr?.message ?? 'unknown'}` }
  }

  const trimmed = value?.trim() ?? ''
  const newValue = trimmed === '' ? null : trimmed

  if (target.superset_group_id) {
    const { error } = await supabase
      .from('template_exercises')
      .update({ section_title: newValue })
      .eq('template_day_id', target.template_day_id)
      .eq('superset_group_id', target.superset_group_id)
      .is('deleted_at', null)
    if (error) return { error: `Update section: ${error.message}` }
  } else {
    const { error } = await supabase
      .from('template_exercises')
      .update({ section_title: newValue })
      .eq('id', templateExerciseId)
    if (error) return { error: `Update section: ${error.message}` }
  }

  revalidate(templateId)
  return { error: null }
}
