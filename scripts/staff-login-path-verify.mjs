// ============================================================================
// staff-login-path-verify.mjs — verification for the 2026-06-10 incident #2
// "owner/staff sign-in 500s on production (NEXT_PUBLIC_SITE_URL absent)"
// ============================================================================
// WHY THIS EXISTS: the poison-cookie matrix (proxy-poison-cookie-verify.mjs)
// minted a ROLE-LESS session, which postAuthLanding routes to /portal — it
// never exercised the owner/staff branch, whose safeNext('/dashboard') call
// crashed when NEXT_PUBLIC_SITE_URL was unset. This script closes that gap:
// it walks a real STAFF session through the staff landing surfaces.
//
// WHAT IT CHECKS (against BASE_URL, default http://localhost:3000):
//   1. staff session GET /          -> 307 redirect to /dashboard (HomePage
//      resolves the staff role claim and routes to the staff home)
//   2. staff session GET /dashboard -> 200 (staff layout + dashboard page
//      render fully — catches any further landmines down the chain)
//   3. no sb-* purge headers anywhere (valid session never falsely purged)
//   4. /api/health                  -> reports db + config status (prints
//      missing env names when the deployment is misconfigured)
//
// HOW: creates ONE throwaway confirmed auth user (RFC-reserved example.com
// address), inserts ONE user_organization_roles row (role 'staff' — never
// 'owner', so the last-owner invariant is untouchable) into the project's
// single organization, signs in via the password grant (the same GoTrue
// call signInWithPassword makes), encodes the session exactly as
// @supabase/ssr writes cookies, and HARD-DELETES the membership row and the
// user in a finally block. The membership insert/delete will each leave an
// audit_log row — acceptable pre-launch noise, noted here deliberately.
//
// USAGE:  node scripts/staff-login-path-verify.mjs [base-url]
// EXIT:   0 all checks pass · 1 a check failed · 2 env/setup problem
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

const BASE_URL = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '')

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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    out[l.slice(0, i).trim()] = v
  }
  return out
}

// --- @supabase/ssr cookie encoding (mirrored) -------------------------------
const MAX_CHUNK_SIZE = 3180
function sessionToCookieHeader(name, session) {
  const encoded = 'base64-' + Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')
  if (encoded.length <= MAX_CHUNK_SIZE) return `${name}=${encoded}`
  const parts = []
  for (let i = 0; i * MAX_CHUNK_SIZE < encoded.length; i++) {
    parts.push(`${name}.${i}=${encoded.slice(i * MAX_CHUNK_SIZE, (i + 1) * MAX_CHUNK_SIZE)}`)
  }
  return parts.join('; ')
}

async function probe(path, cookieHeader) {
  const res = await fetch(BASE_URL + path, {
    redirect: 'manual',
    headers: cookieHeader ? { Cookie: cookieHeader } : {},
  })
  const setCookies = res.headers.getSetCookie?.() ?? []
  const purges = setCookies.filter(
    (c) => c.startsWith('sb-') && /Expires=Thu, 01 Jan 1970/i.test(c),
  )
  return { status: res.status, location: res.headers.get('location'), purges }
}

const results = []
function check(label, ok, detail) {
  results.push({ label, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}

async function main() {
  const env = loadEnvLocal()
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const service = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anon || !service) {
    console.error('Missing Supabase env in .env.local')
    process.exit(2)
  }
  const ref = new URL(url).hostname.split('.')[0]
  const cookieName = `sb-${ref}-auth-token`

  console.log(`\n=== staff login-path verification against ${BASE_URL} ===\n`)

  // 0. health endpoint — config visibility (informational + asserted later
  //    only insofar as the page checks pass; a missing-env report here is
  //    the expected steady state until the operator sets the Vercel vars)
  try {
    const h = await fetch(`${BASE_URL}/api/health`)
    const body = await h.json()
    console.log(
      `health: status=${h.status} db=${body.db} config=${body.config}` +
        (body.missing_env ? ` missing=[${body.missing_env.join(', ')}]` : ''),
    )
  } catch (e) {
    console.log(`health: unreachable (${e?.message ?? e})`)
  }

  const svc = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  // The project's single organization (friends-and-family beta scope).
  const { data: orgs, error: orgErr } = await svc
    .from('organizations')
    .select('id, name')
    .limit(2)
  if (orgErr || !orgs?.length) {
    console.error(`setup: could not read organizations (${orgErr?.message ?? 'no rows'})`)
    process.exit(2)
  }
  if (orgs.length > 1) {
    console.log(`note: ${orgs.length}+ organizations found; using the first`)
  }
  const orgId = orgs[0].id

  const runId = `${Date.now()}-${randomBytes(3).toString('hex')}`
  const email = `staff-path-verify-${runId}@example.com` // RFC-reserved; never delivers
  const password = randomBytes(18).toString('base64url')

  let userId = null
  let membershipId = null
  try {
    const created = await svc.auth.admin.createUser({ email, password, email_confirm: true })
    if (created.error) {
      check('setup: createUser', false, created.error.message)
      return
    }
    userId = created.data.user.id

    // Staff membership BEFORE token issuance so the Custom Access Token
    // Hook injects user_role/organization_id claims into the JWT.
    const { data: membership, error: memberErr } = await svc
      .from('user_organization_roles')
      .insert({ user_id: userId, organization_id: orgId, role: 'staff' })
      .select('id')
      .single()
    if (memberErr || !membership) {
      check('setup: staff membership insert', false, memberErr?.message ?? 'no row')
      return
    }
    membershipId = membership.id
    console.log(`(throwaway staff user ${userId} in org ${orgId})`)

    const tokenRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon },
      body: JSON.stringify({ email, password }),
    })
    const session = await tokenRes.json()
    if (!tokenRes.ok || !session.access_token) {
      check('setup: password grant', false, `status=${tokenRes.status}`)
      return
    }

    const cookieHeader = sessionToCookieHeader(cookieName, session)

    // 1. HomePage routes a staff session to the staff home.
    const r1 = await probe('/', cookieHeader)
    check(
      'staff session / -> redirect to /dashboard',
      [302, 307].includes(r1.status) && (r1.location ?? '').startsWith('/dashboard'),
      `status=${r1.status} location=${r1.location}`,
    )
    check('staff session / NOT purged', r1.purges.length === 0, `${r1.purges.length} purge header(s)`)

    // 2. The staff landing surface actually renders.
    const r2 = await probe('/dashboard', cookieHeader)
    check('staff session /dashboard -> 200', r2.status === 200, `status=${r2.status}`)
    check('staff session /dashboard NOT purged', r2.purges.length === 0, `${r2.purges.length} purge header(s)`)
  } finally {
    if (membershipId) {
      const del = await svc.from('user_organization_roles').delete().eq('id', membershipId)
      console.log(`teardown: membership delete ${del.error ? 'FAILED: ' + del.error.message : 'ok'}`)
    }
    if (userId) {
      const del = await svc.auth.admin.deleteUser(userId)
      console.log(`teardown: deleteUser ${del.error ? 'FAILED: ' + del.error.message : 'ok'}`)
    }
  }
}

main()
  .then(() => {
    const failed = results.filter((r) => !r.ok)
    console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`)
    process.exit(failed.length ? 1 : 0)
  })
  .catch((e) => {
    console.error(`fatal: ${e?.message ?? e}`)
    process.exit(2)
  })
