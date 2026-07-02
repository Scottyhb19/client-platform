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

/**
 * Validate a ?returnTo= value as an internal app path — the create-exercise
 * flow launched from the session builder returns there after save. Anything
 * that isn't a single-leading-slash path is rejected: "https://…" is an
 * absolute URL, "//host" is protocol-relative, and "/\host" is a browser
 * quirk equivalent to it. Validated on BOTH ends (page render and server
 * action) — the hidden form field is client-tamperable.
 */
export function safeInternalPath(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) {
    return null
  }
  return raw
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

/** A template day, lightweight — for the apply modal's per-day date pickers. */
export type TemplateDayLite = {
  id: string
  weekNumber: number
  dayLabel: string
  sortOrder: number
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
  /** Live days (sorted week → sort_order) for the per-day apply date pickers. */
  days: TemplateDayLite[]
}

/** A saved circuit + derived count for the Library Circuits tab. No usage
 *  count: a circuit is COPIED into a day on insert (copy-on-apply), never
 *  referenced, so there is nothing to count back. */
export type CircuitSummary = {
  id: string
  name: string
  circuit_type: CircuitType
  notes: string | null
  created_at: string
  exerciseCount: number
}

/** A saved session template + derived counts for the Library Sessions tab.
 *  Like CircuitSummary, no usage count — a session is COPIED into a day on
 *  apply (copy-on-apply), never referenced. */
export type SessionTemplateSummary = {
  id: string
  name: string
  created_at: string
  exerciseCount: number
  supersetCount: number
}

export type CircuitType = 'superset' | 'triset' | 'circuit' | 'finisher' | 'warmup'

/** Sentence-case labels for the circuit_type enum (design-system voice). */
export const CIRCUIT_TYPE_LABELS: Record<CircuitType, string> = {
  superset: 'Superset',
  triset: 'Tri-set',
  circuit: 'Circuit',
  finisher: 'Finisher',
  warmup: 'Warm-up',
}
