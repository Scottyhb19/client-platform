'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Add an exercise to a program_day by copying the exercise's defaults
 * onto a new program_exercises row. sort_order = (max + 1) so it lands
 * at the bottom.
 *
 * RLS scopes the insert via the parent chain (program_day → program
 * → organization).
 */
export async function addExerciseToDayAction(
  clientId: string,
  dayId: string,
  exerciseId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  // Pull the exercise defaults so the prescription starts sensibly.
  const { data: exercise, error: exErr } = await supabase
    .from('exercises')
    .select(
      `id, default_sets, default_reps, default_metric,
       default_metric_value, default_rpe, default_rest_seconds,
       instructions`,
    )
    .eq('id', exerciseId)
    .is('deleted_at', null)
    .single()

  if (exErr || !exercise) {
    return { error: `Exercise not found: ${exErr?.message ?? 'unknown'}` }
  }

  // Work out sort_order for appending.
  const { data: existing, error: orderErr } = await supabase
    .from('program_exercises')
    .select('sort_order')
    .eq('program_day_id', dayId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (orderErr) return { error: `Couldn't compute sort order: ${orderErr.message}` }
  const nextOrder = (existing?.sort_order ?? -1) + 1

  const { error: insertErr } = await supabase.from('program_exercises').insert({
    program_day_id: dayId,
    exercise_id: exercise.id,
    sets: exercise.default_sets,
    reps: exercise.default_reps,
    optional_metric: exercise.default_metric,
    optional_value: exercise.default_metric_value,
    rpe: exercise.default_rpe,
    rest_seconds: exercise.default_rest_seconds,
    instructions: exercise.instructions,
    sort_order: nextOrder,
  })

  if (insertErr) {
    return { error: `Couldn't add exercise: ${insertErr.message}` }
  }

  revalidatePath(`/clients/${clientId}/program/days/${dayId}`)
  return { error: null }
}

/**
 * Soft-delete a program_exercise row (sets deleted_at=now()).
 * RLS enforces scope; we just need the id.
 */
export async function removeProgramExerciseAction(
  clientId: string,
  dayId: string,
  programExerciseId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from('program_exercises')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', programExerciseId)

  if (error) return { error: `Remove failed: ${error.message}` }

  revalidatePath(`/clients/${clientId}/program/days/${dayId}`)
  return { error: null }
}

/**
 * Patch a program_exercise row (single-field autosave). Validates the
 * field key against an allowlist so the client can't poke at
 * program_day_id, exercise_id, etc.
 */
export type ProgramExercisePatch = {
  sets?: number | null
  reps?: string | null
  optional_value?: string | null
  rpe?: number | null
  rest_seconds?: number | null
  tempo?: string | null
  instructions?: string | null
  section_title?: string | null
}

const EDITABLE_FIELDS = new Set<keyof ProgramExercisePatch>([
  'sets',
  'reps',
  'optional_value',
  'rpe',
  'rest_seconds',
  'tempo',
  'instructions',
  'section_title',
])

export async function updateProgramExerciseAction(
  programExerciseId: string,
  patch: ProgramExercisePatch,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])

  const clean: ProgramExercisePatch = {}
  for (const key of Object.keys(patch) as Array<keyof ProgramExercisePatch>) {
    if (EDITABLE_FIELDS.has(key)) {
      // @ts-expect-error — narrowing is exhaustive via the allowlist above
      clean[key] = patch[key]
    }
  }

  if (Object.keys(clean).length === 0) return { error: null }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('program_exercises')
    .update(clean)
    .eq('id', programExerciseId)

  if (error) return { error: `Update failed: ${error.message}` }

  return { error: null }
}

/**
 * Reorder a program_exercise up or down by one position. Swaps
 * sort_order with the adjacent row within the same program_day.
 */
export async function moveProgramExerciseAction(
  clientId: string,
  dayId: string,
  programExerciseId: string,
  direction: 'up' | 'down',
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { data: target, error: targetErr } = await supabase
    .from('program_exercises')
    .select('id, sort_order, program_day_id')
    .eq('id', programExerciseId)
    .is('deleted_at', null)
    .single()

  if (targetErr || !target) {
    return { error: `Exercise not found: ${targetErr?.message ?? 'unknown'}` }
  }

  // Find the neighbour on the relevant side.
  const { data: neighbour, error: neighbourErr } = await supabase
    .from('program_exercises')
    .select('id, sort_order')
    .eq('program_day_id', target.program_day_id)
    .is('deleted_at', null)
    .filter(
      'sort_order',
      direction === 'up' ? 'lt' : 'gt',
      target.sort_order,
    )
    .order('sort_order', { ascending: direction !== 'up' })
    .limit(1)
    .maybeSingle()

  if (neighbourErr) return { error: `Neighbour lookup: ${neighbourErr.message}` }
  if (!neighbour) return { error: null } // already at the edge; no-op

  // Swap via a sentinel value to avoid any unique-constraint collision if
  // (day_id, sort_order) is ever promoted to UNIQUE in a future migration.
  const sentinel = -1 - target.sort_order
  const steps = [
    { id: target.id, sort_order: sentinel },
    { id: neighbour.id, sort_order: target.sort_order },
    { id: target.id, sort_order: neighbour.sort_order },
  ]
  for (const step of steps) {
    const { error: stepErr } = await supabase
      .from('program_exercises')
      .update({ sort_order: step.sort_order })
      .eq('id', step.id)
    if (stepErr) return { error: `Swap failed: ${stepErr.message}` }
  }

  revalidatePath(`/clients/${clientId}/program/days/${dayId}`)
  return { error: null }
}

/**
 * Group a program_exercise into a superset with the exercise immediately
 * above it (by sort_order). If the above exercise already has a
 * superset_group_id, we join it; otherwise we mint a new UUID and set
 * both rows to the same value. Not allowed on the first exercise.
 */
export async function groupWithAboveAction(
  clientId: string,
  dayId: string,
  programExerciseId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { data: target } = await supabase
    .from('program_exercises')
    .select('id, sort_order, program_day_id')
    .eq('id', programExerciseId)
    .is('deleted_at', null)
    .single()

  if (!target) return { error: 'Exercise not found.' }

  const { data: above } = await supabase
    .from('program_exercises')
    .select('id, sort_order, superset_group_id')
    .eq('program_day_id', target.program_day_id)
    .is('deleted_at', null)
    .lt('sort_order', target.sort_order)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!above) {
    return { error: "Can't group the first exercise." }
  }

  const groupId = above.superset_group_id ?? crypto.randomUUID()

  // Ensure the above exercise has the group id (if it was standalone).
  if (!above.superset_group_id) {
    const { error: aboveErr } = await supabase
      .from('program_exercises')
      .update({ superset_group_id: groupId })
      .eq('id', above.id)
    if (aboveErr) return { error: `Couldn't group: ${aboveErr.message}` }
  }

  const { error: targetErr } = await supabase
    .from('program_exercises')
    .update({ superset_group_id: groupId })
    .eq('id', programExerciseId)

  if (targetErr) return { error: `Couldn't group: ${targetErr.message}` }

  revalidatePath(`/clients/${clientId}/program/days/${dayId}`)
  return { error: null }
}

/**
 * Ungroup an exercise from its superset. If the remaining group has
 * only one member left, clear that exercise's group id too — a
 * singleton superset is meaningless and reads as a regular exercise.
 */
export async function ungroupFromSupersetAction(
  clientId: string,
  dayId: string,
  programExerciseId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { data: target } = await supabase
    .from('program_exercises')
    .select('id, program_day_id, superset_group_id')
    .eq('id', programExerciseId)
    .is('deleted_at', null)
    .single()

  if (!target || !target.superset_group_id) return { error: null }

  const oldGroupId = target.superset_group_id

  // Clear this exercise's group.
  const { error: clearErr } = await supabase
    .from('program_exercises')
    .update({ superset_group_id: null })
    .eq('id', programExerciseId)
  if (clearErr) return { error: `Ungroup failed: ${clearErr.message}` }

  // Check how many members remain in the old group within this day.
  const { data: remaining } = await supabase
    .from('program_exercises')
    .select('id')
    .eq('program_day_id', target.program_day_id)
    .eq('superset_group_id', oldGroupId)
    .is('deleted_at', null)

  if (remaining && remaining.length === 1) {
    await supabase
      .from('program_exercises')
      .update({ superset_group_id: null })
      .eq('id', remaining[0].id)
  }

  revalidatePath(`/clients/${clientId}/program/days/${dayId}`)
  return { error: null }
}
