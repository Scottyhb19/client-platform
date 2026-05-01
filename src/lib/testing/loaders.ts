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
import { resolveMetricSettingsBulk } from './resolver'
import type {
  ClientPortalVisibility,
  ClientViewChart,
  ComparisonMode,
  DefaultChart,
  DirectionOfGood,
  InputType,
  ResolvedMetricSettings,
  Side,
} from './types'
import type {
  BatteryRow,
  CapturedSessionRow,
  CatalogCategory,
  CatalogMetric,
  CatalogSubcategory,
  CatalogTest,
  CategorySummary,
  ClientTestHistory,
  EditableBatteryRow,
  LastUsedBatteryHint,
  MetricHistory,
  MetricSeriesPoint,
  OverrideMapEntry,
  PracticeCustomTest,
  PublicationRow,
  SessionInfo,
  TestHistory,
} from './loader-types'

// Re-export the type surface for callers already importing from
// '@/lib/testing/loaders'. The runtime loaders that follow are
// server-only (the file-level import 'server-only' enforces this); the
// types above are reachable from client code via './loader-types'.
export type {
  BatteryRow,
  CapturedSessionRow,
  CatalogCategory,
  CatalogMetric,
  CatalogSubcategory,
  CatalogTest,
  CategorySummary,
  ClientTestHistory,
  EditableBatteryRow,
  LastUsedBatteryHint,
  MetricHistory,
  MetricSeriesPoint,
  OverrideMapEntry,
  PracticeCustomTest,
  PublicationRow,
  SessionInfo,
  TestHistory,
}

// ---------------------------------------------------------------------------
// Catalog: category → subcategory → test → metric tree
//
// Public types (CatalogCategory, CatalogSubcategory, CatalogTest,
// CatalogMetric) live in ./loader-types so client code can use them
// without importing this server-only module. Imported above and
// re-exported alongside the other loader-result types.
// ---------------------------------------------------------------------------

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

/**
 * All non-deleted batteries (active + inactive) for the org. Used by the
 * Settings → Tests battery builder. The capture modal continues to use
 * loadActiveBatteries which filters to is_active = true.
 */
export async function loadAllBatteriesForOrg(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<EditableBatteryRow[]> {
  const { data, error } = await supabase
    .from('test_batteries')
    .select('id, name, description, is_active, metric_keys')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('is_active', { ascending: false })
    .order('name', { ascending: true })

  if (error) throw new Error(`Load all batteries: ${error.message}`)
  return ((data ?? []) as unknown as EditableBatteryRow[])
}

// ---------------------------------------------------------------------------
// Last used battery for this client (UX hint)
// ---------------------------------------------------------------------------

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
// Test history for the staff Reports tab — every captured test_result for
// a client, grouped by test → metric, with resolved rendering hints.
//
// Single round-trip for the raw rows. The resolver is called in bulk for
// every distinct (test_id, metric_id) seen — three queries total
// regardless of history size (seed cache + custom tests + overrides).
//
// Only the fields the staff Reports tab needs are returned. The publish
// surface (Phase D.5 per-test) reuses this loader and leans on
// settings.client_portal_visibility (resolved from schema/custom only —
// no per-EP override since D.6) to filter.
// ---------------------------------------------------------------------------

interface RawHistoryRow {
  session_id: string
  conducted_at: string
  battery_name: string | null
  test_id: string
  metric_id: string
  side: Side
  value: number
}

/**
 * Loads every captured test_result for one client, grouped by
 * test → metric → time-series, with resolved rendering hints attached.
 *
 * Also returns the per-session metadata list (date + battery name +
 * result count) used by the Phase D.3 comparison-overlay session picker.
 *
 * RLS already filters to this client's organisation. Soft-deleted
 * sessions and results are excluded.
 */
export async function loadTestHistoryForClient(
  supabase: SupabaseClient,
  organizationId: string,
  clientId: string,
): Promise<ClientTestHistory> {
  const { data, error } = await supabase
    .from('test_results')
    .select(
      `test_id, metric_id, side, value,
       session:test_sessions!inner(
         id, conducted_at, deleted_at, client_id,
         battery:test_batteries(name)
       )`,
    )
    .is('deleted_at', null)
    .eq('session.client_id', clientId)
    .is('session.deleted_at', null)

  if (error) throw new Error(`Load test history: ${error.message}`)

  // Flatten to RawHistoryRow shape. The PostgREST *-1 cast is the same
  // shape used by loadLastUsedBatteryForClient — runtime is one object,
  // typegen-emitted as an array.
  type Joined = {
    test_id: string
    metric_id: string
    side: Side
    value: number
    session: {
      id: string
      conducted_at: string
      battery: { name: string } | null
    } | null
  }
  const rows: RawHistoryRow[] = []
  for (const row of (data ?? []) as unknown as Joined[]) {
    if (!row.session) continue
    const battery = row.session.battery as unknown as { name: string } | null
    rows.push({
      session_id: row.session.id,
      conducted_at: row.session.conducted_at,
      battery_name: battery?.name ?? null,
      test_id: row.test_id,
      metric_id: row.metric_id,
      side: row.side,
      value: Number(row.value),
    })
  }

  if (rows.length === 0) {
    return { tests: [], categories: [], sessions: [] }
  }

  // Resolve every (test_id, metric_id) once.
  const uniqueKeys = new Map<string, { testId: string; metricId: string }>()
  for (const r of rows) {
    const k = `${r.test_id}::${r.metric_id}`
    if (!uniqueKeys.has(k)) {
      uniqueKeys.set(k, { testId: r.test_id, metricId: r.metric_id })
    }
  }
  const resolved = await resolveMetricSettingsBulk(
    supabase,
    organizationId,
    Array.from(uniqueKeys.values()),
  )

  // Group rows by test_id, then by metric_id within a test.
  type MetricBucket = {
    settings: ResolvedMetricSettings
    points: MetricSeriesPoint[]
  }
  type TestBucket = {
    test_id: string
    metrics: Map<string, MetricBucket>
    sessionIds: Set<string>
    most_recent: string
  }
  const tests = new Map<string, TestBucket>()
  for (const r of rows) {
    const settings = resolved.get(`${r.test_id}::${r.metric_id}`)
    if (!settings) continue // Resolver returned nothing — drop the row.

    let bucket = tests.get(r.test_id)
    if (!bucket) {
      bucket = {
        test_id: r.test_id,
        metrics: new Map(),
        sessionIds: new Set(),
        most_recent: r.conducted_at,
      }
      tests.set(r.test_id, bucket)
    }
    bucket.sessionIds.add(r.session_id)
    if (r.conducted_at > bucket.most_recent) {
      bucket.most_recent = r.conducted_at
    }

    let mb = bucket.metrics.get(r.metric_id)
    if (!mb) {
      mb = { settings, points: [] }
      bucket.metrics.set(r.metric_id, mb)
    }
    mb.points.push({
      session_id: r.session_id,
      conducted_at: r.conducted_at,
      value: r.value,
      side: r.side,
    })
  }

  // Materialise as TestHistory[]. Use the first metric's resolved
  // settings to populate the test-level labels (test_name, category, etc.)
  // — they're identical across metrics in the same test.
  const testList: TestHistory[] = []
  for (const bucket of tests.values()) {
    if (bucket.metrics.size === 0) continue
    const metricsArr: MetricHistory[] = []
    for (const mb of bucket.metrics.values()) {
      mb.points.sort((a, b) => a.conducted_at.localeCompare(b.conducted_at))
      metricsArr.push(mb)
    }
    // Sort metrics by metric_id for deterministic render order.
    metricsArr.sort((a, b) =>
      a.settings.metric_id.localeCompare(b.settings.metric_id),
    )
    const first = metricsArr[0].settings
    testList.push({
      test_id: bucket.test_id,
      test_name: first.test_name,
      category_id: first.category_id,
      category_name: first.category_name,
      subcategory_id: first.subcategory_id,
      subcategory_name: first.subcategory_name,
      is_custom: first.is_custom,
      metrics: metricsArr,
      most_recent_conducted_at: bucket.most_recent,
      total_sessions: bucket.sessionIds.size,
    })
  }
  // Tests sort by category_name, then subcategory_name, then test_name.
  testList.sort((a, b) => {
    const c = a.category_name.localeCompare(b.category_name)
    if (c !== 0) return c
    const s = a.subcategory_name.localeCompare(b.subcategory_name)
    if (s !== 0) return s
    return a.test_name.localeCompare(b.test_name)
  })

  // Build category summaries from the test list.
  const catBuckets = new Map<
    string,
    {
      category_id: string
      category_name: string
      tests: number
      sessions: Set<string>
      most_recent: string
    }
  >()
  // We need the union of session_ids across the category, not just the
  // sum of per-test counts (a single session may touch multiple tests).
  // Re-walk the raw rows and group by category via the resolver lookup.
  for (const r of rows) {
    const settings = resolved.get(`${r.test_id}::${r.metric_id}`)
    if (!settings) continue
    let cb = catBuckets.get(settings.category_id)
    if (!cb) {
      cb = {
        category_id: settings.category_id,
        category_name: settings.category_name,
        tests: 0,
        sessions: new Set(),
        most_recent: r.conducted_at,
      }
      catBuckets.set(settings.category_id, cb)
    }
    cb.sessions.add(r.session_id)
    if (r.conducted_at > cb.most_recent) cb.most_recent = r.conducted_at
  }
  // Set test_count by walking testList to avoid double-counting from
  // bilateral metrics inside the same test.
  for (const t of testList) {
    const cb = catBuckets.get(t.category_id)
    if (cb) cb.tests += 1
  }
  const categories: CategorySummary[] = Array.from(catBuckets.values())
    .map((cb) => ({
      category_id: cb.category_id,
      category_name: cb.category_name,
      test_count: cb.tests,
      total_sessions: cb.sessions.size,
      most_recent_conducted_at: cb.most_recent,
    }))
    .sort((a, b) => a.category_name.localeCompare(b.category_name))

  // Per-session metadata for the comparison-overlay picker. result_count
  // counts every test_results row for the session — bilateral metrics
  // contribute two rows (L + R), which mirrors how the picker should
  // describe a session ("8 results captured" not "4 metrics" — closer
  // to what the EP physically did).
  const sessionBuckets = new Map<
    string,
    { conducted_at: string; battery_name: string | null; count: number }
  >()
  for (const r of rows) {
    let s = sessionBuckets.get(r.session_id)
    if (!s) {
      s = {
        conducted_at: r.conducted_at,
        battery_name: r.battery_name,
        count: 0,
      }
      sessionBuckets.set(r.session_id, s)
    }
    s.count += 1
  }
  const sessions: SessionInfo[] = Array.from(sessionBuckets.entries())
    .map(([sid, s]) => ({
      session_id: sid,
      conducted_at: s.conducted_at,
      battery_name: s.battery_name,
      result_count: s.count,
    }))
    .sort((a, b) => a.conducted_at.localeCompare(b.conducted_at))

  return { tests: testList, categories, sessions }
}

// ---------------------------------------------------------------------------
// Live publications for the Phase D.4 publish flow.
//
// Returns one row per LIVE client_publications entry for this client
// (deleted_at IS NULL). Filtering to a specific client requires a join
// on test_sessions because client_publications doesn't carry client_id
// directly (the org → session → client chain is the source of truth).
// ---------------------------------------------------------------------------

export async function loadPublicationsForClient(
  supabase: SupabaseClient,
  clientId: string,
): Promise<PublicationRow[]> {
  const { data, error } = await supabase
    .from('client_publications')
    .select(
      `id, test_session_id, test_id, framing_text, published_at, published_by, created_at,
       session:test_sessions!inner(client_id, deleted_at)`,
    )
    .is('deleted_at', null)
    .eq('session.client_id', clientId)
    .is('session.deleted_at', null)
    .order('published_at', { ascending: false })

  if (error) throw new Error(`Load publications: ${error.message}`)

  type Joined = {
    id: string
    test_session_id: string
    test_id: string
    framing_text: string | null
    published_at: string
    published_by: string
    created_at: string
    session: { client_id: string; deleted_at: string | null } | null
  }
  return (data ?? []).map((row) => {
    const r = row as unknown as Joined
    return {
      id: r.id,
      test_session_id: r.test_session_id,
      test_id: r.test_id,
      framing_text: r.framing_text,
      published_at: r.published_at,
      published_by: r.published_by,
      created_at: r.created_at,
    }
  })
}

// ---------------------------------------------------------------------------
// Settings → Tests: per-org override map, disabled-test set, custom-test list
// ---------------------------------------------------------------------------

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
        'comparison_mode, client_view_chart',
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
