import { createSupabaseServerClient } from '@/lib/supabase/server'
import { LibraryView } from './_components/LibraryView'
import type {
  LibraryExercise,
  Pattern,
  Tag,
} from './_components/ExerciseLibrary'

export const dynamic = 'force-dynamic'

/**
 * 05 Library — exercises (live), circuits + sessions + programs scaffold.
 * Data fetch stays server-side; LibraryView is a Client Component that
 * holds the active-tab state and swaps rendered content.
 */
export default async function LibraryPage() {
  const supabase = await createSupabaseServerClient()

  const [
    { data: exercisesRaw, error: exErr },
    { data: patterns },
    { data: tags },
  ] = await Promise.all([
    supabase
      .from('exercises')
      .select(
        `id, name, default_sets, default_reps, default_metric,
         default_metric_value, default_rpe, usage_count, video_url,
         movement_pattern_id,
         movement_pattern:movement_patterns(name),
         exercise_tag_assignments(tag:exercise_tags(id, name))`,
      )
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
  ])

  if (exErr) throw new Error(`Load exercises: ${exErr.message}`)

  const exercises: LibraryExercise[] = (exercisesRaw ?? []).map((e) => {
    const assignments = e.exercise_tag_assignments ?? []
    const tagObjs = assignments
      .map((a) => a.tag)
      .filter((t): t is { id: string; name: string } => t !== null)
    return {
      id: e.id,
      name: e.name,
      movement_pattern_id: e.movement_pattern_id,
      movement_pattern_name: e.movement_pattern?.name ?? null,
      default_sets: e.default_sets,
      default_reps: e.default_reps,
      default_metric: e.default_metric,
      default_metric_value: e.default_metric_value,
      default_rpe: e.default_rpe,
      usage_count: e.usage_count ?? 0,
      video_url: e.video_url,
      tag_ids: tagObjs.map((t) => t.id),
      tag_names: tagObjs.map((t) => t.name),
    }
  })

  return (
    <div className="page">
      <LibraryView
        exercises={exercises}
        patterns={(patterns ?? []) as Pattern[]}
        tags={(tags ?? []) as Tag[]}
        total={exercises.length}
        patternCount={(patterns ?? []).length}
      />
    </div>
  )
}
