'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require-role'
import { assertClientLive } from '@/lib/clients/archive-guard'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  MESSAGE_ATTACHMENTS_MAX,
  MESSAGE_BODY_MAX,
  type AttachmentView,
  type MessageRow,
} from '@/lib/messages/types'
import {
  loadAttachmentViews,
  signAttachmentDownload,
} from '@/lib/messages/attachments-server'

type Result<T = null> = { data: T | null; error: string | null }

/**
 * Find or lazily create a thread for a given client. Returns the thread id.
 * Lazy-create keeps the DB tidy: clients without conversations don't get
 * orphan threads, and the EP doesn't have to "open" a thread before sending.
 */
export async function getOrCreateThreadAction(
  clientId: string,
): Promise<Result<{ threadId: string }>> {
  const { organizationId } = await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  // CN-7 (P1-4): archived clients are read-only — no new conversations.
  // (Their existing thread is archived in lockstep by the cascade trigger,
  // so without this guard the lookup below would miss it and INSERT a
  // duplicate live thread for an archived client.)
  const live = await assertClientLive(supabase, clientId)
  if (live.error) return { data: null, error: live.error }

  const existing = await supabase
    .from('message_threads')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('client_id', clientId)
    .is('deleted_at', null)
    .maybeSingle()

  if (existing.error) return { data: null, error: existing.error.message }
  if (existing.data) {
    return { data: { threadId: existing.data.id }, error: null }
  }

  const inserted = await supabase
    .from('message_threads')
    .insert({ organization_id: organizationId, client_id: clientId })
    .select('id')
    .single()

  if (inserted.error) return { data: null, error: inserted.error.message }
  return { data: { threadId: inserted.data.id }, error: null }
}

/**
 * Send a staff→client message in a thread. Lazily creates the thread when
 * the caller passed a clientId rather than a threadId.
 */
export async function sendStaffMessageAction(
  args: { threadId?: string; clientId?: string; body: string },
): Promise<Result<{ threadId: string; messageId: string }>> {
  const { userId, organizationId } = await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const body = args.body.trim()
  if (!body) return { data: null, error: 'Message cannot be empty.' }
  if (body.length > MESSAGE_BODY_MAX) {
    return {
      data: null,
      error: `Message is ${body.length} characters; cap is ${MESSAGE_BODY_MAX}.`,
    }
  }

  let threadId = args.threadId
  if (!threadId) {
    if (!args.clientId) {
      return { data: null, error: 'Either threadId or clientId is required.' }
    }
    const ensured = await getOrCreateThreadAction(args.clientId)
    if (ensured.error || !ensured.data) {
      return { data: null, error: ensured.error ?? 'Could not open thread.' }
    }
    threadId = ensured.data.threadId
  }

  const inserted = await supabase
    .from('messages')
    .insert({
      thread_id: threadId,
      organization_id: organizationId,
      sender_user_id: userId,
      sender_role: 'staff',
      body,
    })
    .select('id')
    .single()

  if (inserted.error) return { data: null, error: inserted.error.message }

  revalidatePath('/messages')
  return {
    data: { threadId, messageId: inserted.data.id },
    error: null,
  }
}

/**
 * Send a staff→client message carrying attachments. The blobs are already in
 * the message-attachments bucket (uploaded browser-side under the storage
 * write policies); this passes the paths to the send_message_with_attachments
 * definer RPC, which verifies each blob (existence, uploader, authoritative
 * mimetype, size, extension blocklist) before inserting the message + rows
 * atomically. On RPC failure the browser removes the orphan blobs.
 */
export async function sendStaffMessageWithAttachmentsAction(args: {
  threadId: string
  body: string
  attachments: { storagePath: string; fileName: string }[]
}): Promise<Result<{ message: MessageRow; attachments: AttachmentView[] }>> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const body = args.body.trim()
  if (body.length > MESSAGE_BODY_MAX) {
    return {
      data: null,
      error: `Message is ${body.length} characters; cap is ${MESSAGE_BODY_MAX}.`,
    }
  }
  if (args.attachments.length < 1 || args.attachments.length > MESSAGE_ATTACHMENTS_MAX) {
    return {
      data: null,
      error: `Between 1 and ${MESSAGE_ATTACHMENTS_MAX} attachments per message.`,
    }
  }

  // RETURNS messages (single composite) — PostgREST hands back one object,
  // so no .single() (it would re-type the result as never).
  const { data: message, error } = await supabase.rpc(
    'send_message_with_attachments',
    {
      p_thread_id: args.threadId,
      p_body: body,
      p_attachments: args.attachments.map((a) => ({
        storage_path: a.storagePath,
        file_name: a.fileName,
      })),
    },
  )

  if (error || !message) {
    return { data: null, error: error?.message ?? 'Send failed.' }
  }

  const views = await loadAttachmentViews(supabase, { messageId: message.id })

  revalidatePath('/messages')
  return {
    data: { message, attachments: views[message.id] ?? [] },
    error: null,
  }
}

/**
 * Attachment views (metadata + signed image URLs) for one message — used by
 * the realtime INSERT handler when a message arrives with has_attachments.
 */
export async function getStaffAttachmentViewsAction(
  messageId: string,
): Promise<Result<AttachmentView[]>> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()
  const views = await loadAttachmentViews(supabase, { messageId })
  return { data: views[messageId] ?? [], error: null }
}

/** 60-second download URL for a file attachment chip. */
export async function getStaffAttachmentDownloadUrlAction(
  attachmentId: string,
): Promise<Result<{ url: string }>> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()
  const { url, error } = await signAttachmentDownload(supabase, attachmentId)
  if (error || !url) return { data: null, error: error ?? 'Could not generate link.' }
  return { data: { url }, error: null }
}

/**
 * Mark all unread client→staff messages in a thread as read by stamping
 * read_at = now(). Idempotent — only touches rows where read_at IS NULL.
 */
export async function markThreadReadAction(
  threadId: string,
): Promise<Result> {
  const { organizationId } = await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('thread_id', threadId)
    .eq('organization_id', organizationId)
    .eq('sender_role', 'client')
    .is('read_at', null)

  if (error) return { data: null, error: error.message }

  revalidatePath('/messages')
  return { data: null, error: null }
}
