/**
 * Loader-result types for the testing module.
 *
 * Pulled out of loaders.ts so that client components can import these
 * types without dragging in the 'server-only' module graph. The runtime
 * loaders themselves stay in loaders.ts and remain server-only.
 *
 * No 'server-only' import here — this module is intentionally
 * importable from both client and server code.
 */

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

export interface EditableBatteryRow extends BatteryRow {
  is_active: boolean
}

export interface LastUsedBatteryHint {
  id: string
  name: string
  conducted_at: string
}

// ---------------------------------------------------------------------------
// Captured sessions list (legacy — kept for backwards compat)
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

// ---------------------------------------------------------------------------
// Test history (Phase D Reports tab)
// ---------------------------------------------------------------------------

export interface MetricSeriesPoint {
  session_id: string
  conducted_at: string // ISO timestamp
  value: number
  side: Side
}

export interface MetricHistory {
  settings: ResolvedMetricSettings
  /** Time-series across every (non-deleted) session for this metric.
   *  Sorted ascending by conducted_at. For bilateral metrics the array
   *  contains points for both sides interleaved; group at render time. */
  points: MetricSeriesPoint[]
}

export interface TestHistory {
  test_id: string
  test_name: string
  category_id: string
  category_name: string
  subcategory_id: string
  subcategory_name: string
  is_custom: boolean
  metrics: MetricHistory[]
  /** Most recent conducted_at across this test's metrics — for sorting
   *  tests within a category. */
  most_recent_conducted_at: string
  /** Distinct sessions that touched this test for this client. */
  total_sessions: number
}

export interface CategorySummary {
  category_id: string
  category_name: string
  test_count: number
  total_sessions: number
  most_recent_conducted_at: string
}

/**
 * One captured session for this client — enough metadata for the
 * Phase D.3 comparison-overlay session picker. Result count is the
 * number of test_results rows attached to this session.
 */
export interface SessionInfo {
  session_id: string
  conducted_at: string // ISO timestamp
  battery_name: string | null
  result_count: number
}

export interface ClientTestHistory {
  tests: TestHistory[]
  categories: CategorySummary[]
  /** All sessions for this client, ascending by conducted_at. */
  sessions: SessionInfo[]
}

/**
 * One row from client_publications — the publish-gate audit trail.
 * Mirrors the DB shape directly (deleted_at omitted because the
 * loader filters to live rows).
 *
 * Phase D.5: `test_id` is required. Each publication targets one test
 * within a session — publishing CMJ in a session does not affect the
 * KOOS visibility for the same session.
 */
export interface PublicationRow {
  id: string
  test_session_id: string
  test_id: string
  framing_text: string | null
  published_at: string // ISO timestamp
  published_by: string // user id
  created_at: string
}

// ---------------------------------------------------------------------------
// Settings → Tests
// ---------------------------------------------------------------------------

export interface OverrideMapEntry {
  direction_of_good: DirectionOfGood | null
  default_chart: DefaultChart | null
  comparison_mode: ComparisonMode | null
  client_view_chart: ClientViewChart | null
}

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
