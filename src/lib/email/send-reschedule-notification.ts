'use server'

import { defaultFromAddress, getResendClient } from './client'
import { logCommunication, type CommLogContext } from '@/lib/comms/log'
import { captureException } from '@/lib/observability/sentry'
import {
  renderRescheduleNotificationEmail,
  type RescheduleNotificationEmailInput,
} from './templates/reschedule-notification'

export interface SendRescheduleNotificationArgs
  extends RescheduleNotificationEmailInput {
  to: string
  /** §12 Part B: when present, the send outcome lands on the Comms tab. */
  log?: CommLogContext
}

/**
 * Send the reschedule-notification email via Resend.
 *
 * Returns { error } on failure rather than throwing — the appointment has
 * already moved in the database, so an email failure shouldn't roll back the
 * reschedule. The caller logs the error (best-effort) and carries on.
 */
export async function sendRescheduleNotificationEmail(
  args: SendRescheduleNotificationArgs,
): Promise<{ error: string | null; messageId: string | null }> {
  const { to, log, ...templateInput } = args

  let resend
  try {
    resend = getResendClient()
  } catch (e) {
    captureException(e, { where: 'email-send:reschedule-notification' })
    return {
      error: e instanceof Error ? e.message : 'Resend client unavailable.',
      messageId: null,
    }
  }

  const { subject, html, text } =
    renderRescheduleNotificationEmail(templateInput)

  const { data, error } = await resend.emails.send({
    from: defaultFromAddress(),
    to,
    subject,
    html,
    text,
  })

  if (error) {
    // Log every send failure at source (mirrors the booking-confirmation path):
    // the caller discards this {error}, so without this it would vanish silently
    // — the client never learns their session moved and the EP never knows.
    captureException(new Error(error.message), {
      where: 'email-send:reschedule-notification',
    })
    if (log) {
      await logCommunication({
        ...log,
        recipientEmail: to,
        subject,
        body: text,
        status: 'failed',
        failureReason: error.message,
      })
    }
    return { error: error.message, messageId: null }
  }
  if (log) {
    await logCommunication({
      ...log,
      recipientEmail: to,
      subject,
      body: text,
      status: 'sent',
      providerMessageId: data?.id ?? null,
    })
  }
  return { error: null, messageId: data?.id ?? null }
}
