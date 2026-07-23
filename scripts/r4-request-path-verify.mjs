// ============================================================================
// r4-request-path-verify.mjs — R-4 request-path half: real-token PostgREST
// cross-tenant denial over HTTP (gateway → PostgREST → RLS).
// ============================================================================
// go-live-checklist §8 (indexed 2026-07-23): pgTAP 17/57 prove RLS isolation
// under JWT-SPOOFED sessions inside the DB; the C-1/C-6 harness proves
// app-path behaviour. This script exercises the remaining leg — a REAL
// GoTrue-issued token for org-A staff driving RAW PostgREST reads/writes
// against org-B rows over HTTP. It is also the named test case handed to the
// external security reviewer (hard rule (a)).
//
// STAGING ONLY. Reads the default (staging) keys from .env.local and refuses
// to run if the URL matches PROD_SUPABASE_URL. Uses the two seeded org
// logins (seed-staging.mjs): STAGING_DEV_LOGIN_* (org A) and
// STAGING_DEV_EXCO_* (org B). Self-heals a cred desync (a sibling session
// re-seeding staging) via service-role updateUserById, per the standing note.
//
// Checks (all raw fetch, real bearer tokens):
//   1. positive control: A reads ≥1 own-org client; B reads ≥1 own-org client
//   2. cross-read:  A GET org-B client by id            → 0 rows
//   3. cross-list:  A GET clients?organization_id=eq.B  → 0 rows
//   4. cross-write: A PATCH org-B client (return=representation) → 0 rows
//   5. cross-insert: A POST clinical_notes with organization_id=B → 42501
//   6. control: the PATCH that was denied cross-org SUCCEEDS same-org
//      (proves 0-rows wasn't a dead endpoint)
//
// Run: node scripts/r4-request-path-verify.mjs
// Exit 0 = all green; non-zero = a check failed (printed).
// ============================================================================

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

function loadEnv() {
  const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  const env = {}
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2]
  }
  return env
}

const env = loadEnv()
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY

if (!URL_ || !ANON) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / ANON key in .env.local')
  process.exit(2)
}
if (env.PROD_SUPABASE_URL && URL_ === env.PROD_SUPABASE_URL) {
  console.error(
    'REFUSING: the default URL resolves to PRODUCTION. This probe is staging-only.',
  )
  process.exit(2)
}

const logins = [
  {
    name: 'orgA',
    email: env.STAGING_DEV_LOGIN_EMAIL,
    password: env.STAGING_DEV_LOGIN_PASSWORD,
  },
  {
    name: 'orgB',
    email: env.STAGING_DEV_EXCO_EMAIL,
    password: env.STAGING_DEV_EXCO_PASSWORD,
  },
]
for (const l of logins) {
  if (!l.email || !l.password) {
    console.error(`Missing seeded login for ${l.name} in .env.local — run scripts/seed-staging.mjs`)
    process.exit(2)
  }
}

const failures = []
function check(name, cond, detail) {
  const ok = Boolean(cond)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — ${detail}`}`)
  if (!ok) failures.push(name)
}

async function signIn(email, password) {
  const auth = createClient(URL_, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  let { data, error } = await auth.auth.signInWithPassword({ email, password })
  if (error && SERVICE) {
    // Cred-desync self-heal (sibling re-seed): reset the password to the
    // .env.local value via the admin API, then retry once.
    console.log(`  (login failed for ${email} — attempting cred resync)`)
    const admin = createClient(URL_, SERVICE, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
    const u = users?.users?.find((x) => x.email === email)
    if (u) {
      await admin.auth.admin.updateUserById(u.id, { password })
      ;({ data, error } = await auth.auth.signInWithPassword({ email, password }))
    }
  }
  if (error || !data?.session?.access_token) {
    throw new Error(`GoTrue sign-in failed for ${email}: ${error?.message}`)
  }
  return data.session.access_token
}

async function rest(token, method, path, body, prefer) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  let json = null
  const text = await res.text()
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text
  }
  return { status: res.status, json }
}

const tokenA = await signIn(logins[0].email, logins[0].password)
const tokenB = await signIn(logins[1].email, logins[1].password)
console.log('Real GoTrue tokens issued for both orgs.\n')

// Own-org baselines (positive controls).
// deleted_at=is.null: the same-org control PATCH below must target a LIVE
// client — an archived one would be refused by the CN-7 write guard (P0001),
// which is correct behaviour but not what check 6 is proving.
const ownA = await rest(tokenA, 'GET', 'clients?select=id,organization_id,first_name&deleted_at=is.null&limit=5')
const ownB = await rest(tokenB, 'GET', 'clients?select=id,organization_id,first_name&deleted_at=is.null&limit=5')
check('1a. org-A staff reads own-org clients (>0)', ownA.status === 200 && ownA.json.length > 0, `status ${ownA.status}, rows ${ownA.json?.length}`)
check('1b. org-B staff reads own-org clients (>0)', ownB.status === 200 && ownB.json.length > 0, `status ${ownB.status}, rows ${ownB.json?.length}`)
if (failures.length) {
  console.error('\nBaselines failed — aborting before cross-tenant checks.')
  process.exit(1)
}

const orgAId = ownA.json[0].organization_id
const orgBId = ownB.json[0].organization_id
const clientB = ownB.json[0]
check('1c. the two logins resolve DIFFERENT orgs', orgAId !== orgBId, `both ${orgAId}`)

// 2. Cross-read by id.
const crossRead = await rest(tokenA, 'GET', `clients?select=id&id=eq.${clientB.id}`)
check('2. cross-read: A fetching an org-B client id → 0 rows', crossRead.status === 200 && crossRead.json.length === 0, `status ${crossRead.status}, rows ${crossRead.json?.length}`)

// 3. Cross-list by organization_id.
const crossList = await rest(tokenA, 'GET', `clients?select=id&organization_id=eq.${orgBId}`)
check('3. cross-list: A listing org-B clients → 0 rows', crossList.status === 200 && crossList.json.length === 0, `status ${crossList.status}, rows ${crossList.json?.length}`)

// 4. Cross-write: PATCH with return=representation → must affect 0 rows.
const crossWrite = await rest(
  tokenA,
  'PATCH',
  `clients?id=eq.${clientB.id}`,
  { first_name: 'R4-Crossed' },
  'return=representation',
)
check(
  '4. cross-write: A PATCHing an org-B client → 0 rows affected',
  crossWrite.status === 200 && Array.isArray(crossWrite.json) && crossWrite.json.length === 0,
  `status ${crossWrite.status}, body ${JSON.stringify(crossWrite.json).slice(0, 200)}`,
)

// 5. Cross-insert: clinical note pinned to org B with an org-B client id.
// Denial can land at either tenant-boundary layer, both correct:
//   - RLS WITH CHECK → 42501, or
//   - enforce_same_org_fk BEFORE trigger → P0001 "Cross-org FK …" (the org-B
//     client does not exist through A's RLS view, so the FK check fails
//     first). Either way the write must be refused and leave no residue.
const crossInsert = await rest(
  tokenA,
  'POST',
  'clinical_notes',
  {
    organization_id: orgBId,
    client_id: clientB.id,
    title: 'R4 cross-tenant probe',
    plan: 'should never exist',
  },
  'return=representation',
)
const denied =
  crossInsert.status >= 400 &&
  (crossInsert.json?.code === '42501' ||
    (crossInsert.json?.code === 'P0001' &&
      String(crossInsert.json?.message).includes('Cross-org FK')))
check(
  '5a. cross-insert: A POSTing a clinical note into org B → refused at the tenant boundary',
  denied,
  `status ${crossInsert.status}, body ${JSON.stringify(crossInsert.json).slice(0, 200)}`,
)
// Residue check through org-B's OWN eyes: the probe row must not exist.
const residue = await rest(
  tokenB,
  'GET',
  `clinical_notes?select=id&title=eq.${encodeURIComponent('R4 cross-tenant probe')}`,
)
check(
  '5b. cross-insert left NO residue in org B',
  residue.status === 200 && residue.json.length === 0,
  `status ${residue.status}, rows ${residue.json?.length}`,
)

// 6. Same-org control for the PATCH shape (proves 4's zero was RLS, not a
// dead endpoint). Uses a no-op value write on A's own client, then reverts.
const clientA = ownA.json[0]
const sameOrgWrite = await rest(
  tokenA,
  'PATCH',
  `clients?id=eq.${clientA.id}`,
  { first_name: clientA.first_name },
  'return=representation',
)
check(
  '6. control: the same PATCH shape same-org → 1 row',
  sameOrgWrite.status === 200 && sameOrgWrite.json.length === 1,
  `status ${sameOrgWrite.status}, body ${JSON.stringify(sameOrgWrite.json).slice(0, 200)}`,
)

console.log(
  failures.length === 0
    ? '\nR-4 request path: ALL GREEN — real-token PostgREST cross-tenant denial holds over HTTP.'
    : `\nR-4 request path: ${failures.length} FAILURE(S): ${failures.join(', ')}`,
)
process.exit(failures.length === 0 ? 0 : 1)
