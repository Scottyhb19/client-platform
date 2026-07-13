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

/** Raster-image Content-Type claims we can verify by magic number. */
const RASTER_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
])

/**
 * Defense-in-depth against the mime-spoof the reviewer flagged (SVG/HTML bytes
 * declared as image/png): if a file CLAIMS a raster image type, verify its
 * leading bytes actually match that family before we upload it. This is not
 * the security boundary — the storage mimetype is caller-controlled and the
 * RPC can't read blob bytes, so the real guarantee is <img>-only rendering
 * (MessageAttachments) — but it stops the honest/accidental path and any
 * attacker who isn't hand-crafting the storage call, with an honest error
 * rather than a silently-mislabelled blob. Files that don't claim a raster
 * type (e.g. a legitimate .svg or .pdf staff attachment) are left alone;
 * the RPC classifies non-raster images as kind='file' (download, never inline).
 */
async function declaredRasterTypeMatchesBytes(file: File): Promise<boolean> {
  if (!RASTER_IMAGE_TYPES.has(file.type)) return true // not a raster claim — not our check
  const buf = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  const b = (i: number) => buf[i]
  // JPEG FF D8 FF
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return file.type === 'image/jpeg'
  // PNG 89 50 4E 47 0D 0A 1A 0A
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return file.type === 'image/png'
  // GIF 47 49 46 38
  if (b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x38) return file.type === 'image/gif'
  // WEBP: RIFF....WEBP
  if (b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 &&
      b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50) return file.type === 'image/webp'
  // HEIC/HEIF: 'ftyp' box at bytes 4-7, brand at 8-11
  if (b(4) === 0x66 && b(5) === 0x74 && b(6) === 0x79 && b(7) === 0x70) {
    return file.type === 'image/heic' || file.type === 'image/heif'
  }
  return false // claims a raster type its bytes don't match — reject
}

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
    if (!(await declaredRasterTypeMatchesBytes(file))) {
      await removeUploadedAttachments(uploaded)
      return {
        uploaded: null,
        error: `${file.name || 'That file'} doesn't look like the image it claims to be.`,
      }
    }
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
