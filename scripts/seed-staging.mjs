// ============================================================================
// scripts/seed-staging.mjs — synthetic seed data for the STAGING project
// ============================================================================
// Environment separation (2026-07-21): staging is the default dev target and
// must hold realistic-but-fake data so local dev never needs production.
//
// WHAT IT CREATES
//   - Two orgs mirroring production's org NAMES ("The Odyssey. Platform",
//     "The Exercise Collaborative") so org-name-targeting scripts run
//     unchanged and cross-tenant surfaces are exercisable. All content fake.
//   - Dev logins (owner + portal client), written to .env.local as
//     STAGING_DEV_LOGIN_* / STAGING_DEV_CLIENT_* (synthetic, staging-only).
//   - The exercise library via the existing scripts/seed-exercise-library-*.sql
//     files (prod org/user UUIDs substituted for the staging ones).
//   - Six Odyssey clients exercising the dashboard triggers (rich/active,
//     ending-program, new-no-program, overdue, archived, uncategorised) with
//     programs, per-set prescriptions, completed sessions + set logs, clinical
//     notes (incl. an injury flag), medical history, appointments,
//     availability, a message thread with an unread client message, and one
//     logged communication. One minimal EXCO client for cross-tenant work.
//
// SAFETY
//   - Refuses to run unless the .env.local default URL resolves to
//     STAGING_PROJECT_REF; refuses outright if it matches PROD_PROJECT_REF.
//   - Every email is a delivered+…@resend.dev sink — nothing can reach a
//     human or bounce. NEVER put identifiable client data in staging.
//   - Refuses if either seed org already exists; --wipe tears down the two
//     seed orgs (leaf→root, audit_log last) + the three dev users first, so
//     `node scripts/seed-staging.mjs --wipe` is the full re-seed.
//
// RUN:  node scripts/seed-staging.mjs [--wipe]        (from the repo root)
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes, randomUUID } from 'node:crypto'

// ---- env -------------------------------------------------------------------
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
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY
if (!STAGING_REF || !URL || !ANON || !SERVICE) {
  console.error('Missing STAGING_PROJECT_REF / default Supabase keys in .env.local')
  process.exit(2)
}
if (PROD_REF && URL.includes(PROD_REF)) {
  console.error('REFUSING: .env.local default URL points at PRODUCTION. This script seeds staging only.')
  process.exit(2)
}
if (!URL.includes(STAGING_REF)) {
  console.error(`REFUSING: .env.local default URL does not resolve to STAGING_PROJECT_REF (${STAGING_REF}).`)
  process.exit(2)
}
console.log(`Target: staging (${STAGING_REF}) — resolved from .env.local default keys.`)

const svc = createClient(URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

// ---- helpers ---------------------------------------------------------------
const pw = () => randomBytes(15).toString('base64url') // ~20 chars, clears 12-min + HIBP
const SYD = 'Australia/Sydney'
// YYYY-MM-DD in Sydney for (today + offsetDays)
function sydDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: SYD, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
// ISO instant for Sydney wall-clock hour on (today + offsetDays)
function sydInstant(offsetDays, hour, minute = 0) {
  const day = sydDate(offsetDays)
  // Sydney is UTC+10 (AEST) in July — fixed offset is fine for seed data
  return new Date(`${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+10:00`).toISOString()
}
const daysAgoISO = (n, hour = 9) => sydInstant(-n, hour)

async function must(promise, label) {
  const { data, error } = await promise
  if (error) {
    console.error(`FAILED: ${label}:`, error.message ?? error)
    process.exit(1)
  }
  return data
}

async function ensureUser(email, password, meta) {
  const { data, error } = await svc.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: meta,
  })
  if (!error) return data.user
  // partial-run recovery: find the existing user and reset its password
  let page = 1
  for (;;) {
    const res = await svc.auth.admin.listUsers({ page, perPage: 200 })
    if (res.error) { console.error('listUsers failed:', res.error.message); process.exit(1) }
    const hit = res.data.users.find((u) => u.email === email)
    if (hit) {
      await svc.auth.admin.updateUserById(hit.id, { password })
      return hit
    }
    if (res.data.users.length < 200) break
    page++
  }
  console.error(`createUser failed for ${email}: ${error.message}`)
  process.exit(1)
}

async function signedInClient(email, password) {
  const c = createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { error } = await c.auth.signInWithPassword({ email, password })
  if (error) { console.error(`sign-in failed for ${email}: ${error.message}`); process.exit(1) }
  return c
}

// ---- 0. refuse if seed orgs exist (or --wipe them first) --------------------
const ORG_ODYSSEY = 'The Odyssey. Platform'
const ORG_EXCO = 'The Exercise Collaborative'
const WIPE = process.argv.includes('--wipe')

if (WIPE) {
  // Deterministic teardown of everything this script creates (and nothing
  // else): the two seed orgs' rows leaf→root, then the three dev auth users.
  // Runs as postgres via the Management-API channel so trigger disabling works.
  console.log('wipe: removing existing seed orgs + dev users …')
  const wipeSql = `
do $$
declare
  v_orgs uuid[];
  v_t record;
  v_n bigint;
  v_pass int := 0;
  v_progress boolean := true;
begin
  select array_agg(id) into v_orgs from organizations
   where name in ('${ORG_ODYSSEY.replace(/'/g, "''")}', '${ORG_EXCO.replace(/'/g, "''")}');
  if v_orgs is null then raise notice 'no seed orgs to wipe'; return; end if;

  -- children without organization_id, via their parents (what the seed writes)
  delete from set_logs where exercise_log_id in (
    select el.id from exercise_logs el join sessions s on s.id = el.session_id
    where s.organization_id = any(v_orgs));
  delete from exercise_logs where session_id in (
    select id from sessions where organization_id = any(v_orgs));
  delete from program_exercise_sets where program_exercise_id in (
    select pe.id from program_exercises pe
    join program_days pd on pd.id = pe.program_day_id
    join programs p on p.id = pd.program_id
    where p.organization_id = any(v_orgs));
  delete from program_exercises where program_day_id in (
    select pd.id from program_days pd join programs p on p.id = pd.program_id
    where p.organization_id = any(v_orgs));
  delete from program_days where program_id in (
    select id from programs where organization_id = any(v_orgs));
  if to_regclass('public.program_weeks') is not null then
    delete from program_weeks where program_id in (
      select id from programs where organization_id = any(v_orgs));
  end if;
  delete from exercise_tag_assignments where exercise_id in (
    select id from exercises where organization_id = any(v_orgs));
  if to_regclass('public.appointment_reminders') is not null then
    delete from appointment_reminders where appointment_id in (
      select id from appointments where organization_id = any(v_orgs));
  end if;

  -- every remaining public table carrying organization_id, FK-tolerant retries
  while v_progress and v_pass < 8 loop
    v_progress := false; v_pass := v_pass + 1;
    for v_t in
      select c.table_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = 'public' and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
      where c.table_schema = 'public' and c.column_name = 'organization_id'
        and c.table_name not in ('organizations', 'user_organization_roles')
    loop
      begin
        execute format('delete from public.%I where organization_id = any($1)', v_t.table_name) using v_orgs;
        get diagnostics v_n = row_count;
        if v_n > 0 then v_progress := true; end if;
      exception when foreign_key_violation then
        v_progress := true; -- a child still holds rows; retry next pass
      end;
    end loop;
  end loop;

  begin
    alter table user_organization_roles disable trigger enforce_last_owner_invariant;
  exception when others then null;
  end;
  delete from user_organization_roles where organization_id = any(v_orgs);
  -- audit rows are REPOPULATED by the audited deletes above, so audit_log must
  -- be cleared last, after every tenant delete and before the org rows
  -- (the standing service-role cleanup order).
  if to_regclass('public.audit_log') is not null then
    delete from audit_log where organization_id = any(v_orgs);
  end if;
  delete from organizations where id = any(v_orgs);
  begin
    alter table user_organization_roles enable trigger enforce_last_owner_invariant;
  exception when others then null;
  end;
end $$;`
  const wipePath = join(mkdtempSync(join(tmpdir(), 'odyssey-wipe-')), 'wipe.sql')
  writeFileSync(wipePath, wipeSql, 'utf8')
  execSync(`supabase db query --linked -f "${wipePath}" -o json`, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  for (const email of ['delivered+dev-owner@resend.dev', 'delivered+exco-owner@resend.dev', 'delivered+dev-client@resend.dev']) {
    let page = 1
    for (;;) {
      const res = await svc.auth.admin.listUsers({ page, perPage: 200 })
      if (res.error) break
      const hit = res.data.users.find((u) => u.email === email)
      if (hit) { await svc.auth.admin.deleteUser(hit.id); break }
      if (res.data.users.length < 200) break
      page++
    }
  }
  console.log('wipe ✓')
}

{
  const existing = await must(
    svc.from('organizations').select('id,name').in('name', [ORG_ODYSSEY, ORG_EXCO]),
    'org existence check',
  )
  if (existing.length) {
    console.error(`REFUSING: seed org(s) already exist on staging: ${existing.map((o) => o.name).join(', ')}.`)
    console.error('Re-run with --wipe to tear down and re-seed, or reset staging (runbooks/use-the-staging-project.md).')
    process.exit(1)
  }
}

// ---- 1. users + orgs --------------------------------------------------------
const ownerPw = pw(), excoPw = pw(), clientPw = pw()
const OWNER_EMAIL = 'delivered+dev-owner@resend.dev'
const EXCO_EMAIL = 'delivered+exco-owner@resend.dev'
const CLIENT_EMAIL = 'delivered+dev-client@resend.dev'

const owner = await ensureUser(OWNER_EMAIL, ownerPw, { first_name: 'Dev', last_name: 'Owner' })
const excoOwner = await ensureUser(EXCO_EMAIL, excoPw, { first_name: 'Exco', last_name: 'Owner' })
const portalUser = await ensureUser(CLIENT_EMAIL, clientPw, { first_name: 'Jordan', last_name: 'Sample' })
console.log('users: owner, exco-owner, portal client ✓')

const ownerSess = await signedInClient(OWNER_EMAIL, ownerPw)
const odysseyOrgId = await must(
  ownerSess.rpc('create_organization_with_owner', {
    p_first_name: 'Dev', p_last_name: 'Owner', p_org_name: ORG_ODYSSEY, p_timezone: SYD,
  }),
  'create Odyssey org',
)
const excoSess = await signedInClient(EXCO_EMAIL, excoPw)
const excoOrgId = await must(
  excoSess.rpc('create_organization_with_owner', {
    p_first_name: 'Exco', p_last_name: 'Owner', p_org_name: ORG_EXCO, p_timezone: SYD,
  }),
  'create EXCO org',
)
console.log(`orgs: "${ORG_ODYSSEY}" (${odysseyOrgId}), "${ORG_EXCO}" (${excoOrgId}) ✓`)

// ---- 1b. library prerequisites the bootstrap defaults don't cover -----------
// Prod's library grew organically: the operator hand-created three movement
// patterns and three tags before the library seed scripts were written, so the
// scripts' guards expect them. Mirror that state here.
{
  const pats = await must(
    svc.from('movement_patterns').select('name').eq('organization_id', odysseyOrgId).is('deleted_at', null),
    'pattern census',
  )
  const missingPats = ['Accessory', 'Movement Restoration', 'Plyometrics']
    .filter((p) => !pats.some((x) => x.name.toLowerCase() === p.toLowerCase()))
  if (missingPats.length) {
    await must(
      svc.from('movement_patterns').insert(missingPats.map((name) => ({ organization_id: odysseyOrgId, name }))),
      'extra movement patterns',
    )
  }
  for (const [orgId, tagNames] of [
    [odysseyOrgId, ['Single leg', 'Single Arm', 'Deep Tier Plyometrics', 'Reactive Plyometrics', 'Field']],
    [excoOrgId, ['Field']], // the conditioning file requires Field in BOTH orgs
  ]) {
    const tags = await must(
      svc.from('exercise_tags').select('name').eq('organization_id', orgId).is('deleted_at', null),
      'tag census',
    )
    const missing = tagNames.filter((t) => !tags.some((x) => x.name.toLowerCase() === t.toLowerCase()))
    if (missing.length) {
      await must(
        svc.from('exercise_tags').insert(missing.map((name) => ({ organization_id: orgId, name }))),
        'extra tags',
      )
    }
  }
  // One exercise the rehab file's tag block assumes pre-exists (hand-created
  // on prod before the seed scripts were written).
  const { data: curtsey } = await svc.from('exercises').select('id')
    .eq('organization_id', odysseyOrgId).ilike('name', 'Curtsey to Lateral Lunge').maybeSingle()
  if (!curtsey) {
    const { data: accessory } = await svc.from('movement_patterns').select('id')
      .eq('organization_id', odysseyOrgId).ilike('name', 'Accessory').single()
    await must(
      svc.from('exercises').insert({
        organization_id: odysseyOrgId, created_by_user_id: owner.id,
        movement_pattern_id: accessory?.id ?? null,
        name: 'Curtsey to Lateral Lunge', default_sets: 3, default_reps: '10',
      }),
      'pre-existing exercise (Curtsey to Lateral Lunge)',
    )
  }
  console.log('library prerequisites (patterns + tags + assumed exercises) ✓')
}

// ---- 2. exercise library via the existing seed scripts ----------------------
// The four UUID-scoped files hardcode the PROD Odyssey org + operator user ids;
// substitute the staging ids. The conditioning file resolves both orgs by name
// and runs unchanged. Runner: supabase db query --linked -f (repo is linked to
// staging — the whole point of the flip).
const PROD_ORG_UUID = '33d23c20-4c41-42c9-8918-ec663895ea56'
const PROD_USER_UUID = '641422e8-a927-4985-9cff-ff5e4fc2b127'
const LIB_FILES = [
  'seed-exercise-library-2026-06-24.sql',
  'seed-exercise-library-additions-2026-06-24.sql',
  'seed-exercise-library-rehab-2026-06-24.sql',
  'seed-exercise-library-tags-2026-06-24.sql',
  'tag-single-limb-exercises-orgwide-2026-06-24.sql',
  'seed-exercise-library-conditioning-2026-07-13.sql', // by-name; no substitution
]
const tmp = mkdtempSync(join(tmpdir(), 'odyssey-seed-'))
for (const f of LIB_FILES) {
  const src = readFileSync(join('scripts', f), 'utf8')
  const sub = src
    .replaceAll(PROD_ORG_UUID, odysseyOrgId)
    .replaceAll(PROD_USER_UUID, owner.id)
  const abs = join(tmp, f)
  writeFileSync(abs, sub, 'utf8')
  process.stdout.write(`library: ${f} … `)
  const out = execSync(`supabase db query --linked -f "${abs}" -o json`, {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  })
  if (/"(error|ERROR)"/.test(out) || /\bexception\b/i.test(out)) {
    console.error(`\nlibrary seed ${f} reported an error:\n${out.slice(0, 2000)}`)
    process.exit(1)
  }
  console.log('✓')
}

// ---- 3. clients -------------------------------------------------------------
const cats = await must(
  svc.from('client_categories').select('id,name').eq('organization_id', odysseyOrgId),
  'categories',
)
const cat = (n) => cats.find((c) => c.name === n)?.id ?? null

async function insertOne(table, row, label) {
  const data = await must(svc.from(table).insert(row).select().single(), label)
  return data
}

const jordan = await insertOne('clients', {
  organization_id: odysseyOrgId, first_name: 'Jordan', last_name: 'Sample',
  email: 'delivered+dev-client@resend.dev', phone: '0400 000 001', dob: '1994-03-18',
  sex: 'male', category_id: cat('Athlete'), goals: 'Return to competitive touch football; build lower-body strength.',
  referral_source: 'Word of mouth', user_id: portalUser.id,
  invited_at: daysAgoISO(30), onboarded_at: daysAgoISO(28), last_activity_at: daysAgoISO(1),
}, 'client Jordan')

const casey = await insertOne('clients', {
  organization_id: odysseyOrgId, first_name: 'Casey', last_name: 'Demo',
  email: 'delivered+casey-demo@resend.dev', phone: '0400 000 002', dob: '1987-11-02',
  sex: 'female', category_id: cat('Rehab'), goals: 'Post-ACL-reconstruction return to running.',
  invited_at: daysAgoISO(20), onboarded_at: daysAgoISO(18), last_activity_at: daysAgoISO(2),
}, 'client Casey')

const riley = await insertOne('clients', {
  organization_id: odysseyOrgId, first_name: 'Riley', last_name: 'Newby',
  email: 'delivered+riley-newby@resend.dev', phone: '0400 000 003', dob: '2001-06-25',
  category_id: cat('Lifestyle'), invited_at: daysAgoISO(1),
}, 'client Riley (new, invite pending)')

const morgan = await insertOne('clients', {
  organization_id: odysseyOrgId, first_name: 'Morgan', last_name: 'Overdue',
  email: 'delivered+morgan-overdue@resend.dev', phone: '0400 000 004', dob: '1979-01-30',
  category_id: cat('Osteoporosis'), goals: 'Bone-density maintenance; falls-risk reduction.',
  invited_at: daysAgoISO(45), onboarded_at: daysAgoISO(44), last_activity_at: daysAgoISO(12),
}, 'client Morgan (overdue)')

const avery = await insertOne('clients', {
  organization_id: odysseyOrgId, first_name: 'Avery', last_name: 'Archived',
  email: 'delivered+avery-archived@resend.dev', phone: '0400 000 005', dob: '1990-09-09',
  category_id: cat('Golf'), invited_at: daysAgoISO(60), onboarded_at: daysAgoISO(58),
  last_activity_at: daysAgoISO(30), archived_at: daysAgoISO(14),
}, 'client Avery (archived)')

await insertOne('clients', {
  organization_id: odysseyOrgId, first_name: 'Sam', last_name: 'Contact',
  email: 'delivered+sam-contact@resend.dev',
}, 'client Sam (uncategorised contact)')

await insertOne('clients', {
  organization_id: excoOrgId, first_name: 'Taylor', last_name: 'Exco',
  email: 'delivered+taylor-exco@resend.dev', invited_at: daysAgoISO(5),
}, 'client Taylor (EXCO)')

// portal client role link (what client_accept_invite would have created)
await must(
  svc.from('user_organization_roles').insert({
    user_id: portalUser.id, organization_id: odysseyOrgId, role: 'client',
  }),
  'portal client role',
)
console.log('clients: 6 Odyssey + 1 EXCO ✓')

// ---- 4. medical history + notes ---------------------------------------------
await must(svc.from('client_medical_history').insert([
  { organization_id: odysseyOrgId, client_id: jordan.id, condition: 'Left ACL reconstruction (2022)', diagnosis_date: '2022-08-15', notes: 'Hamstring graft; full clearance 2023.', show_on_header: false },
  { organization_id: odysseyOrgId, client_id: casey.id, condition: 'Right ACL reconstruction (2026)', diagnosis_date: '2026-02-10', notes: 'Patellar tendon graft. Surgeon: fictional. 12-week review complete.', show_on_header: true },
  { organization_id: odysseyOrgId, client_id: morgan.id, condition: 'Osteopenia (lumbar spine)', diagnosis_date: '2024-05-01', notes: 'T-score -1.8. GP-managed; vitamin D supplemented.', show_on_header: true },
]), 'medical history')

await must(svc.from('client_medications').insert([
  { organization_id: odysseyOrgId, client_id: morgan.id, name: 'Cholecalciferol 1000 IU', context_note: 'Daily, GP-prescribed.' },
]), 'medications')

await must(svc.from('clinical_notes').insert([
  {
    organization_id: odysseyOrgId, client_id: jordan.id, author_user_id: owner.id,
    note_type: 'initial_assessment', title: 'Initial assessment', note_date: sydDate(-28),
    subjective: 'Touch football player, 2 seasons post-ACLR, wants a structured strength block before pre-season.',
    objective: 'Single-leg squat L/R symmetrical to 60°. Hop testing 92% LSI. No effusion.',
    assessment: 'Cleared for progressive lower-limb loading. No current contraindications.',
    plan: '4-week strength block, 3 sessions/week. Reassess hop battery at week 4.',
  },
  {
    organization_id: odysseyOrgId, client_id: casey.id, author_user_id: owner.id,
    note_type: 'injury_flag', title: 'Anterior knee pain flare', note_date: sydDate(-3),
    flag_body_region: 'Right knee', flag_severity: 2,
    subjective: 'Reported 3/10 anterior knee pain after Tuesday session, settled within 24 h.',
    plan: 'Keep knee-dominant loading at RPE ≤ 7 this week; review at next session.',
  },
  {
    organization_id: odysseyOrgId, client_id: avery.id, author_user_id: owner.id,
    note_type: 'discharge', title: 'Discharge — relocated', note_date: sydDate(-14),
    plan: 'Client relocated interstate. Program closed out; records archived.',
  },
]), 'clinical notes')
console.log('history + notes ✓')

// ---- 5. programs (per-set prescriptions live in program_exercise_sets) ------
const exs = await must(
  svc.from('exercises').select('id,name').eq('organization_id', odysseyOrgId).is('deleted_at', null).order('name').limit(400),
  'exercise list',
)
const findEx = (needle) => exs.find((e) => e.name.toLowerCase().includes(needle))?.id
// robust picks with fallbacks so seed survives library content drift
const pick = (...needles) => {
  for (const n of needles) { const id = findEx(n); if (id) return id }
  return exs[Math.floor(exs.length / 2)].id
}
const EX = {
  squat: pick('back squat', 'goblet squat', 'squat'),
  hinge: pick('romanian deadlift', 'trap bar deadlift', 'deadlift', 'hinge'),
  push: pick('bench press', 'push-up', 'push up', 'overhead press'),
  pull: pick('chin-up', 'pull-up', 'seated row', 'row'),
  lunge: pick('walking lunge', 'split squat', 'lunge', 'step-up'),
  core: pick('pallof', 'plank', 'dead bug'),
  hipthrust: pick('hip thrust', 'glute bridge'),
  carry: pick("farmer", 'carry'),
}

async function buildProgram({ client, name, startOffset, weeks, daysPerWeek, status = 'active', archivedAt = null }) {
  const prog = await insertOne('programs', {
    organization_id: odysseyOrgId, client_id: client.id, name,
    status, start_date: sydDate(startOffset), duration_weeks: weeks,
    created_by_user_id: owner.id, archived_at: archivedAt,
  }, `program ${name}`)
  const dayRows = []
  const weekdayOffsets = [0, 2, 4].slice(0, daysPerWeek) // Mon/Wed/Fri pattern relative to start
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < daysPerWeek; d++) {
      dayRows.push({
        program_id: prog.id,
        day_label: `Week ${w + 1} · Day ${d + 1}`,
        scheduled_date: sydDate(startOffset + w * 7 + weekdayOffsets[d]),
        sort_order: w * daysPerWeek + d,
        // Published (= assigned to the client): the portal can see the day,
        // and a completed session against it locks the builder — the state
        // the render harness asserts.
        published_at: daysAgoISO(20),
      })
    }
  }
  const days = await must(svc.from('program_days').insert(dayRows).select(), `days ${name}`)
  days.sort((a, b) => a.sort_order - b.sort_order)

  // each day: A1/A2 superset + 2 straight lifts + core
  for (const day of days) {
    const ss = randomUUID()
    const peRows = [
      { program_day_id: day.id, exercise_id: EX.squat, section_title: 'Strength', sort_order: 0, rest_seconds: 120 },
      { program_day_id: day.id, exercise_id: EX.push, section_title: 'Strength', sort_order: 1, superset_group_id: ss },
      { program_day_id: day.id, exercise_id: EX.pull, section_title: 'Strength', sort_order: 2, superset_group_id: ss },
      { program_day_id: day.id, exercise_id: EX.hinge, section_title: 'Hypertrophy', sort_order: 3, rest_seconds: 90 },
      { program_day_id: day.id, exercise_id: EX.core, section_title: 'Recovery', sort_order: 4 },
    ]
    const pes = await must(svc.from('program_exercises').insert(peRows).select(), `exercises ${day.day_label}`)
    pes.sort((a, b) => a.sort_order - b.sort_order)
    const setRows = []
    for (const pe of pes) {
      const nSets = pe.sort_order === 4 ? 3 : 4
      for (let s = 1; s <= nSets; s++) {
        setRows.push({
          program_exercise_id: pe.id, set_number: s,
          reps: pe.sort_order === 4 ? '45' : String(10 - pe.sort_order),
          rep_metric: pe.sort_order === 4 ? 'time_minsec' : null,
        })
      }
    }
    await must(svc.from('program_exercise_sets').insert(setRows), `sets ${day.day_label}`)
  }
  return { prog, days }
}

const jp = await buildProgram({ client: jordan, name: 'Pre-season strength block', startOffset: -14, weeks: 4, daysPerWeek: 3 })
const cp = await buildProgram({ client: casey, name: 'Return-to-running bridge', startOffset: -10, weeks: 2, daysPerWeek: 3 })
const mp = await buildProgram({ client: morgan, name: 'Bone loading — phase 2', startOffset: -21, weeks: 6, daysPerWeek: 2 })
const ap = await buildProgram({ client: avery, name: 'Golf conditioning (closed)', startOffset: -56, weeks: 4, daysPerWeek: 2, status: 'archived', archivedAt: daysAgoISO(14) })
console.log('programs: 4 ✓')

// ---- 6. completed sessions with logged sets ---------------------------------
async function completeDay(client, day, agoDays, rpe) {
  const sess = await insertOne('sessions', {
    organization_id: odysseyOrgId, client_id: client.id, program_day_id: day.id,
    started_at: daysAgoISO(agoDays, 17), completed_at: daysAgoISO(agoDays, 18),
    session_rpe: rpe, feedback: 'Felt strong. Left knee fine throughout.',
  }, `session ${day.day_label}`)
  const pes = await must(
    svc.from('program_exercises').select('id,exercise_id,sort_order').eq('program_day_id', day.id).order('sort_order'),
    'pe for logs',
  )
  for (const pe of pes) {
    const log = await insertOne('exercise_logs', {
      session_id: sess.id, exercise_id: pe.exercise_id, program_exercise_id: pe.id,
      sort_order: pe.sort_order, completed_at: daysAgoISO(agoDays, 18), rpe,
    }, 'exercise log')
    const sl = []
    const nSets = pe.sort_order === 4 ? 3 : 4
    for (let s = 1; s <= nSets; s++) {
      sl.push({
        exercise_log_id: log.id, set_number: s,
        reps_performed: pe.sort_order === 4 ? 45 : 10 - pe.sort_order,
        weight_value: pe.sort_order === 4 ? null : 40 + pe.sort_order * 10 + s * 2.5,
        weight_metric: pe.sort_order === 4 ? null : 'kg',
        rpe: Math.min(10, rpe - 1 + (s % 3)), completed_at: daysAgoISO(agoDays, 18),
      })
    }
    await must(svc.from('set_logs').insert(sl), 'set logs')
  }
}

// Jordan: first 5 scheduled days completed (locks those builder days — the
// completed-and-assigned edit-lock dev surface for CN-7 step 2)
const jordanPast = jp.days.filter((d) => d.scheduled_date < sydDate(0)).slice(0, 5)
for (let i = 0; i < jordanPast.length; i++) {
  await completeDay(jordan, jordanPast[i], Math.max(1, 13 - i * 3), 7 + (i % 2))
}
// Morgan: two sessions, both ≥12 days ago (keeps the Overdue trigger honest)
const morganPast = mp.days.filter((d) => d.scheduled_date < sydDate(-11)).slice(0, 2)
for (const d of morganPast) await completeDay(morgan, d, 13, 6)
// Casey: two recent sessions
const caseyPast = cp.days.filter((d) => d.scheduled_date < sydDate(0)).slice(0, 2)
for (let i = 0; i < caseyPast.length; i++) await completeDay(casey, caseyPast[i], 6 - i * 4, 6)
console.log('completed sessions + logs ✓')

// ---- 7. scheduling ----------------------------------------------------------
for (let dow = 1; dow <= 5; dow++) {
  await must(svc.from('availability_rules').insert({
    organization_id: odysseyOrgId, staff_user_id: owner.id, recurrence: 'weekly',
    day_of_week: dow, start_time: '07:00', end_time: '17:00',
  }), `availability dow ${dow}`)
}
await must(svc.from('appointments').insert([
  { organization_id: odysseyOrgId, staff_user_id: owner.id, client_id: jordan.id, appointment_type: 'Session', kind: 'appointment', start_at: sydInstant(1, 9), end_at: sydInstant(1, 9, 45), status: 'confirmed', confirmed_at: daysAgoISO(1), location: 'Studio', created_by_role: 'staff' },
  { organization_id: odysseyOrgId, staff_user_id: owner.id, client_id: casey.id, appointment_type: 'Review', kind: 'appointment', start_at: sydInstant(2, 11), end_at: sydInstant(2, 11, 45), status: 'pending', location: 'Studio', created_by_role: 'client_portal' },
  { organization_id: odysseyOrgId, staff_user_id: owner.id, client_id: riley.id, appointment_type: 'Initial assessment', kind: 'appointment', start_at: sydInstant(4, 14), end_at: sydInstant(4, 15), status: 'confirmed', confirmed_at: daysAgoISO(0), location: 'Studio', created_by_role: 'staff' },
  { organization_id: odysseyOrgId, staff_user_id: owner.id, client_id: jordan.id, appointment_type: 'Session', kind: 'appointment', start_at: sydInstant(-7, 9), end_at: sydInstant(-7, 9, 45), status: 'completed', location: 'Studio', created_by_role: 'staff' },
  { organization_id: odysseyOrgId, staff_user_id: owner.id, client_id: null, appointment_type: 'Admin/paperwork', kind: 'unavailable', start_at: sydInstant(1, 13), end_at: sydInstant(1, 14), status: 'confirmed', confirmed_at: daysAgoISO(1), created_by_role: 'staff' },
]), 'appointments')
console.log('scheduling ✓')

// ---- 8. messaging + communications ------------------------------------------
const thread = await insertOne('message_threads', {
  organization_id: odysseyOrgId, client_id: jordan.id,
}, 'thread')
await must(svc.from('messages').insert(
  { organization_id: odysseyOrgId, thread_id: thread.id, sender_user_id: owner.id, sender_role: 'staff', body: 'Program for the next block is live — first session is Monday. Sing out if anything looks off.', read_at: daysAgoISO(2) },
), 'message 1')
await must(svc.from('messages').insert(
  { organization_id: odysseyOrgId, thread_id: thread.id, sender_user_id: portalUser.id, sender_role: 'client', body: 'Looks good. Quick one — is the tempo on the split squats 3-1-1 or 3-0-1?', read_at: daysAgoISO(1) },
), 'message 2')
await must(svc.from('messages').insert(
  { organization_id: odysseyOrgId, thread_id: thread.id, sender_user_id: portalUser.id, sender_role: 'client', body: 'Also done with today’s session — knee felt great.' },
), 'message 3 (unread)')

await must(svc.from('communications').insert({
  organization_id: odysseyOrgId, client_id: jordan.id, sender_user_id: owner.id,
  communication_type: 'email', direction: 'outbound', status: 'sent', provider: 'resend',
  subject: 'Welcome to the portal', body: 'Synthetic welcome email (seed data).',
  recipient_email: 'delivered+dev-client@resend.dev', sent_at: daysAgoISO(28),
}), 'communication log row')
console.log('messaging + communications ✓')

// ---- 9. write dev creds into .env.local -------------------------------------
{
  const marker0 = '# --- STAGING DEV LOGINS (written by scripts/seed-staging.mjs) ---'
  const marker1 = '# --- END STAGING DEV LOGINS ---'
  const block = [
    marker0,
    `STAGING_DEV_LOGIN_EMAIL=${OWNER_EMAIL}`,
    `STAGING_DEV_LOGIN_PASSWORD=${ownerPw}`,
    `STAGING_DEV_CLIENT_EMAIL=${CLIENT_EMAIL}`,
    `STAGING_DEV_CLIENT_PASSWORD=${clientPw}`,
    `STAGING_DEV_EXCO_EMAIL=${EXCO_EMAIL}`,
    `STAGING_DEV_EXCO_PASSWORD=${excoPw}`,
    marker1,
  ].join('\n')
  let raw = readFileSync('.env.local', 'utf8')
  if (raw.includes(marker0)) {
    raw = raw.replace(new RegExp(`${marker0}[\\s\\S]*?${marker1}`), block)
  } else {
    raw = raw.trimEnd() + '\n\n' + block + '\n'
  }
  writeFileSync('.env.local', raw, 'utf8')
}

// ---- census -----------------------------------------------------------------
async function count(table, orgCol = 'organization_id') {
  const { count: n } = await svc.from(table).select('*', { count: 'exact', head: true }).eq(orgCol, odysseyOrgId)
  return n
}
console.log('\n=== Seed complete (Odyssey org) ===')
for (const t of ['clients', 'exercises', 'programs', 'sessions', 'appointments', 'clinical_notes', 'client_medical_history', 'message_threads', 'messages', 'communications', 'availability_rules']) {
  console.log(`${t}: ${await count(t)}`)
}
console.log(`\nDev logins written to .env.local (STAGING_DEV_LOGIN_* / STAGING_DEV_CLIENT_* / STAGING_DEV_EXCO_*).`)
console.log('Staff login: ' + OWNER_EMAIL + '  ·  Portal login: ' + CLIENT_EMAIL)
