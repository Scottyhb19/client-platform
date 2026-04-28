#!/usr/bin/env node
/*
 * generate-physical-markers-seed.mjs
 *
 * Reads data/physical_markers_schema_v1.1.json and emits a SQL migration
 * that populates physical_markers_schema_seed + physical_markers_schema_version.
 *
 * Re-run when the schema JSON version bumps. The output is committed
 * to source control — this script is the *generator*, the SQL file is
 * the *artifact*.
 *
 * Usage:
 *   node scripts/generate-physical-markers-seed.mjs
 *
 * The output filename includes the schema_version + a timestamp prefix
 * so it sorts correctly into the supabase/migrations sequence. Edit the
 * MIGRATION_TIMESTAMP constant if you re-run for the same schema version.
 */

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const SCHEMA_PATH = path.join(REPO_ROOT, 'data', 'physical_markers_schema_v1.1.json')
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase', 'migrations')

// Bump if regenerating for the same schema version (e.g. correcting
// the seed). The timestamp must sort after 20260428120900 so the seed
// applies after audit registration is in place.
const MIGRATION_TIMESTAMP = '20260428121000'

function sqlString(s) {
  if (s === null || s === undefined) return 'NULL'
  return `'${String(s).replace(/'/g, "''")}'`
}

function sqlBool(b) {
  return b ? 'TRUE' : 'FALSE'
}

function sqlInt(n) {
  return Number.isFinite(n) ? String(n) : 'NULL'
}

async function main() {
  const raw = await readFile(SCHEMA_PATH, 'utf8')
  const schema = JSON.parse(raw)
  const version = schema.schema_version

  if (typeof version !== 'string' || !version.length) {
    throw new Error('schema_version missing or empty in schema JSON')
  }

  const rows = []
  for (const cat of schema.categories ?? []) {
    for (const sub of cat.subcategories ?? []) {
      for (const test of sub.tests ?? []) {
        for (const metric of test.metrics ?? []) {
          const sideLR =
            Array.isArray(metric.side) &&
            metric.side.includes('left') &&
            metric.side.includes('right')
          rows.push({
            category_id: cat.id,
            category_name: cat.name,
            category_display_order: cat.display_order,
            subcategory_id: sub.id,
            subcategory_name: sub.name,
            subcategory_display_order: sub.display_order,
            subcategory_notes: sub.notes ?? null,
            test_id: test.id,
            test_name: test.name,
            test_display_order: test.display_order,
            test_notes: test.notes ?? null,
            metric_id: metric.id,
            metric_label: metric.label,
            unit: metric.unit,
            input_type: metric.input_type,
            side_left_right: sideLR,
            direction_of_good: metric.direction_of_good,
            default_chart: metric.default_chart,
            comparison_mode: metric.comparison_mode,
            client_portal_visibility: metric.client_portal_visibility,
            client_view_chart: metric.client_view_chart,
          })
        }
      }
    }
  }

  // Generate SQL
  const lines = []
  lines.push(`-- ============================================================================`)
  lines.push(`-- ${MIGRATION_TIMESTAMP}_seed_physical_markers_v${version.replace(/\./g, '_')}`)
  lines.push(`-- ============================================================================`)
  lines.push(`-- Why: Populates physical_markers_schema_seed from`)
  lines.push(`-- data/physical_markers_schema_v1.1.json (version ${version}).`)
  lines.push(`-- This file is GENERATED — regenerate with:`)
  lines.push(`--   node scripts/generate-physical-markers-seed.mjs`)
  lines.push(`--`)
  lines.push(`-- The seed is idempotent: TRUNCATE + INSERT runs on every apply, so`)
  lines.push(`-- a re-applied migration ends with the same state regardless of`)
  lines.push(`-- prior partial runs. Per-EP overrides in practice_test_settings`)
  lines.push(`-- are unaffected — they're keyed on (test_id, metric_id) which`)
  lines.push(`-- survive schema version bumps.`)
  lines.push(`-- ============================================================================`)
  lines.push('')
  lines.push(`-- Reset to a clean slate. ON DELETE CASCADE is not in play; this`)
  lines.push(`-- is the simple approach to "make state match the JSON."`)
  lines.push(`TRUNCATE TABLE physical_markers_schema_seed;`)
  lines.push('')
  lines.push(`INSERT INTO physical_markers_schema_seed (`)
  lines.push(`  category_id, category_name, category_display_order,`)
  lines.push(`  subcategory_id, subcategory_name, subcategory_display_order, subcategory_notes,`)
  lines.push(`  test_id, test_name, test_display_order, test_notes,`)
  lines.push(`  metric_id, metric_label,`)
  lines.push(`  unit, input_type, side_left_right,`)
  lines.push(`  direction_of_good, default_chart, comparison_mode,`)
  lines.push(`  client_portal_visibility, client_view_chart`)
  lines.push(`) VALUES`)

  const valueLines = rows.map((r, i) => {
    const tail = i === rows.length - 1 ? ';' : ','
    return (
      `  (${sqlString(r.category_id)}, ${sqlString(r.category_name)}, ${sqlInt(r.category_display_order)},\n` +
      `   ${sqlString(r.subcategory_id)}, ${sqlString(r.subcategory_name)}, ${sqlInt(r.subcategory_display_order)}, ${sqlString(r.subcategory_notes)},\n` +
      `   ${sqlString(r.test_id)}, ${sqlString(r.test_name)}, ${sqlInt(r.test_display_order)}, ${sqlString(r.test_notes)},\n` +
      `   ${sqlString(r.metric_id)}, ${sqlString(r.metric_label)},\n` +
      `   ${sqlString(r.unit)}, ${sqlString(r.input_type)}, ${sqlBool(r.side_left_right)},\n` +
      `   ${sqlString(r.direction_of_good)}::direction_of_good_t, ${sqlString(r.default_chart)}::default_chart_t, ${sqlString(r.comparison_mode)}::comparison_mode_t,\n` +
      `   ${sqlString(r.client_portal_visibility)}::client_portal_visibility_t, ${sqlString(r.client_view_chart)}::client_view_chart_t)${tail}`
    )
  })

  lines.push(...valueLines)
  lines.push('')
  lines.push(`-- Record the schema version we just seeded.`)
  lines.push(`INSERT INTO physical_markers_schema_version (id, schema_version, seeded_at)`)
  lines.push(`VALUES (1, ${sqlString(version)}, now())`)
  lines.push(`ON CONFLICT (id) DO UPDATE`)
  lines.push(`  SET schema_version = EXCLUDED.schema_version,`)
  lines.push(`      seeded_at      = EXCLUDED.seeded_at;`)

  const outFile = `${MIGRATION_TIMESTAMP}_seed_physical_markers_v${version.replace(/\./g, '_')}.sql`
  const outPath = path.join(MIGRATIONS_DIR, outFile)
  await writeFile(outPath, lines.join('\n') + '\n', 'utf8')

  console.log(`Wrote ${rows.length} metric rows to ${outFile}`)
  console.log(`Schema version: ${version}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
