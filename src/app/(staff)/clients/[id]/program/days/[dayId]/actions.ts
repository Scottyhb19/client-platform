'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Where to insert an exercise when calling addExerciseToDayAction.
 *
 *   append  — MAX(sort_order)+1; today's behaviour. The bottom between-cards
 *             bar and any default library-pick (no slot armed) end up here.
 *   atStart — sort_order 0; existing rows shifted +1. The top between-cards
 *             bar.
 *   after   — sort_order = anchor.sort_order + 1; downstream rows shifted +1.
 *             Body between-cards bars carry an anchor pe id.
 *
 * Phase D of the session-builder polish pass (/docs/polish/session-builder.md
 * §4 row D + §0.1 ø-1, ø-3).
 */
export type InsertSlot =
  | { kind: 'append' }
  | { kind: 'atStart' }
  | { kind: 'after'; afterPeId: string }

/**
 * Add an exercise to a program_day at a given slot. All three slots route
 * through the insert_program_exercise_at RPC (migration 20260612110000),
 * so insert + per-set fan-out from the exercise's defaults — and the
 * sort_order shift where the slot needs one — is atomic under one
 * transaction. The RPC handles group inheritance internally per Q3
 * sign-off 2026-05-07: anchor and below share a superset_group_id ⇒ new
 * row inherits it; otherwise solo. Appends and top inserts always start
 * solo.
 *
 * History: until G-3 of the program-engine polish pass (2026-06-12) the
 * append slot ran a TS-side three-call sequence (read defaults, insert
 * parent, fan out sets) with soft-delete compensation — one of two
 * default-application paths that had to be kept field-identical by hand.
 * Converged on the RPC per exercise-library rider 2.
 */
export async function addExerciseToDayAction(
  clientId: string,
  dayId: string,
  exerciseId: string,
  slot: InsertSlot = { kind: 'append' },
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase.rpc('insert_program_exercise_at', {
    p_day_id: dayId,
    p_exercise_id: exerciseId,
    // p_after_pe_id is nullable in SQL (only the 'after' slot carries an
    // anchor), but generated types treat function args as non-null. Cast
    // at the call site so the rest of the file stays clean.
    p_after_pe_id: (slot.kind === 'after'
      ? slot.afterPeId
      : null) as unknown as string,
    p_slot:
      slot.kind === 'after'
        ? 'after'
        : slot.kind === 'atStart'
          ? 'at_start'
          : 'append',
  })
  if (error) return { error: `Couldn't insert exercise: ${error.message}` }

  revalidatePath(`/clients/${clientId}/program/days/${dayId}`)
  return { error: null }
}

/**
 * Swap an exercise in place — replace one program_exercise row with another
 * at the same slot (sort_order, section_title, superset_group_id), and
 * fan out fresh per-set rows from the new exercise's defaults.
 *
 * Routes through the swap_program_exercise SECURITY DEFINER RPC
 * (migration 20260507100400) so soft-delete + insert + per-set fan-out
 * happens in one transaction. A sequence of supabase-js calls would leak
 * mid-swap orphans on revalidate (Q1 sign-off 2026-05-07).
 *
 * Old prescription is discarded (Q2 sign-off): the EP picked a different
 * exercise, defaults speak for the new exercise. Set count resets to the
 * new exercise's default_sets (or 1 when NULL) — the stepper is one click
 * away if the EP wants to override.
 *
 * History (exercise_logs / set_logs) survives because exercise_logs.
 * exercise_id is a direct FK to exercises that doesn't change on swap;
 * Phase H "Last logged" lookups key off exercise_id, so the footer
 * correctly resets to the new exercise's history.
 */
export async function swapProgramExerciseAction(
  clientId: string,
  dayId: string,
  programExerciseId: string,
  newExerciseId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase.rpc('swap_program_exercise', {
    p_pe_id: programExerciseId,
    p_new_exercise_id: newExerciseId,
  })

  if (error) return { error: `Swap failed: ${error.message}` }

  revalidatePath(`/clients/${clientId}/program/days/${dayId}`)
  return { error: null }
}

/**
 * Soft-delete a program_exercise row via the soft_delete_program_exercise
 * RPC (migration 20260429130000). Direct UPDATE setting deleted_at fails
 * 42501 because the SELECT policy filters deleted_at IS NULL; the RPC
 * bypasses RLS for the UPDATE and re-implements the org check inside via
 * the parent walk (program_days → program_weeks → programs).
 */
export async function removeProgramExerciseAction(
  clientId: string,
  dayId: string,
  programExerciseId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase.rpc('soft_delete_program_exercise', {
    p_id: programExerciseId,
  })

  if (error) return { error: `Remove failed: ${error.message}` }

  revalidatePath(`/clients/${clientId}/program/days/${dayId}`)
  return { error: null }
}

/**
 * Patch a program_exercise row (single-field autosave). Validates the
 * field key against an allowlist so the client can't poke at
 * program_day_id, exercise_id, etc.
 *
 * Phase C (2026-05-07): per-set fields (sets / reps / optional_value /
 * rpe) moved off program_exercises onto program_exercise_sets and are
 * patched via updateProgramExerciseSetAction below. The remaining fields
 * here are genuinely per-exercise (instructions, tempo, rest, section
 * title) and stay on the parent row.
 */
export type ProgramExercisePatch = {
  rest_seconds?: number | null
  tempo?: string | null
  instructions?: string | null
  section_title?: string | null
}

const EDITABLE_FIELDS = new Set<keyof ProgramExercisePatch>([
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
 * Atomic full-list reorder. Phase G of the session-builder polish pass —
 * drag-and-drop via @dnd-kit produces "the new order", not "this one moved
 * to that index". A multi-position drag through chained adjacent swaps
 * would be (a) non-atomic across N round-trips, (b) momentarily expose
 * intermediate sort_order states via realtime, and (c) re-introduce the
 * partial-failure window we already closed for inserts via
 * insert_program_exercise_at.
 *
 * orderedIds must be a permutation of the day's live program_exercise ids.
 * The RPC validates this server-side; the client just sends what the DnD
 * library gave it.
 *
 * movedPeId is a hint — the id of the card the user dragged. The server
 * uses it to re-derive that one card's superset_group_id from its new
 * neighbours (Q3 sign-off 2026-05-07: server re-derives from position).
 * Other cards keep their group_id; singleton cleanup runs at the end so
 * any group reduced to a single member by the move dissolves. Pass NULL
 * for sort-order-only reorders that should not touch group membership.
 *
 * RLS scoped via the parent walk in the RPC (single-hop via pd.program_id
 * post-D-PROG-001).
 */
export async function reorderProgramExercisesAction(
  clientId: string,
  dayId: string,
  orderedIds: string[],
  movedPeId: string | null,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase.rpc('reorder_program_exercises', {
    p_day_id: dayId,
    p_ordered_ids: orderedIds,
    // p_moved_pe_id is nullable in SQL but the generated types treat it as
    // non-null. Cast at the call site so the rest of the file stays clean.
    p_moved_pe_id: movedPeId as unknown as string,
  })

  if (error) return { error: `Reorder failed: ${error.message}` }

  revalidatePath(`/clients/${clientId}/program/days/${dayId}`)
  return { error: null }
}

/**
 * Reorder a program_exercise up or down by one position. The keyboard-
 * accessible fallback for the up/down arrow buttons; drag-and-drop hits
 * reorderProgramExercisesAction above.
 *
 * Phase G hot-fix (2026-05-07): the arrow now delegates to the same
 * reorder_program_exercises RPC that DnD uses, instead of doing a bare
 * sentinel-swap of sort_orders. Reason: a bare swap leaves
 * superset_group_id untouched, so clicking ↑ on the first member of a
 * superset would push that member above an outsider — same group_id, no
 * longer contiguous in sort_order — which is an invalid state the
 * ExerciseList walker can't render (duplicate React key on the group's
 * SupersetBlock). Routing through the RPC means the arrow inherits the
 * group-rederivation rule + singleton cleanup, matching DnD semantics
 * exactly.
 *
 * Implementation: read the day's live ids in sort_order, swap the target
 * with its neighbour client-side, hand the new permutation to the RPC.
 * The RPC re-validates and applies atomically.
 */
export async function moveProgramExerciseAction(
  clientId: string,
  dayId: string,
  programExerciseId: string,
  direction: 'up' | 'down',
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { data: rows, error: readErr } = await supabase
    .from('program_exercises')
    .select('id')
    .eq('program_day_id', dayId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })

  if (readErr) return { error: `Read failed: ${readErr.message}` }
  if (!rows || rows.length === 0) return { error: 'Day has no exercises.' }

  const index = rows.findIndex((r) => r.id === programExerciseId)
  if (index === -1) return { error: 'Exercise not found on this day.' }

  const neighbourIndex = direction === 'up' ? index - 1 : index + 1
  if (neighbourIndex < 0 || neighbourIndex >= rows.length) {
    // Already at the edge — silent no-op so the arrow's disabled state is
    // a soft guarantee, not the only safeguard.
    return { error: null }
  }

  const orderedIds = rows.map((r) => r.id)
  ;[orderedIds[index], orderedIds[neighbourIndex]] = [
    orderedIds[neighbourIndex]!,
    orderedIds[index]!,
  ]

  const { error: rpcErr } = await supabase.rpc('reorder_program_exercises', {
    p_day_id: dayId,
    p_ordered_ids: orderedIds,
    p_moved_pe_id: programExerciseId,
  })

  if (rpcErr) return { error: `Move failed: ${rpcErr.message}` }

  revalidatePath(`/clients/${clientId}/program/days/${dayId}`)
  return { error: null }
}

/**
 * Group the two cards on either side of a between-cards action bar. Replaces
 * groupWithAboveAction (deleted in Phase D, 2026-05-07) — the new bar
 * placement makes "the relationship between these two cards" the natural
 * primitive, so the action takes both pe ids explicitly.
 *
 * Q3 sign-off 2026-05-07 covers four cases:
 *
 *   - Both ungrouped → mint a new UUID, both adopt it (fresh group).
 *   - One ungrouped, one grouped (boundary) → ungrouped joins the existing
 *     group.
 *   - Both grouped, different groups (adjacent groups) → merge into the
 *     upper group's id (canonical so the visual letter A/B/C of the upper
 *     group stays stable on render).
 *   - Both grouped, same group → no-op (the UI hides the Superset button
 *     when both share a group, but defensive).
 *
 * The caller (BetweenCardsBar) is responsible for only showing the Superset
 * button when grouping makes sense; this action stays self-consistent if
 * a stale render slips one through.
 */
export async function groupAcrossActionBarAction(
  clientId: string,
  dayId: string,
  beforePeId: string,
  afterPeId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  // Phase J (2026-05-08): section_title now follows the group across every
  // grouping branch below — the upper card/group is canonical for both id
  // and section, mirroring the existing id-merge rule. See migration
  // 20260508120000 for the matching reorder-path reconciliation.
  const { data: pair, error: lookupErr } = await supabase
    .from('program_exercises')
    .select('id, sort_order, superset_group_id, section_title')
    .eq('program_day_id', dayId)
    .in('id', [beforePeId, afterPeId])
    .is('deleted_at', null)

  if (lookupErr) return { error: `Lookup failed: ${lookupErr.message}` }
  if (!pair || pair.length !== 2) return { error: 'Adjacent rows not found.' }

  const before = pair.find((p) => p.id === beforePeId)
  const after = pair.find((p) => p.id === afterPeId)
  if (!before || !after) return { error: 'Adjacent rows not found.' }

  const beforeG = before.superset_group_id
  const afterG = after.superset_group_id

  // Same group — defensive no-op.
  if (beforeG && afterG && beforeG === afterG) {
    return { error: null }
  }

  // Two ungrouped → mint a fresh group. Q1-A: upper section wins, both
  // members converge on it.
  if (!beforeG && !afterG) {
    const newGroupId = crypto.randomUUID()
    const { error } = await supabase
      .from('program_exercises')
      .update({
        superset_group_id: newGroupId,
        section_title: before.section_title,
      })
      .in('id', [beforePeId, afterPeId])
    if (error) return { error: `Group failed: ${error.message}` }
    revalidatePath(`/clients/${clientId}/program/days/${dayId}`)
    return { error: null }
  }

  // Boundary — ungrouped card joins the existing group; joiner adopts
  // the group's section_title (read any sibling — fan-out keeps them
  // uniform).
  if (!beforeG && afterG) {
    const { data: groupRow, error: gErr } = await supabase
      .from('program_exercises')
      .select('section_title')
      .eq('program_day_id', dayId)
      .eq('superset_group_id', afterG)
      .is('deleted_at', null)
      .limit(1)
      .single()
    if (gErr) return { error: `Lookup failed: ${gErr.message}` }
    const { error } = await supabase
      .from('program_exercises')
      .update({
        superset_group_id: afterG,
        section_title: groupRow.section_title,
      })
      .eq('id', beforePeId)
    if (error) return { error: `Group failed: ${error.message}` }
    revalidatePath(`/clients/${clientId}/program/days/${dayId}`)
    return { error: null }
  }
  if (beforeG && !afterG) {
    const { data: groupRow, error: gErr } = await supabase
      .from('program_exercises')
      .select('section_title')
      .eq('program_day_id', dayId)
      .eq('superset_group_id', beforeG)
      .is('deleted_at', null)
      .limit(1)
      .single()
    if (gErr) return { error: `Lookup failed: ${gErr.message}` }
    const { error } = await supabase
      .from('program_exercises')
      .update({
        superset_group_id: beforeG,
        section_title: groupRow.section_title,
      })
      .eq('id', afterPeId)
    if (error) return { error: `Group failed: ${error.message}` }
    revalidatePath(`/clients/${clientId}/program/days/${dayId}`)
    return { error: null }
  }

  // Adjacent different groups → merge into the upper group's id. Q2-Yes:
  // upper group's section also wins — every lower-group member converges
  // on the upper section in the same UPDATE that rewrites group_id.
  if (beforeG && afterG && beforeG !== afterG) {
    const { data: upperRow, error: ugErr } = await supabase
      .from('program_exercises')
      .select('section_title')
      .eq('program_day_id', dayId)
      .eq('superset_group_id', beforeG)
      .is('deleted_at', null)
      .limit(1)
      .single()
    if (ugErr) return { error: `Lookup failed: ${ugErr.message}` }
    const { error } = await supabase
      .from('program_exercises')
      .update({
        superset_group_id: beforeG,
        section_title: upperRow.section_title,
      })
      .eq('program_day_id', dayId)
      .eq('superset_group_id', afterG)
      .is('deleted_at', null)
    if (error) return { error: `Merge failed: ${error.message}` }
    revalidatePath(`/clients/${clientId}/program/days/${dayId}`)
    return { error: null }
  }

  return { error: 'Unexpected grouping state.' }
}

/**
 * Publish a program_day so the client can see it in the portal.
 * Idempotent — re-publishing a published day is a no-op (the
 * published_at timestamp stays put so we don't lose "originally
 * assigned" context).
 */
export async function publishProgramDayAction(
  clientId: string,
  dayId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from('program_days')
    .update({ published_at: new Date().toISOString() })
    .eq('id', dayId)
    .is('published_at', null)

  if (error) return { error: `Publish failed: ${error.message}` }
  revalidatePath(`/clients/${clientId}/program/days/${dayId}`)
  revalidatePath(`/clients/${clientId}/program`)
  return { error: null }
}

/**
 * Unpublish — yanks portal visibility. Useful if the EP published by
 * accident; client stops seeing the day until it's re-published.
 */
export async function unpublishProgramDayAction(
  clientId: string,
  dayId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from('program_days')
    .update({ published_at: null })
    .eq('id', dayId)

  if (error) return { error: `Unpublish failed: ${error.message}` }
  revalidatePath(`/clients/${clientId}/program/days/${dayId}`)
  revalidatePath(`/clients/${clientId}/program`)
  return { error: null }
}

/**
 * Ungroup an exercise from its superset. If the remaining group has
 * only one member left, clear that exercise's group id too — a
 * singleton superset is meaningless and reads as a regular exercise.
 *
 * Phase J (2026-05-08): the explicitly-ungrouped card also has its
 * section_title cleared — the EP just removed it from the block, so the
 * leaver becomes a fresh solo (matches the outbound-move rule in the
 * reorder RPC). The singleton survivor (if any) keeps its section per
 * Q3-A — it didn't move, only its partner did.
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

  // Clear this exercise's group AND section (Phase J: leaver loses section).
  const { error: clearErr } = await supabase
    .from('program_exercises')
    .update({ superset_group_id: null, section_title: null })
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
    // Survivor keeps its section_title — only group_id clears.
    await supabase
      .from('program_exercises')
      .update({ superset_group_id: null })
      .eq('id', remaining[0].id)
  }

  revalidatePath(`/clients/${clientId}/program/days/${dayId}`)
  return { error: null }
}

/* ====================== Per-set prescription actions ====================== */

/**
 * Patch a program_exercise_sets row (single-cell autosave). Allowlist-
 * validated; the client can't poke at program_exercise_id, set_number,
 * timestamps, deleted_at.
 *
 * Phase C (2026-05-07). Phase F will switch optional_metric to a metric
 * dropdown sourced from exercise_metric_units; until then the UI keeps
 * Load/Notes freetext and only writes optional_value here.
 */
export type ProgramExerciseSetPatch = {
  reps?: string | null
  optional_metric?: string | null
  optional_value?: string | null
}

const EDITABLE_SET_FIELDS = new Set<keyof ProgramExerciseSetPatch>([
  'reps',
  'optional_metric',
  'optional_value',
])

export async function updateProgramExerciseSetAction(
  setId: string,
  patch: ProgramExerciseSetPatch,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])

  const clean: ProgramExerciseSetPatch = {}
  for (const key of Object.keys(patch) as Array<keyof ProgramExerciseSetPatch>) {
    if (EDITABLE_SET_FIELDS.has(key)) {
      clean[key] = patch[key]
    }
  }

  if (Object.keys(clean).length === 0) return { error: null }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('program_exercise_sets')
    .update(clean)
    .eq('id', setId)

  if (error) return { error: `Update failed: ${error.message}` }
  return { error: null }
}

/**
 * Column autofill (dogfooding capture 2026-07-03): a value committed into
 * one set's Volume or Load cell FOLLOWS DOWNWARD — into every cell BELOW
 * the edited set (set_number greater) that is empty or still holds the
 * edited cell's previous value. Sets above the edited one never move.
 *
 * Downward-only is what makes ascending/descending sequences enterable
 * top-down (owner refinement, 2026-07-03): seeded 8/8/8 → edit set 2 to 6
 * → 8/6/6 → edit set 3 to 4 → 8/6/4. A whole-column follow would drag
 * set 1 (still matching the previous 8) along and make 8/6/4 unreachable.
 * Editing set 1 remains the change-the-whole-column gesture. A below-cell
 * customised to a DIFFERENT value never moves: wave loading survives.
 *
 * The follow conditions are checked server-side (IS NULL, = previous),
 * never against the caller's view of the column — single-cell saves don't
 * revalidate, so the screen is often stale, and a stale screen must not
 * be able to overwrite a sibling's saved value.
 */
export type AutofillableSetField = 'reps' | 'optional_value'

export async function autofillProgramExerciseSetColumnAction(
  clientId: string,
  dayId: string,
  programExerciseId: string,
  field: AutofillableSetField,
  value: string,
  previousValue: string | null,
  /** set_number of the edited set — only rows strictly below it follow.
   *  Client-supplied (the cell knows its row); a tampered value can only
   *  mis-scope the caller's own org's autofill, RLS holds the boundary. */
  belowSetNumber: number,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])

  // Server actions are network-callable — re-check the column name at
  // runtime, same posture as EDITABLE_SET_FIELDS above.
  if (field !== 'reps' && field !== 'optional_value') {
    return { error: 'Invalid column.' }
  }
  if (!Number.isFinite(belowSetNumber)) {
    return { error: 'Invalid set number.' }
  }
  const trimmed = value.trim()
  if (trimmed === '') return { error: null }

  const patch: ProgramExerciseSetPatch = { [field]: trimmed }
  const supabase = await createSupabaseServerClient()

  // Two targeted UPDATEs rather than one .or() filter: .is()/.eq() take
  // arbitrary values safely, while .or()'s filter string would need
  // PostgREST quote-escaping for free-text reps like `8 e/s`.
  const { error: fillErr } = await supabase
    .from('program_exercise_sets')
    .update(patch)
    .eq('program_exercise_id', programExerciseId)
    .is('deleted_at', null)
    .gt('set_number', belowSetNumber)
    .is(field, null)
  if (fillErr) return { error: `Autofill failed: ${fillErr.message}` }

  const prev = (previousValue ?? '').trim()
  if (prev !== '' && prev !== trimmed) {
    const { error: followErr } = await supabase
      .from('program_exercise_sets')
      .update(patch)
      .eq('program_exercise_id', programExerciseId)
      .is('deleted_at', null)
      .gt('set_number', belowSetNumber)
      .eq(field, prev)
    if (followErr) return { error: `Autofill failed: ${followErr.message}` }
  }

  revalidatePath(`/clients/${clientId}/program/days/${dayId}`)
  return { error: null }
}

/**
 * Add a new set row to a program_exercise. Stepper "+" — copies the last
 * live set's values so quick set-count adjustments inherit the EP's
 * prescription rather than starting blank (Q2 sign-off, 2026-05-07).
 *
 * set_number is computed as max(set_number) over live rows + 1. The
 * partial-unique index on (program_exercise_id, set_number) WHERE
 * deleted_at IS NULL allows a re-used set_number after a soft-delete —
 * see migration 20260507100000 §1.
 */
export async function addProgramExerciseSetAction(
  clientId: string,
  dayId: string,
  programExerciseId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { data: lastSet, error: lookupErr } = await supabase
    .from('program_exercise_sets')
    .select('set_number, reps, rep_metric, optional_metric, optional_value')
    .eq('program_exercise_id', programExerciseId)
    .is('deleted_at', null)
    .order('set_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (lookupErr) return { error: `Couldn't read last set: ${lookupErr.message}` }

  const nextSetNumber = (lastSet?.set_number ?? 0) + 1

  const { error: insertErr } = await supabase
    .from('program_exercise_sets')
    .insert({
      program_exercise_id: programExerciseId,
      set_number: nextSetNumber,
      reps: lastSet?.reps ?? null,
      rep_metric: lastSet?.rep_metric ?? null,
      optional_metric: lastSet?.optional_metric ?? null,
      optional_value: lastSet?.optional_value ?? null,
    })

  if (insertErr) return { error: `Couldn't add set: ${insertErr.message}` }

  revalidatePath(`/clients/${clientId}/program/days/${dayId}`)
  return { error: null }
}

/**
 * Set the metric (optional_metric) for every live set on a program_exercise
 * in one bulk UPDATE. The metric is column-level in the UI (per Phase F
 * sign-off chat 2026-05-07) — picking "kg" applies to all sets at once,
 * picking RPE applies to all sets at once. Storage stays per-set so the
 * portal RPC and Logger don't need to change; this action is the writer
 * that keeps the per-set rows in sync.
 *
 * Direct UPDATE works (no soft-delete trap): the SELECT policy filters
 * deleted_at IS NULL, the UPDATE policy lets owner/staff write to live
 * rows in their org, and we're touching optional_metric (not deleted_at).
 */
export async function updateProgramExerciseMetricAction(
  clientId: string,
  dayId: string,
  programExerciseId: string,
  metric: string | null,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from('program_exercise_sets')
    .update({ optional_metric: metric })
    .eq('program_exercise_id', programExerciseId)
    .is('deleted_at', null)

  if (error) return { error: `Set metric failed: ${error.message}` }

  revalidatePath(`/clients/${clientId}/program/days/${dayId}`)
  return { error: null }
}

/**
 * Set the VOLUME unit (rep_metric) for every live set on a program_exercise
 * in one bulk UPDATE — the column-level Measure picker (Reps / Seconds /
 * Metres). Mirrors updateProgramExerciseMetricAction (the load-metric writer):
 * storage stays per-set so the portal RPC + Logger read it unchanged, and a
 * direct UPDATE is safe because we touch rep_metric, not deleted_at. NULL =
 * a plain rep count (the volume axis, kept separate from the load axis).
 */
export async function updateProgramExerciseRepMetricAction(
  clientId: string,
  dayId: string,
  programExerciseId: string,
  repMetric: string | null,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from('program_exercise_sets')
    .update({ rep_metric: repMetric })
    .eq('program_exercise_id', programExerciseId)
    .is('deleted_at', null)

  if (error) return { error: `Set measure failed: ${error.message}` }

  revalidatePath(`/clients/${clientId}/program/days/${dayId}`)
  return { error: null }
}

/**
 * Soft-delete a single set via the soft_delete_program_exercise_set RPC
 * (migration 20260507100000 §6). Direct UPDATE setting deleted_at fails
 * 42501 because the SELECT policy filters deleted_at IS NULL — see
 * memory/project_postgrest_soft_delete_rls.md.
 */
export async function removeProgramExerciseSetAction(
  clientId: string,
  dayId: string,
  setId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase.rpc('soft_delete_program_exercise_set', {
    p_id: setId,
  })

  if (error) return { error: `Remove set failed: ${error.message}` }

  revalidatePath(`/clients/${clientId}/program/days/${dayId}`)
  return { error: null }
}

/* ====================== Section title management ====================== */

/**
 * Apply a section title to a program_exercise — and to every other live
 * member of its superset group, if grouped. Used by the SectionTitleField
 * in the session builder.
 *
 * Why a dedicated action vs. the generic updateProgramExerciseAction:
 *   - Section is conceptually a property of the *block* (a superset is one
 *     logical block — its section header in the design renders once across
 *     the whole group). Letting the user set the section on one member and
 *     leaving siblings empty creates a visual asymmetry the EP didn't ask
 *     for and cannot recover from short of clicking each sibling.
 *   - Solo cards behave identically to the old patch path (single-row
 *     UPDATE), so non-superset behaviour is unchanged.
 *
 * Atomicity: a single UPDATE with the group_id filter — either every
 * member adopts the new section_title or the request fails. RLS scopes
 * the visibility + writability via the parent walk on program_days
 * (post-D-PROG-001 single-hop); the matching SELECT/UPDATE policies on
 * program_exercises gate every row before the bulk UPDATE touches it.
 *
 * Phase E hot-fix (2026-05-07) — chat report: "when I add the section
 * for the B superset it does not update the rest of the superset."
 */
export async function updateSectionTitleAction(
  programExerciseId: string,
  value: string | null,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { data: target, error: lookupErr } = await supabase
    .from('program_exercises')
    .select('id, program_day_id, superset_group_id')
    .eq('id', programExerciseId)
    .is('deleted_at', null)
    .single()

  if (lookupErr || !target) {
    return { error: `Exercise not found: ${lookupErr?.message ?? 'unknown'}` }
  }

  const trimmed = value?.trim() ?? ''
  const newValue = trimmed === '' ? null : trimmed

  if (target.superset_group_id) {
    const { error } = await supabase
      .from('program_exercises')
      .update({ section_title: newValue })
      .eq('program_day_id', target.program_day_id)
      .eq('superset_group_id', target.superset_group_id)
      .is('deleted_at', null)
    if (error) return { error: `Update section: ${error.message}` }
  } else {
    const { error } = await supabase
      .from('program_exercises')
      .update({ section_title: newValue })
      .eq('id', programExerciseId)
    if (error) return { error: `Update section: ${error.message}` }
  }

  return { error: null }
}

/**
 * Insert a new section_titles row scoped to the caller's organization. Used
 * by the SectionTitleField "+ Add section…" affordance in the session
 * builder (Phase E, /docs/polish/session-builder.md §2.6).
 *
 * Returns the inserted row so the client can apply the value optimistically
 * and let router.refresh() repopulate dropdowns on other cards. The "name
 * already exists" path returns a soft error — the caller can still apply
 * the same name to the program_exercise (section_title is free-text on
 * program_exercises by design — Q1 sign-off 2026-05-07; the dropdown is a
 * UI helper, not an FK).
 *
 * RLS: the staff-INSERT policy on section_titles requires
 * organization_id = user_organization_id(); requireRole gives us the
 * caller's org so the WITH CHECK passes.
 *
 * Audit: section_titles is currently un-audited (no trigger, no
 * audit_resolve_org_id branch). Phase I polish-round will add coverage to
 * match the movement_patterns / exercise_tags precedent set in
 * 20260505100100_audit_register_library — deferred per Q4 sign-off
 * 2026-05-07 to keep Phase E pure UI/wiring.
 */
export async function addSectionTitleAction(
  rawName: string,
): Promise<{
  data: { id: string; name: string } | null
  error: string | null
}> {
  const { organizationId } = await requireRole(['owner', 'staff'])

  const name = rawName.trim()
  if (name.length === 0 || name.length > 60) {
    return { data: null, error: 'Section name must be 1–60 characters.' }
  }

  const supabase = await createSupabaseServerClient()

  // sort_order = (max + 10) within the org so freshly-added sections sort
  // to the bottom of the list. Step of 10 mirrors the seed (10, 20, …, 100).
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
    .insert({
      organization_id: organizationId,
      name,
      sort_order: nextOrder,
    })
    .select('id, name')
    .single()

  if (error) {
    // Duplicate (case-insensitive) — friendlier message via the partial
    // unique index section_titles_org_name_unique on lower(name).
    if (error.code === '23505') {
      return {
        data: null,
        error: `A section called "${name}" already exists.`,
      }
    }
    return { data: null, error: `Couldn't add section: ${error.message}` }
  }

  return { data: inserted, error: null }
}

/* ====================== Circuits (C-5 save / C-6 add) ====================== */

/**
 * C-5 — save a superset group as a reusable circuit (save_group_as_circuit RPC,
 * 20260624110000). Copies the group's program_exercises + their per-set rows
 * (incl. rep_metric) into a new circuit. Duplicate name (case-insensitive)
 * returns status='duplicate_name' so the caller can prompt for another.
 */
export type SaveCircuitResult =
  | { status: 'created'; circuitId: string }
  | { status: 'duplicate_name' }
  | { error: string }

export async function saveGroupAsCircuitAction(
  name: string,
  circuitType: string,
  programExerciseIds: string[],
  notes: string | null = null,
): Promise<SaveCircuitResult> {
  await requireRole(['owner', 'staff'])

  if (programExerciseIds.length === 0) return { error: 'No exercises to save.' }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('save_group_as_circuit', {
    p_name: name,
    p_circuit_type: circuitType,
    p_program_exercise_ids: programExerciseIds,
    // p_notes has a SQL DEFAULT NULL, so the generated type is string|undefined;
    // coalesce our null → undefined to omit the arg (lands DEFAULT NULL).
    p_notes: notes ?? undefined,
  })

  if (error) return { error: `Couldn't save circuit: ${error.message}` }

  const obj = (data ?? {}) as { status?: string; circuit_id?: string }
  if (obj.status === 'duplicate_name') return { status: 'duplicate_name' }
  if (obj.status === 'created' && obj.circuit_id) {
    revalidatePath('/library')
    return { status: 'created', circuitId: obj.circuit_id }
  }
  return { error: `Unexpected response: ${obj.status ?? 'unknown'}` }
}

/**
 * C-6 — add (copy) a circuit's exercises into a program day, appended at the
 * end under one fresh superset group (insert_circuit_into_day RPC). Copy-on-
 * apply: editing the source circuit later never touches what landed here.
 */
export async function addCircuitToDayAction(
  clientId: string,
  dayId: string,
  circuitId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('insert_circuit_into_day', {
    p_circuit_id: circuitId,
    p_program_day_id: dayId,
  })

  if (error) return { error: `Couldn't add circuit: ${error.message}` }

  revalidatePath(`/clients/${clientId}/program/days/${dayId}`)
  return { error: null }
}
