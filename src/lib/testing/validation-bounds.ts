/**
 * Validation bounds loader — outlier detection for the capture flow.
 *
 * Per brief §4.1 and /docs/testing-module-schema.md §13, validation
 * bounds live in data/validation_bounds.json — tunable without code
 * changes. This module is the only allowed reader; the capture modal
 * calls validateMetricValue() rather than checking ranges directly.
 *
 * Resolution order for any (testId, metricId, unit):
 *   1. by_metric["{testId}::{metricId}"] — explicit bounds
 *   2. defaults_by_unit[unit] — sensible default per unit
 *   3. fallback — non-negative number with no upper bound
 *
 * `min`/`max` are HARD bounds: outside = reject the value.
 * `warn_below`/`warn_above` are SOFT bounds: outside = require confirm.
 *
 * Server-only. The bounds file ships with the deployment and is read
 * once per process via fs.readFileSync.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import 'server-only'
import type { InputType } from './types'

interface MetricBounds {
  min?: number
  max?: number
  warn_below?: number
  warn_above?: number
}

interface ValidationBoundsFile {
  schema_version: string
  description: string
  defaults_by_unit: Record<string, MetricBounds>
  by_metric: Record<string, MetricBounds>
}

let cached: ValidationBoundsFile | null = null

function load(): ValidationBoundsFile {
  if (cached) return cached
  const filePath = join(process.cwd(), 'data', 'validation_bounds.json')
  const raw = readFileSync(filePath, 'utf8')
  cached = JSON.parse(raw) as ValidationBoundsFile
  return cached
}

/** Test-only: clears the cache. */
export function _clearValidationBoundsCache(): void {
  cached = null
}

/**
 * Returns the bounds that apply to a given metric. Resolution falls
 * through metric → unit default → permissive fallback.
 */
export function getMetricBounds(
  testId: string,
  metricId: string,
  unit: string,
): MetricBounds {
  const file = load()
  const key = `${testId}::${metricId}`
  if (file.by_metric[key]) return file.by_metric[key]
  if (file.defaults_by_unit[unit]) return file.defaults_by_unit[unit]
  return { min: 0 } // permissive: non-negative, no upper bound
}

export type ValidationVerdict =
  | { ok: true; warning: null }
  | { ok: true; warning: string }
  | { ok: false; error: string }

/**
 * Validate a captured numeric value against the metric's bounds and
 * input_type. Pure function — no DB access.
 *
 * Returns:
 *   { ok: true, warning: null }    — value is within all bounds
 *   { ok: true, warning: '...' }   — within hard bounds, outside soft bounds (confirm dialog)
 *   { ok: false, error: '...' }    — outside hard bounds (reject)
 */
export function validateMetricValue(args: {
  testId: string
  metricId: string
  unit: string
  inputType: InputType
  value: number
}): ValidationVerdict {
  const { testId, metricId, unit, inputType, value } = args

  if (Number.isNaN(value)) {
    return { ok: false, error: 'Enter a number.' }
  }
  if (!Number.isFinite(value)) {
    return { ok: false, error: 'Value must be finite.' }
  }
  if (inputType === 'integer' && !Number.isInteger(value)) {
    return { ok: false, error: 'Whole numbers only.' }
  }

  const bounds = getMetricBounds(testId, metricId, unit)

  if (bounds.min !== undefined && value < bounds.min) {
    return {
      ok: false,
      error: `Below the minimum (${bounds.min} ${unit}).`,
    }
  }
  if (bounds.max !== undefined && value > bounds.max) {
    return {
      ok: false,
      error: `Above the maximum (${bounds.max} ${unit}).`,
    }
  }
  if (bounds.warn_below !== undefined && value < bounds.warn_below) {
    return {
      ok: true,
      warning: `Unusually low — confirm? (${bounds.warn_below} ${unit} is the typical lower bound.)`,
    }
  }
  if (bounds.warn_above !== undefined && value > bounds.warn_above) {
    return {
      ok: true,
      warning: `Unusually high — confirm? (${bounds.warn_above} ${unit} is the typical upper bound.)`,
    }
  }
  return { ok: true, warning: null }
}
