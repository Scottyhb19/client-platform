// ============================================================================
// verify-auth-config.mjs — dashboard-config verification (Track A: G-1/G-3/G-3u/G-7)
// ============================================================================
// Verifies four Supabase auth settings that live in the dashboard, are invisible
// to application code, and silently degrade security if changed. See
// docs/polish/auth-onboarding-staff.md "A.1 resolution" for the full design and
// docs/runbooks/verify-auth-config.md for how to run + read this.
//
//   G-1  custom-access-token hook enabled  — behaviourally asserted (the tripwire)
//   G-3  HIBP leaked-password protection   — probed via front-door signUp
//   G-3u HIBP on the updateUser path (C-7) — admin-create + sign-in + updateUser; sends no mail (free-tier-safe)
//   G-7  email confirmations enabled       — partial assertion via signUp behaviour
//   G-4  refresh-token lifetime (30 days)  — DOC-ONLY; this script does not assert it
//
// SECURITY / SCOPE:
//   - Run on the OPERATOR'S MACHINE ONLY, on demand. Never in CI, never as an
//     HTTP endpoint, never imported by app code. It lives in scripts/ (outside
//     src/), is a standalone Node ESM script that self-executes, exports nothing,
//     and is never reachable from the Next.js bundle graph.
//   - Reads SUPABASE_SERVICE_ROLE_KEY from .env.local. The key is passed only to
//     the Supabase client; it is NEVER logged, printed, or sent anywhere else.
//
// VARIANT 3 (approved): a persistent inert MEMBERLESS verification org, plus a
//   per-run ephemeral NON-OWNER probe user attached to it. Non-owner teardown is
//   simple leaf-to-root deletes with NO trigger-disabling (the enforce_last_owner_
//   invariant trigger only fires for role='owner' — identity_tables.sql:133).
//
// USAGE:
//   node scripts/verify-auth-config.mjs                 # run the checks
//   node scripts/verify-auth-config.mjs --bootstrap     # also create the inert org if absent (reviewed first-run step)
//   node scripts/verify-auth-config.mjs --clean-orphans # also delete leftover probe users from prior crashed runs
//
// EXIT CODES: 0 all green · 1 any red · 2 any could-not-determine (no red) · 3 fatal
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

// ---- Naming convention (unmistakable; drives the orphan scan) ---------------
const VERIFY_USER_PREFIX = 'verify-probe-' // every ephemeral probe email starts with this
// Resolved in main() from .env.local (then an exported process.env override, then this default).
// FINDING (2026-05-21 first run): front-door signUp REJECTS `.invalid` (email_address_invalid),
// even though admin.createUser accepts it. G-3/G-7 probe via front-door signUp, so the domain must
// be real and accepted — set VERIFY_EMAIL_DOMAIN in .env.local to a subdomain of the Resend-verified
// sending domain (e.g. verify.mail.odysseyhq.com.au). admin-created G-1 users are pre-confirmed, so
// no mail is sent for G-1 regardless.
let VERIFY_EMAIL_DOMAIN = 'verify.invalid'
const VERIFY_ORG_NAME = '[VERIFY] auth-config probe org - do not use'
const VERIFY_ORG_SLUG = 'verify-auth-config-probe' // matches organizations.slug CHECK ^[a-z0-9-]{3,63}$

// G-3 probe password: must be (a) >= 12 chars to clear the length policy and
// (b) present in the HIBP corpus. Because the project enforces NO character-class
// rules, the only weak-password reason that can fire is "pwned" — so a rejection
// cleanly isolates HIBP. This is NOT a real credential. Its HIBP membership cannot
// be verified offline; the first run confirms it. If G-3 reports RED while the
// dashboard shows HIBP enabled, swap this for another known-breached >=12-char
// string (verify a candidate at https://haveibeenpwned.com/Passwords first).
// CONFIRMED IN CORPUS (2026-06-10): verified via the HIBP k-anonymity range API
// (SHA-1 prefix AE903) — 181,374 breach occurrences. Not a corpus false-negative.
const DEFAULT_BREACHED_PASSWORD = 'password12345'

// ---- Minimal .env.local reader (matches scripts/audit-spotcheck.mjs) --------
function loadEnvLocal() {
  let raw
  try {
    raw = readFileSync('.env.local', 'utf8')
  } catch {
    console.error('Could not read .env.local from the repo root. Run this from the repository root.')
    process.exit(2)
  }
  const entries = raw
    .split('\n')
    .filter((l) => l && !l.trimStart().startsWith('#') && l.includes('='))
    .map((l) => {
      const idx = l.indexOf('=')
      let val = l.slice(idx + 1).trim()
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      return [l.slice(0, idx).trim(), val]
    })
  return Object.fromEntries(entries)
}

function requireEnv(env) {
  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ]
  const missing = required.filter((k) => !env[k])
  if (missing.length) {
    console.error(`Missing required keys in .env.local: ${missing.join(', ')}`)
    process.exit(2)
  }
}

function randomPassword() {
  // ~32 random chars; never stored, never logged. Trailing class mix is harmless
  // belt-and-suspenders in case any character-class policy is ever added.
  return randomBytes(24).toString('base64url') + 'Aa1!'
}

function decodeJwtPayload(token) {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('access_token is not a well-formed JWT')
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
}

function parseFlags(argv) {
  const args = argv.slice(2)
  return {
    bootstrap: args.includes('--bootstrap'),
    cleanOrphans: args.includes('--clean-orphans'),
    prod: args.includes('--prod'),
  }
}

// ---- Shared probe-user helpers (service-role; bypass RLS) -------------------
async function findUsersByPrefix(svc, prefix) {
  const found = []
  let page = 1
  const perPage = 200
  for (;;) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage })
    if (error) throw new Error(`listUsers failed: ${error.message}`)
    const users = data?.users ?? []
    for (const u of users) {
      if (u.email && u.email.startsWith(prefix)) found.push({ id: u.id, email: u.email })
    }
    if (users.length < perPage) break
    page += 1
  }
  return found
}

// Leaf-to-root teardown: membership(s) first (non-owner -> no trigger block),
// then the auth user (cascades to user_profiles). Never touches the persistent org.
async function deleteProbeUsers(svc, users) {
  const cleaned = []
  for (const u of users) {
    try {
      await svc.from('user_organization_roles').delete().eq('user_id', u.id)
    } catch {
      /* membership may not exist (G-3/G-7 users have none) — ignore */
    }
    try {
      const { error } = await svc.auth.admin.deleteUser(u.id)
      if (!error) cleaned.push(u)
    } catch {
      /* surfaced via the post-run straggler check if it persists */
    }
  }
  return cleaned
}

async function findVerifyOrgId(svc) {
  const { data, error } = await svc
    .from('organizations')
    .select('id')
    .eq('slug', VERIFY_ORG_SLUG)
    .maybeSingle()
  if (error) throw new Error(`verification-org lookup failed: ${error.message}`)
  return data?.id ?? null
}

async function bootstrapVerifyOrg(svc) {
  const { data, error } = await svc
    .from('organizations')
    .insert({ name: VERIFY_ORG_NAME, slug: VERIFY_ORG_SLUG, timezone: 'Australia/Sydney' })
    .select('id')
    .single()
  if (error) throw new Error(`bootstrap of verification org failed: ${error.message}`)
  return data.id
}

// ---- G-1: custom-access-token hook enabled ---------------------------------
async function checkG1(svc, anon, verifyOrgId, runPrefix) {
  if (!verifyOrgId) {
    return {
      id: 'G-1',
      label: 'custom-access-token hook',
      status: 'cnd',
      detail:
        'Verification org not found. Run once with --bootstrap to create the inert probe org (a reviewed first-run step), then re-run.',
    }
  }
  const email = `${runPrefix}g1@${VERIFY_EMAIL_DOMAIN}`
  const password = randomPassword()
  let userId = null
  try {
    const { data: created, error: cErr } = await svc.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // pre-confirmed -> can sign in immediately, no mailbox needed
    })
    if (cErr || !created?.user) {
      return {
        id: 'G-1',
        label: 'custom-access-token hook',
        status: 'cnd',
        detail: `Could not create probe user: ${cErr?.message ?? 'no user returned'}`,
      }
    }
    userId = created.user.id

    const { error: mErr } = await svc
      .from('user_organization_roles')
      .insert({ user_id: userId, organization_id: verifyOrgId, role: 'staff' }) // NON-owner
    if (mErr) {
      return {
        id: 'G-1',
        label: 'custom-access-token hook',
        status: 'cnd',
        detail: `Could not attach probe membership: ${mErr.message}`,
      }
    }

    // Fresh JWT via front-door sign-in. The hook runs at issue; the membership
    // already exists, so a green hook injects organization_id into THIS token.
    const { data: signIn, error: sErr } = await anon.auth.signInWithPassword({ email, password })
    if (sErr || !signIn?.session) {
      return {
        id: 'G-1',
        label: 'custom-access-token hook',
        status: 'cnd',
        detail: `Could not sign in probe user to obtain a JWT: ${sErr?.message ?? 'no session returned'}`,
      }
    }
    const claims = decodeJwtPayload(signIn.session.access_token)
    await anon.auth.signOut().catch(() => {})

    if (claims.organization_id) {
      return {
        id: 'G-1',
        label: 'custom-access-token hook',
        status: 'green',
        detail: `JWT carries organization_id=${claims.organization_id} (user_role=${claims.user_role ?? 'n/a'}). Hook is ENABLED and injecting tenant scope.`,
      }
    }
    return {
      id: 'G-1',
      label: 'custom-access-token hook',
      status: 'red',
      detail:
        'JWT issued WITHOUT organization_id claim. The custom-access-token hook is DISABLED — the catastrophic case. Every RLS policy matches zero rows for real users; the platform reads as a dead/empty system. Enable it: Dashboard -> Authentication -> Hooks -> Custom Access Token.',
    }
  } finally {
    // Belt-and-suspenders. The top-level finally also sweeps by runPrefix.
    if (userId) {
      try {
        await svc.from('user_organization_roles').delete().eq('user_id', userId)
      } catch {}
      try {
        await svc.auth.admin.deleteUser(userId)
      } catch {}
    }
  }
}

// ---- G-3: HIBP leaked-password protection ----------------------------------
async function checkG3(svc, anon, env, runPrefix) {
  const breached = env.VERIFY_G3_BREACHED_PASSWORD || DEFAULT_BREACHED_PASSWORD
  if (breached.length < 12) {
    return {
      id: 'G-3',
      label: 'HIBP leaked-password',
      status: 'cnd',
      detail:
        'Configured breached test password is < 12 chars; it would fail the length policy and cannot isolate HIBP. Set VERIFY_G3_BREACHED_PASSWORD to a known-breached >=12-char string.',
    }
  }
  const email = `${runPrefix}g3@${VERIFY_EMAIL_DOMAIN}`
  let createdId = null
  try {
    // MUST be the front-door signUp (anon) — admin.createUser bypasses HIBP.
    const { data, error } = await anon.auth.signUp({ email, password: breached })
    if (error) {
      const reasons = Array.isArray(error?.reasons) ? error.reasons : null
      if (reasons && reasons.includes('pwned')) {
        return {
          id: 'G-3',
          label: 'HIBP leaked-password',
          status: 'green',
          detail: 'Front-door signUp rejected the known-breached password (reasons include "pwned"). HIBP leaked-password protection is ENABLED.',
        }
      }
      if (reasons && reasons.length > 0) {
        return {
          id: 'G-3',
          label: 'HIBP leaked-password',
          status: 'cnd',
          detail: `signUp rejected as weak but reasons=[${reasons.join(', ')}] without "pwned" — unexpected for a length-valid, character-class-free password. Check the test password and that no character-class policy was added.`,
        }
      }
      if (error?.code === 'weak_password') {
        return {
          id: 'G-3',
          label: 'HIBP leaked-password',
          status: 'green',
          detail: 'signUp rejected with code=weak_password (no structured reasons returned). The test password is length-valid and the project enforces no character classes, so the only possible weak reason is "pwned" — HIBP ENABLED (inferred).',
        }
      }
      return {
        id: 'G-3',
        label: 'HIBP leaked-password',
        status: 'cnd',
        detail: `signUp errored for a non-weak-password reason: ${error.message} (code=${error.code ?? 'n/a'}). Possibly a rate limit or network issue — re-run.`,
      }
    }
    // No error -> signUp accepted a breached password -> HIBP is OFF.
    if (data?.user) createdId = data.user.id
    return {
      id: 'G-3',
      label: 'HIBP leaked-password',
      status: 'red',
      detail:
        'Front-door signUp ACCEPTED a known-breached password. HIBP leaked-password protection is DISABLED. Enable it: Dashboard -> Authentication -> Providers -> Email -> Password Settings -> "Prevent use of leaked passwords".',
    }
  } finally {
    if (createdId) {
      try {
        await svc.auth.admin.deleteUser(createdId)
      } catch {}
    }
    // Backstop: top-level finally also sweeps this run's emails by prefix.
  }
}

// ---- G-3u (C-7): HIBP leaked-password protection on the updateUser path -----
// WHY THIS EXISTS, SEPARATELY FROM G-3:
//   Clients are admin-INVITED and never hit signUp. They set their FIRST real
//   password via supabase.auth.updateUser({password}) in the welcome/accept flow
//   (src/app/welcome/actions.ts) and again in password reset
//   (src/app/auth/reset-password/actions.ts). checkG3 only proves HIBP on signUp.
//   This proves — or disproves — HIBP on updateUser, the path EVERY client uses.
//   It also sidesteps the free-tier signUp blockers that leave G-3 at CND:
//   admin.createUser is pre-confirmed (no mail, accepts any domain incl. .invalid),
//   sign-in sends no mail, and updateUser sends no mail — so this returns a real
//   GREEN/RED on the free tier. See docs/polish/auth-onboarding-client.md C-7 and
//   the runbook's "Future automation option" note.
// PLAN-GATE (discovered 2026-06-10, first G-3u run): HIBP itself is a Pro-plan
//   feature — the Management API refuses to enable it on the free tier
//   ("available on Pro Plans and up"). On a free-tier project G-3u therefore
//   reports RED as the EXPECTED steady state: not drift, not an updateUser
//   exemption — the protection cannot be switched on at all. The probe's
//   original question (does HIBP fire on updateUser, or only signUp?) becomes
//   answerable the day the project moves to Pro and the toggle is enabled;
//   re-run this script that day. See the runbook's plan-gate section.
async function checkG3Updateuser(svc, anon, env, runPrefix) {
  const breached = env.VERIFY_G3_BREACHED_PASSWORD || DEFAULT_BREACHED_PASSWORD
  if (breached.length < 12) {
    return {
      id: 'G-3u',
      label: 'HIBP on updateUser (C-7)',
      status: 'cnd',
      detail:
        'Configured breached test password is < 12 chars; it would fail the length policy and cannot isolate HIBP. Set VERIFY_G3_BREACHED_PASSWORD to a known-breached >=12-char string.',
    }
  }
  const email = `${runPrefix}g3u@${VERIFY_EMAIL_DOMAIN}`
  const initialPassword = randomPassword()
  let createdId = null
  try {
    // 1. Admin-create a pre-confirmed user (no mail; bypasses HIBP itself, which
    //    is fine — we are testing the LATER updateUser, not creation).
    const { data: created, error: cErr } = await svc.auth.admin.createUser({
      email,
      password: initialPassword,
      email_confirm: true,
    })
    if (cErr || !created?.user) {
      return {
        id: 'G-3u',
        label: 'HIBP on updateUser (C-7)',
        status: 'cnd',
        detail: `Could not create probe user: ${cErr?.message ?? 'no user returned'}. Re-run.`,
      }
    }
    createdId = created.user.id

    // 2. Sign in on the ANON (front-door) client to hold a real user session.
    //    updateUser must run as the user — the admin API would bypass HIBP just
    //    like admin.createUser does, which would make the test meaningless.
    const { data: signIn, error: sErr } = await anon.auth.signInWithPassword({
      email,
      password: initialPassword,
    })
    if (sErr || !signIn?.session) {
      return {
        id: 'G-3u',
        label: 'HIBP on updateUser (C-7)',
        status: 'cnd',
        detail: `Could not sign in probe user to obtain a session: ${sErr?.message ?? 'no session returned'}. Re-run.`,
      }
    }

    // 3. Attempt to set a KNOWN-BREACHED password via the front-door updateUser —
    //    the exact call clients make in welcome/actions.ts and reset-password/actions.ts.
    const { error: uErr } = await anon.auth.updateUser({ password: breached })
    await anon.auth.signOut().catch(() => {})

    if (uErr) {
      const reasons = Array.isArray(uErr?.reasons) ? uErr.reasons : null
      if (reasons && reasons.includes('pwned')) {
        return {
          id: 'G-3u',
          label: 'HIBP on updateUser (C-7)',
          status: 'green',
          detail:
            'updateUser REJECTED the known-breached password (reasons include "pwned"). HIBP IS enforced on the updateUser path — the client welcome + password-reset surfaces are covered. C-7 closes as verified, no code change.',
        }
      }
      if (reasons && reasons.length > 0) {
        return {
          id: 'G-3u',
          label: 'HIBP on updateUser (C-7)',
          status: 'cnd',
          detail: `updateUser rejected as weak but reasons=[${reasons.join(', ')}] without "pwned" — unexpected for a length-valid, character-class-free password. Check the test password and that no character-class policy was added.`,
        }
      }
      if (uErr?.code === 'weak_password') {
        return {
          id: 'G-3u',
          label: 'HIBP on updateUser (C-7)',
          status: 'green',
          detail:
            'updateUser rejected with code=weak_password (no structured reasons). Length-valid + no character-class policy means the only possible weak reason is "pwned" — HIBP enforced on updateUser (inferred). C-7 closes as verified.',
        }
      }
      return {
        id: 'G-3u',
        label: 'HIBP on updateUser (C-7)',
        status: 'cnd',
        detail: `updateUser errored for a non-weak-password reason: ${uErr.message} (code=${uErr.code ?? 'n/a'}). Possibly a rate limit, session, or network issue — re-run.`,
      }
    }

    // No error -> updateUser ACCEPTED a breached password -> HIBP is NOT enforced
    // on this path. THIS IS THE C-7 HOLE.
    return {
      id: 'G-3u',
      label: 'HIBP on updateUser (C-7)',
      status: 'red',
      detail:
        'updateUser ACCEPTED a known-breached password — HIBP did not fire on this path. FIRST check the plan: HIBP is plan-gated (Pro+) and on the free tier cannot be enabled at all (Management API refuses with "available on Pro Plans and up"; verified 2026-06-10), so on free tier this RED is the expected steady state until a Pro upgrade — no support ticket, see the runbook. ONLY if the project is on Pro with the dashboard HIBP toggle ON does this RED mean the C-7 platform hole (updateUser exempt from the signUp leaked-password policy): in that case file a Supabase support ticket and document the residual recovery-path risk in docs/polish/auth-onboarding-client.md C-7.',
    }
  } finally {
    if (createdId) {
      try {
        await svc.auth.admin.deleteUser(createdId)
      } catch {}
    }
    // Backstop: the top-level run-prefix sweep also catches this user.
  }
}

// ---- G-7: email confirmations enabled --------------------------------------
async function checkG7(svc, anon, runPrefix) {
  const email = `${runPrefix}g7@${VERIFY_EMAIL_DOMAIN}`
  const password = randomPassword()
  let createdId = null
  try {
    const { data, error } = await anon.auth.signUp({ email, password })
    if (error) {
      return {
        id: 'G-7',
        label: 'email confirmations',
        status: 'cnd',
        detail: `signUp errored: ${error.message}. Cannot infer the confirmation setting from an error (possibly a rate limit) — re-run.`,
      }
    }
    if (data?.user) createdId = data.user.id
    if (data?.session === null) {
      return {
        id: 'G-7',
        label: 'email confirmations',
        status: 'green',
        detail: 'signUp returned a null session — email confirmation is required before first login (partial assertion per design).',
      }
    }
    return {
      id: 'G-7',
      label: 'email confirmations',
      status: 'red',
      detail:
        'signUp returned an ACTIVE session immediately — email confirmations appear DISABLED. Enable: Dashboard -> Authentication -> Providers -> Email -> "Confirm email".',
    }
  } finally {
    if (createdId) {
      try {
        await svc.auth.admin.deleteUser(createdId)
      } catch {}
    }
    // Backstop: the top-level finally sweeps this run's emails by prefix, which
    // also catches the case where prevent-email-enumeration returned an
    // obfuscated id but a real unconfirmed row exists.
  }
}

// ---- Reporting -------------------------------------------------------------
const STATUS_LABEL = { green: 'GREEN', red: 'RED ', cnd: 'CND ', doc: 'DOC ' }

function printReport(results) {
  console.log('')
  console.log('=== Dashboard-config verification ===')
  console.log(new Date().toISOString())
  console.log('')
  for (const r of results) {
    console.log(`${r.id}  [${STATUS_LABEL[r.status] ?? r.status}]  ${r.label}`)
    console.log(`      ${r.detail}`)
  }
  console.log('')
}

function computeExitCode(results) {
  if (results.some((r) => r.status === 'red')) return 1
  if (results.some((r) => r.status === 'cnd')) return 2
  return 0
}

// ---- Main ------------------------------------------------------------------
async function main() {
  const flags = parseFlags(process.argv)
  const env = loadEnvLocal()
  // Environment separation (2026-07-21): the .env.local default keys point at
  // STAGING, so that is the default target. --prod re-points this run at
  // production via the PROD_* keys — cutover/post-deploy sittings pass it
  // explicitly. The resolved target is printed so the operator always knows
  // where the probes are landing.
  if (flags.prod) {
    for (const [dst, src] of [
      ['NEXT_PUBLIC_SUPABASE_URL', 'PROD_SUPABASE_URL'],
      ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'PROD_SUPABASE_ANON_KEY'],
      ['SUPABASE_SERVICE_ROLE_KEY', 'PROD_SUPABASE_SERVICE_ROLE_KEY'],
    ]) {
      if (!env[src]) {
        console.error(`--prod requires ${src} in .env.local`)
        process.exit(2)
      }
      env[dst] = env[src]
    }
  }
  requireEnv(env)
  const targetRef = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]
  console.log(
    `Target: ${flags.prod ? 'PRODUCTION' : 'staging (default)'} (${targetRef}) — resolved from .env.local ${flags.prod ? 'PROD_*' : 'default'} keys.`,
  )

  // Resolve the probe email domain from .env.local first (then an exported override, then default).
  VERIFY_EMAIL_DOMAIN = env.VERIFY_EMAIL_DOMAIN || process.env.VERIFY_EMAIL_DOMAIN || 'verify.invalid'

  const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  const runId = `${Date.now()}-${randomBytes(3).toString('hex')}`
  const runPrefix = `${VERIFY_USER_PREFIX}${runId}-` // verify-probe-<runId>-

  // 1. Pre-run orphan scan. Runs BEFORE any probe user is created, so every
  //    match is residue from a prior crashed run. Report; only delete on flag.
  const orphans = await findUsersByPrefix(svc, VERIFY_USER_PREFIX)
  if (orphans.length === 0) {
    console.log('Orphan scan: clean (no leftover probe users).')
  } else {
    console.log(`Orphan scan: found ${orphans.length} leftover probe user(s) from prior run(s):`)
    for (const o of orphans) console.log(`  - ${o.email} (${o.id})`)
    if (flags.cleanOrphans) {
      const cleaned = await deleteProbeUsers(svc, orphans)
      console.log(`Cleaned ${cleaned.length} orphaned probe user(s).`)
    } else {
      console.log('Re-run with --clean-orphans to remove the above. (Not auto-deleted.)')
    }
  }

  // 2. Resolve (or, on --bootstrap, create) the persistent inert verification org.
  let verifyOrgId = await findVerifyOrgId(svc)
  if (!verifyOrgId && flags.bootstrap) {
    verifyOrgId = await bootstrapVerifyOrg(svc)
    console.log(`Bootstrapped inert verification org: ${verifyOrgId} (slug=${VERIFY_ORG_SLUG})`)
  } else if (!verifyOrgId) {
    console.log('Verification org absent. G-1 will report could-not-determine. Run with --bootstrap to create it (reviewed first-run step).')
  }

  // 3. Run the checks with a GUARANTEED sweep of this run's probe users on every
  //    exit path (pass, fail, or throw). The per-probe finally blocks are a fast
  //    path; this sweep is the guarantee that no ephemeral user is ever orphaned.
  const results = []
  try {
    results.push(await checkG1(svc, anon, verifyOrgId, runPrefix))
    results.push(await checkG3(svc, anon, env, runPrefix))
    results.push(await checkG3Updateuser(svc, anon, env, runPrefix)) // C-7
    results.push(await checkG7(svc, anon, runPrefix))
  } finally {
    const stragglers = await findUsersByPrefix(svc, runPrefix)
    if (stragglers.length) {
      const swept = await deleteProbeUsers(svc, stragglers)
      console.log(`Teardown sweep: removed ${swept.length} probe user(s) created this run.`)
    } else {
      console.log('Teardown sweep: clean (this run left no probe users).')
    }
  }

  // 4. G-4 is documentation-only — surfaced, never asserted here.
  results.push({
    id: 'G-4',
    label: 'refresh-token lifetime',
    status: 'doc',
    detail:
      'Documentation-only. Refresh-token lifetime (target 30 days) is verified by the dashboard value and docs/runbooks/verify-auth-config.md, not by this script.',
  })

  printReport(results)
  return computeExitCode(results)
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`Fatal: ${e?.message ?? e}`)
    process.exit(3)
  })
