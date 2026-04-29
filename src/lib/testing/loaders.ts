/**
 * Server-side data loaders for the testing module's UI surface.
 *
 * Centralised so the page component, the Reports tab, and any future
 * test-related screen all pull from the same shape. Per the runtime-
 * config rule, these loaders are the only place application code joins
 * the schema seed with practice_custom_tests + practice_disabled_tests
 * to produce a "what's available to capture" view.
 *
 * Server-only — `createSupabaseServerClient` is required by every call.
 */

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ClientPortalVisibility,
  ClientViewChart,
  ComparisonMode,
  DefaultChart,
  DirectionOfGood,
  InputType,
} from './types'

// ---------------------------------------------------------------------------
// Catalog: category → subcategory → test → metric tree
// ---------------------------------------------------------------------------

export interface CatalogMetric {
  id: string
  label: string
  unit: string
  input_type: InputType
  side_left_right: boolean
  direction_of_good: DirectionOfGood
  default_chart: DefaultChart
  comparison_mode: ComparisonMode
  client_portal_visibility: ClientPortalVisibility
  client_view_chart: ClientViewChart
}

export interface CatalogTest {
  id: string
  name: string
  display_order: number
  notes: string | null
  is_custom: boolean
  metrics: CatalogMetric[]
}

export interface CatalogSubcategory {
  id: string
  name: string
  display_order: number
  notes: string | null
  tests: CatalogTest[]
}

export interface CatalogCategory {
  id: string
  name: string
  display_order: number
  subcategories: CatalogSubcategory[]
}

interface SeedRow {
  category_id: string
  category_name: string
  category_display_order: number
  subcategory_id: string
  subcategory_name: string
  subcategory_display_order: number
  subcategory_notes: string | null
  test_id: string
  test_name: string
  test_display_order: number
  test_notes: string | null
  metric_id: string
  metric_label: string
  unit: string
  input_type: string
  side_left_right: boolean
  direction_of_good: DirectionOfGood
  default_chart: DefaultChart
  comparison_mode: ComparisonMode
  client_portal_visibility: ClientPortalVisibility
  client_view_chart: ClientViewChart
}

interface CustomTestRow {
  test_id: string
  category_id: string
  subcategory_id: string
  name: string
  display_order: number
  metrics: Array<{
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
  }>
}

/**
 * Builds the capture-modal catalog: schema seed + custom tests, with
 * disabled tests filtered out. Sort order matches the schema's
 * display_order at every level.
 *
 * Options (default = current capture-flow behaviour):
 * - includeCustom (default true): merge practice_custom_tests rows into
 *   the tree alongside schema tests. Set false for the disable-tests
 *   surface, which only manages schema tests (custom tests have their
 *   own Archive action in 3.2 per Q4 sign-off).
 * - includeDisabled (default false): include schema and custom tests
 *   that are listed in practice_disabled_tests. Set true for
 *   /settings/tests so the override editor can still be used on
 *   disabled tests and the disable-tests toggle list shows everything.
 */
export async function loadCatalog(
  supabase: SupabaseClient,
  organizationId: string,
  options: { includeCustom?: boolean; includeDisabled?: boolean } = {},
): Promise<CatalogCategory[]> {
  const includeCustom = options.includeCustom !== false
  const includeDisabled = options.includeDisabled === true

  const [seedQ, customQ, disabledQ] = await Promise.all([
    supabase.from('physical_markers_schema_seed').select('*'),
    supabase
      .from('practice_custom_tests')
      .select('test_id, category_id, subcategory_id, name, display_order, metrics')
      .eq('organization_id', organizationId)
      .is('deleted_at', null),
    supabase
      .from('practice_disabled_tests')
      .select('test_id')
      .eq('organization_id', organizationId),
  ])

  if (seedQ.error) throw new Error(`Load schema seed: ${seedQ.error.message}`)
  if (customQ.error) throw new Error(`Load custom tests: ${customQ.error.message}`)
  if (disabledQ.error) throw new Error(`Load disabled tests: ${disabledQ.error.message}`)

  const disabled = new Set((disabledQ.data ?? []).map((d) => d.test_id))
  const customs = (customQ.data ?? []) as unknown as CustomTestRow[]

  // Group seed rows by category > subcategory > test.
  const catMap = new Map<string, CatalogCategory>()
  for (const row of (seedQ.data ?? []) as SeedRow[]) {
    if (!includeDisabled && disabled.has(row.test_id)) continue

    let cat = catMap.get(row.category_id)
    if (!cat) {
      cat = {
        id: row.category_id,
        name: row.category_name,
        display_order: row.category_display_order,
        subcategories: [],
      }
      catMap.set(row.category_id, cat)
    }
    let sub = cat.subcategories.find((s) => s.id === row.subcategory_id)
    if (!sub) {
      sub = {
        id: row.subcategory_id,
        name: row.subcategory_name,
        display_order: row.subcategory_display_order,
        notes: row.subcategory_notes,
        tests: [],
      }
      cat.subcategories.push(sub)
    }
    let test = sub.tests.find((t) => t.id === row.test_id)
    if (!test) {
      test = {
        id: row.test_id,
        name: row.test_name,
        display_order: row.test_display_order,
        notes: row.test_notes,
        is_custom: false,
        metrics: [],
      }
      sub.tests.push(test)
    }
    test.metrics.push({
      id: row.metric_id,
      label: row.metric_label,
      unit: row.unit,
      input_type: row.input_type as InputType,
      side_left_right: row.side_left_right,
      direction_of_good: row.direction_of_good,
      default_chart: row.default_chart,
      comparison_mode: row.comparison_mode,
      client_portal_visibility: row.client_portal_visibility,
      client_view_chart: row.client_view_chart,
    })
  }

  // Custom tests: append into the appropriate subcategory if it exists,
  // otherwise create a "Custom" subcategory under the named category.
  if (!includeCustom) {
    // Skip the custom-tests merge entirely.
    for (const cat of catMap.values()) {
      cat.subcategories.sort(
        (a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name),
      )
      for (const sub of cat.subcategories) {
        sub.tests.sort(
          (a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name),
        )
      }
    }
    return Array.from(catMap.values()).sort(
      (a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name),
    )
  }

  for (const ct of customs) {
    if (!includeDisabled && disabled.has(ct.test_id)) continue
    let cat = catMap.get(ct.category_id)
    if (!cat) {
      // Custom category that isn't in the schema — create with a high
      // display_order so it sorts after schema categories.
      cat = {
        id: ct.category_id,
        name: ct.category_id, // v1 doesn't store custom-category names separately
        display_order: 999,
        subcategories: [],
      }
      catMap.set(ct.category_id, cat)
    }
    let sub = cat.subcategories.find((s) => s.id === ct.subcategory_id)
    if (!sub) {
      sub = {
        id: ct.subcategory_id,
        name: ct.subcategory_id,
        display_order: 999,
        notes: null,
        tests: [],
      }
      cat.subcategories.push(sub)
    }
    sub.tests.push({
      id: ct.test_id,
      name: ct.name,
      display_order: ct.display_order,
      notes: null,
      is_custom: true,
      metrics: ct.metrics.map((m) => ({
        id: m.id,
        label: m.label,
        unit: m.unit,
        input_type: m.input_type,
        side_left_right:
          Array.isArray(m.side) && m.side.includes('left') && m.side.includes('right'),
        direction_of_good: m.direction_of_good,
        default_chart: m.default_chart,
        comparison_mode: m.comparison_mode,
        client_portal_visibility: m.client_portal_visibility,
        client_view_chart: m.client_view_chart,
      })),
    })
  }

  // Sort everything by display_order, ties broken alphabetically.
  const cats = Array.from(catMap.values()).sort(
    (a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name),
  )
  for (const cat of cats) {
    cat.subcategories.sort(
      (a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name),
    )
    for (const sub of cat.subcategories) {
      sub.tests.sort(
        (a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name),
      )
    }
  }
  return cats
}

// ---------------------------------------------------------------------------
// Batteries
// ---------------------------------------------------------------------------

export interface BatteryRow {
  id: string
  name: string
  description: string | null
  metric_keys: Array<{
    test_id: string
    metric_id: string
    side?: 'left' | 'right' | null
  }>
}

/** Active, non-deleted batteries for the org, sorted by name. */
export async function loadActiveBatteries(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<BatteryRow[]> {
  const { data, error } = await supabase
    .from('test_batteries')
    .select('id, name, description, metric_keys')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('name', { ascending: true })

  if (error) throw new Error(`Load batteries: ${error.message}`)
  return ((data ?? []) as unknown as BatteryRow[])
}

// ---------------------------------------------------------------------------
// Last used battery for this client (UX hint)
// ---------------------------------------------------------------------------

export interface LastUsedBatteryHint {
  id: string
  name: string
  conducted_at: string
}

export async function loadLastUsedBatteryForClient(
  supabase: SupabaseClient,
  clientId: string,
): Promise<LastUsedBatteryHint | null> {
  const { data, error } = await supabase
    .from('test_sessions')
    .select('applied_battery_id, conducted_at, battery:test_batteries(name)')
    .eq('client_id', clientId)
    .not('applied_battery_id', 'is', null)
    .is('deleted_at', null)
    .order('conducted_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Load last-used battery: ${error.message}`)
  if (!data || !data.applied_battery_id) return null

  // PostgREST returns the *-1 relation as a single object at runtime;
  // the supabase-js type generator types it as an array. Cast through
  // unknown to match the runtime shape.
  const battery = data.battery as unknown as { name: string } | null
  if (!battery) return null
  return {
    id: data.applied_battery_id,
    name: battery.name,
    conducted_at: data.conducted_at,
  }
}

// ---------------------------------------------------------------------------
// Captured sessions for the Reports tab list
// ---------------------------------------------------------------------------

export interface CapturedSessionRow {
  id: string
  conducted_at: string
  notes: string | null
  source: 'manual' | 'vald' | 'imported'
  applied_battery_id: string | null
  battery_name: string | null
  result_count: number
}

/** Recent test sessions for a client — for the staff Reports tab list. */
export async function loadCapturedSessionsForClient(
  supabase: SupabaseClient,
  clientId: string,
  limit = 30,
): Promise<CapturedSessionRow[]> {
  const { data, error } = await supabase
    .from('test_sessions')
    .select(
      `id, conducted_at, notes, source, applied_battery_id,
       battery:test_batteries(name),
       results:test_results(id)`,
    )
    .eq('client_id', clientId)
    .is('deleted_at', null)
    .order('conducted_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(`Load captured sessions: ${error.message}`)

  return (data ?? []).map((row) => {
    // Same *-1 cast as loadLastUsedBatteryForClient — runtime is one object.
    const battery = row.battery as unknown as { name: string } | null
    const results = (row.results ?? []) as Array<{ id: string }>
    return {
      id: row.id,
      conducted_at: row.conducted_at,
      notes: row.notes,
      source: row.source,
      applied_battery_id: row.applied_battery_id,
      battery_name: battery?.name ?? null,
      result_count: results.length,
    }
  })
}

// ---------------------------------------------------------------------------
// Settings → Tests: per-org override map, disabled-test set, custom-test list
// ---------------------------------------------------------------------------

export interface OverrideMapEntry {
  direction_of_good: DirectionOfGood | null
  default_chart: DefaultChart | null
  comparison_mode: ComparisonMode | null
  client_portal_visibility: ClientPortalVisibility | null
  client_view_chart: ClientViewChart | null
}

const overrideKey = (testId: string, metricId: string): string =>
  `${testId}::${metricId}`

/**
 * Load every practice_test_settings row for the org as a Map keyed by
 * `${test_id}::${metric_id}`. Used by the Settings → Tests override editor
 * to render the entire catalog in one round-trip instead of one
 * resolveMetricSettings call per metric.
 *
 * This is the single permitted direct-read of practice_test_settings —
 * the runtime-config rule (see /docs/testing-module-schema.md §0) routes
 * all per-metric reads through the resolver. The override editor must
 * read every row, so it gets a dedicated bulk loader.
 */
export async function loadAllOverridesForOrg(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<Map<string, OverrideMapEntry>> {
  const { data, error } = await supabase
    .from('practice_test_settings')
    .select(
      'test_id, metric_id, direction_of_good, default_chart, ' +
        'comparison_mode, client_portal_visibility, client_view_chart',
    )
    .eq('organization_id', organizationId)
  if (error) throw new Error(`Load practice_test_settings: ${error.message}`)
  const map = new Map<string, OverrideMapEntry>()
  // PostgREST's typed union ('successful row' | 'error string') trips a
  // direct cast — go through unknown the same way loadActiveBatteries does.
  const rows = ((data ?? []) as unknown) as Array<
    OverrideMapEntry & { test_id: string; metric_id: string }
  >
  for (const row of rows) {
    map.set(overrideKey(row.test_id, row.metric_id), {
      direction_of_good: row.direction_of_good,
      default_chart: row.default_chart,
      comparison_mode: row.comparison_mode,
      client_portal_visibility: row.client_portal_visibility,
      client_view_chart: row.client_view_chart,
    })
  }
  return map
}

/** Set of disabled test_ids for the org. Empty set if none disabled. */
export async function loadAllDisabledTests(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('practice_disabled_tests')
    .select('test_id')
    .eq('organization_id', organizationId)
  if (error) throw new Error(`Load practice_disabled_tests: ${error.message}`)
  return new Set((data ?? []).map((d) => d.test_id))
}

/** Editable view of a custom test for the Settings → Tests builder. */
export interface PracticeCustomTest {
  id: string
  test_id: string
  category_id: string
  subcategory_id: string
  name: string
  display_order: number
  metrics: Array<{
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
  }>
}

export async function loadCustomTestsForOrg(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<PracticeCustomTest[]> {
  const { data, error } = await supabase
    .from('practice_custom_tests')
    .select(
      'id, test_id, category_id, subcategory_id, name, display_order, metrics',
    )
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('category_id', { ascending: true })
    .order('subcategory_id', { ascending: true })
    .order('display_order', { ascending: true })
  if (error) throw new Error(`Load practice_custom_tests: ${error.message}`)
  return (data ?? []) as unknown as PracticeCustomTest[]
}
