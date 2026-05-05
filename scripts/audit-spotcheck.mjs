// One-shot spot-check for the new exercise-library audit triggers.
// Usage: node scripts/audit-spotcheck.mjs
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

const { data, error } = await supabase
  .from('audit_log')
  .select('table_name, action, changed_fields, actor_role, actor_user_id, organization_id, changed_at')
  .in('table_name', [
    'exercises',
    'movement_patterns',
    'exercise_tags',
    'exercise_metric_units',
  ])
  .gte('changed_at', new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString())
  .order('changed_at', { ascending: false })
  .limit(40)

if (error) {
  console.error('Query failed:', error.message)
  process.exit(1)
}

console.log(`Rows: ${data.length}`)
console.log()
for (const r of data) {
  const fields = Array.isArray(r.changed_fields)
    ? r.changed_fields.join(', ')
    : r.changed_fields ?? ''
  console.log(
    `${r.changed_at}  ${r.table_name.padEnd(22)} ${r.action.padEnd(7)} role=${(r.actor_role ?? 'NULL').padEnd(6)} user=${r.actor_user_id ?? 'NULL'} org=${r.organization_id ?? 'NULL'} fields=[${fields}]`,
  )
}
