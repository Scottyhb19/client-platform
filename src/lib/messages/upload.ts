'use client'

/**
 * Browser-side upload for message attachments.
 *
 * Blobs go DIRECT from the browser to the `message-attachments` bucket via
 * the supabase browser client — never through a server action. Two reasons:
 * the Next.js server-action body limit (1 MB default) would reject phone
 * photos, and the storage write policies are the security boundary anyway
 * (the first client-role storage writes in the platform — a client can only
 * write image-extension paths under their own thread folder). The subsequent
 * send action passes only the paths; the send RPC then verifies each blob
 * (existence, uploader, authoritative mimetype, size) before any message row
 * references it.
 *
 * Path convention: {organization_id}/{thread_id}/{uuid}.{ext} — the ext is
 * derived here (mime-first for images), so the storage policy's extension
 * check is satisfied by construction for legitimate uploads.
 */

import { createSupabaseBrowserClient } from '@/lib/supabase/client'

const IMAGE_MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
}

function extensionFor(file: File): string {
  const byMime = IMAGE_MIME_TO_EXT[file.type]
  if (byMime) return byMime
  const dot = file.name.lastIndexOf('.')
  if (dot > 0 && dot < file.name.length - 1) {
    return file.name.slice(dot + 1).toLowerCase()
  }
  return ''
}

export type UploadedAttachment = { storagePath: string; fileName: string }

/**
 * Upload files to the thread's folder. All-or-nothing: if any upload fails,
 * the ones that already landed are removed (the uploader-orphan DELETE
 * policy exists exactly for this) and an error is returned.
 */
export async function uploadMessageAttachments(opts: {
  organizationId: string
  threadId: string
  files: File[]
}): Promise<{ uploaded: UploadedAttachment[] | null; error: string | null }> {
  const supabase = createSupabaseBrowserClient()
  const uploaded: UploadedAttachment[] = []

  for (const file of opts.files) {
    const ext = extensionFor(file)
    const storagePath = `${opts.organizationId}/${opts.threadId}/${crypto.randomUUID()}${ext ? `.${ext}` : ''}`

    const { error } = await supabase.storage
      .from('message-attachments')
      .upload(storagePath, file, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      })

    if (error) {
      await removeUploadedAttachments(uploaded)
      return { uploaded: null, error: `Upload failed: ${error.message}` }
    }
    uploaded.push({ storagePath, fileName: file.name || 'attachment' })
  }

  return { uploaded, error: null }
}

/**
 * Best-effort rollback of blobs whose send failed. Allowed by the
 * uploader-and-orphan-only storage DELETE policy; once a message references
 * a blob it is undeletable, so this can only ever remove true orphans.
 */
export async function removeUploadedAttachments(
  uploaded: UploadedAttachment[],
): Promise<void> {
  if (uploaded.length === 0) return
  const supabase = createSupabaseBrowserClient()
  try {
    await supabase.storage
      .from('message-attachments')
      .remove(uploaded.map((u) => u.storagePath))
  } catch {
    // Orphan sweep (runbook) catches anything left behind.
  }
}
