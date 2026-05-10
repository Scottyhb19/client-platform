'use server'

import { defaultFromAddress, getResendClient } from './client'
import {
  renderBookingConfirmationEmail,
  type BookingConfirmationEmailInput,
} from './templates/booking-confirmation'

export interface SendBookingConfirmationArgs
  extends BookingConfirmationEmailInput {
  to: string
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
  const { to, ...templateInput } = args

  let resend
  try {
    resend = getResendClient()
  } catch (e) {
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
    return { error: error.message, messageId: null }
  }
  return { error: null, messageId: data?.id ?? null }
}
