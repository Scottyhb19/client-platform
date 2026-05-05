export type ExerciseFormState = {
  error: string | null
  fieldErrors: Partial<Record<'name', string>>
}

export const initialExerciseFormState: ExerciseFormState = {
  error: null,
  fieldErrors: {},
}

export type Pattern = { id: string; name: string }
export type Tag = { id: string; name: string }
export type MetricUnit = { code: string; display_label: string }

export type LibraryExercise = {
  id: string
  name: string
  movement_pattern_id: string | null
  movement_pattern_name: string | null
  default_sets: number | null
  default_reps: string | null
  default_metric: string | null
  default_metric_value: string | null
  default_rpe: number | null
  usage_count: number
  video_url: string | null
  tag_ids: string[]
  tag_names: string[]
}

export type ExerciseFormValues = {
  name: string
  movement_pattern_id: string | null
  video_url: string | null
  description: string | null
  default_sets: number | null
  default_reps: string | null
  default_metric: string | null
  default_metric_value: string | null
  default_rpe: number | null
  default_rest_seconds: number | null
  instructions: string | null
  tag_ids: string[]
}
