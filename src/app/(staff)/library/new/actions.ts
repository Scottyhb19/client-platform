'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { NewExerciseState } from './types'

/**
 * Create an exercise in the caller's organization, plus optional tag
 * assignments. RLS scopes the insert; we pass organization_id because
 * the INSERT policy requires WITH CHECK (organization_id = ...).
 */
export async function createExerciseAction(
  _prev: NewExerciseState,
  formData: FormData,
): Promise<NewExerciseState> {
  const { organizationId, userId } = await requireRole(['owner', 'staff'])

  const name = (formData.get('name') ?? '').toString().trim()
  const movementPatternId = nullable(formData.get('movement_pattern_id'))
  const defaultSetsRaw = (formData.get('default_sets') ?? '').toString().trim()
  const defaultReps = nullable(formData.get('default_reps'))
  const defaultMetricValue = nullable(formData.get('default_metric_value'))
  const defaultRpeRaw = (formData.get('default_rpe') ?? '').toString().trim()
  const restRaw = (formData.get('default_rest_seconds') ?? '').toString().trim()
  const videoUrl = nullable(formData.get('video_url'))
  const description = nullable(formData.get('description'))
  const instructions = nullable(formData.get('instructions'))
  const tagIds = formData.getAll('tag_ids').map((v) => v.toString())

  if (!name) {
    return { error: null, fieldErrors: { name: 'Required.' } }
  }

  const supabase = await createSupabaseServerClient()

  const { data: exercise, error } = await supabase
    .from('exercises')
    .insert({
      organization_id: organizationId,
      created_by_user_id: userId,
      name,
      movement_pattern_id: movementPatternId,
      default_sets: toIntOrNull(defaultSetsRaw),
      default_reps: defaultReps,
      default_metric_value: defaultMetricValue,
      default_rpe: toIntOrNull(defaultRpeRaw),
      default_rest_seconds: toIntOrNull(restRaw),
      video_url: videoUrl,
      description,
      instructions,
    })
    .select('id')
    .single()

  if (error) {
    return {
      error: `Failed to create exercise: ${error.message}`,
      fieldErrors: {},
    }
  }

  if (tagIds.length > 0) {
    const { error: tagErr } = await supabase
      .from('exercise_tag_assignments')
      .insert(
        tagIds.map((tag_id) => ({ exercise_id: exercise.id, tag_id })),
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

function nullable(value: FormDataEntryValue | null): string | null {
  if (value === null) return null
  const s = value.toString().trim()
  return s.length === 0 ? null : s
}

function toIntOrNull(raw: string): number | null {
  if (!raw) return null
  const n = parseInt(raw, 10)
  return Number.isFinite(n) ? n : null
}
