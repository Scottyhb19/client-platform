// ============================================================================
// c11-burn-verify.mjs — C-11 burn-on-click verification harness
// ============================================================================
// VERIFICATION ONLY — changes no application code. Seeds throwaway
// invite_tokens rows whose action_link points at a local sentinel URL, so
// the gate's burn-on-click path can be driven end-to-end in a browser
// without touching real auth: the redirect's destination URL is the proof,
// not a real sign-in. Run on the operator's machine only.
//
// Reads SUPABASE_SERVICE_ROLE_KEY from .env.local; never logged.
//
// Seeded rows are identifiable by the sentinel action_link substring
// (c11-burn-target) — teardown deletes exactly those and nothing else.
//
// USAGE (run from repo root):
//   node scripts/c11-burn-verify.mjs seed             # live token → prints id + gate URL
//   node scripts/c11-burn-verify.mjs seed --expired   # token already past expires_at
//   node scripts/c11-burn-verify.mjs check <id>       # print consumed_at / expires_at
//   node scripts/c11-burn-verify.mjs age <id> <mins>  # backdate consumed_at by <mins>
//   node scripts/c11-burn-verify.mjs teardown         # delete all sentinel rows
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const SENTINEL = 'c11-burn-target'

function loadEnvLocal() {
  let raw
  try {
    raw = readFileSync('.env.local', 'utf8')
  } catch {
    console.error('Could not read .env.local from the repo root. Run from the repository root.')
    process.exit(2)
  }
  const out = {}
  for (const line of raw.split('\n')) {
    const l = line.trim()
    if (!l || l.startsWith('#') || !l.includes('=')) continue
    const i = l.indexOf('=')
    let v = l.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[l.slice(0, i).trim()] = v
  }
  return out
}

const env = loadEnvLocal()
const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(2)
}
const svc = createClient(url, key, { auth: { persistSession: false } })

const [cmd, arg1, arg2] = process.argv.slice(2)

if (cmd === 'seed') {
  // FK anchors: first real org + first client in it. The row is invisible
  // to all users (RLS deny-all) and torn down by sentinel match.
  const { data: org, error: orgErr } = await svc
    .from('organizations')
    .select('id, name')
    .limit(1)
    .maybeSingle()
  if (orgErr || !org) {
    console.error('No organization found:', orgErr?.message ?? 'empty table')
    process.exit(1)
  }
  const { data: client, error: cliErr } = await svc
    .from('clients')
    .select('id, first_name')
    .eq('organization_id', org.id)
    .limit(1)
    .maybeSingle()
  if (cliErr || !client) {
    console.error('No client found in org:', cliErr?.message ?? 'empty table')
    process.exit(1)
  }

  const expired = arg1 === '--expired'
  const row = {
    organization_id: org.id,
    client_id: client.id,
    action_link: `http://localhost:3000/${SENTINEL}?seed=${Math.random().toString(36).slice(2, 10)}`,
    ...(expired
      ? { expires_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() }
      : {}),
  }
  const { data: inserted, error: insErr } = await svc
    .from('invite_tokens')
    .insert(row)
    .select('id, expires_at')
    .single()
  if (insErr || !inserted) {
    console.error('Insert failed:', insErr?.message ?? 'no row')
    process.exit(1)
  }
  console.log('token id   :', inserted.id)
  console.log('gate URL   :', `http://localhost:3000/i/${inserted.id}`)
  console.log('expires_at :', inserted.expires_at, expired ? '(EXPIRED seed)' : '')
  console.log('target     :', row.action_link)
} else if (cmd === 'check') {
  if (!arg1) { console.error('Usage: check <id>'); process.exit(2) }
  const { data, error } = await svc
    .from('invite_tokens')
    .select('id, consumed_at, expires_at, action_link')
    .eq('id', arg1)
    .maybeSingle()
  if (error) { console.error('Check failed:', error.message); process.exit(1) }
  if (!data) { console.log('NO ROW (deleted?)'); process.exit(0) }
  console.log('consumed_at:', data.consumed_at ?? 'null (NOT consumed)')
  console.log('expires_at :', data.expires_at)
} else if (cmd === 'age') {
  if (!arg1 || !arg2) { console.error('Usage: age <id> <minutes>'); process.exit(2) }
  const ts = new Date(Date.now() - Number(arg2) * 60 * 1000).toISOString()
  const { error } = await svc
    .from('invite_tokens')
    .update({ consumed_at: ts })
    .eq('id', arg1)
    .like('action_link', `%${SENTINEL}%`)
  if (error) { console.error('Age failed:', error.message); process.exit(1) }
  console.log(`consumed_at set to ${ts} (${arg2} min ago) — sentinel rows only`)
} else if (cmd === 'teardown') {
  const { data, error } = await svc
    .from('invite_tokens')
    .delete()
    .like('action_link', `%${SENTINEL}%`)
    .select('id')
  if (error) { console.error('Teardown failed:', error.message); process.exit(1) }
  console.log(`Deleted ${data?.length ?? 0} sentinel row(s).`)
  const { count } = await svc
    .from('invite_tokens')
    .select('id', { count: 'exact', head: true })
    .like('action_link', `%${SENTINEL}%`)
  console.log(`Remaining sentinel rows: ${count ?? 0}`)
} else {
  console.error('Usage: node scripts/c11-burn-verify.mjs seed [--expired] | check <id> | age <id> <mins> | teardown')
  process.exit(2)
}
