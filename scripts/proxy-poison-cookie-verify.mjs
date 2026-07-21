// ============================================================================
// proxy-poison-cookie-verify.mjs — verification for the 2026-06-10 incident
// "malformed sb-* auth cookie 500s every proxied route"
// ============================================================================
// WHAT IT CHECKS (against BASE_URL, default http://localhost:3000):
//   1.  cold /login (no cookies)             -> 200
//   2.  garbage (non-JSON) session cookie    -> 200 AND purged
//   2b. lost-chunk truncated session cookie  -> 200 AND purged
//   2c. PKCE code-verifier cookie (plain
//       string payload, legitimately not JSON)-> 200 AND NOT purged
//   3.  poison (bad UTF-8) session cookie    -> 200 AND purged
//   4.  poison cookie on /dashboard          -> 307 /login + purge
//   5.  VALID session cookie /               -> authenticated (redirect to an
//      app surface, NOT /login) and NO sb-* purge in the response. Proves the
//      hardening never falsely signs out a real session.
//
// The HTTP matrix is necessary but not sufficient: after a run, the server
// log must also show ZERO supabase cookie-parse errors or unhandledRejections
// (pre-fix, poisoned jars detonated on detached promise chains inside
// supabase-js even when the HTTP response was 200). Check the log alongside.
//
// Check 5 mints a real session: creates ONE throwaway confirmed auth user via
// the service role (RFC-reserved example.com address, random password), signs
// in via the password grant, encodes the session exactly as @supabase/ssr
// does (`base64-` prefix + base64url, chunked at 3180 chars), and HARD-
// DELETES the user in a finally block — same hygiene as c14-prefetch-probe.
//
// USAGE:  node scripts/proxy-poison-cookie-verify.mjs [base-url]
// EXIT:   0 all checks pass · 1 a check failed · 2 env/setup problem
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

const ARGS = process.argv.slice(2)
const BASE_URL = (ARGS.find((a) => !a.startsWith('--')) ?? 'http://localhost:3000').replace(/\/$/, '')
const PROD_FLAG = ARGS.includes('--prod')

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
function toBase64URL(str) {
  return Buffer.from(str, 'utf8').toString('base64url')
}
function sessionToCookies(name, session) {
  const encoded = 'base64-' + toBase64URL(JSON.stringify(session))
  if (encoded.length <= MAX_CHUNK_SIZE) return [[name, encoded]]
  const chunks = []
  for (let i = 0; i * MAX_CHUNK_SIZE < encoded.length; i++) {
    chunks.push([`${name}.${i}`, encoded.slice(i * MAX_CHUNK_SIZE, (i + 1) * MAX_CHUNK_SIZE)])
  }
  return chunks
}

// --- response helpers --------------------------------------------------------
async function probe(path, cookieHeader) {
  const res = await fetch(BASE_URL + path, {
    redirect: 'manual',
    headers: cookieHeader ? { Cookie: cookieHeader } : {},
  })
  // Node fetch: getSetCookie() returns every Set-Cookie header.
  const setCookies = res.headers.getSetCookie?.() ?? []
  const purges = setCookies.filter(
    (c) => c.startsWith('sb-') && /Expires=Thu, 01 Jan 1970/i.test(c),
  )
  return { status: res.status, location: res.headers.get('location'), purges, setCookies }
}

const results = []
function check(label, ok, detail) {
  results.push({ label, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}

async function main() {
  const env = loadEnvLocal()
  // Environment separation (2026-07-21): .env.local's default keys point at
  // STAGING. Probing the deployed production site needs --prod, which resolves
  // the PROD_* keys instead; a prod-looking BASE_URL without --prod is refused
  // so a probe user can never be created in the wrong project.
  const url = PROD_FLAG ? env.PROD_SUPABASE_URL : env.NEXT_PUBLIC_SUPABASE_URL
  const anon = PROD_FLAG ? env.PROD_SUPABASE_ANON_KEY : env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const service = PROD_FLAG ? env.PROD_SUPABASE_SERVICE_ROLE_KEY : env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anon || !service) {
    console.error(`Missing Supabase env in .env.local (${PROD_FLAG ? 'PROD_*' : 'default'} keys)`)
    process.exit(2)
  }
  if (/odysseyhq\.com\.au|vercel\.app/i.test(BASE_URL) && !PROD_FLAG) {
    console.error('BASE_URL looks like production but --prod was not passed — refusing to probe the prod site with staging keys.')
    process.exit(2)
  }
  const ref = new URL(url).hostname.split('.')[0]
  const cookieName = `sb-${ref}-auth-token`

  console.log(`\n=== proxy poison-cookie verification against ${BASE_URL} ===`)
  console.log(`Supabase target: ${PROD_FLAG ? `PRODUCTION (${ref}, PROD_* keys)` : `staging (${ref}, default .env.local keys)`}\n`)

  // 1. cold
  const r1 = await probe('/login')
  check('cold /login -> 200', r1.status === 200, `status=${r1.status}`)

  // 2. garbage (not JSON — pre-fix this threw a background TypeError in
  //    supabase-js's _recoverAndRefresh; now sanitized + purged)
  const r2 = await probe('/login', `${cookieName}=garbage-not-json`)
  check('garbage cookie /login -> 200', r2.status === 200, `status=${r2.status}`)
  check('garbage cookie /login purges sb-*', r2.purges.length > 0, `${r2.purges.length} purge header(s)`)

  // 2b. lost-chunk shape: chunk .0 only, valid base64url/UTF-8 but truncated
  //     JSON — the most likely real-world corruption (browser drops/expires
  //     one chunk of a chunked session cookie)
  const r2b = await probe(
    '/login',
    `${cookieName}.0=base64-eyJhY2Nlc3NfdG9rZW4iOiJleUpoYkdjaU9pSklVekkxTmlJc0ltdHBaQ0k2`,
  )
  check('lost-chunk cookie /login -> 200', r2b.status === 200, `status=${r2b.status}`)
  check('lost-chunk cookie /login purges sb-*', r2b.purges.length > 0, `${r2b.purges.length} purge header(s)`)

  // 2c. false-positive guard: a PKCE code-verifier cookie carries a plain
  //     string (NOT JSON) — it must never be purged, or invite/recovery
  //     code exchanges would break mid-flow
  const r2c = await probe(
    '/login',
    `${cookieName}-code-verifier=base64-YWJjZDEyMzQ`,
  )
  check('code-verifier cookie /login -> 200', r2c.status === 200, `status=${r2c.status}`)
  check('code-verifier cookie NOT purged', r2c.purges.length === 0, `${r2c.purges.length} purge header(s)`)

  // 3. poison (base64- prefix, invalid UTF-8 payload — the crash shape from
  //    the 2026-06-10 production incident)
  const r3 = await probe('/login', `${cookieName}=base64-AAAAgarbage`)
  check('poison cookie /login -> 200', r3.status === 200, `status=${r3.status}`)
  check('poison cookie /login purges sb-*', r3.purges.length > 0, `${r3.purges.length} purge header(s)`)

  // 4. poison on a protected route
  const r4 = await probe('/dashboard', `${cookieName}=base64-AAAAgarbage`)
  check(
    'poison cookie /dashboard -> redirect to /login',
    [302, 307].includes(r4.status) && (r4.location ?? '').includes('/login'),
    `status=${r4.status} location=${r4.location}`,
  )
  check('poison cookie /dashboard purges sb-*', r4.purges.length > 0, `${r4.purges.length} purge header(s)`)

  // 5. valid session — must still authenticate, must NOT be purged
  const svc = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const runId = `${Date.now()}-${randomBytes(3).toString('hex')}`
  const email = `proxy-verify-${runId}@example.com` // RFC-reserved; never delivers
  const password = randomBytes(18).toString('base64url')

  let userId = null
  try {
    const created = await svc.auth.admin.createUser({ email, password, email_confirm: true })
    if (created.error) {
      check('valid session: setup (createUser)', false, created.error.message)
      return
    }
    userId = created.data.user.id
    console.log(`\n(throwaway user ${userId} created for the valid-session check)`)

    const tokenRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon },
      body: JSON.stringify({ email, password }),
    })
    const session = await tokenRes.json()
    if (!tokenRes.ok || !session.access_token) {
      check('valid session: setup (password grant)', false, `status=${tokenRes.status}`)
      return
    }

    const cookieHeader = sessionToCookies(cookieName, session)
      .map(([n, v]) => `${n}=${v}`)
      .join('; ')
    const r5 = await probe('/', cookieHeader)
    const authed =
      [302, 307].includes(r5.status) && !(r5.location ?? '').startsWith('/login')
    check(
      'valid session / -> authenticated redirect (not /login)',
      authed,
      `status=${r5.status} location=${r5.location}`,
    )
    check('valid session NOT purged', r5.purges.length === 0, `${r5.purges.length} purge header(s)`)
  } finally {
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
