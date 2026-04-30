/**
 * Direction-of-good colour helpers for the staff Reports tab.
 *
 * Per docs/decisions.md D-003 (Q7 sign-off):
 *   - higher  : green when current > baseline, red when current < baseline
 *   - lower   : green when current < baseline, red when current > baseline
 *   - target_range : green inside band, amber in caution, red outside band
 *   - context_dependent : neutral grey — no inherent good/bad
 *
 * Returns CSS-token references rather than raw hex so the caller stays
 * inside the design system. Caller spreads `colour` into a style.color or
 * style.background.
 *
 * Pure functions — no DB access, no React state. Tested via unit-only
 * pgTAP doesn't apply here; the data half of Test 1 already passes
 * (override flips direction_of_good in practice_test_settings) — this
 * module is the visual half.
 */

import type { DirectionOfGood } from './types'

export type DirectionVerdict = 'good' | 'bad' | 'caution' | 'neutral'

/** Token references — references the design-system CSS variables. */
export const DIRECTION_TOKENS: Record<DirectionVerdict, string> = {
  good: 'var(--color-accent)',
  bad: 'var(--color-alert)',
  caution: 'var(--color-warning)',
  neutral: 'var(--color-muted)',
}

/**
 * Verdict for a (direction, baseline, current) triple.
 *
 * - `higher` / `lower`: comparison of current vs. baseline
 * - `target_range`: not yet wired — returns neutral until clinical bands
 *   are encoded in the schema (current schema does not carry them per
 *   metric, only the validation_bounds soft warns which are not the
 *   same thing)
 * - `context_dependent`: always neutral
 *
 * If baseline === current, returns `neutral` regardless of direction —
 * no movement is no signal.
 */
export function verdictFor(
  direction: DirectionOfGood,
  baseline: number,
  current: number,
): DirectionVerdict {
  if (!Number.isFinite(baseline) || !Number.isFinite(current)) return 'neutral'
  if (baseline === current) return 'neutral'

  switch (direction) {
    case 'higher':
      return current > baseline ? 'good' : 'bad'
    case 'lower':
      return current < baseline ? 'good' : 'bad'
    case 'target_range':
      // Without per-metric clinical bands wired into the schema we
      // can't make a signed call. Phase E will revisit when the bands
      // land. For now, render neutral.
      return 'neutral'
    case 'context_dependent':
      return 'neutral'
  }
}

/** Convenience: token from (direction, baseline, current). */
export function colourFor(
  direction: DirectionOfGood,
  baseline: number,
  current: number,
): string {
  return DIRECTION_TOKENS[verdictFor(direction, baseline, current)]
}

/**
 * Format a percentage change with sign, one decimal place. Returns
 * `'—'` if either input isn't finite or baseline is zero.
 */
export function formatPctChange(baseline: number, current: number): string {
  if (!Number.isFinite(baseline) || !Number.isFinite(current)) return '—'
  if (baseline === 0) return '—'
  const pct = ((current - baseline) / Math.abs(baseline)) * 100
  const sign = pct > 0 ? '+' : pct < 0 ? '' : ''
  return `${sign}${pct.toFixed(1)}%`
}

/** Format an absolute delta with sign, e.g. `+5.2`, `-3.0`. */
export function formatDelta(baseline: number, current: number, decimals = 1): string {
  if (!Number.isFinite(baseline) || !Number.isFinite(current)) return '—'
  const d = current - baseline
  const sign = d > 0 ? '+' : ''
  return `${sign}${d.toFixed(decimals)}`
}
