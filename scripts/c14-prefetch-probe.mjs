// ============================================================================
// c14-prefetch-probe.mjs — C-14 Phase A baseline detector probe
// ============================================================================
// PURPOSE (verification only; changes no application code):
//   Establish, empirically, WHICH auth.users field flips when the Supabase
//   invite action_link is fetched, and prove that a BARE GET of that link
//   (no redirect follow) is enough to consume the one-time token / confirm
//   the user. That field becomes the detector for the live Gmail/Outlook
//   prefetch test (Phase B/C of C-14).
//
// WHY IT IS SAFE:
//   - admin.generateLink({type:'invite'}) does NOT send email. It only mints
//     the link (this is exactly why the app uses it instead of inviteUserByEmail).
//   - The probe email is an RFC-reserved example.com address — never delivers.
//   - Creates exactly ONE throwaway auth user and HARD-DELETES it on every
//     exit path (try/finally). No real data is touched.
//   - Logs only the action_link's host + pathname, NEVER the token query and
//     NEVER the service-role key.
//
// USAGE:  node scripts/c14-prefetch-probe.mjs       (run from the repo root)
// EXIT:   0 detector established · 2 env/setup problem · 3 fatal/probe error
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

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

// The fields most likely to carry a consumption/confirmation signal.
const snap = (u) => ({
  email_confirmed_at: u?.email_confirmed_at ?? null,
  confirmed_at: u?.confirmed_at ?? null,
  last_sign_in_at: u?.last_sign_in_at ?? null,
  updated_at: u?.updated_at ?? null,
})

const changed = (a, b) =>
  Object.keys(a).filter((k) => a[k] !== b[k])

async function main() {
  const env = loadEnvLocal()
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
    process.exit(2)
  }

  const svc = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  const runId = `${Date.now()}-${randomBytes(3).toString('hex')}`
  const email = `c14-baseline-${runId}@example.com` // RFC-reserved; never delivers
  // redirect_to is irrelevant to the no-follow GET (consumption happens at the
  // Supabase /verify step, before any redirect). Point it at the live prod
  // callback so an escalation follow-probe, if needed, hits a real endpoint.
  const redirectTo = 'https://odysseyhq.com.au/auth/callback?next=%2Fwelcome'

  console.log('\n=== C-14 Phase A — baseline detector probe ===')
  console.log(`probe email : ${email}`)

  let userId = null
  try {
    const gl = await svc.auth.admin.generateLink({
      type: 'invite',
      email,
      options: { redirectTo },
    })
    if (gl.error || !gl.data?.properties?.action_link) {
      console.error(`generateLink failed: ${gl.error?.message ?? 'no action_link returned'}`)
      process.exit(3)
    }
    const actionLink = gl.data.properties.action_link
    userId = gl.data.user?.id ?? null
    if (!userId) {
      const { data } = await svc.auth.admin.listUsers({ page: 1, perPage: 200 })
      userId = (data?.users ?? []).find((u) => u.email === email)?.id ?? null
    }
    if (!userId) {
      console.error('Could not resolve the probe user id.')
      process.exit(3)
    }
    const al = new URL(actionLink)
    console.log(`probe user  : ${userId}`)
    console.log(`action_link : ${al.protocol}//${al.host}${al.pathname}  (token query withheld)`)

    // Checkpoint 1 — immediately after generateLink (before any fetch).
    const c1 = (await svc.auth.admin.getUserById(userId)).data?.user
    console.log('\n[1] after generateLink (pre-fetch):')
    console.log('   ', snap(c1))

    // The probe: a bare GET with NO redirect follow — exactly what a link
    // prefetcher does when it touches a URL to "scan" it.
    const r1 = await fetch(actionLink, { redirect: 'manual' })
    console.log(`\n[GET no-follow] status=${r1.status}  location=${r1.headers.get('location') ? 'present' : 'none'}`)

    // Checkpoint 2 — after the bare GET.
    const c2 = (await svc.auth.admin.getUserById(userId)).data?.user
    console.log('\n[2] after bare GET (no redirect follow):')
    console.log('   ', snap(c2))

    const movedNoFollow = changed(snap(c1), snap(c2))
    let trigger = movedNoFollow.length ? 'BARE GET (no redirect follow)' : null
    let before = snap(c1)
    let after = snap(c2)

    // Escalation: only if a bare GET did NOT move anything, follow redirects
    // (this hits the prod /auth/callback code-exchange). Tells us whether
    // consumption needs the full redirect chain rather than a bare GET.
    if (!movedNoFollow.length) {
      console.log('\n(no change from a bare GET — escalating to a redirect-following GET)')
      const r2 = await fetch(actionLink, { redirect: 'follow' })
      console.log(`[GET follow] status=${r2.status}  final-host=${(() => { try { return new URL(r2.url).host } catch { return '?' } })()}`)
      const c3 = (await svc.auth.admin.getUserById(userId)).data?.user
      console.log('\n[3] after GET (following redirects):')
      console.log('   ', snap(c3))
      if (changed(snap(c2), snap(c3)).length) {
        trigger = 'GET + follow redirect (callback chain)'
        after = snap(c3)
      }
    }

    console.log('\n=== DETECTOR SUMMARY ===')
    const moved = changed(before, after)
    if (moved.length) {
      for (const k of moved) console.log(`   ${k}: ${before[k] ?? 'null'}  ->  ${after[k] ?? 'null'}`)
    } else {
      console.log('   no field moved — neither a bare GET nor a redirect-following GET consumed the token')
    }
    console.log(`   consumption trigger: ${trigger ?? 'NONE OBSERVED'}`)
    console.log(`   => detector field for Phase B/C: ${moved[0] ?? '(undetermined — investigate)'}`)
  } finally {
    if (userId) {
      const del = await svc.auth.admin.deleteUser(userId)
      console.log(`\nteardown: deleteUser ${del.error ? 'FAILED: ' + del.error.message : 'ok'}`)
      const still = (await svc.auth.admin.getUserById(userId)).data?.user
      console.log(`teardown verify: probe user ${still ? 'STILL EXISTS (!)' : 'gone'}`)
    }
  }
}

main().catch((e) => {
  console.error(`fatal: ${e?.message ?? e}`)
  process.exit(3)
})
