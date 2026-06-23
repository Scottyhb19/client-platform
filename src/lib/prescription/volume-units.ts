/**
 * The prescription VOLUME axis — reps / time / distance.
 *
 * A set's volume is a value (`reps` / `reps_performed` text or number) plus a
 * unit (`rep_metric`). `NULL` rep_metric means a plain rep count; otherwise it
 * is an `exercise_metric_units` time/distance code. This is the axis the
 * operator asked to make selectable (timed holds, distance carries) — it is
 * deliberately separate from the LOAD axis (kg/lb/%/bodyweight via
 * `optional_metric` / `weight_metric`) so a loaded carry can record BOTH a
 * distance and a weight on the same set.
 *
 * Single source of truth: the library form, the session builder, the client
 * portal logger, and every card/summary render import from here so the unit
 * list and its rendering can never drift between surfaces.
 *
 * Gap doc: docs/polish/prescription-volume-unit.md (VU-1, VU-4, VU-8).
 */

/** DB-allowed volume metric codes. `NULL` (absent here) = a plain rep count. */
export const VOLUME_METRIC_CODES = [
  'time_minsec',
  'distance_m',
  'distance_km',
  'distance_miles',
] as const

export type VolumeMetric = (typeof VOLUME_METRIC_CODES)[number]

/**
 * UI-exposed options for the volume-unit dropdown (Q-B: Reps / Seconds /
 * Metres now; km + miles are DB-valid but not surfaced until a real need).
 * The empty value persists as `NULL` rep_metric (a plain rep count).
 */
export const VOLUME_UNIT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'Reps' },
  { value: 'time_minsec', label: 'Seconds' },
  { value: 'distance_m', label: 'Metres' },
]

/** Narrow an arbitrary string to a known volume metric (server-side guard). */
export function isVolumeMetric(code: string | null | undefined): code is VolumeMetric {
  return code != null && (VOLUME_METRIC_CODES as readonly string[]).includes(code)
}

/**
 * Full unit label for a field/header — what the value MEANS.
 * `NULL` → "Reps"; time → "Seconds"; distance → "Metres" / "Km" / "Miles".
 */
export function volumeUnitLabel(metric: string | null): string {
  switch (metric) {
    case 'time_minsec':
      return 'Seconds'
    case 'distance_m':
      return 'Metres'
    case 'distance_km':
      return 'Km'
    case 'distance_miles':
      return 'Miles'
    default:
      return 'Reps'
  }
}

/**
 * Short unit suffix for compact summaries (e.g. the builder's "Last logged"
 * footer): "s" / "m" / "km" / "mi"; empty for reps.
 */
export function volumeUnitSuffix(metric: string | null): string {
  switch (metric) {
    case 'time_minsec':
      return 's'
    case 'distance_m':
      return 'm'
    case 'distance_km':
      return 'km'
    case 'distance_miles':
      return 'mi'
    default:
      return ''
  }
}

/**
 * Render a volume value + unit in house voice for cards and summaries:
 *   reps            → "12", "8-12", "8 e/s"   (value as-is — free text)
 *   time_minsec     → "30s" under 90s, "1:30" at/above 90s (when numeric)
 *   distance_m/km/mi→ "20m", "5km", "3mi"
 * Returns null when there is no value to render.
 */
export function formatVolume(
  value: string | null,
  metric: string | null,
): string | null {
  if (value == null) return null
  const v = value.trim()
  if (v === '') return null

  switch (metric) {
    case 'time_minsec': {
      // Seconds stored as a plain integer render as a duration; anything the
      // EP typed in another shape (a range, an explicit "1:30") passes through.
      if (/^\d+$/.test(v)) {
        const secs = parseInt(v, 10)
        if (secs < 90) return `${secs}s`
        const m = Math.floor(secs / 60)
        const s = secs % 60
        return `${m}:${s.toString().padStart(2, '0')}`
      }
      return v
    }
    case 'distance_m':
      return `${v}m`
    case 'distance_km':
      return `${v}km`
    case 'distance_miles':
      return `${v}mi`
    default:
      return v
  }
}
