// Throwaway staff user for browser verification of the exercise-library
// re-audit pass (2026-06-12). Mirrors the staff-login-path-verify.mjs
// precedent: confirmed user on an RFC-reserved example.com address, 'staff'
// role (never 'owner' — last-owner invariant untouchable) in the operator
// org, HARD-DELETED via --cleanup when verification ends. The membership
// insert/delete each leave an audit_log row — acceptable pre-launch noise,
// noted deliberately (same as the precedent script).
//
// USAGE:
//   node scripts/library-verify-user.mjs            -> creates, prints creds
//   node scripts/library-verify-user.mjs --cleanup  -> deletes user + role
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const idx = l.indexOf('=')
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()]
    }),
)

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const STATE_FILE = '.library-verify-user.json'
const ORG_ID = '33d23c20-4c41-42c9-8918-ec663895ea56' // operator org (preflight 2026-06-12)

if (process.argv.includes('--cleanup')) {
  const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  const { error: roleErr } = await admin
    .from('user_organization_roles')
    .delete()
    .eq('user_id', state.userId)
  if (roleErr) console.error('role delete:', roleErr.message)
  const { error: userErr } = await admin.auth.admin.deleteUser(state.userId)
  if (userErr) console.error('user delete:', userErr.message)
  unlinkSync(STATE_FILE)
  console.log('Cleaned up throwaway verification user', state.email)
  process.exit(0)
}

const email = `lib-verify-${randomBytes(4).toString('hex')}@example.com`
const password = randomBytes(18).toString('base64url')

const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
})
if (createErr) {
  console.error('createUser failed:', createErr.message)
  process.exit(2)
}

const { error: grantErr } = await admin.from('user_organization_roles').insert({
  user_id: created.user.id,
  organization_id: ORG_ID,
  role: 'staff',
})
if (grantErr) {
  console.error('membership insert failed:', grantErr.message)
  await admin.auth.admin.deleteUser(created.user.id)
  process.exit(2)
}

writeFileSync(STATE_FILE, JSON.stringify({ userId: created.user.id, email }))
console.log(JSON.stringify({ email, password }))
