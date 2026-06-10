// ============================================================================
// c14-prefetch-test.mjs — C-14 live mail-client prefetch test (Gmail)
// ============================================================================
// VERIFICATION ONLY — changes no application code. Drives the two test sends
// for C-14, reads the consumption detector at each checkpoint, and tears the
// test rows down. Run on the operator's machine only; never CI, never an HTTP
// endpoint. Reads SUPABASE_SERVICE_ROLE_KEY + RESEND_API_KEY from .env.local;
// neither is ever logged.
//
// Detector (established empirically by scripts/c14-prefetch-probe.mjs, Phase A):
//   auth.users.email_confirmed_at flips null -> timestamp the moment the
//   Supabase action_link is fetched by ANYONE (a bare GET is enough). So:
//     null after delivery+scan, before any human tap  => NOT consumed (gate holds)
//     timestamp before any human tap                  => CONSUMED  (prefetcher won)
//
// Two parallel sends to the SAME Gmail inbox (distinct +alias identities):
//   B1 CONTROL  (scottyhb19+g2jctl@gmail.com): the raw Supabase action_link,
//               emailed directly with NO gate. Tests whether Gmail's scanner
//               consumes that URL shape AT ALL (the gate's unverified premise).
//   B2 GATED    (scottyhb19+g2j@gmail.com):    the REAL production gate URL
//               https://odysseyhq.com.au/i/<token>. Tests whether the gate
//               stops the scanner from reaching the action_link behind it.
//
// USAGE (run from repo root):
//   node scripts/c14-prefetch-test.mjs send       # create users + send both emails
//   node scripts/c14-prefetch-test.mjs check      # read email_confirmed_at for both
//   node scripts/c14-prefetch-test.mjs teardown   # hard-delete all test rows
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const CONTROL_EMAIL = 'scottyhb19+g2jctl@gmail.com'
const REAL_EMAIL = 'scottyhb19+g2j@gmail.com'
const PROD = 'https://odysseyhq.com.au'

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

async function findUserByEmail(svc, email) {
  let page = 1
  for (;;) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error(`listUsers failed: ${error.message}`)
    const users = data?.users ?? []
    const hit = users.find((u) => (u.email ?? '').toLowerCase() === email.toLowerCase())
    if (hit) return hit
    if (users.length < 200) return null
    page += 1
  }
}

async function resolveRealOrg(svc) {
  const { data, error } = await svc.from('organizations').select('id, name, slug')
  if (error) throw new Error(`org lookup failed: ${error.message}`)
  const all = data ?? []
  const real = all.filter(
    (o) => !/^verify-/.test(o.slug ?? '') && !String(o.name ?? '').startsWith('[VERIFY]'),
  )
  if (real.length === 1) return real[0]
  console.error('Could not unambiguously resolve the real org. Candidates:')
  for (const o of all) console.error(`   ${o.id}  slug=${o.slug}  name=${o.name}`)
  throw new Error(`expected exactly 1 real org, found ${real.length}`)
}

async function sendResend(env, { to, subject, html }) {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY missing in .env.local')
  if (!env.EMAIL_FROM) throw new Error('EMAIL_FROM missing in .env.local')
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to, subject, html }),
  })
  const body = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(`Resend send failed (${resp.status}): ${JSON.stringify(body)}`)
  return body?.id ?? '(no id)'
}

function controlHtml(actionLink) {
  return `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:480px;color:#1c1917">
  <p style="color:#b00020"><strong>[C-14 CONTROL — do not tap]</strong></p>
  <p>Direct sign-in link, no gate. This mirrors the pre-gate invite email.</p>
  <p><a href="${actionLink}">Continue to your portal</a></p>
  <p style="color:#78746f;font-size:13px">Leave this sitting in your inbox. Do not click.</p>
</div>`
}

function gatedHtml(gateUrl) {
  return `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:480px;color:#1c1917">
  <p style="color:#b00020"><strong>[C-14 TEST — do not tap until told]</strong></p>
  <p>Hi Prefetch, your practitioner has invited you to Odyssey.</p>
  <p><a href="${gateUrl}">Continue to your portal</a></p>
  <p style="color:#78746f;font-size:13px">Leave this sitting in your inbox until I tell you to tap it.</p>
</div>`
}

async function cmdSend(svc, env) {
  // Guard the magic-link-fallback trap: a pre-existing user on either alias
  // would make generateLink fall back to magiclink and change the observable.
  const exCtl = await findUserByEmail(svc, CONTROL_EMAIL)
  const exReal = await findUserByEmail(svc, REAL_EMAIL)
  const { data: exClient } = await svc
    .from('clients').select('id').ilike('email', REAL_EMAIL).is('deleted_at', null).maybeSingle()
  if (exCtl || exReal || exClient) {
    console.error('Leftover test artifacts exist — run `node scripts/c14-prefetch-test.mjs teardown` first:')
    console.error(`   control user: ${exCtl ? exCtl.id : 'none'}`)
    console.error(`   real user:    ${exReal ? exReal.id : 'none'}`)
    console.error(`   test client:  ${exClient ? exClient.id : 'none'}`)
    process.exit(2)
  }

  // Org: explicit id via argv[3] (preferred — the live project carries leftover
  // test orgs that defeat auto-resolve), else best-effort auto-resolve.
  const orgArg = process.argv[3]
  let org
  if (orgArg) {
    const { data, error } = await svc
      .from('organizations').select('id, name, slug').eq('id', orgArg).maybeSingle()
    if (error || !data) throw new Error(`org ${orgArg} not found: ${error?.message ?? 'no row'}`)
    org = data
  } else {
    org = await resolveRealOrg(svc)
  }
  console.log(`real org: ${org.id} (${org.name})`)

  // ---- B1 CONTROL: raw action_link, no gate ----
  const glCtl = await svc.auth.admin.generateLink({
    type: 'invite', email: CONTROL_EMAIL, options: { redirectTo: `${PROD}/auth/callback?next=%2Fwelcome` },
  })
  if (glCtl.error || !glCtl.data?.properties?.action_link) {
    throw new Error(`control generateLink failed: ${glCtl.error?.message ?? 'no action_link'}`)
  }
  const ctlLink = glCtl.data.properties.action_link
  const ctlUser = glCtl.data.user?.id ?? (await findUserByEmail(svc, CONTROL_EMAIL))?.id
  const ctlMsg = await sendResend(env, {
    to: CONTROL_EMAIL, subject: '[C-14 control] Odyssey sign-in — do not tap', html: controlHtml(ctlLink),
  })

  // ---- B2 GATED: real client + invite_tokens + production gate URL ----
  const { data: client, error: cErr } = await svc
    .from('clients')
    .insert({ organization_id: org.id, first_name: 'Prefetch', last_name: 'TestB2', email: REAL_EMAIL })
    .select('id').single()
  if (cErr || !client) throw new Error(`client insert failed: ${cErr?.message ?? 'no row'}`)

  const glReal = await svc.auth.admin.generateLink({
    type: 'invite', email: REAL_EMAIL,
    options: { redirectTo: `${PROD}/auth/callback?next=${encodeURIComponent('/welcome?client_id=' + client.id)}` },
  })
  if (glReal.error || !glReal.data?.properties?.action_link) {
    throw new Error(`real generateLink failed: ${glReal.error?.message ?? 'no action_link'}`)
  }
  const realLink = glReal.data.properties.action_link
  const realUser = glReal.data.user?.id ?? (await findUserByEmail(svc, REAL_EMAIL))?.id

  const { data: tok, error: tErr } = await svc
    .from('invite_tokens')
    .insert({ organization_id: org.id, client_id: client.id, action_link: realLink })
    .select('id').single()
  if (tErr || !tok) throw new Error(`invite_tokens insert failed: ${tErr?.message ?? 'no row'}`)

  const gateUrl = `${PROD}/i/${tok.id}`
  const realMsg = await sendResend(env, {
    to: REAL_EMAIL, subject: '[C-14 test] Your Odyssey portal invite — do not tap yet', html: gatedHtml(gateUrl),
  })

  console.log(`\n=== SENT (${new Date().toISOString()}) ===`)
  console.log(`B1 control -> ${CONTROL_EMAIL}`)
  console.log(`   user=${ctlUser}  resend_id=${ctlMsg}  (raw action_link host: ${new URL(ctlLink).host})`)
  console.log(`B2 gated   -> ${REAL_EMAIL}`)
  console.log(`   user=${realUser}  client=${client.id}  token=${tok.id}  resend_id=${realMsg}`)
  console.log(`   gate URL Gmail will scan: ${gateUrl}`)
  console.log('\nOperator: check inbox AND spam. Confirm both arrived, do NOT tap either,')
  console.log('let them sit ~10-15 min, then say "arrived, untouched".')
}

async function cmdCheck(svc) {
  console.log(`=== CHECK (${new Date().toISOString()}) ===`)
  for (const [label, email] of [
    ['B1 control (raw link) ', CONTROL_EMAIL],
    ['B2 gated  (real invite)', REAL_EMAIL],
  ]) {
    const u = await findUserByEmail(svc, email)
    if (!u) { console.log(`${label}  ${email}\n   (no user — not sent yet, or torn down)`); continue }
    const ec = u.email_confirmed_at ?? null
    console.log(`${label}  ${email}`)
    console.log(`   email_confirmed_at: ${ec ?? 'null'}   => ${ec ? '*** CONSUMED ***' : 'NOT consumed'}`)
    console.log(`   last_sign_in_at:    ${u.last_sign_in_at ?? 'null'}`)
  }
  const { data: client } = await svc
    .from('clients').select('id').ilike('email', REAL_EMAIL).is('deleted_at', null).maybeSingle()
  if (client) {
    const { data: tok } = await svc
      .from('invite_tokens').select('id, consumed_at, expires_at').eq('client_id', client.id).maybeSingle()
    if (tok) console.log(`B2 invite_tokens: consumed_at=${tok.consumed_at ?? 'null'} expires_at=${tok.expires_at}`)
  }
}

async function cmdTeardown(svc) {
  console.log(`=== TEARDOWN (${new Date().toISOString()}) ===`)
  // clients (and invite_tokens via cascade, but delete explicitly first)
  const { data: clients } = await svc.from('clients').select('id').ilike('email', REAL_EMAIL)
  for (const c of clients ?? []) {
    const { error: itErr } = await svc.from('invite_tokens').delete().eq('client_id', c.id)
    console.log(`invite_tokens for client ${c.id}: ${itErr ? 'DELETE FAILED ' + itErr.message : 'deleted'}`)
    const { error: cErr } = await svc.from('clients').delete().eq('id', c.id)
    console.log(`client ${c.id}: ${cErr ? 'DELETE FAILED ' + cErr.message : 'deleted'}`)
  }
  // auth users for both aliases
  for (const email of [CONTROL_EMAIL, REAL_EMAIL]) {
    const u = await findUserByEmail(svc, email)
    if (!u) { console.log(`auth user ${email}: none`); continue }
    const { error } = await svc.auth.admin.deleteUser(u.id)
    console.log(`auth user ${email} (${u.id}): ${error ? 'DELETE FAILED ' + error.message : 'deleted'}`)
  }
  // verify clean sweep
  const stragglerCtl = await findUserByEmail(svc, CONTROL_EMAIL)
  const stragglerReal = await findUserByEmail(svc, REAL_EMAIL)
  const { data: clientLeft } = await svc.from('clients').select('id').ilike('email', REAL_EMAIL)
  console.log(`\nverify: control user ${stragglerCtl ? 'STILL EXISTS (!)' : 'gone'}; ` +
    `real user ${stragglerReal ? 'STILL EXISTS (!)' : 'gone'}; ` +
    `test client rows remaining: ${(clientLeft ?? []).length}`)
  console.log('note: any audit_log rows from the test client INSERT remain as an append-only trail ' +
    '(reference a now-deleted client id; harmless). Say so if you want them purged too.')
}

async function main() {
  const cmd = process.argv[2]
  if (!['send', 'check', 'teardown'].includes(cmd)) {
    console.error('Usage: node scripts/c14-prefetch-test.mjs <send|check|teardown>')
    process.exit(2)
  }
  const env = loadEnvLocal()
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
    process.exit(2)
  }
  const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  if (cmd === 'send') await cmdSend(svc, env)
  else if (cmd === 'check') await cmdCheck(svc)
  else await cmdTeardown(svc)
}

main().catch((e) => { console.error(`fatal: ${e?.message ?? e}`); process.exit(3) })
