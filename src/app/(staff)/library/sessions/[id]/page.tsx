import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  SessionEditor,
  type EditorSession,
} from './_components/SessionEditor'
import type {
  DayEditorExercise,
  MetricUnitOption,
  SectionTitleOption,
} from '@/app/(staff)/library/_components/DayContentEditor'
import {
  LIBRARY_EXERCISE_COLUMNS,
  toLibraryExercises,
} from '@/app/(staff)/library/_lib/exercise-query'

export const dynamic = 'force-dynamic'

/**
 * In-Library session editor (S-5). Author/edit a session template (a day minus
 * the client): ordered exercises, supersets, sections, per-set prescriptions.
 * Same loader shape as the circuit editor + the section_title/superset_group_id
 * the grouping engine needs, plus the org's section_titles for the dropdown.
 * Server-rendered + RLS-scoped; a cross-org id is invisible → null → notFound().
 */
export default async function SessionEditorPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const [
    { data: sessionRaw },
    { data: libraryRaw },
    { data: patternsRaw },
    { data: tagsRaw },
    { data: metricUnitsRaw },
    { data: sectionTitlesRaw },
  ] = await Promise.all([
    supabase
      .from('session_templates')
      .select(
        `id, name,
         session_template_exercises(id, sort_order, exercise_id, section_title,
           superset_group_id, rest_seconds, tempo, instructions, deleted_at,
           exercise:exercises(name, video_url),
           session_template_exercise_sets(
             id, set_number, reps, rep_metric, optional_metric, optional_value, deleted_at
           ))`,
      )
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle(),
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
    supabase
      .from('exercise_metric_units')
      .select('code, display_label')
      .is('deleted_at', null)
      .eq('is_active', true)
      .order('sort_order'),
    supabase
      .from('section_titles')
      .select('id, name')
      .is('deleted_at', null)
      .order('sort_order'),
  ])

  if (!sessionRaw) notFound()

  const s = sessionRaw as unknown as RawSession
  const exercises: DayEditorExercise[] = (s.session_template_exercises ?? [])
    .filter((e) => e.deleted_at === null)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((e) => ({
      id: e.id,
      exercise_id: e.exercise_id,
      exercise_name: e.exercise?.name ?? 'Unknown exercise',
      exercise_video_url: e.exercise?.video_url ?? null,
      section_title: e.section_title,
      superset_group_id: e.superset_group_id,
      rest_seconds: e.rest_seconds,
      tempo: e.tempo,
      instructions: e.instructions,
      sets: (e.session_template_exercise_sets ?? [])
        .filter((x) => x.deleted_at === null)
        .sort((a, b) => a.set_number - b.set_number)
        .map((x) => ({
          id: x.id,
          set_number: x.set_number,
          reps: x.reps,
          rep_metric: x.rep_metric,
          optional_metric: x.optional_metric,
          optional_value: x.optional_value,
        })),
    }))

  const session: EditorSession = { id: s.id, name: s.name, exercises }
  const library = toLibraryExercises(libraryRaw)
  const movementPatterns = (patternsRaw ?? []).map((p) => ({ id: p.id, name: p.name }))
  const exerciseTags = (tagsRaw ?? []).map((t) => ({ id: t.id, name: t.name }))
  const metricUnits: MetricUnitOption[] = (metricUnitsRaw ?? []).map((u) => ({
    code: u.code,
    display_label: u.display_label,
  }))
  const sectionTitles: SectionTitleOption[] = (sectionTitlesRaw ?? []).map((t) => ({
    id: t.id,
    name: t.name,
  }))

  return (
    <div className="page" style={{ maxWidth: 1320 }}>
      <SessionEditor
        session={session}
        library={library}
        movementPatterns={movementPatterns}
        exerciseTags={exerciseTags}
        metricUnits={metricUnits}
        sectionTitles={sectionTitles}
      />
    </div>
  )
}

type RawSession = {
  id: string
  name: string
  session_template_exercises:
    | Array<{
        id: string
        sort_order: number
        exercise_id: string
        section_title: string | null
        superset_group_id: string | null
        rest_seconds: number | null
        tempo: string | null
        instructions: string | null
        deleted_at: string | null
        exercise: { name: string; video_url: string | null } | null
        session_template_exercise_sets:
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
