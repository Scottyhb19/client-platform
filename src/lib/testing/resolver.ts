/**
 * resolveMetricSettings — the application-side runtime resolver.
 *
 * For a given (organization_id, test_id, metric_id) returns the merged
 * rendering hints, with per-field flags showing which fields came from
 * an override vs. the base (schema or custom test).
 *
 * Resolution order (mirrors the DB-side test_metric_visibility() function
 * but exposes more fields):
 *
 *   1. Base values:
 *      - If test_id starts with 'custom_', read from practice_custom_tests
 *      - Otherwise, read from the cached physical_markers_schema_seed
 *   2. Override values:
 *      - Read from practice_test_settings for (org, test, metric)
 *      - Each NULL field falls through to the base
 *
 * If the test or metric doesn't exist anywhere, returns null.
 *
 * This is the ONLY path application code uses to read these values.
 * Per /docs/testing-module-schema.md §0, no other module should query
 * the schema JSON, the seed table, or practice_test_settings directly
 * for rendering decisions.
 *
 * Server-only.
 */

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadSchemaSeed } from './schema-loader'
import type {
  ClientPortalVisibility,
  ClientViewChart,
  ComparisonMode,
  DefaultChart,
  DirectionOfGood,
  InputType,
  MetricMeasurement,
  MetricRenderingHints,
  ResolvedMetricSettings,
} from './types'

interface BaseMetric extends MetricMeasurement, MetricRenderingHints {
  category_id: string
  category_name: string
  subcategory_id: string
  subcategory_name: string
  test_id: string
  test_name: string
  metric_id: string
  metric_label: string
  is_custom: boolean
}

interface OverrideRow {
  direction_of_good: DirectionOfGood | null
  default_chart: DefaultChart | null
  comparison_mode: ComparisonMode | null
  client_portal_visibility: ClientPortalVisibility | null
  client_view_chart: ClientViewChart | null
}

interface CustomMetricJson {
  id: string
  label: string
  unit: string
  input_type: InputType
  side: ['left', 'right'] | null
  direction_of_good: DirectionOfGood
  default_chart: DefaultChart
  comparison_mode: ComparisonMode
  client_portal_visibility: ClientPortalVisibility
  client_view_chart: ClientViewChart
}

interface CustomTestRow {
  test_id: string
  name: string
  category_id: string
  subcategory_id: string
  metrics: CustomMetricJson[]
}

const CUSTOM_TEST_PREFIX = 'custom_'

export async function resolveMetricSettings(
  supabase: SupabaseClient,
  organizationId: string,
  testId: string,
  metricId: string,
): Promise<ResolvedMetricSettings | null> {
  const base = await loadBase(supabase, organizationId, testId, metricId)
  if (!base) return null

  const override = await loadOverride(
    supabase,
    organizationId,
    testId,
    metricId,
  )

  return merge(base, override)
}

// ---------------------------------------------------------------------------
// Base resolution: schema seed (or custom test for 'custom_*' IDs)
// ---------------------------------------------------------------------------

async function loadBase(
  supabase: SupabaseClient,
  organizationId: string,
  testId: string,
  metricId: string,
): Promise<BaseMetric | null> {
  if (testId.startsWith(CUSTOM_TEST_PREFIX)) {
    return loadCustomBase(supabase, organizationId, testId, metricId)
  }
  return loadSchemaBase(supabase, testId, metricId)
}

async function loadSchemaBase(
  supabase: SupabaseClient,
  testId: string,
  metricId: string,
): Promise<BaseMetric | null> {
  const seed = await loadSchemaSeed(supabase)
  const row = seed.get(`${testId}::${metricId}`)
  if (!row) return null
  return { ...row, is_custom: false }
}

async function loadCustomBase(
  supabase: SupabaseClient,
  organizationId: string,
  testId: string,
  metricId: string,
): Promise<BaseMetric | null> {
  const { data, error } = await supabase
    .from('practice_custom_tests')
    .select('test_id, name, category_id, subcategory_id, metrics')
    .eq('organization_id', organizationId)
    .eq('test_id', testId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) {
    throw new Error(
      `Failed to load practice_custom_tests for ${testId}: ${error.message}`,
    )
  }
  if (!data) return null

  const test = data as unknown as CustomTestRow
  const metric = test.metrics.find((m) => m.id === metricId)
  if (!metric) return null

  return {
    category_id: test.category_id,
    category_name: test.category_id, // Custom categories don't carry a separate name in v1
    subcategory_id: test.subcategory_id,
    subcategory_name: test.subcategory_id,
    test_id: test.test_id,
    test_name: test.name,
    metric_id: metric.id,
    metric_label: metric.label,
    unit: metric.unit,
    input_type: metric.input_type,
    side_left_right:
      Array.isArray(metric.side) &&
      metric.side.includes('left') &&
      metric.side.includes('right'),
    direction_of_good: metric.direction_of_good,
    default_chart: metric.default_chart,
    comparison_mode: metric.comparison_mode,
    client_portal_visibility: metric.client_portal_visibility,
    client_view_chart: metric.client_view_chart,
    is_custom: true,
  }
}

// ---------------------------------------------------------------------------
// Override resolution: practice_test_settings
// ---------------------------------------------------------------------------

async function loadOverride(
  supabase: SupabaseClient,
  organizationId: string,
  testId: string,
  metricId: string,
): Promise<OverrideRow | null> {
  const { data, error } = await supabase
    .from('practice_test_settings')
    .select(
      'direction_of_good, default_chart, comparison_mode, client_portal_visibility, client_view_chart',
    )
    .eq('organization_id', organizationId)
    .eq('test_id', testId)
    .eq('metric_id', metricId)
    .maybeSingle()

  if (error) {
    throw new Error(
      `Failed to load practice_test_settings for (${testId}, ${metricId}): ${error.message}`,
    )
  }
  return (data as OverrideRow | null) ?? null
}

// ---------------------------------------------------------------------------
// Merge: override OR base, per field
// ---------------------------------------------------------------------------

function merge(
  base: BaseMetric,
  override: OverrideRow | null,
): ResolvedMetricSettings {
  const o = override ?? {
    direction_of_good: null,
    default_chart: null,
    comparison_mode: null,
    client_portal_visibility: null,
    client_view_chart: null,
  }
  return {
    category_id: base.category_id,
    category_name: base.category_name,
    subcategory_id: base.subcategory_id,
    subcategory_name: base.subcategory_name,
    test_id: base.test_id,
    test_name: base.test_name,
    metric_id: base.metric_id,
    metric_label: base.metric_label,
    unit: base.unit,
    input_type: base.input_type,
    side_left_right: base.side_left_right,
    is_custom: base.is_custom,
    direction_of_good: o.direction_of_good ?? base.direction_of_good,
    default_chart: o.default_chart ?? base.default_chart,
    comparison_mode: o.comparison_mode ?? base.comparison_mode,
    client_portal_visibility:
      o.client_portal_visibility ?? base.client_portal_visibility,
    client_view_chart: o.client_view_chart ?? base.client_view_chart,
    overrides: {
      direction_of_good: o.direction_of_good !== null,
      default_chart: o.default_chart !== null,
      comparison_mode: o.comparison_mode !== null,
      client_portal_visibility: o.client_portal_visibility !== null,
      client_view_chart: o.client_view_chart !== null,
    },
  }
}
