import { notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/require-role'
import {
  ProgramEditor,
  type EditorTemplate,
} from './_components/ProgramEditor'
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
 * P-1 — the in-Library program-template editor (edit-existing v1). Replaces the
 * old read-only preview: weeks → days, each day expandable into the shared
 * DayContentEditor for in-place editing, plus day management (rename / reorder /
 * add / remove / duplicate). Week add/remove is out of scope (v1). Same loader
 * shape as the session editor + the week/day tree; server-rendered + RLS-scoped
 * (cross-org id → null → notFound()).
 */
export default async function ProgramTemplateEditorPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const [
    { data: tplRaw },
    { data: libraryRaw },
    { data: patternsRaw },
    { data: tagsRaw },
    { data: metricUnitsRaw },
    { data: sectionTitlesRaw },
  ] = await Promise.all([
    supabase
      .from('program_templates')
      .select(
        `id, name,
         template_weeks(id, week_number, deleted_at,
           template_days(id, day_label, sort_order, deleted_at,
             template_exercises(id, sort_order, exercise_id, section_title,
               superset_group_id, rest_seconds, tempo, instructions, deleted_at,
               exercise:exercises(name, video_url),
               template_exercise_sets(id, set_number, reps, rep_metric,
                 optional_metric, optional_value, deleted_at))))`,
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

  if (!tplRaw) notFound()

  const t = tplRaw as unknown as RawTemplate
  const weeks = (t.template_weeks ?? [])
    .filter((w) => w.deleted_at === null)
    .sort((a, b) => a.week_number - b.week_number)
    .map((w) => ({
      id: w.id,
      week_number: w.week_number,
      days: (w.template_days ?? [])
        .filter((d) => d.deleted_at === null)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((d) => ({
          id: d.id,
          day_label: d.day_label,
          exercises: (d.template_exercises ?? [])
            .filter((e) => e.deleted_at === null)
            .sort((a, b) => a.sort_order - b.sort_order)
            .map(
              (e): DayEditorExercise => ({
                id: e.id,
                exercise_id: e.exercise_id,
                exercise_name: e.exercise?.name ?? 'Unknown exercise',
                exercise_video_url: e.exercise?.video_url ?? null,
                section_title: e.section_title,
                superset_group_id: e.superset_group_id,
                rest_seconds: e.rest_seconds,
                tempo: e.tempo,
                instructions: e.instructions,
                sets: (e.template_exercise_sets ?? [])
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
              }),
            ),
        })),
    }))

  const template: EditorTemplate = { id: t.id, name: t.name, weeks }
  const library = toLibraryExercises(libraryRaw)
  const movementPatterns = (patternsRaw ?? []).map((p) => ({ id: p.id, name: p.name }))
  const exerciseTags = (tagsRaw ?? []).map((tg) => ({ id: tg.id, name: tg.name }))
  const metricUnits: MetricUnitOption[] = (metricUnitsRaw ?? []).map((u) => ({
    code: u.code,
    display_label: u.display_label,
  }))
  const sectionTitles: SectionTitleOption[] = (sectionTitlesRaw ?? []).map((st) => ({
    id: st.id,
    name: st.name,
  }))

  return (
    <div className="page" style={{ maxWidth: 1320 }}>
      <ProgramEditor
        template={template}
        library={library}
        movementPatterns={movementPatterns}
        exerciseTags={exerciseTags}
        metricUnits={metricUnits}
        sectionTitles={sectionTitles}
      />
    </div>
  )
}

type RawTemplate = {
  id: string
  name: string
  template_weeks:
    | Array<{
        id: string
        week_number: number
        deleted_at: string | null
        template_days:
          | Array<{
              id: string
              day_label: string
              sort_order: number
              deleted_at: string | null
              template_exercises:
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
                    template_exercise_sets:
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
            }>
          | null
      }>
    | null
}
