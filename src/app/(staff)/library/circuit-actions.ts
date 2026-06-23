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

/* ============== Card-parity additions (NEXT pass, 2026-06-24) ==============
 * The in-Library editor carbon-copies the session builder's card, which edits
 * the scalar parent fields (instructions / rest / tempo) and reorders rows.
 * These two actions back that left column — they mirror updateProgramExerciseAction
 * and moveProgramExerciseAction on the circuit tables. No migration: the columns
 * (instructions, rest_seconds, tempo, sort_order) already exist on circuit_exercises
 * (20260624100000). RLS staff-UPDATE via parent; no soft-delete trap (we never
 * touch deleted_at), so a direct UPDATE is correct.
 */

/**
 * Patch a circuit_exercise's scalar parent fields (single-field autosave).
 * Allowlisted so the client can't poke at circuit_id, exercise_id, sort_order,
 * timestamps, or deleted_at. Mirrors updateProgramExerciseAction; circuits have
 * no section_title (a circuit is one group), so it's omitted from the allowlist.
 */
export type CircuitExercisePatch = {
  rest_seconds?: number | null
  tempo?: string | null
  instructions?: string | null
}

const EDITABLE_CIRCUIT_EXERCISE_FIELDS = new Set<keyof CircuitExercisePatch>([
  'rest_seconds',
  'tempo',
  'instructions',
])

export async function updateCircuitExerciseAction(
  circuitId: string,
  circuitExerciseId: string,
  patch: CircuitExercisePatch,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])

  const clean: CircuitExercisePatch = {}
  for (const key of Object.keys(patch) as Array<keyof CircuitExercisePatch>) {
    if (EDITABLE_CIRCUIT_EXERCISE_FIELDS.has(key)) {
      // @ts-expect-error — narrowing is exhaustive via the allowlist above
      clean[key] = patch[key]
    }
  }
  if (Object.keys(clean).length === 0) return { error: null }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('circuit_exercises')
    .update(clean)
    .eq('id', circuitExerciseId)
    .is('deleted_at', null)

  if (error) return { error: `Update failed: ${error.message}` }
  revalidatePath(`/library/circuits/${circuitId}`)
  return { error: null }
}

/**
 * Move a circuit exercise up or down one position (the ↑/↓ arrow buttons).
 * Swaps the two adjacent rows' sort_order values — circuits have no superset
 * regrouping to re-derive (the whole circuit IS one group), so this is the
 * simple value-swap, not the builder's reorder RPC. Distinct sort_orders are
 * an invariant of the writers (addExerciseToCircuit appends MAX+1;
 * save_group_as_circuit copies sequential orders), so the two values never
 * collide. There is no unique index on (circuit_id, sort_order), so the two
 * UPDATEs need no transient-collision dance.
 */
export async function moveCircuitExerciseAction(
  circuitId: string,
  circuitExerciseId: string,
  direction: 'up' | 'down',
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { data: rows, error: readErr } = await supabase
    .from('circuit_exercises')
    .select('id, sort_order')
    .eq('circuit_id', circuitId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })

  if (readErr) return { error: `Read failed: ${readErr.message}` }
  if (!rows || rows.length === 0) return { error: 'Circuit has no exercises.' }

  const index = rows.findIndex((r) => r.id === circuitExerciseId)
  if (index === -1) return { error: 'Exercise not found in this circuit.' }

  const neighbourIndex = direction === 'up' ? index - 1 : index + 1
  if (neighbourIndex < 0 || neighbourIndex >= rows.length) {
    // Already at the edge — silent no-op so the arrow's disabled state is a
    // soft guarantee, not the only safeguard.
    return { error: null }
  }

  const target = rows[index]!
  const neighbour = rows[neighbourIndex]!

  const { error: e1 } = await supabase
    .from('circuit_exercises')
    .update({ sort_order: neighbour.sort_order })
    .eq('id', target.id)
    .is('deleted_at', null)
  if (e1) return { error: `Move failed: ${e1.message}` }

  const { error: e2 } = await supabase
    .from('circuit_exercises')
    .update({ sort_order: target.sort_order })
    .eq('id', neighbour.id)
    .is('deleted_at', null)
  if (e2) return { error: `Move failed: ${e2.message}` }

  revalidatePath(`/library/circuits/${circuitId}`)
  return { error: null }
}

/**
 * Reorder a circuit's exercises to an explicit new order (drag-and-drop, which
 * yields the full permutation, not a one-step move). Assigns sort_order = index
 * for each id. No superset re-derivation (a circuit IS one group) and no
 * (circuit_id, sort_order) unique index, so there's no collision dance — unlike
 * the builder's reorder_program_exercises RPC. Plain RLS staff-writes (no new
 * RPC/migration); each UPDATE is scoped to this circuit by the circuit_id filter
 * so a foreign id can't be reordered in. Non-atomic (N writes, run in parallel)
 * but template data at F&F scope — a partial failure just needs another drag.
 */
export async function reorderCircuitExercisesAction(
  circuitId: string,
  orderedIds: string[],
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  if (orderedIds.length === 0) return { error: null }
  const supabase = await createSupabaseServerClient()

  const results = await Promise.all(
    orderedIds.map((id, i) =>
      supabase
        .from('circuit_exercises')
        .update({ sort_order: i })
        .eq('id', id)
        .eq('circuit_id', circuitId)
        .is('deleted_at', null),
    ),
  )
  const failed = results.find((r) => r.error)
  if (failed?.error) return { error: `Reorder failed: ${failed.error.message}` }

  revalidatePath(`/library/circuits/${circuitId}`)
  return { error: null }
}
