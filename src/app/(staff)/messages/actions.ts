'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { MESSAGE_BODY_MAX } from '@/lib/messages/types'

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
