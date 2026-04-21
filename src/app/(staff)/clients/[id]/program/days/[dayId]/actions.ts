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
