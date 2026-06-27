/**
 * Collapse an exercise's prescribed SETS into one glanceable line.
 *
 * The prescription detail lives in the per-set `program_exercise_sets`
 * table — `reps` + `rep_metric` (the VOLUME axis: reps / time / distance)
 * and `optional_value` + `optional_metric` (the LOAD / Notes axis: kg / lb
 * / % / RPE / bodyweight). The legacy flat columns on `program_exercises`
 * (`sets`, `reps`, `rpe`, `optional_*`) are dead — no writer populates them
 * since the per-set fan-out — so anything reading them shows blanks.
 *
 * This is the summary surface (the program-calendar day popover today,
 * reusable by any future card that previews a prescription without the
 * full builder grid). The full editor lives in the session builder.
 *
 * Single source of truth: the VOLUME axis is rendered through the shared
 * `formatVolume`, so the unit can never drift from the builder / portal /
 * completion surfaces. The LOAD axis is rendered with its unit label,
 * resolved from the org's `exercise_metric_units` (code → display_label);
 * the `rpe` metric is special-cased to house style ("RPE 8").
 *
 * Rendering rules:
 *   - Uniform sets collapse to "{n} × {volume}"  → "3 × 8", "3 × 30s".
 *   - Varied reps list the per-set values        → "8 / 6 / 4" (capped;
 *     beyond the cap it falls back to "{n} sets" — the per-set detail is
 *     one tap away in the builder).
 *   - A LOAD value appends: uniform shows once    → " · 80kg", " · RPE 8";
 *     an ascending / varied sequence lists each   → " · 80kg / 85kg / 90kg",
 *     " · RPE 7 / 8 / 9" (capped like the volume list — beyond the cap it's
 *     omitted, the per-set detail being one tap away in the builder).
 *   - A positive rest appends                     → " · 90s rest".
 *
 * Returns '' when nothing is prescribed yet, so the caller renders its own
 * empty marker ('—').
 */
import { formatVolume } from './volume-units'

export interface PrescriptionSetInput {
  /** Free-text volume value: "8", "8-12", "30". NULL when not yet typed. */
  reps: string | null
  /** Volume unit code. NULL = plain reps; 'time_minsec' / 'distance_m' = unit. */
  rep_metric: string | null
  /** Load / Notes unit code (kg, lb, %, rpe, ...). Column-uniform per exercise. */
  optional_metric: string | null
  /** Load / Notes value, per set. */
  optional_value: string | null
}

export interface SummariseOptions {
  /** code → display_label for the LOAD axis, from `exercise_metric_units`. */
  metricLabelByCode?: Record<string, string>
  /** Per-exercise rest (program_exercises.rest_seconds). */
  restSeconds?: number | null
}

// How many varied per-set volumes to list before collapsing to "{n} sets".
const VARIED_VOLUME_CAP = 5

export function summarisePrescription(
  sets: PrescriptionSetInput[],
  { metricLabelByCode = {}, restSeconds = null }: SummariseOptions = {},
): string {
  const live = sets ?? []
  if (live.length === 0) return ''

  const parts: string[] = []
  const n = live.length

  // ── Volume axis (reps / time / distance) ──────────────────────────
  const volumes = live.map((s) => formatVolume(s.reps, s.rep_metric))
  const allPresent = volumes.every((v) => v !== null)
  const uniform = volumes.every((v) => v === volumes[0])

  if (allPresent && uniform) {
    parts.push(`${n} × ${volumes[0]}`)
  } else if (volumes.some((v) => v !== null)) {
    parts.push(
      n <= VARIED_VOLUME_CAP
        ? volumes.map((v) => v ?? '–').join(' / ')
        : `${n} ${n === 1 ? 'set' : 'sets'}`,
    )
  } else {
    // Sets exist but no volume typed on any of them — just the count.
    parts.push(`${n} ${n === 1 ? 'set' : 'sets'}`)
  }

  // ── Load / Notes axis (kg / lb / % / rpe / ...) ───────────────────
  // The metric is column-uniform (one writer keeps all rows in sync); the
  // value is per-set. A uniform value shows once ("80kg"); an ascending /
  // varied sequence lists every set's value ("80kg / 85kg / 90kg") so the
  // glance shows what the EP actually programmed — capped like the volume
  // list, beyond which the per-set detail is one tap away in the builder.
  const metricCode = live.find((s) => s.optional_metric)?.optional_metric ?? null
  const loadValues = live.map((s) => s.optional_value?.trim() || null)
  const anyLoad = loadValues.some((v) => v !== null)

  if (anyLoad) {
    // anyLoad ⇒ when every entry equals the first, that first is non-null.
    const uniform = loadValues.every((v) => v === loadValues[0])
    if (uniform) {
      parts.push(renderLoad(loadValues[0]!, metricCode, metricLabelByCode))
    } else if (n <= VARIED_VOLUME_CAP) {
      if (metricCode === 'rpe') {
        // Prefix the axis label once: "RPE 7 / 8 / 9".
        parts.push(`RPE ${loadValues.map((v) => v ?? '–').join(' / ')}`)
      } else {
        parts.push(
          loadValues
            .map((v) =>
              v === null ? '–' : renderLoad(v, metricCode, metricLabelByCode),
            )
            .join(' / '),
        )
      }
    }
    // n beyond the cap: omit (the volume part already reads "{n} sets").
  }

  // ── Rest (per-exercise) ───────────────────────────────────────────
  if (restSeconds != null && restSeconds > 0) {
    parts.push(`${restSeconds}s rest`)
  }

  return parts.join(' · ')
}

/**
 * Render a single LOAD value with its unit:
 *   'rpe'         → "RPE 8"        (the label prefixes the number)
 *   short symbol  → "80kg", "75%"  (kg / lb / % sit flush)
 *   word label    → "100 Bodyweight" (longer labels get a space)
 *   no metric     → the raw value (free-typed note)
 */
function renderLoad(
  value: string,
  metricCode: string | null,
  labels: Record<string, string>,
): string {
  if (metricCode === 'rpe') return `RPE ${value}`
  if (metricCode) {
    const label = labels[metricCode] ?? metricCode
    const flush = label.length <= 2 || label === '%'
    return `${value}${flush ? '' : ' '}${label}`
  }
  return value
}
