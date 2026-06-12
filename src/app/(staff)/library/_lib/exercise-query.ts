import type { LibraryExercise } from '../types'

/**
 * Shared select + mapper for loading LibraryExercise rows. Two consumers:
 * the standalone library page and the session builder's Library tab
 * (G-7 of the program-engine polish pass, 2026-06-12) — one query shape
 * so the card content can never drift between the two surfaces.
 */
export const LIBRARY_EXERCISE_COLUMNS = `id, name, default_sets, default_reps, default_metric,
         default_metric_value, usage_count, video_url,
         movement_pattern_id,
         movement_pattern:movement_patterns(name),
         exercise_tag_assignments(tag:exercise_tags(id, name, deleted_at))` as const

/** Structural input type — the supabase-inferred row satisfies this. */
type RawLibraryExerciseRow = {
  id: string
  name: string
  default_sets: number | null
  default_reps: string | null
  default_metric: string | null
  default_metric_value: string | null
  usage_count: number | null
  video_url: string | null
  movement_pattern_id: string | null
  movement_pattern: { name: string } | null
  exercise_tag_assignments:
    | { tag: { id: string; name: string; deleted_at: string | null } | null }[]
    | null
}

export function toLibraryExercises(
  rows: RawLibraryExerciseRow[] | null,
): LibraryExercise[] {
  return (rows ?? []).map((e) => {
    const assignments = e.exercise_tag_assignments ?? []
    // Drop soft-deleted tags from the per-card chip render. The assignment
    // row stays in the join table for historical context; the chip is
    // hidden because the tag itself is no longer active.
    const tagObjs = assignments
      .map((a) => a.tag)
      .filter(
        (t): t is { id: string; name: string; deleted_at: string | null } =>
          t !== null && t.deleted_at === null,
      )
    return {
      id: e.id,
      name: e.name,
      movement_pattern_id: e.movement_pattern_id,
      movement_pattern_name: e.movement_pattern?.name ?? null,
      default_sets: e.default_sets,
      default_reps: e.default_reps,
      default_metric: e.default_metric,
      default_metric_value: e.default_metric_value,
      usage_count: e.usage_count ?? 0,
      video_url: e.video_url,
      tag_ids: tagObjs.map((t) => t.id),
      tag_names: tagObjs.map((t) => t.name),
    }
  })
}
