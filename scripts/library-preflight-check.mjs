// Read-only pre-flight for the exercise-library re-audit pass (2026-06-12).
// Checks live data before migrations G-1/G-3/G-6/G-10 are written:
//   1. exercises with default_metric_value set but default_metric NULL
//      (blocks the G-6 CHECK constraint if present)
//   2. exercises with a non-null default_rpe (data the Q-B column drop discards)
//   3. active exercise_tags count per organization (shapes the G-10 backfill)
//   4. program_exercises count per exercise (G-1 backfill sanity)
// Usage: node scripts/library-preflight-check.mjs
// Reads the service role key from .env.local; never prints it.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const idx = l.indexOf('=')
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()]
    }),
)

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)

// 1. value-without-unit
const { data: orphanValues, error: e1 } = await supabase
  .from('exercises')
  .select('id, name, default_metric_value, default_metric, deleted_at')
  .not('default_metric_value', 'is', null)
  .is('default_metric', null)
if (e1) throw new Error(`orphan-values query: ${e1.message}`)
console.log(`1. value-without-unit rows: ${orphanValues.length}`)
for (const r of orphanValues)
  console.log(`   ${r.id}  "${r.name}"  value=${r.default_metric_value}  deleted=${r.deleted_at ?? 'no'}`)

// 2. non-null default_rpe
const { data: rpeRows, error: e2 } = await supabase
  .from('exercises')
  .select('id, name, default_rpe, deleted_at')
  .not('default_rpe', 'is', null)
if (e2) throw new Error(`default_rpe query: ${e2.message}`)
console.log(`2. exercises with default_rpe set: ${rpeRows.length}`)
for (const r of rpeRows)
  console.log(`   ${r.id}  "${r.name}"  rpe=${r.default_rpe}  deleted=${r.deleted_at ?? 'no'}`)

// 3. tags per org
const { data: orgs, error: e3 } = await supabase
  .from('organizations')
  .select('id, name')
if (e3) throw new Error(`orgs query: ${e3.message}`)
const { data: tags, error: e4 } = await supabase
  .from('exercise_tags')
  .select('organization_id, name, deleted_at')
if (e4) throw new Error(`tags query: ${e4.message}`)
console.log(`3. organizations: ${orgs.length}`)
for (const o of orgs) {
  const active = tags.filter((t) => t.organization_id === o.id && !t.deleted_at)
  console.log(`   ${o.id}  "${o.name}"  active tags: ${active.length}${active.length ? '  [' + active.map((t) => t.name).join(', ') + ']' : ''}`)
}

// 4. prescription counts (G-1 backfill sanity)
const { data: pes, error: e5 } = await supabase
  .from('program_exercises')
  .select('exercise_id')
if (e5) throw new Error(`program_exercises query: ${e5.message}`)
const counts = new Map()
for (const r of pes) counts.set(r.exercise_id, (counts.get(r.exercise_id) ?? 0) + 1)
console.log(`4. program_exercises rows total: ${pes.length} across ${counts.size} distinct exercises`)
const { data: allEx, error: e6 } = await supabase
  .from('exercises')
  .select('id, name, usage_count')
if (e6) throw new Error(`exercises query: ${e6.message}`)
for (const ex of allEx) {
  const real = counts.get(ex.id) ?? 0
  if (real > 0 || ex.usage_count > 0)
    console.log(`   "${ex.name}"  stored usage_count=${ex.usage_count}  actual prescriptions=${real}`)
}
