'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { MESSAGE_BODY_MAX } from '@/lib/messages/types'

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

  revalidatePath('/portal/messages')
  return { data: { messageId: inserted.data.id }, error: null }
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
