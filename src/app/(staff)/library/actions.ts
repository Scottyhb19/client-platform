'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isVolumeMetric } from '@/lib/prescription/volume-units'
import { addExerciseToDayAction } from '@/app/(staff)/clients/[id]/program/days/[dayId]/actions'
import { addSessionExerciseAction } from './session-actions'
import { addTemplateExerciseAction } from './program-template-editor-actions'
import { addExerciseToCircuitAction } from './circuit-actions'
import {
  safeInternalPath,
  type ExerciseFormEcho,
  type ExerciseFormState,
} from './types'

/**
 * Append a just-created exercise to the surface the EP was editing when they
 * clicked "Create New Exercise" — the returnTo names one of the four
 * day-editing surfaces, so the new exercise is already in place on return
 * instead of the EP re-searching the library for it (dogfooding capture
 * 2026-07-13). Always an append: an armed insert slot is client-side state
 * that doesn't survive the navigation to /library/new. An unrecognised
 * returnTo adds nothing and the redirect proceeds as before.
 */
async function autoAddForReturnTo(
  returnTo: string,
  exerciseId: string,
): Promise<{ error: string | null }> {
  const [path, query = ''] = returnTo.split('?')
  let m = path.match(/^\/clients\/([^/]+)\/program\/days\/([^/]+)$/)
  if (m) return addExerciseToDayAction(m[1], m[2], exerciseId)
  m = path.match(/^\/library\/sessions\/([^/]+)$/)
  if (m) return addSessionExerciseAction(m[1], exerciseId)
  m = path.match(/^\/library\/programs\/([^/]+)$/)
  if (m) {
    // The template editor edits one day at a time, so the pathname alone
    // can't identify the target — the panel encodes the open day in ?day=.
    const dayId = new URLSearchParams(query).get('day')
    if (!dayId) return { error: null }
    return addTemplateExerciseAction(m[1], dayId, exerciseId)
  }
  m = path.match(/^\/library\/circuits\/([^/]+)$/)
  if (m) return addExerciseToCircuitAction(m[1], exerciseId)
  return { error: null }
}

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

  const metricError = await validateMetricCode(
    supabase,
    parsed.values.default_metric,
  )
  if (metricError) return { ...metricError, values: echoFields(formData) }

  const { data: exercise, error } = await supabase
    .from('exercises')
    .insert({
      organization_id: organizationId,
      created_by_user_id: userId,
      name: parsed.values.name,
      movement_pattern_id: parsed.values.movement_pattern_id,
      default_sets: parsed.values.default_sets,
      default_reps: parsed.values.default_reps,
      default_rep_metric: parsed.values.default_rep_metric,
      default_metric: parsed.values.default_metric,
      default_metric_value: parsed.values.default_metric_value,
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
      values: echoFields(formData),
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
        values: echoFields(formData),
      }
    }
  }

  revalidatePath('/library')

  // Launched from a day-editing surface (returnTo in the form): append the
  // new exercise to that surface, then land the EP back there with it in
  // place. Re-validated server-side — the hidden field is tamperable.
  const returnTo = safeInternalPath(nullable(formData.get('returnTo')))
  if (returnTo) {
    const added = await autoAddForReturnTo(returnTo, exercise.id)
    if (added.error) {
      // Mirrors the tag-failure path above: the exercise exists, so stay on
      // the form with an honest error rather than a silent redirect. The EP
      // gets back via Cancel; resubmitting would create a duplicate.
      return {
        error: `Exercise created, but it couldn't be added where you were working — ${added.error} It's in the library; add it from the panel.`,
        fieldErrors: {},
        values: echoFields(formData),
      }
    }
    // Strip any query (?day=…) — revalidatePath wants a bare path; the add
    // actions above already revalidate their own surfaces.
    revalidatePath(returnTo.split('?')[0])
    redirect(returnTo)
  }
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

  const metricError = await validateMetricCode(
    supabase,
    parsed.values.default_metric,
  )
  if (metricError) return { ...metricError, values: echoFields(formData) }

  // .select('id') so a zero-row match (exercise deleted in another tab, or
  // filtered by RLS) surfaces as an error instead of a silent fake success.
  const { data: updated, error } = await supabase
    .from('exercises')
    .update({
      name: parsed.values.name,
      movement_pattern_id: parsed.values.movement_pattern_id,
      default_sets: parsed.values.default_sets,
      default_reps: parsed.values.default_reps,
      default_rep_metric: parsed.values.default_rep_metric,
      default_metric: parsed.values.default_metric,
      default_metric_value: parsed.values.default_metric_value,
      default_rest_seconds: parsed.values.default_rest_seconds,
      video_url: parsed.values.video_url,
      description: parsed.values.description,
      instructions: parsed.values.instructions,
    })
    .eq('id', exerciseId)
    .select('id')

  if (error) {
    return {
      error: `Failed to save changes: ${error.message}`,
      fieldErrors: {},
      values: echoFields(formData),
    }
  }

  if (!updated || updated.length === 0) {
    return {
      error:
        'This exercise no longer exists — it may have been deleted in another tab.',
      fieldErrors: {},
      values: echoFields(formData),
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
      values: echoFields(formData),
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
        values: echoFields(formData),
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
        values: echoFields(formData),
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
    return {
      error: {
        error: null,
        fieldErrors: { name: 'Required.' },
        values: echoFields(formData),
      },
    }
  }

  const videoUrl = normaliseVideoUrl(nullable(formData.get('video_url')))
  if (videoUrl.error) {
    return {
      error: {
        error: null,
        fieldErrors: { video_url: videoUrl.error },
        values: echoFields(formData),
      },
    }
  }

  const default_metric = nullable(formData.get('default_metric'))
  const default_metric_value = nullable(formData.get('default_metric_value'))
  if (default_metric_value && !default_metric) {
    return {
      error: {
        error: null,
        fieldErrors: { default_metric: 'Pick a unit for the load value.' },
        values: echoFields(formData),
      },
    }
  }

  // Volume unit (reps / time / distance) — NULL = a plain rep count. The
  // dropdown is curated, so a value outside the known set can only arrive
  // from a tampered request; reject rather than write garbage.
  const default_rep_metric = nullable(formData.get('default_rep_metric'))
  if (default_rep_metric !== null && !isVolumeMetric(default_rep_metric)) {
    return {
      error: {
        error: 'Invalid rep unit.',
        fieldErrors: {},
        values: echoFields(formData),
      },
    }
  }

  return {
    error: null,
    values: {
      name,
      movement_pattern_id: nullable(formData.get('movement_pattern_id')),
      video_url: videoUrl.value ?? null,
      description: nullable(formData.get('description')),
      instructions: nullable(formData.get('instructions')),
      default_sets: toIntOrNull(formData.get('default_sets')),
      default_reps: nullable(formData.get('default_reps')),
      default_rep_metric,
      default_metric,
      default_metric_value,
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
  default_rep_metric: string | null
  default_metric: string | null
  default_metric_value: string | null
  default_rest_seconds: number | null
  tag_ids: string[]
}

/**
 * Echo the raw submitted form fields back to the client. React 19 resets
 * uncontrolled inputs when a server action returns; error states carry
 * this so the form can restore what the EP typed.
 */
function echoFields(formData: FormData): ExerciseFormEcho {
  const raw = (k: string) => (formData.get(k) ?? '').toString()
  return {
    name: raw('name'),
    movement_pattern_id: raw('movement_pattern_id'),
    video_url: raw('video_url'),
    description: raw('description'),
    instructions: raw('instructions'),
    default_sets: raw('default_sets'),
    default_reps: raw('default_reps'),
    default_rep_metric: raw('default_rep_metric'),
    default_metric: raw('default_metric'),
    default_metric_value: raw('default_metric_value'),
    default_rest_seconds: raw('default_rest_seconds'),
    tag_ids: formData.getAll('tag_ids').map((v) => v.toString()),
  }
}

/**
 * Normalise + validate the video URL ahead of the DB CHECK (^https?://) so
 * the EP gets an inline field error, not a raw constraint violation.
 * Scheme-less host-shaped pastes ("youtube.com/watch?v=…") are common when
 * the URL is typed or copied from the address bar — auto-prefix https://.
 */
function normaliseVideoUrl(
  raw: string | null,
): { value: string | null; error?: never } | { value?: never; error: string } {
  if (raw === null) return { value: null }
  const withScheme = /^https?:\/\//i.test(raw)
    ? raw
    : /^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#]\S*)?$/i.test(raw)
      ? `https://${raw}`
      : null
  if (!withScheme) {
    return { error: 'Paste a full URL — https://…' }
  }
  return { value: withScheme }
}

/**
 * The unit code is free text at the DB layer (stored as text for rename
 * stability) — assert it matches an active exercise_metric_units code so a
 * stale form or hand-crafted request can't write an unknown unit.
 */
async function validateMetricCode(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  code: string | null,
): Promise<ExerciseFormState | null> {
  if (code === null) return null
  const { data, error } = await supabase
    .from('exercise_metric_units')
    .select('code')
    .eq('code', code)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) {
    return { error: `Couldn't verify the unit: ${error.message}`, fieldErrors: {} }
  }
  if (!data) {
    return {
      error: null,
      fieldErrors: { default_metric: 'Unknown unit — pick one from the list.' },
    }
  }
  return null
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
