'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require-role'
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
 * Send a client→staff message. Resolves the client's thread by their
 * authenticated user_id (one client → one thread per org). The thread MUST
 * already exist — clients cannot create threads, only staff can.
 *
 * If the client has no thread yet, returns a polite error pointing them at
 * the help/booking flow rather than silently creating one. (Auto-creation
 * for clients would let an unverified user spam threads if RLS ever drifted.)
 */
export async function sendClientMessageAction(
  body: string,
): Promise<Result<{ messageId: string }>> {
  const { userId } = await requireRole(['client'])
  const supabase = await createSupabaseServerClient()

  const trimmed = body.trim()
  if (!trimmed) return { data: null, error: 'Message cannot be empty.' }
  if (trimmed.length > MESSAGE_BODY_MAX) {
    return {
      data: null,
      error: `Message is ${trimmed.length} characters; cap is ${MESSAGE_BODY_MAX}.`,
    }
  }

  // Resolve the client's single thread via RLS — the thread SELECT policy
  // already constrains to client.user_id = auth.uid().
  const thread = await supabase
    .from('message_threads')
    .select('id, organization_id')
    .is('deleted_at', null)
    .maybeSingle()

  if (thread.error) return { data: null, error: thread.error.message }
  if (!thread.data) {
    return {
      data: null,
      error:
        'No conversation open yet — please reach out via your booking confirmation and your practitioner will start the thread.',
    }
  }

  const { id: threadId, organization_id: organizationId } = thread.data

  const inserted = await supabase
    .from('messages')
    .insert({
      thread_id: threadId,
      organization_id: organizationId,
      sender_user_id: userId,
      sender_role: 'client',
      body: trimmed,
    })
    .select('id')
    .single()

  if (inserted.error) return { data: null, error: inserted.error.message }

  // P1-1c (queue+cron upgrade, 2026-07-02): the EP's new-message email is no
  // longer sent from here. The messages INSERT above fires the
  // message_notification_enqueue DB trigger (20260702140000), which — with
  // the same first-unread debounce and first-name-only content — enqueues a
  // message_notifications row; the send-message-notifications Edge Function
  // drains it on the 5-minute cron with retry + a queryable sent/failed
  // outcome. Enqueue is atomic with the insert (the former best-effort
  // `after()` send could be lost and its failures were unobservable).
  revalidatePath('/portal/messages')
  return { data: { messageId: inserted.data.id }, error: null }
}

/**
 * Send a client→staff message carrying photos. Blobs are already uploaded
 * browser-side (the client storage write policy only admits image-extension
 * paths under the client's own thread folder); the send RPC then verifies
 * each blob's authoritative mimetype (photos only for the client role, 10 MB
 * cap) before inserting the message + attachment rows atomically. An empty
 * body is allowed — a photo alone is a message.
 */
export async function sendClientPhotoMessageAction(args: {
  body: string
  attachments: { storagePath: string; fileName: string }[]
}): Promise<Result<{ message: MessageRow; attachments: AttachmentView[] }>> {
  await requireRole(['client'])
  const supabase = await createSupabaseServerClient()

  const body = args.body.trim()
  if (body.length > MESSAGE_BODY_MAX) {
    return {
      data: null,
      error: `Message is too long. Max ${MESSAGE_BODY_MAX} characters.`,
    }
  }
  if (args.attachments.length < 1 || args.attachments.length > MESSAGE_ATTACHMENTS_MAX) {
    return {
      data: null,
      error: `Between 1 and ${MESSAGE_ATTACHMENTS_MAX} photos per message.`,
    }
  }

  const thread = await supabase
    .from('message_threads')
    .select('id')
    .is('deleted_at', null)
    .maybeSingle()

  if (thread.error) return { data: null, error: thread.error.message }
  if (!thread.data) {
    return {
      data: null,
      error:
        'No conversation open yet — please reach out via your booking confirmation and your practitioner will start the thread.',
    }
  }

  // RETURNS messages (single composite) — PostgREST hands back one object,
  // so no .single() (it would re-type the result as never).
  const { data: message, error } = await supabase.rpc(
    'send_message_with_attachments',
    {
      p_thread_id: thread.data.id,
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

  revalidatePath('/portal/messages')
  return {
    data: { message, attachments: views[message.id] ?? [] },
    error: null,
  }
}

/**
 * Attachment views for one message — used by the realtime INSERT handler
 * when a staff message arrives with has_attachments.
 */
export async function getClientAttachmentViewsAction(
  messageId: string,
): Promise<Result<AttachmentView[]>> {
  await requireRole(['client'])
  const supabase = await createSupabaseServerClient()
  const views = await loadAttachmentViews(supabase, { messageId })
  return { data: views[messageId] ?? [], error: null }
}

/** 60-second download URL for a file attachment the EP sent. */
export async function getClientAttachmentDownloadUrlAction(
  attachmentId: string,
): Promise<Result<{ url: string }>> {
  await requireRole(['client'])
  const supabase = await createSupabaseServerClient()
  const { url, error } = await signAttachmentDownload(supabase, attachmentId)
  if (error || !url) return { data: null, error: error ?? 'Could not generate link.' }
  return { data: { url }, error: null }
}

/**
 * Client marks staff→client messages read. Mirrors the staff version.
 */
export async function markClientThreadReadAction(): Promise<Result> {
  await requireRole(['client'])
  const supabase = await createSupabaseServerClient()

  // Find the client's thread (one of) — RLS limits scope.
  const thread = await supabase
    .from('message_threads')
    .select('id')
    .is('deleted_at', null)
    .maybeSingle()

  if (thread.error || !thread.data) return { data: null, error: null }

  const { error } = await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('thread_id', thread.data.id)
    .eq('sender_role', 'staff')
    .is('read_at', null)

  if (error) return { data: null, error: error.message }

  revalidatePath('/portal/messages')
  return { data: null, error: null }
}
