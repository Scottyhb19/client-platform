/**
 * Schema loader — file + database side.
 *
 * The runtime architecture is documented in /docs/testing-module-schema.md
 * §0 and §14 Q5. Two roles for the schema JSON:
 *
 *   1. The FILE (data/physical_markers_schema_v1.1.json) is the editing
 *      source of truth. Authors edit this. The seed migration is
 *      generated from it via scripts/generate-physical-markers-seed.mjs.
 *
 *   2. The DB SEED TABLE (physical_markers_schema_seed) is the runtime
 *      artifact. The DB-side test_metric_visibility() RLS function
 *      reads it. The application-side resolver also reads it for
 *      consistency — single DB-side source of truth, mirrored from
 *      the file.
 *
 * The file is loaded into memory once per process for two purposes:
 *   - Reading the schema_version, used to assert it matches the DB seed.
 *   - Use by tooling (validation_bounds defaults, future schema diff,
 *     unit tests).
 *
 * The seed table is fetched on first use and cached per-process.
 *
 * Server-only. The loader uses node:fs and assumes a Node.js runtime;
 * Next.js Edge runtime is not supported. Callers from `(staff)` server
 * components and server actions will use the Node runtime by default.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ClientPortalVisibility,
  ClientViewChart,
  ComparisonMode,
  DefaultChart,
  DirectionOfGood,
  InputType,
  SchemaSeedRow,
} from './types'

// ---------------------------------------------------------------------------
// File loader
// ---------------------------------------------------------------------------

interface SchemaFileMetric {
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

interface SchemaFileTest {
  id: string
  name: string
  display_order: number
  notes?: string
  metrics: SchemaFileMetric[]
}

interface SchemaFileSubcategory {
  id: string
  name: string
  display_order: number
  notes?: string
  tests: SchemaFileTest[]
}

interface SchemaFileCategory {
  id: string
  name: string
  display_order: number
  subcategories: SchemaFileSubcategory[]
}

interface SchemaFile {
  schema_version: string
  description: string
  categories: SchemaFileCategory[]
}

let cachedFile: SchemaFile | null = null

/**
 * Read and parse data/physical_markers_schema_v1.1.json. Cached at module
 * level — a single process-wide read.
 */
export function loadSchemaFile(): SchemaFile {
  if (cachedFile) return cachedFile
  const filePath = join(
    process.cwd(),
    'data',
    'physical_markers_schema_v1.1.json',
  )
  const raw = readFileSync(filePath, 'utf8')
  cachedFile = JSON.parse(raw) as SchemaFile
  return cachedFile
}

/**
 * The schema_version baked into the file. Used by the consistency
 * check below.
 */
export function getSchemaFileVersion(): string {
  return loadSchemaFile().schema_version
}

// ---------------------------------------------------------------------------
// Database seed loader
// ---------------------------------------------------------------------------

let cachedSeedMap: Map<string, SchemaSeedRow> | null = null

function seedKey(testId: string, metricId: string): string {
  return `${testId}::${metricId}`
}

/**
 * Fetch every row of physical_markers_schema_seed once and cache it as a
 * Map<test_id::metric_id, row>. Called lazily on first resolver call.
 *
 * The cache is process-lifetime: a schema bump migration won't be picked
 * up without a process restart. That's the expected operational story —
 * schema bumps are code releases.
 */
export async function loadSchemaSeed(
  supabase: SupabaseClient,
): Promise<Map<string, SchemaSeedRow>> {
  if (cachedSeedMap) return cachedSeedMap

  const { data, error } = await supabase
    .from('physical_markers_schema_seed')
    .select('*')

  if (error) {
    throw new Error(
      `Failed to load physical_markers_schema_seed: ${error.message}`,
    )
  }

  const map = new Map<string, SchemaSeedRow>()
  for (const row of data ?? []) {
    map.set(seedKey(row.test_id, row.metric_id), {
      category_id: row.category_id,
      category_name: row.category_name,
      subcategory_id: row.subcategory_id,
      subcategory_name: row.subcategory_name,
      test_id: row.test_id,
      test_name: row.test_name,
      metric_id: row.metric_id,
      metric_label: row.metric_label,
      unit: row.unit,
      input_type: row.input_type as SchemaSeedRow['input_type'],
      side_left_right: row.side_left_right,
      direction_of_good: row.direction_of_good,
      default_chart: row.default_chart,
      comparison_mode: row.comparison_mode,
      client_portal_visibility: row.client_portal_visibility,
      client_view_chart: row.client_view_chart,
    })
  }

  cachedSeedMap = map
  return map
}

/** Test-only: clears the in-process seed cache. */
export function _clearSchemaSeedCache(): void {
  cachedSeedMap = null
}

// ---------------------------------------------------------------------------
// Consistency check (Q5 sign-off)
// ---------------------------------------------------------------------------

/**
 * Asserts that the schema JSON file's version matches the seed table's
 * version. Throws on mismatch. Call this from a deploy health-check or
 * a startup script.
 *
 * v1 leaves this opt-in — the resolver does NOT call it on every request
 * (would cost a round trip per request). The expectation is that a
 * deployment pipeline runs it once after applying migrations.
 */
export async function assertSchemaConsistent(
  supabase: SupabaseClient,
): Promise<void> {
  const fileVersion = getSchemaFileVersion()
  const { data, error } = await supabase
    .from('physical_markers_schema_version')
    .select('schema_version')
    .eq('id', 1)
    .maybeSingle()

  if (error) {
    throw new Error(
      `Failed to read physical_markers_schema_version: ${error.message}`,
    )
  }
  if (!data) {
    throw new Error(
      'physical_markers_schema_version is empty. Run the seed migration.',
    )
  }
  if (data.schema_version !== fileVersion) {
    throw new Error(
      `Schema version drift: file is ${fileVersion}, DB is ${data.schema_version}. ` +
        `Either regenerate the seed migration (node scripts/generate-physical-markers-seed.mjs) ` +
        `or apply the pending migration.`,
    )
  }
}
