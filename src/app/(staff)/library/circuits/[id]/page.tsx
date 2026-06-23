import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  CircuitEditor,
  type EditorCircuit,
  type EditorExerciseOption,
} from './_components/CircuitEditor'
import type { CircuitType } from '../../types'

export const dynamic = 'force-dynamic'

/**
 * #3 — the in-Library circuit editor (workbench). Author/edit a circuit: name +
 * type, add/remove exercises, set per-set prescriptions. Server-rendered +
 * RLS-scoped; a cross-org id is invisible → null → notFound() (FM-6, mirrors the
 * program preview route). Reached from the Circuits tab (New / click-to-edit).
 */
export default async function CircuitEditorPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const [{ data: circuitRaw }, { data: libraryRaw }] = await Promise.all([
    supabase
      .from('circuits')
      .select(
        `id, name, circuit_type, notes,
         circuit_exercises(id, sort_order, exercise_id, deleted_at,
           exercise:exercises(name),
           circuit_exercise_sets(
             id, set_number, reps, rep_metric, optional_metric, optional_value, deleted_at
           ))`,
      )
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase.from('exercises').select('id, name').is('deleted_at', null).order('name'),
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

  const library: EditorExerciseOption[] = (libraryRaw ?? []).map((e) => ({
    id: e.id,
    name: e.name,
  }))

  return (
    <div className="page" style={{ maxWidth: 880 }}>
      <CircuitEditor circuit={circuit} library={library} />
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
        deleted_at: string | null
        exercise: { name: string } | null
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
