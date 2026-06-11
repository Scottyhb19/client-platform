/** Render a default-prescription load for the card summary in house voice
 *  ("60kg", "BW", "3:00", "RPE 8", "80%"). Keyed on the seeded
 *  exercise_metric_units codes — codes are stable text identifiers (stored
 *  as text precisely so renames don't ripple), so a lookup table here is
 *  safe. Unknown / org-custom codes fall back to the raw value.
 *
 *  Unit-without-value is legal (e.g. "track kg", no default load): only
 *  'bodyweight' renders in that case — the unit IS the load statement.
 *  Value-without-unit cannot exist (DB CHECK exercises_metric_value_requires_unit).
 */
export function formatDefaultLoad(
  value: string | null,
  metricCode: string | null,
): string | null {
  if (metricCode === 'bodyweight') return 'BW'
  if (!value) return null
  switch (metricCode) {
    case 'kg':
      return `${value}kg`
    case 'lb':
      return `${value}lb`
    case 'percentage':
      return `${value}%`
    case 'rpe':
      return `RPE ${value}`
    case 'distance_m':
      return `${value}m`
    case 'distance_km':
      return `${value}km`
    case 'distance_miles':
      return `${value}mi`
    case 'time_minsec':
    case 'tempo':
    default:
      return value
  }
}
