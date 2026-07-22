// ============================================================================
// c1c6-fixture.mjs — STAGING-ONLY fixtures for the C-1 branch-(b) and C-6
// infra-error runtime verifications (docs/polish/auth-onboarding-client.md,
// reviewer verdict 2026-07-22).
//
// Safety: refuses to run unless the .env.local default URL resolves to
// STAGING_PROJECT_REF; refuses outright on PROD_PROJECT_REF. All emails are
// @resend.dev sinks. Run from the repo root:
//   node <scratchpad>/c1c6-fixture.mjs <command> [n]
//
// Commands:
//   c1-setup <n>     create probe auth user + unlinked clients row (pre-invite
//                    state). User can sign in; JWT will be claimless (no
//                    membership) — the C-1 precondition.
//   c1-link <n>      simulate client_accept_invite's effects WITHOUT the
//                    refreshSession: insert the 'client' membership row and
//                    link clients.user_id + onboarded_at. The browser's held
//                    JWT stays claimless -> the exact C-1 stuck state.
//   status <n>       print probe state (user, membership, clients link).
//   teardown <n>     delete membership -> clients row -> auth user (cascades
//                    user_profiles). auth_events rows persist by design
//                    (bare-uuid user_id, append-only log).
//   invite-url <email>  print the /i/<token_id> gate URL for a client's
//                    freshest invite token (C-6 accept-gate drive).
//   teardown-email <email>  teardown a C-6-created client + its auth user by
//                    email (used for the /clients/new-created probe client).
// ============================================================================
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

function loadEnvLocal() {
  const out = {}
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const l = line.trim()
    if (!l || l.startsWith('#') || !l.includes('=')) continue
    const i = l.indexOf('=')
    out[l.slice(0, i).trim()] = l.slice(i + 1).trim()
  }
  return out
}
const env = loadEnvLocal()
const STAGING_REF = env.STAGING_PROJECT_REF
const PROD_REF = env.PROD_PROJECT_REF
const URL = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY
if (!STAGING_REF || !URL || !SERVICE) {
  console.error('Missing staging keys in .env.local'); process.exit(2)
}
if (PROD_REF && URL.includes(PROD_REF)) {
  console.error('REFUSING: default URL points at PRODUCTION.'); process.exit(2)
}
if (!URL.includes(STAGING_REF)) {
  console.error('REFUSING: default URL is not the staging ref.'); process.exit(2)
}
console.log(`Target: staging (${STAGING_REF}) — resolved from .env.local default keys.`)

const svc = createClient(URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

const PROBE_PW = 'c1-probe-Password-2026' // 22 chars, clears the 12-min
const probeEmail = (n) => `delivered+c1probe${n}@resend.dev`

async function odysseyOrgId() {
  const { data, error } = await svc.from('organizations')
    .select('id, name').ilike('name', '%odyssey%').limit(1).single()
  if (error) throw new Error(`org lookup: ${error.message}`)
  console.log(`org: ${data.name} (${data.id})`)
  return data.id
}

async function findUser(email) {
  // listUsers + filter (getUserByEmail is not in supabase-js v2 admin API)
  const { data, error } = await svc.auth.admin.listUsers({ perPage: 200 })
  if (error) throw new Error(`listUsers: ${error.message}`)
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null
}

async function c1Setup(n) {
  const email = probeEmail(n)
  const orgId = await odysseyOrgId()
  const { data: created, error: cErr } = await svc.auth.admin.createUser({
    email, password: PROBE_PW, email_confirm: true,
  })
  if (cErr) throw new Error(`createUser: ${cErr.message}`)
  const uid = created.user.id
  const { data: client, error: clErr } = await svc.from('clients').insert({
    organization_id: orgId, first_name: 'C1', last_name: `Probe${n}`,
    email,
  }).select('id').single()
  if (clErr) throw new Error(`clients insert: ${clErr.message}`)
  console.log(`c1-setup OK: user=${uid} client=${client.id} email=${email} pw=${PROBE_PW}`)
}

async function c1Link(n) {
  const email = probeEmail(n)
  const user = await findUser(email)
  if (!user) throw new Error(`no auth user for ${email}`)
  const { data: client, error: clErr } = await svc.from('clients')
    .select('id, organization_id').eq('email', email).is('deleted_at', null).single()
  if (clErr) throw new Error(`clients lookup: ${clErr.message}`)
  const { error: rErr } = await svc.from('user_organization_roles').upsert(
    { user_id: user.id, organization_id: client.organization_id, role: 'client' },
    { onConflict: 'user_id,organization_id' },
  )
  if (rErr) throw new Error(`membership insert: ${rErr.message}`)
  const { error: uErr } = await svc.from('clients')
    .update({ user_id: user.id, onboarded_at: new Date().toISOString() })
    .eq('id', client.id)
  if (uErr) throw new Error(`clients link: ${uErr.message}`)
  console.log(`c1-link OK: membership + clients.user_id set for ${email}. Held browser JWT is now the stuck claimless state.`)
}

async function status(n) {
  const email = probeEmail(n)
  const user = await findUser(email)
  console.log(`user: ${user ? user.id : 'ABSENT'}`)
  if (!user) return
  const { data: m } = await svc.from('user_organization_roles')
    .select('role, organization_id').eq('user_id', user.id)
  console.log(`membership: ${JSON.stringify(m)}`)
  const { data: c } = await svc.from('clients')
    .select('id, user_id, onboarded_at').eq('email', email)
  console.log(`clients: ${JSON.stringify(c)}`)
}

async function teardownByEmail(email) {
  const user = await findUser(email)
  if (user) {
    const { error: rErr } = await svc.from('user_organization_roles')
      .delete().eq('user_id', user.id).eq('role', 'client')
    if (rErr) console.error(`membership delete: ${rErr.message}`)
  }
  const { error: cErr, count } = await svc.from('clients')
    .delete({ count: 'exact' }).eq('email', email)
  if (cErr) console.error(`clients delete: ${cErr.message}`)
  else console.log(`clients deleted: ${count}`)
  if (user) {
    const { error: dErr } = await svc.auth.admin.deleteUser(user.id)
    if (dErr) console.error(`deleteUser: ${dErr.message}`)
    else console.log(`auth user deleted: ${user.id}`)
  } else {
    console.log('no auth user to delete')
  }
  // verify clean
  const after = await findUser(email)
  const { data: cAfter } = await svc.from('clients').select('id').eq('email', email)
  console.log(`post-teardown: user=${after ? 'STILL PRESENT' : 'gone'} clients=${cAfter?.length ?? 0}`)
}

async function inviteUrl(email) {
  const { data: client, error } = await svc.from('clients')
    .select('id').eq('email', email).is('deleted_at', null).single()
  if (error) throw new Error(`clients lookup: ${error.message}`)
  const { data: tok, error: tErr } = await svc.from('invite_tokens')
    .select('id, expires_at, consumed_at, action_link')
    .eq('client_id', client.id)
    .order('created_at', { ascending: false }).limit(1).single()
  if (tErr) throw new Error(`invite_tokens lookup: ${tErr.message}`)
  console.log(`gate URL: http://localhost:3000/i/${tok.id}`)
  console.log(`expires_at=${tok.expires_at} consumed_at=${tok.consumed_at} action_link=${tok.action_link === null ? 'NULL (mint-at-POST)' : 'PRE-MINTED'}`)
}

const [cmd, arg] = process.argv.slice(2)
const run = {
  'c1-setup': () => c1Setup(arg),
  'c1-link': () => c1Link(arg),
  'status': () => status(arg),
  'teardown': () => teardownByEmail(probeEmail(arg)),
  'teardown-email': () => teardownByEmail(arg),
  'invite-url': () => inviteUrl(arg),
}[cmd]
if (!run) { console.error(`unknown command: ${cmd}`); process.exit(2) }
run().catch((e) => { console.error(e.message); process.exit(1) })
