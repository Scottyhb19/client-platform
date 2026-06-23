export type ExerciseFormState = {
  error: string | null
  fieldErrors: Partial<Record<'name' | 'video_url' | 'default_metric', string>>
  /** Raw submitted values, echoed back on error returns. React 19 resets
   *  uncontrolled form fields after a server action completes; without
   *  this echo a validation error wipes everything the EP typed. The form
   *  prefers these over the persisted initial values when present. */
  values?: ExerciseFormEcho
}

export type ExerciseFormEcho = {
  name: string
  movement_pattern_id: string
  video_url: string
  description: string
  instructions: string
  default_sets: string
  default_reps: string
  default_rep_metric: string
  default_metric: string
  default_metric_value: string
  default_rest_seconds: string
  tag_ids: string[]
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
  default_rep_metric: string | null
  default_metric: string | null
  default_metric_value: string | null
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
  default_rep_metric: string | null
  default_metric: string | null
  default_metric_value: string | null
  default_rest_seconds: number | null
  instructions: string | null
  tag_ids: string[]
}

/** A client option for the Programs-tab apply-to-client picker (LPT-4). */
export type ClientOption = {
  id: string
  first_name: string
  last_name: string
}

/** A saved program template + derived counts for the Library Programs tab. */
export type ProgramTemplateSummary = {
  id: string
  name: string
  description: string | null
  created_at: string
  weekCount: number
  dayCount: number
  exerciseCount: number
  usedCount: number
}
