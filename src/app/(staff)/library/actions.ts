'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { ExerciseFormState } from './types'

/**
 * Create an exercise in the caller's organization, plus optional tag
 * assignments. RLS scopes the insert; we pass organization_id because the
 * INSERT policy requires WITH CHECK (organization_id = …).
 */
export async function createExerciseAction(
  _prev: ExerciseFormState,
  formData: FormData,
): Promise<ExerciseFormState> {
  const { organizationId, userId } = await requireRole(['owner', 'staff'])

  const parsed = parseFormFields(formData)
  if (parsed.error) return parsed.error

  const supabase = await createSupabaseServerClient()

  const { data: exercise, error } = await supabase
    .from('exercises')
    .insert({
      organization_id: organizationId,
      created_by_user_id: userId,
      name: parsed.values.name,
      movement_pattern_id: parsed.values.movement_pattern_id,
      default_sets: parsed.values.default_sets,
      default_reps: parsed.values.default_reps,
      default_metric: parsed.values.default_metric,
      default_metric_value: parsed.values.default_metric_value,
      default_rpe: parsed.values.default_rpe,
      default_rest_seconds: parsed.values.default_rest_seconds,
      video_url: parsed.values.video_url,
      description: parsed.values.description,
      instructions: parsed.values.instructions,
    })
    .select('id')
    .single()

  if (error) {
    return {
      error: `Failed to create exercise: ${error.message}`,
      fieldErrors: {},
    }
  }

  if (parsed.values.tag_ids.length > 0) {
    const { error: tagErr } = await supabase
      .from('exercise_tag_assignments')
      .insert(
        parsed.values.tag_ids.map((tag_id) => ({
          exercise_id: exercise.id,
          tag_id,
        })),
      )
    if (tagErr) {
      return {
        error: `Exercise created but tag assignment failed: ${tagErr.message}`,
        fieldErrors: {},
      }
    }
  }

  revalidatePath('/library')
  redirect('/library')
}

/**
 * Update an existing exercise + reconcile its tag assignments.
 * Tag reconciliation is a two-step diff: delete removed assignments,
 * insert added ones. RLS + cross-org trigger guard the writes.
 */
export async function updateExerciseAction(
  exerciseId: string,
  _prev: ExerciseFormState,
  formData: FormData,
): Promise<ExerciseFormState> {
  await requireRole(['owner', 'staff'])

  const parsed = parseFormFields(formData)
  if (parsed.error) return parsed.error

  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from('exercises')
    .update({
      name: parsed.values.name,
      movement_pattern_id: parsed.values.movement_pattern_id,
      default_sets: parsed.values.default_sets,
      default_reps: parsed.values.default_reps,
      default_metric: parsed.values.default_metric,
      default_metric_value: parsed.values.default_metric_value,
      default_rpe: parsed.values.default_rpe,
      default_rest_seconds: parsed.values.default_rest_seconds,
      video_url: parsed.values.video_url,
      description: parsed.values.description,
      instructions: parsed.values.instructions,
    })
    .eq('id', exerciseId)

  if (error) {
    return {
      error: `Failed to save changes: ${error.message}`,
      fieldErrors: {},
    }
  }

  // Reconcile tag assignments: read current set, diff against submitted,
  // delete removals, insert additions. Cross-org trigger on
  // exercise_tag_assignments rejects any tag_id from a different org.
  //
  // Critical: only diff against ACTIVE tag assignments. Soft-deleted tags
  // are not rendered as form checkboxes, so they wouldn't appear in
  // desiredTagIds — without this filter the diff would treat them as
  // "removed" and destroy the historical assignment row.
  const [
    { data: existingAssignments, error: fetchErr },
    { data: activeTagRows, error: activeErr },
  ] = await Promise.all([
    supabase
      .from('exercise_tag_assignments')
      .select('tag_id')
      .eq('exercise_id', exerciseId),
    supabase
      .from('exercise_tags')
      .select('id')
      .is('deleted_at', null),
  ])

  if (fetchErr || activeErr) {
    return {
      error: `Saved exercise but tag reconciliation failed: ${(fetchErr ?? activeErr)!.message}`,
      fieldErrors: {},
    }
  }

  const activeTagIds = new Set((activeTagRows ?? []).map((t) => t.id))
  const currentActiveTagIds = new Set(
    (existingAssignments ?? [])
      .map((a) => a.tag_id)
      .filter((id) => activeTagIds.has(id)),
  )
  const desiredTagIds = new Set(parsed.values.tag_ids)
  const toRemove = [...currentActiveTagIds].filter(
    (t) => !desiredTagIds.has(t),
  )
  const toAdd = [...desiredTagIds].filter(
    (t) => !currentActiveTagIds.has(t),
  )

  if (toRemove.length > 0) {
    const { error: rmErr } = await supabase
      .from('exercise_tag_assignments')
      .delete()
      .eq('exercise_id', exerciseId)
      .in('tag_id', toRemove)
    if (rmErr) {
      return {
        error: `Saved exercise but tag removal failed: ${rmErr.message}`,
        fieldErrors: {},
      }
    }
  }

  if (toAdd.length > 0) {
    const { error: addErr } = await supabase
      .from('exercise_tag_assignments')
      .insert(toAdd.map((tag_id) => ({ exercise_id: exerciseId, tag_id })))
    if (addErr) {
      return {
        error: `Saved exercise but tag addition failed: ${addErr.message}`,
        fieldErrors: {},
      }
    }
  }

  revalidatePath('/library')
  revalidatePath(`/library/${exerciseId}`)
  redirect('/library')
}

/**
 * Soft-delete an exercise via the SECURITY DEFINER RPC. RPC handles the
 * deleted_at-IS-NULL SELECT-policy trap; auth + org check live inside.
 * Existing program_exercises prescriptions remain (RESTRICT FK on the
 * exercise_id keeps them resolvable).
 */
export async function deleteExerciseAction(
  exerciseId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('soft_delete_exercise', {
    p_id: exerciseId,
  })

  if (error) return { error: `Delete failed: ${error.message}` }

  revalidatePath('/library')
  return { error: null }
}

/* ====================== Helpers ====================== */

function parseFormFields(
  formData: FormData,
):
  | { error: ExerciseFormState; values?: never }
  | { error: null; values: ParsedExerciseFields } {
  const name = (formData.get('name') ?? '').toString().trim()
  if (!name) {
    return { error: { error: null, fieldErrors: { name: 'Required.' } } }
  }

  return {
    error: null,
    values: {
      name,
      movement_pattern_id: nullable(formData.get('movement_pattern_id')),
      video_url: nullable(formData.get('video_url')),
      description: nullable(formData.get('description')),
      instructions: nullable(formData.get('instructions')),
      default_sets: toIntOrNull(formData.get('default_sets')),
      default_reps: nullable(formData.get('default_reps')),
      default_metric: nullable(formData.get('default_metric')),
      default_metric_value: nullable(formData.get('default_metric_value')),
      default_rpe: toIntOrNull(formData.get('default_rpe')),
      default_rest_seconds: toIntOrNull(formData.get('default_rest_seconds')),
      tag_ids: formData.getAll('tag_ids').map((v) => v.toString()),
    },
  }
}

type ParsedExerciseFields = {
  name: string
  movement_pattern_id: string | null
  video_url: string | null
  description: string | null
  instructions: string | null
  default_sets: number | null
  default_reps: string | null
  default_metric: string | null
  default_metric_value: string | null
  default_rpe: number | null
  default_rest_seconds: number | null
  tag_ids: string[]
}

function nullable(value: FormDataEntryValue | null): string | null {
  if (value === null) return null
  const s = value.toString().trim()
  return s.length === 0 ? null : s
}

function toIntOrNull(raw: FormDataEntryValue | null): number | null {
  if (raw === null) return null
  const s = raw.toString().trim()
  if (!s) return null
  const n = parseInt(s, 10)
  return Number.isFinite(n) ? n : null
}
