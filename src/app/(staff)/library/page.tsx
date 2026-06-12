import { createSupabaseServerClient } from '@/lib/supabase/server'
import { LibraryView } from './_components/LibraryView'
import { LIBRARY_EXERCISE_COLUMNS, toLibraryExercises } from './_lib/exercise-query'
import type { Pattern, Tag } from './types'

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
    // Shared select with the session builder's Library tab (G-7,
    // 2026-06-12) — one query shape, one card mapping, no drift.
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
  ])

  if (exErr) throw new Error(`Load exercises: ${exErr.message}`)

  const exercises = toLibraryExercises(exercisesRaw)

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
