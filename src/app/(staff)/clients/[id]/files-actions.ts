'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * File-related server actions for the client profile Files tab.
 *
 * - uploadClientFileAction: receives a FormData (file + clientId + category +
 *   displayName + notes), uploads the binary to the `client-files` bucket,
 *   then inserts a metadata row in `client_files`.
 * - deleteClientFileAction: removes the row + the storage object. Hard
 *   delete; the audit_log trigger snapshots the row on DELETE so the
 *   compliance trail is preserved.
 * - getClientFileSignedUrlAction: returns a 60-second signed URL the
 *   browser can use to download / preview the file.
 *
 * Everything authenticates via the standard supabase-server client, so RLS
 * (table + storage policies) does the heavy lifting. We add explicit
 * org-scoped checks as defence-in-depth.
 *
 * IMPORTANT: until `npm run supabase:types` is re-run after this migration
 * is applied, `client_files` does not exist on the typed Database surface.
 * The two strategic `as never` casts below let the queries compile against
 * the current types; once types are regenerated they can be removed.
 */

export type FileCategory =
  | 'gpccmp'
  | 'radiology'
  | 'workers_comp'
  | 'specialist_letter'
  | 'referral'
  | 'other'

const VALID_CATEGORIES: FileCategory[] = [
  'gpccmp',
  'radiology',
  'workers_comp',
  'specialist_letter',
  'referral',
  'other',
]

const MAX_FILE_BYTES = 25 * 1024 * 1024 // 25 MB

// Block obvious dangerous executable formats. We're permissive otherwise —
// the brief calls for "any sort of file" and the bucket size cap protects
// against DoS-via-upload.
const BLOCKED_EXTENSIONS = new Set([
  'exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'ps1', 'sh', 'jar',
  'js', 'jse', 'vbs', 'vbe', 'wsf', 'wsh', 'hta', 'cpl',
  'php', 'phtml', 'jsp', 'asp', 'aspx',
])

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  if (dot < 0 || dot === filename.length - 1) return ''
  return filename.slice(dot + 1).toLowerCase()
}

function trimToMax(s: string, max: number): string {
  const t = s.trim()
  return t.length > max ? t.slice(0, max) : t
}

/* ====================== Upload ====================== */

export async function uploadClientFileAction(
  formData: FormData,
): Promise<{ error: string | null; fileId: string | null }> {
  const { userId, organizationId } = await requireRole(['owner', 'staff'])

  const file = formData.get('file')
  const clientId = formData.get('clientId')
  const categoryRaw = formData.get('category')
  const displayNameRaw = formData.get('displayName')
  const notesRaw = formData.get('notes')

  if (!(file instanceof File) || file.size === 0) {
    return { error: 'No file received.', fileId: null }
  }
  if (typeof clientId !== 'string' || clientId.length === 0) {
    return { error: 'Missing client.', fileId: null }
  }
  if (typeof categoryRaw !== 'string' || !VALID_CATEGORIES.includes(categoryRaw as FileCategory)) {
    return { error: 'Pick a valid category.', fileId: null }
  }
  const category = categoryRaw as FileCategory

  if (file.size > MAX_FILE_BYTES) {
    return {
      error: `File is too large. Max 25 MB; this one is ${(file.size / 1024 / 1024).toFixed(1)} MB.`,
      fileId: null,
    }
  }

  const ext = getExtension(file.name)
  if (ext && BLOCKED_EXTENSIONS.has(ext)) {
    return { error: `.${ext} files aren't supported here.`, fileId: null }
  }

  const displayName = trimToMax(
    typeof displayNameRaw === 'string' && displayNameRaw.trim().length > 0
      ? displayNameRaw
      : file.name.replace(/\.[^.]+$/, ''),
    200,
  )
  if (displayName.length === 0) {
    return { error: 'Give the file a name.', fileId: null }
  }

  const notes =
    typeof notesRaw === 'string' && notesRaw.trim().length > 0
      ? trimToMax(notesRaw, 2000)
      : null

  const supabase = await createSupabaseServerClient()

  // Confirm the client belongs to this org. RLS would already block a
  // mismatched insert, but a clear error message > a generic RLS denial.
  const { data: target, error: clientErr } = await supabase
    .from('clients')
    .select('id, organization_id')
    .eq('id', clientId)
    .is('deleted_at', null)
    .maybeSingle()

  if (clientErr) {
    return { error: `Could not load client: ${clientErr.message}`, fileId: null }
  }
  if (!target || target.organization_id !== organizationId) {
    return { error: 'Client not found in your practice.', fileId: null }
  }

  const fileId = crypto.randomUUID()
  const extSuffix = ext ? `.${ext}` : ''
  const storagePath = `${organizationId}/${clientId}/${fileId}${extSuffix}`

  const { error: uploadError } = await supabase.storage
    .from('client-files')
    .upload(storagePath, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })

  if (uploadError) {
    return { error: `Upload failed: ${uploadError.message}`, fileId: null }
  }

  const { error: insertError } = await supabase
    // Cast avoids a type error until `npm run supabase:types` regenerates
    // the Database type after this migration is applied. Remove cast then.
    .from('client_files' as never)
    .insert({
      id: fileId,
      organization_id: organizationId,
      client_id: clientId,
      uploaded_by_user_id: userId,
      category,
      name: displayName,
      original_filename: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
      storage_bucket: 'client-files',
      storage_path: storagePath,
      notes,
    } as never)

  if (insertError) {
    // Roll back the storage upload so we don't leave an orphan blob.
    await supabase.storage.from('client-files').remove([storagePath])
    return { error: `Could not save file: ${insertError.message}`, fileId: null }
  }

  revalidatePath(`/clients/${clientId}`)
  return { error: null, fileId }
}

/* ====================== Delete ====================== */

export async function deleteClientFileAction(
  fileId: string,
): Promise<{ error: string | null }> {
  const { organizationId } = await requireRole(['owner', 'staff'])

  const supabase = await createSupabaseServerClient()

  // Look up the row first so we have the storage_path + can verify org.
  const { data: row, error: lookupErr } = await supabase
    // Same temporary cast as the insert above.
    .from('client_files' as never)
    .select('id, organization_id, client_id, storage_bucket, storage_path')
    .eq('id', fileId)
    .maybeSingle<{
      id: string
      organization_id: string
      client_id: string
      storage_bucket: string
      storage_path: string
    }>()

  if (lookupErr) return { error: `Could not find file: ${lookupErr.message}` }
  if (!row) return { error: 'File not found.' }
  if (row.organization_id !== organizationId) {
    return { error: 'Not authorised to delete this file.' }
  }

  // Delete the row first. If we deleted the object first and the row delete
  // failed, we'd have an unreferenceable row pointing at a missing object.
  const { error: deleteErr } = await supabase
    .from('client_files' as never)
    .delete()
    .eq('id', fileId)

  if (deleteErr) {
    return { error: `Could not delete file: ${deleteErr.message}` }
  }

  // Remove the binary. If this fails we surface a warning but the row is
  // already gone, so the user sees the file disappear from the list and
  // we leak storage rather than confuse them with a half-finished delete.
  const { error: storageErr } = await supabase.storage
    .from(row.storage_bucket)
    .remove([row.storage_path])

  if (storageErr) {
    console.warn(
      `[client_files] row deleted but storage object lingered: ${row.storage_path} — ${storageErr.message}`,
    )
  }

  revalidatePath(`/clients/${row.client_id}`)
  return { error: null }
}

/* ====================== Download (signed URL) ====================== */

export async function getClientFileSignedUrlAction(
  fileId: string,
): Promise<{ error: string | null; url: string | null }> {
  const { organizationId } = await requireRole(['owner', 'staff'])

  const supabase = await createSupabaseServerClient()

  const { data: row, error: lookupErr } = await supabase
    .from('client_files' as never)
    .select('id, organization_id, storage_bucket, storage_path, original_filename')
    .eq('id', fileId)
    .maybeSingle<{
      id: string
      organization_id: string
      storage_bucket: string
      storage_path: string
      original_filename: string
    }>()

  if (lookupErr) return { error: `Could not find file: ${lookupErr.message}`, url: null }
  if (!row) return { error: 'File not found.', url: null }
  if (row.organization_id !== organizationId) {
    return { error: 'Not authorised to view this file.', url: null }
  }

  const { data, error } = await supabase.storage
    .from(row.storage_bucket)
    .createSignedUrl(row.storage_path, 60, {
      download: row.original_filename,
    })

  if (error || !data) {
    return {
      error: `Could not generate download link: ${error?.message ?? 'unknown'}`,
      url: null,
    }
  }
  return { error: null, url: data.signedUrl }
}
