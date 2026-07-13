import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { AttachmentView } from '@/lib/messages/types'

/**
 * Server-side loader for attachment views. RLS on message_attachments scopes
 * what the caller can see (staff: own org; client: own thread), so this is
 * safe to call with either role's authed client — no extra guards here.
 *
 * Signed URLs are minted only for kind='image' (they feed <img> src directly;
 * 1 hour keeps a scrolled-back thread rendering without re-fetch churn).
 * kind='file' chips request a download URL on click so the link can carry
 * the original filename via the `download` disposition.
 */
export async function loadAttachmentViews(
  supabase: SupabaseClient<Database>,
  filter: { threadId: string } | { messageId: string },
): Promise<Record<string, AttachmentView[]>> {
  let query = supabase
    .from('message_attachments')
    .select('id, message_id, storage_path, file_name, mime_type, byte_size, kind')
    .order('created_at', { ascending: true })

  query =
    'threadId' in filter
      ? query.eq('thread_id', filter.threadId)
      : query.eq('message_id', filter.messageId)

  const { data: rows } = await query
  if (!rows || rows.length === 0) return {}

  const imagePaths = rows.filter((r) => r.kind === 'image').map((r) => r.storage_path)
  const urlByPath = new Map<string, string>()
  if (imagePaths.length > 0) {
    const { data: signed } = await supabase.storage
      .from('message-attachments')
      .createSignedUrls(imagePaths, 3600)
    for (const s of signed ?? []) {
      if (s.signedUrl && s.path) urlByPath.set(s.path, s.signedUrl)
    }
  }

  const byMessage: Record<string, AttachmentView[]> = {}
  for (const r of rows) {
    const view: AttachmentView = {
      id: r.id,
      messageId: r.message_id,
      fileName: r.file_name,
      mimeType: r.mime_type,
      byteSize: r.byte_size,
      kind: r.kind === 'image' ? 'image' : 'file',
      url: urlByPath.get(r.storage_path) ?? null,
    }
    ;(byMessage[r.message_id] ??= []).push(view)
  }
  return byMessage
}

/**
 * Mint a 60-second download URL for one attachment. The message_attachments
 * SELECT (RLS) is the authorisation — if the caller can't see the row, there
 * is nothing to sign.
 */
export async function signAttachmentDownload(
  supabase: SupabaseClient<Database>,
  attachmentId: string,
): Promise<{ url: string | null; error: string | null }> {
  const { data: row, error: lookupErr } = await supabase
    .from('message_attachments')
    .select('storage_path, file_name')
    .eq('id', attachmentId)
    .maybeSingle()

  if (lookupErr) return { url: null, error: lookupErr.message }
  if (!row) return { url: null, error: 'Attachment not found.' }

  const { data, error } = await supabase.storage
    .from('message-attachments')
    .createSignedUrl(row.storage_path, 60, { download: row.file_name })

  if (error || !data) {
    return { url: null, error: error?.message ?? 'Could not generate link.' }
  }
  return { url: data.signedUrl, error: null }
}
