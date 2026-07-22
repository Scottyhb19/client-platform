'use server'

import { defaultFromAddress, getResendClient } from './client'
import { logCommunication, type CommLogContext } from '@/lib/comms/log'
import { captureException } from '@/lib/observability/sentry'
import {
  renderBookingConfirmationEmail,
  type BookingConfirmationEmailInput,
} from './templates/booking-confirmation'

export interface SendBookingConfirmationArgs
  extends BookingConfirmationEmailInput {
  to: string
  /** §12 Part B: when present, the send outcome lands on the Comms tab. */
  log?: CommLogContext
}

/**
 * Send the booking-confirmation email via Resend.
 *
 * Returns { error } on failure rather than throwing — the booking itself
 * has already landed in the database, so an email failure shouldn't roll
 * back the booking. The caller logs the error and surfaces a quiet "we
 * couldn't send the confirmation email" hint to the user.
 */
export async function sendBookingConfirmationEmail(
  args: SendBookingConfirmationArgs,
): Promise<{ error: string | null; messageId: string | null }> {
  const { to, log, ...templateInput } = args

  let resend
  try {
    resend = getResendClient()
  } catch (e) {
    captureException(e, { where: 'email-send:booking-confirmation' })
    return {
      error: e instanceof Error ? e.message : 'Resend client unavailable.',
      messageId: null,
    }
  }

  const { subject, html, text } = renderBookingConfirmationEmail(templateInput)

  const { data, error } = await resend.emails.send({
    from: defaultFromAddress(),
    to,
    subject,
    html,
    text,
  })

  if (error) {
    // P1-3: log every send failure at source. The booking actions (portal +
    // staff) discard this returned {error}, so without this it would vanish
    // silently — a client never gets a confirmation and the EP never knows.
    captureException(new Error(error.message), {
      where: 'email-send:booking-confirmation',
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
