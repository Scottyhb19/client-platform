'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Server actions for the Library Circuits tab (C-4).
 * The circuit ENGINE (save_group_as_circuit / insert_circuit_into_day, both in
 * the session builder) lives in 20260624110000; these are the management
 * actions the Library surfaces — rename + soft-delete. Mirrors
 * program-template-actions.ts.
 */

/**
 * C-4 delete — soft-delete a circuit via the SECURITY DEFINER RPC
 * (20260624110000). A direct UPDATE setting deleted_at fails 42501 against the
 * deleted_at-IS-NULL SELECT policy; the RPC bypasses RLS for the UPDATE and
 * re-checks org/role in-body. Already-placed instances are independent copies,
 * unaffected (copy-on-apply).
 */
export async function deleteCircuitAction(
  circuitId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('soft_delete_circuit', { p_id: circuitId })

  if (error) return { error: `Delete failed: ${error.message}` }

  revalidatePath('/library')
  return { error: null }
}

/**
 * C-4 rename — a direct UPDATE of `name` is safe under RLS (the staff UPDATE
 * policy lets owner/staff write their org's live rows, and we're not touching
 * deleted_at). Case-insensitive duplicate-name guard mirrors
 * save_group_as_circuit's in-RPC guard.
 */
export async function renameCircuitAction(
  circuitId: string,
  rawName: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])

  const name = rawName.trim()
  if (name.length === 0 || name.length > 80) {
    return { error: 'Circuit name must be 1–80 characters.' }
  }

  const supabase = await createSupabaseServerClient()

  // Duplicate-name guard (case-insensitive), excluding this circuit. RLS scopes
  // the read to the caller's org, so we don't filter org explicitly.
  const { data: clash, error: clashErr } = await supabase
    .from('circuits')
    .select('id')
    .ilike('name', name)
    .is('deleted_at', null)
    .neq('id', circuitId)
    .limit(1)
    .maybeSingle()

  if (clashErr) return { error: `Rename failed: ${clashErr.message}` }
  if (clash) return { error: `A circuit called "${name}" already exists.` }

  // .select('id') so a zero-row match (deleted elsewhere / RLS) surfaces as an
  // error instead of a silent fake success.
  const { data: updated, error } = await supabase
    .from('circuits')
    .update({ name })
    .eq('id', circuitId)
    .is('deleted_at', null)
    .select('id')

  if (error) return { error: `Rename failed: ${error.message}` }
  if (!updated || updated.length === 0) {
    return { error: 'This circuit no longer exists — it may have been deleted.' }
  }

  revalidatePath('/library')
  return { error: null }
}

/* ====================== Circuit editor (#3 workbench) ====================== */
//
// The in-Library editor: author a circuit from scratch + edit add/remove
// exercises and prescriptions. All writes are RLS-guarded staff writes EXCEPT
// the two soft-deletes, which route through the SECURITY DEFINER RPCs
// (20260624120000) to dodge the deleted_at-IS-NULL SELECT-policy trap. Mirrors
// the session builder's day actions on the circuit tables.

export type CreateCircuitResult =
  | { circuitId: string }
  | { status: 'duplicate_name' }
  | { error: string }

/** Create an empty circuit (RLS staff INSERT), case-insensitive name-guarded. */
export async function createCircuitAction(
  rawName: string,
  circuitType: string,
  notes: string | null = null,
): Promise<CreateCircuitResult> {
  const { organizationId, userId } = await requireRole(['owner', 'staff'])

  const name = rawName.trim()
  if (name.length === 0 || name.length > 80) {
    return { error: 'Circuit name must be 1–80 characters.' }
  }
  if (!['superset', 'triset', 'circuit', 'finisher', 'warmup'].includes(circuitType)) {
    return { error: 'Pick a circuit type.' }
  }

  const supabase = await createSupabaseServerClient()

  const { data: clash } = await supabase
    .from('circuits')
    .select('id')
    .ilike('name', name)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()
  if (clash) return { status: 'duplicate_name' }

  const { data: created, error } = await supabase
    .from('circuits')
    .insert({
      organization_id: organizationId,
      created_by_user_id: userId,
      name,
      circuit_type: circuitType,
      notes,
    })
    .select('id')
    .single()

  if (error) return { error: `Couldn't create circuit: ${error.message}` }
  revalidatePath('/library')
  return { circuitId: created.id }
}

/** Update a circuit's name / type / notes (RLS staff UPDATE). */
export async function updateCircuitAction(
  circuitId: string,
  patch: { name?: string; circuit_type?: string; notes?: string | null },
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const clean: { name?: string; circuit_type?: string; notes?: string | null } = {}
  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (name.length === 0 || name.length > 80) {
      return { error: 'Circuit name must be 1–80 characters.' }
    }
    const { data: clash } = await supabase
      .from('circuits')
      .select('id')
      .ilike('name', name)
      .is('deleted_at', null)
      .neq('id', circuitId)
      .limit(1)
      .maybeSingle()
    if (clash) return { error: `A circuit called "${name}" already exists.` }
    clean.name = name
  }
  if (patch.circuit_type !== undefined) clean.circuit_type = patch.circuit_type
  if (patch.notes !== undefined) clean.notes = patch.notes
  if (Object.keys(clean).length === 0) return { error: null }

  const { error } = await supabase
    .from('circuits')
    .update(clean)
    .eq('id', circuitId)
    .is('deleted_at', null)

  if (error) return { error: `Update failed: ${error.message}` }
  revalidatePath(`/library/circuits/${circuitId}`)
  return { error: null }
}

/** Add an exercise to a circuit, fanning out the exercise's default sets. */
export async function addExerciseToCircuitAction(
  circuitId: string,
  exerciseId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { data: ex, error: exErr } = await supabase
    .from('exercises')
    .select('default_sets, default_reps, default_rep_metric, default_metric, default_metric_value')
    .eq('id', exerciseId)
    .is('deleted_at', null)
    .single()
  if (exErr || !ex) return { error: `Exercise not found: ${exErr?.message ?? 'unknown'}` }

  const { data: maxRow } = await supabase
    .from('circuit_exercises')
    .select('sort_order')
    .eq('circuit_id', circuitId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextSort = (maxRow?.sort_order ?? -1) + 1

  // Parent row carries the scalar defaults; the enforce-exercise-org trigger
  // (20260624100000) validates the exercise is in the circuit's org.
  const { data: ce, error: ceErr } = await supabase
    .from('circuit_exercises')
    .insert({
      circuit_id: circuitId,
      exercise_id: exerciseId,
      sort_order: nextSort,
      sets: ex.default_sets,
      reps: ex.default_reps,
      optional_metric: ex.default_metric,
      optional_value: ex.default_metric_value,
    })
    .select('id')
    .single()
  if (ceErr || !ce) return { error: `Couldn't add exercise: ${ceErr?.message ?? 'unknown'}` }

  const setCount = Math.min(Math.max(ex.default_sets ?? 1, 1), 50)
  const rows = Array.from({ length: setCount }, (_, i) => ({
    circuit_exercise_id: ce.id,
    set_number: i + 1,
    reps: ex.default_reps,
    rep_metric: ex.default_rep_metric,
    optional_metric: ex.default_metric,
    optional_value: ex.default_metric_value,
  }))
  const { error: setsErr } = await supabase.from('circuit_exercise_sets').insert(rows)
  if (setsErr) return { error: `Couldn't seed sets: ${setsErr.message}` }

  revalidatePath(`/library/circuits/${circuitId}`)
  return { error: null }
}

/** Remove an exercise from a circuit (SECURITY DEFINER soft-delete RPC). */
export async function removeCircuitExerciseAction(
  circuitId: string,
  circuitExerciseId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('soft_delete_circuit_exercise', {
    p_id: circuitExerciseId,
  })
  if (error) return { error: `Remove failed: ${error.message}` }
  revalidatePath(`/library/circuits/${circuitId}`)
  return { error: null }
}

/** Patch one set on a circuit exercise (RLS staff UPDATE; allowlisted fields). */
export async function updateCircuitExerciseSetAction(
  circuitId: string,
  setId: string,
  patch: { reps?: string | null; optional_metric?: string | null; optional_value?: string | null },
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const clean: { reps?: string | null; optional_metric?: string | null; optional_value?: string | null } = {}
  if ('reps' in patch) clean.reps = patch.reps
  if ('optional_metric' in patch) clean.optional_metric = patch.optional_metric
  if ('optional_value' in patch) clean.optional_value = patch.optional_value
  if (Object.keys(clean).length === 0) return { error: null }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('circuit_exercise_sets')
    .update(clean)
    .eq('id', setId)
    .is('deleted_at', null)
  if (error) return { error: `Update failed: ${error.message}` }
  revalidatePath(`/library/circuits/${circuitId}`)
  return { error: null }
}

/** Add a set to a circuit exercise, copying the last live set's values. */
export async function addCircuitExerciseSetAction(
  circuitId: string,
  circuitExerciseId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { data: last } = await supabase
    .from('circuit_exercise_sets')
    .select('set_number, reps, rep_metric, optional_metric, optional_value')
    .eq('circuit_exercise_id', circuitExerciseId)
    .is('deleted_at', null)
    .order('set_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { error } = await supabase.from('circuit_exercise_sets').insert({
    circuit_exercise_id: circuitExerciseId,
    set_number: (last?.set_number ?? 0) + 1,
    reps: last?.reps ?? null,
    rep_metric: last?.rep_metric ?? null,
    optional_metric: last?.optional_metric ?? null,
    optional_value: last?.optional_value ?? null,
  })
  if (error) return { error: `Couldn't add set: ${error.message}` }
  revalidatePath(`/library/circuits/${circuitId}`)
  return { error: null }
}

/** Remove one set (SECURITY DEFINER soft-delete RPC). */
export async function removeCircuitExerciseSetAction(
  circuitId: string,
  setId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('soft_delete_circuit_exercise_set', { p_id: setId })
  if (error) return { error: `Remove set failed: ${error.message}` }
  revalidatePath(`/library/circuits/${circuitId}`)
  return { error: null }
}

/** Bulk-set the volume unit (rep_metric) for every live set on a circuit exercise. */
export async function updateCircuitExerciseRepMetricAction(
  circuitId: string,
  circuitExerciseId: string,
  repMetric: string | null,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('circuit_exercise_sets')
    .update({ rep_metric: repMetric })
    .eq('circuit_exercise_id', circuitExerciseId)
    .is('deleted_at', null)
  if (error) return { error: `Set measure failed: ${error.message}` }
  revalidatePath(`/library/circuits/${circuitId}`)
  return { error: null }
}

/** Bulk-set the load metric (optional_metric) for every live set on a circuit exercise. */
export async function updateCircuitExerciseMetricAction(
  circuitId: string,
  circuitExerciseId: string,
  metric: string | null,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('circuit_exercise_sets')
    .update({ optional_metric: metric })
    .eq('circuit_exercise_id', circuitExerciseId)
    .is('deleted_at', null)
  if (error) return { error: `Set load metric failed: ${error.message}` }
  revalidatePath(`/library/circuits/${circuitId}`)
  return { error: null }
}
