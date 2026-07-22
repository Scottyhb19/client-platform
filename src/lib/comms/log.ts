import 'server-only'

import { createSupabaseServiceRoleClient } from '@/lib/supabase/server'
import { captureException } from '@/lib/observability/sentry'

/**
 * §12 Part B (logging half) — record an outbound communication on the
 * client's record (the Comms tab reads these; brief §6.7 "sent
 * communications logged to the client's Comms tab").
 *
 * Called by the app-side send modules (invite, booking confirmation,
 * reschedule notification) right after the Resend call, with the REAL
 * subject/body that went out. System sends with no acting human pass
 * senderUserId: null. Reminder sends are logged DB-side by the
 * reminder_log_communication trigger (migration 20260721160000), not here.
 *
 * Best-effort by design: a logging failure must never fail or retry a send
 * (double-email risk). Failures go to the server log only.
 */
/**
 * The caller-supplied context a send module needs to record its outcome.
 * senderUserId null = system send (no acting human).
 */
export interface CommLogContext {
  organizationId: string
  clientId: string
  senderUserId: string | null
}

export async function logCommunication(args: {
  organizationId: string
  clientId: string
  senderUserId: string | null
  recipientEmail: string
  subject: string
  body: string
  status: 'sent' | 'failed'
  providerMessageId?: string | null
  failureReason?: string | null
}): Promise<void> {
  try {
    const svc = createSupabaseServiceRoleClient()
    const now = new Date().toISOString()
    const { error } = await svc.from('communications').insert({
      organization_id: args.organizationId,
      client_id: args.clientId,
      sender_user_id: args.senderUserId,
      communication_type: 'email',
      direction: 'outbound',
      status: args.status,
      provider: 'resend',
      provider_message_id: args.providerMessageId ?? null,
      subject: args.subject,
      body: args.body,
      recipient_email: args.recipientEmail,
      sent_at: args.status === 'sent' ? now : null,
      failed_at: args.status === 'failed' ? now : null,
      failure_reason: args.failureReason ?? null,
    })
    if (error) {
      // The Comms tab is now the EP-facing surface for a failed send (FM-5).
      // If this log write itself fails, that surface silently under-reports —
      // so route the miss through the same observability seam the send paths
      // use (not a raw console line), so it is visible now and lights up when
      // the real Sentry SDK is wired. Still best-effort: never rethrow.
      captureException(new Error(`comms-log insert failed: ${error.message}`), {
        where: 'comms-log:insert',
        clientId: args.clientId,
        status: args.status,
      })
    }
  } catch (e) {
    captureException(e, {
      where: 'comms-log:insert',
      clientId: args.clientId,
      status: args.status,
    })
  }
}
