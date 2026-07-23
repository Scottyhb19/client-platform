import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Shared harness plumbing. Reads .env.local (the staging-default file) and
 * refuses to run against anything but the staging project — the harness
 * writes nothing itself, but the refusal keeps a misconfigured machine from
 * even probing production.
 */
export function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  const raw = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
  for (const line of raw.split('\n')) {
    const l = line.trim()
    if (!l || l.startsWith('#') || !l.includes('=')) continue
    const i = l.indexOf('=')
    out[l.slice(0, i).trim()] = l.slice(i + 1).trim()
  }
  const stagingRef = out.STAGING_PROJECT_REF
  if (!stagingRef || !out.NEXT_PUBLIC_SUPABASE_URL?.includes(stagingRef)) {
    throw new Error(
      'Harness refused: .env.local default keys do not resolve to the staging project.',
    )
  }
  if (!out.STAGING_DEV_LOGIN_EMAIL || !out.STAGING_DEV_LOGIN_PASSWORD) {
    throw new Error(
      'Harness refused: STAGING_DEV_LOGIN_* missing — run `node scripts/seed-staging.mjs` first.',
    )
  }
  return out
}

/** Service-role staging client for fixture lookups (read-only usage). */
export function stagingAdmin() {
  const env = loadEnv()
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

/**
 * 2026-07-23 parity-pass fixtures. These are CREATE-IF-ABSENT synthetic rows
 * on the (synthetic-only) staging seed — an amendment to the original
 * "harness writes nothing" posture, confined to this module: fixtures are
 * idempotent, use @resend.dev sink addresses, and are recreated by the next
 * run after any seed --wipe. Passwords are minted fresh per run via the
 * admin API — nothing secret is stored.
 */
function randomPassword(): string {
  return `E2e!${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}Xy7`
}

async function ensureUser(email: string): Promise<{ id: string; password: string }> {
  const admin = stagingAdmin()
  const password = randomPassword()
  const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  const existing = users?.users?.find((u) => u.email === email)
  if (existing) {
    await admin.auth.admin.updateUserById(existing.id, { password })
    return { id: existing.id, password }
  }
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error || !created?.user) throw new Error(`fixture user ${email}: ${error?.message}`)
  return { id: created.user.id, password }
}

/**
 * G-15 negative control: an auth user with NO membership/claims at all.
 * Caller should deleteUser() it in a finally — with no clients row it
 * deletes cleanly.
 */
export async function createClaimlessUser(): Promise<{
  id: string
  email: string
  password: string
}> {
  const email = `claimless-e2e+${Date.now()}@resend.dev`
  const u = await ensureUser(email)
  return { ...u, email }
}

export async function deleteAuthUser(id: string): Promise<void> {
  const admin = stagingAdmin()
  await admin.auth.admin.deleteUser(id)
}

/**
 * P2-3 fixture: a standing synthetic ARCHIVED client with a portal login.
 * Left in place between runs on purpose — deleting an archived clients row
 * is DB-refused by design (CN-7 guard), and a standing archived synthetic
 * client is exactly what the closed-door screen needs to render against.
 */
export async function ensureArchivedPortalUser(): Promise<{
  email: string
  password: string
}> {
  const admin = stagingAdmin()
  const email = 'delivered+archived-portal-e2e@resend.dev'
  const u = await ensureUser(email)

  const { data: existing } = await admin
    .from('clients')
    .select('id, deleted_at, user_id')
    .eq('email', email)
    .maybeSingle()

  const { data: anchor } = await admin
    .from('clients')
    .select('organization_id')
    .eq('email', 'delivered+dev-client@resend.dev')
    .single()

  // Membership survives a real archive — the JWT hook reads it for the role
  // claim, so the fixture needs it too or the login lands on /onboarding/org
  // instead of the portal. Upserted every run (self-heals partial fixtures).
  const { error: roleErr } = await admin
    .from('user_organization_roles')
    .upsert(
      {
        user_id: u.id,
        organization_id: anchor!.organization_id,
        role: 'client',
      },
      { onConflict: 'user_id,organization_id' },
    )
  if (roleErr) throw new Error(`fixture membership: ${roleErr.message}`)

  if (!existing) {
    const { data: inserted, error: insErr } = await admin
      .from('clients')
      .insert({
        organization_id: anchor!.organization_id,
        user_id: u.id,
        first_name: 'Archie',
        last_name: 'Portal-E2E',
        email,
      })
      .select('id')
      .single()
    if (insErr) throw new Error(`fixture clients insert: ${insErr.message}`)
    // Archive transition (OLD.deleted_at IS NULL) — permitted by the guard.
    const { error: archErr } = await admin
      .from('clients')
      .update({
        deleted_at: new Date().toISOString(),
        archived_at: new Date().toISOString(),
      })
      .eq('id', inserted!.id)
    if (archErr) throw new Error(`fixture archive: ${archErr.message}`)
  } else if (!existing.user_id) {
    throw new Error(
      'fixture drift: archived-portal-e2e clients row exists without user_id — reseed staging',
    )
  }
  return { email, password: u.password }
}

/**
 * FM-8 fixture: ensure the seeded ARCHIVED client (Avery) has an archived
 * thread carrying at least one message, so the Comms tab's in-app history
 * section has something to render.
 */
export async function ensureArchivedThreadFixture(averyId: string): Promise<string> {
  const admin = stagingAdmin()
  const env = loadEnv()

  let { data: thread } = await admin
    .from('message_threads')
    .select('id, deleted_at')
    .eq('client_id', averyId)
    .maybeSingle()

  if (!thread) {
    const { data: avery } = await admin
      .from('clients')
      .select('organization_id')
      .eq('id', averyId)
      .single()
    const { data: created, error } = await admin
      .from('message_threads')
      .insert({
        organization_id: avery!.organization_id,
        client_id: averyId,
        deleted_at: new Date().toISOString(),
      })
      .select('id, deleted_at')
      .single()
    if (error) throw new Error(`fixture thread: ${error.message}`)
    thread = created
  } else if (!thread.deleted_at) {
    await admin
      .from('message_threads')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', thread.id)
  }

  const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  const owner = users!.users.find((x) => x.email === env.STAGING_DEV_LOGIN_EMAIL)!
  const { data: threadRow } = await admin
    .from('message_threads')
    .select('organization_id')
    .eq('id', thread!.id)
    .single()

  const { count } = await admin
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('thread_id', thread!.id)
  if (!count) {
    const { error } = await admin.from('messages').insert([
      {
        thread_id: thread!.id,
        organization_id: threadRow!.organization_id,
        sender_user_id: owner.id,
        sender_role: 'staff',
        body: 'Pre-archive check-in — how was the last block? (seed fixture)',
      },
    ])
    if (error) throw new Error(`fixture message: ${error.message}`)
  }

  // FM-8 reviewer follow-up (2026-07-23): the transcript must PRODUCE
  // attachments, not just count them — so the standing fixture carries one
  // attachment-bearing message with a real blob (create-if-absent, same
  // amended posture as the rest of this module).
  const { count: attCount } = await admin
    .from('message_attachments')
    .select('id', { count: 'exact', head: true })
    .eq('thread_id', thread!.id)
  if (!attCount) {
    const attachmentId = crypto.randomUUID()
    const storagePath = `${threadRow!.organization_id}/${thread!.id}/${attachmentId}.txt`
    const bytes = new TextEncoder().encode(
      'Synthetic archived-thread attachment (e2e seed fixture).',
    )
    const { error: upErr } = await admin.storage
      .from('message-attachments')
      .upload(storagePath, bytes, { contentType: 'text/plain', upsert: true })
    if (upErr) throw new Error(`fixture blob: ${upErr.message}`)

    const { data: attMsg, error: msgErr } = await admin
      .from('messages')
      .insert({
        thread_id: thread!.id,
        organization_id: threadRow!.organization_id,
        sender_user_id: owner.id,
        sender_role: 'staff',
        body: 'Exercise notes attached. (seed fixture)',
        has_attachments: true,
      })
      .select('id')
      .single()
    if (msgErr) throw new Error(`fixture attachment message: ${msgErr.message}`)

    const { error: attErr } = await admin.from('message_attachments').insert({
      id: attachmentId,
      message_id: attMsg!.id,
      thread_id: thread!.id,
      organization_id: threadRow!.organization_id,
      storage_path: storagePath,
      file_name: 'exercise-notes.txt',
      mime_type: 'text/plain',
      byte_size: bytes.length,
      kind: 'file',
    })
    if (attErr) throw new Error(`fixture attachment row: ${attErr.message}`)
  }
  return thread!.id
}
