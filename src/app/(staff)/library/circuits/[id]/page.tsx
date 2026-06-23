import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  CircuitEditor,
  type EditorCircuit,
  type EditorMetricUnit,
} from './_components/CircuitEditor'
import {
  LIBRARY_EXERCISE_COLUMNS,
  toLibraryExercises,
} from '@/app/(staff)/library/_lib/exercise-query'
import type { CircuitType } from '../../types'

export const dynamic = 'force-dynamic'

/**
 * #3 — the in-Library circuit editor (workbench). Author/edit a circuit: name +
 * type, add/remove exercises, set per-set prescriptions, instructions, rest,
 * tempo, and reorder. The card UI is carbon-copied from the session builder
 * ("NEXT focused pass" 2026-06-24), so the loader pulls the same shape: the
 * full LibraryExercise card columns (for the right-panel picker + its chips),
 * the scalar parent fields on circuit_exercises, and the exercise demo video.
 * Server-rendered + RLS-scoped; a cross-org id is invisible → null → notFound()
 * (FM-6, mirrors the program preview route).
 */
export default async function CircuitEditorPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const [
    { data: circuitRaw },
    { data: libraryRaw },
    { data: patternsRaw },
    { data: tagsRaw },
    { data: metricUnitsRaw },
  ] = await Promise.all([
    supabase
      .from('circuits')
      .select(
        `id, name, circuit_type, notes,
         circuit_exercises(id, sort_order, exercise_id, rest_seconds, tempo,
           instructions, deleted_at,
           exercise:exercises(name, video_url),
           circuit_exercise_sets(
             id, set_number, reps, rep_metric, optional_metric, optional_value, deleted_at
           ))`,
      )
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle(),
    // Full LibraryExercise card shape — the right-panel picker composes the
    // standalone library's atoms (same select both surfaces, via the shared
    // exercise-query module). Carries movement_pattern_id + flat tag_ids so the
    // chip filters run client-side.
    supabase
      .from('exercises')
      .select(LIBRARY_EXERCISE_COLUMNS)
      .is('deleted_at', null)
      .order('name'),
    supabase
      .from('movement_patterns')
      .select('id, name')
      .is('deleted_at', null)
      .order('sort_order'),
    supabase
      .from('exercise_tags')
      .select('id, name')
      .is('deleted_at', null)
      .order('sort_order'),
    // Load-metric dropdown options — same source as the builder + the
    // new-exercise form (active, ordered).
    supabase
      .from('exercise_metric_units')
      .select('code, display_label')
      .is('deleted_at', null)
      .eq('is_active', true)
      .order('sort_order'),
  ])

  if (!circuitRaw) notFound()

  const c = circuitRaw as unknown as RawCircuit
  const exercises = (c.circuit_exercises ?? [])
    .filter((e) => e.deleted_at === null)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((e) => ({
      id: e.id,
      exercise_id: e.exercise_id,
      exercise_name: e.exercise?.name ?? 'Unknown exercise',
      exercise_video_url: e.exercise?.video_url ?? null,
      rest_seconds: e.rest_seconds,
      tempo: e.tempo,
      instructions: e.instructions,
      sets: (e.circuit_exercise_sets ?? [])
        .filter((s) => s.deleted_at === null)
        .sort((a, b) => a.set_number - b.set_number)
        .map((s) => ({
          id: s.id,
          set_number: s.set_number,
          reps: s.reps,
          rep_metric: s.rep_metric,
          optional_metric: s.optional_metric,
          optional_value: s.optional_value,
        })),
    }))

  const circuit: EditorCircuit = {
    id: c.id,
    name: c.name,
    circuit_type: c.circuit_type as CircuitType,
    notes: c.notes,
    exercises,
  }

  const library = toLibraryExercises(libraryRaw)
  const movementPatterns = (patternsRaw ?? []).map((p) => ({
    id: p.id,
    name: p.name,
  }))
  const exerciseTags = (tagsRaw ?? []).map((t) => ({ id: t.id, name: t.name }))
  const metricUnits: EditorMetricUnit[] = (metricUnitsRaw ?? []).map((u) => ({
    code: u.code,
    display_label: u.display_label,
  }))

  return (
    <div className="page" style={{ maxWidth: 1320 }}>
      <CircuitEditor
        circuit={circuit}
        library={library}
        movementPatterns={movementPatterns}
        exerciseTags={exerciseTags}
        metricUnits={metricUnits}
      />
    </div>
  )
}

type RawCircuit = {
  id: string
  name: string
  circuit_type: string
  notes: string | null
  circuit_exercises:
    | Array<{
        id: string
        sort_order: number
        exercise_id: string
        rest_seconds: number | null
        tempo: string | null
        instructions: string | null
        deleted_at: string | null
        exercise: { name: string; video_url: string | null } | null
        circuit_exercise_sets:
          | Array<{
              id: string
              set_number: number
              reps: string | null
              rep_metric: string | null
              optional_metric: string | null
              optional_value: string | null
              deleted_at: string | null
            }>
          | null
      }>
    | null
}
