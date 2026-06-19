'use server'

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import {
  createSupabaseServerClient,
  createSupabaseServiceRoleClient,
} from '@/lib/supabase/server'
import { MESSAGE_BODY_MAX } from '@/lib/messages/types'
import { sendMessageNotificationEmail } from '@/lib/email/send-message-notification'
import { getPublicOrigin } from '@/lib/env/site-url'
import { captureException } from '@/lib/observability/sentry'

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

  // P1-1c: notify the EP by email that a client messaged them, so an unread
  // message doesn't sit unseen until they next open the app (premortem FM-5).
  // Runs AFTER the response so it never blocks or fails the client's send —
  // the in-app unread badge is the backstop. Best-effort: any failure is
  // logged, never surfaced. Uses the service-role client because the EP's
  // email and the org owner are not readable under the client's own RLS.
  after(async () => {
    try {
      const svc = createSupabaseServiceRoleClient()

      // Debounce: only notify on the FIRST unread client message in the
      // thread. The row we just inserted has read_at = null, so a count of
      // exactly 1 means it's the only unread one — the EP has read everything
      // prior. A burst, or a message arriving while the EP already has an
      // unread one, sends nothing further until they read + the cycle resets.
      // read_at is the debounce; no state table needed.
      const { count: unread, error: countErr } = await svc
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('thread_id', threadId)
        .eq('sender_role', 'client')
        .is('read_at', null)
        .is('deleted_at', null)
      if (countErr) {
        captureException(countErr, { where: 'message-notify:count', threadId })
        return
      }
      if ((unread ?? 0) !== 1) return

      // Client first name (the only client detail in the email) + practice name.
      const { data: threadRow } = await svc
        .from('message_threads')
        .select('client_id')
        .eq('id', threadId)
        .maybeSingle()
      let clientFirstName = 'A client'
      if (threadRow?.client_id) {
        const { data: clientRow } = await svc
          .from('clients')
          .select('first_name')
          .eq('id', threadRow.client_id)
          .maybeSingle()
        if (clientRow?.first_name) clientFirstName = clientRow.first_name
      }
      const { data: orgRow } = await svc
        .from('organizations')
        .select('name')
        .eq('id', organizationId)
        .maybeSingle()
      const practiceName = orgRow?.name ?? 'Odyssey'

      // Recipient(s): the org owner(s) — the EP. user_profiles carries no
      // email, so resolve the canonical auth email via the admin API.
      const { data: owners } = await svc
        .from('user_organization_roles')
        .select('user_id')
        .eq('organization_id', organizationId)
        .eq('role', 'owner')
      if (!owners || owners.length === 0) return

      const inboxUrl = `${getPublicOrigin()}/messages`
      for (const owner of owners) {
        const { data: u } = await svc.auth.admin.getUserById(owner.user_id)
        const to = u?.user?.email
        if (!to) continue
        const { error: sendErr } = await sendMessageNotificationEmail({
          to,
          clientFirstName,
          practiceName,
          inboxUrl,
        })
        if (sendErr) {
          captureException(new Error(sendErr), {
            where: 'message-notify:send',
            threadId,
          })
        }
      }
    } catch (e) {
      captureException(e, { where: 'message-notify', threadId })
    }
  })

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
