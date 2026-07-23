import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * FM-8 reviewer blocking item 1 (2026-07-23): verify that a STAFF session can
 * retrieve the actual attachment BYTES on an ARCHIVED client's thread — not
 * just see a metadata row. The two authorising surfaces are separate from the
 * message_threads SELECT policy the FM-8 migration added:
 *
 *   - message_attachments staff SELECT (20260713130000): org + role only,
 *     no thread-liveness predicate
 *   - storage.objects "staff read message-attachments in own org": bucket +
 *     org folder + role only, no thread join
 *
 * This probe proves it end-to-end on STAGING (target resolved from the
 * .env.local default keys; hard-refuses any other project — same gate as
 * e2e/helpers.ts):
 *
 *   1. service role: on the seeded archived client's (Avery) archived
 *      thread, upload a known blob + insert an attachment-bearing message
 *      and its message_attachments row
 *   2. STAFF authed session (STAGING_DEV_LOGIN_*): SELECT the attachment
 *      row under RLS, mint a signed URL for the blob (storage RLS is the
 *      authorisation), fetch the URL, byte-compare
 *   3. teardown (service role): attachment row -> message row -> blob
 *
 * Run:  node scripts/verify-archived-attachment-retrieval.mjs
 */

function loadEnv() {
  const out = {}
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
      'Probe refused: .env.local default keys do not resolve to the staging project.',
    )
  }
  if (!out.STAGING_DEV_LOGIN_EMAIL || !out.STAGING_DEV_LOGIN_PASSWORD) {
    throw new Error('Probe refused: STAGING_DEV_LOGIN_* missing — seed staging first.')
  }
  return out
}

const env = loadEnv()
console.log(
  `[target] STAGING project ${env.STAGING_PROJECT_REF} (resolved from .env.local default keys)`,
)

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`  ok - ${name}`)
  } else {
    fail++
    console.log(`  FAIL - ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

// --- fixture (service role) -------------------------------------------------
const { data: avery } = await admin
  .from('clients')
  .select('id, organization_id, deleted_at')
  .eq('email', 'delivered+avery-archived@resend.dev')
  .maybeSingle()
if (!avery) throw new Error('Seeded archived client (Avery) not found — reseed staging.')
if (!avery.deleted_at) throw new Error('Avery is not archived — reseed staging.')

let { data: thread } = await admin
  .from('message_threads')
  .select('id, deleted_at')
  .eq('client_id', avery.id)
  .maybeSingle()
if (!thread) {
  const { data: created, error } = await admin
    .from('message_threads')
    .insert({
      organization_id: avery.organization_id,
      client_id: avery.id,
      deleted_at: new Date().toISOString(),
    })
    .select('id, deleted_at')
    .single()
  if (error) throw new Error(`fixture thread: ${error.message}`)
  thread = created
}
if (!thread.deleted_at) throw new Error('Avery thread is not archived — unexpected state.')

const attachmentId = randomUUID()
const storagePath = `${avery.organization_id}/${thread.id}/${attachmentId}.txt`
const blobBytes = Buffer.from(
  `archived-attachment retrieval probe ${attachmentId} — synthetic, torn down by the script`,
  'utf8',
)

const { error: upErr } = await admin.storage
  .from('message-attachments')
  .upload(storagePath, blobBytes, { contentType: 'text/plain' })
if (upErr) throw new Error(`fixture blob upload: ${upErr.message}`)

const { data: userList } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
const devStaff = userList?.users?.find((u) => u.email === env.STAGING_DEV_LOGIN_EMAIL)
if (!devStaff) throw new Error('STAGING_DEV_LOGIN user not found — reseed staging.')

const { data: msg, error: msgErr } = await admin
  .from('messages')
  .insert({
    thread_id: thread.id,
    organization_id: avery.organization_id,
    sender_user_id: devStaff.id,
    sender_role: 'staff',
    body: 'Probe: attachment-bearing message (synthetic, torn down).',
    has_attachments: true,
  })
  .select('id')
  .single()

let attRowId = null
try {
  if (msgErr) throw new Error(`fixture message: ${msgErr.message}`)

  const { data: attRow, error: attErr } = await admin
    .from('message_attachments')
    .insert({
      id: attachmentId,
      message_id: msg.id,
      thread_id: thread.id,
      organization_id: avery.organization_id,
      storage_path: storagePath,
      file_name: 'probe.txt',
      mime_type: 'text/plain',
      byte_size: blobBytes.length,
      kind: 'file',
    })
    .select('id')
    .single()
  if (attErr) throw new Error(`fixture attachment row: ${attErr.message}`)
  attRowId = attRow.id

  // --- the probe: a real STAFF session under RLS ----------------------------
  const staff = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  )
  const { error: signInErr } = await staff.auth.signInWithPassword({
    email: env.STAGING_DEV_LOGIN_EMAIL,
    password: env.STAGING_DEV_LOGIN_PASSWORD,
  })
  if (signInErr) throw new Error(`staff sign-in: ${signInErr.message}`)

  const { data: visible, error: selErr } = await staff
    .from('message_attachments')
    .select('id, storage_path, file_name')
    .eq('id', attachmentId)
    .maybeSingle()
  check(
    'staff SELECT sees the archived-thread attachment row (RLS)',
    !selErr && visible?.id === attachmentId,
    selErr?.message ?? 'row not visible',
  )

  const { data: signed, error: signErr } = await staff.storage
    .from('message-attachments')
    .createSignedUrl(storagePath, 60, { download: 'probe.txt' })
  check(
    'staff session mints a signed URL for the blob (storage RLS)',
    !signErr && !!signed?.signedUrl,
    signErr?.message ?? 'no url',
  )

  if (signed?.signedUrl) {
    const res = await fetch(signed.signedUrl)
    const body = Buffer.from(await res.arrayBuffer())
    check(
      'signed URL serves the exact bytes back (retrieval proven)',
      res.ok && body.equals(blobBytes),
      `status ${res.status}, ${body.length} bytes`,
    )
  } else {
    check('signed URL serves the exact bytes back (retrieval proven)', false, 'no url to fetch')
  }

  await staff.auth.signOut()
} finally {
  // --- teardown (service role): attachment row -> message -> blob -----------
  if (attRowId) {
    const { error } = await admin.from('message_attachments').delete().eq('id', attRowId)
    if (error) console.log(`  WARN teardown attachment row: ${error.message}`)
  }
  if (msg?.id) {
    const { error } = await admin.from('messages').delete().eq('id', msg.id)
    if (error) console.log(`  WARN teardown message: ${error.message}`)
  }
  const { error: rmErr } = await admin.storage
    .from('message-attachments')
    .remove([storagePath])
  if (rmErr) console.log(`  WARN teardown blob: ${rmErr.message}`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
