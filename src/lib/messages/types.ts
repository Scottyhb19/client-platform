/**
 * Convenience types for the messaging tables.
 *
 * Row shapes are aliased from the generated database types so they stay in
 * sync automatically — re-running `npm run supabase:types` propagates any
 * column change here. The constants and the SenderRole literal type live
 * here because they're domain-level values not derivable from the schema.
 */

import type { Database } from '@/types/database'

export type SenderRole = 'staff' | 'client'

export type MessageThreadRow = Database['public']['Tables']['message_threads']['Row']
export type MessageRow = Database['public']['Tables']['messages']['Row']
export type MessageAttachmentRow =
  Database['public']['Tables']['message_attachments']['Row']

/**
 * Attachment metadata plus a short-lived signed URL for rendering. Minted
 * server-side (the bucket is private); `url` is set for kind='image' so the
 * bubble can render an <img> immediately — kind='file' chips request a
 * download URL on click instead, so the link carries the original filename.
 */
export type AttachmentView = {
  id: string
  messageId: string
  fileName: string
  mimeType: string
  byteSize: number
  kind: 'image' | 'file'
  url: string | null
}

export const MESSAGE_BODY_MAX = 1000

/** Contract §1/§6 (docs/polish/messaging-attachments.md): caps mirrored in
 * the send RPC's guards — client-side checks are UX, the RPC is the law. */
export const MESSAGE_ATTACHMENTS_MAX = 4
export const CLIENT_PHOTO_MAX_BYTES = 10 * 1024 * 1024
export const STAFF_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024

/** Image mimes a client may attach (RPC allow-list; SVG deliberately absent). */
export const CLIENT_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
] as const

/**
 * Executable formats blocked for staff attachments — mirrors the
 * client-files blocklist; the send RPC re-checks the same list server-side.
 */
export const STAFF_BLOCKED_EXTENSIONS = new Set([
  'exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'ps1', 'sh', 'jar',
  'js', 'jse', 'vbs', 'vbe', 'wsf', 'wsh', 'hta', 'cpl',
  'php', 'phtml', 'jsp', 'asp', 'aspx',
])
