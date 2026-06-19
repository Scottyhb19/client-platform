'use server'

import { defaultFromAddress, getResendClient } from './client'
import {
  renderMessageNotificationEmail,
  type MessageNotificationEmailInput,
} from './templates/message-notification'

export interface SendMessageNotificationArgs
  extends MessageNotificationEmailInput {
  to: string
}

/**
 * Send the new-message notification email via Resend (messaging P1-1c).
 *
 * Returns { error } on failure rather than throwing — the message itself has
 * already landed in the database and the in-app unread indicator already
 * shows it, so a notification-email failure must not affect the send path.
 * The caller (a post-response `after()` block) logs the error; the in-app
 * badge is the backstop.
 */
export async function sendMessageNotificationEmail(
  args: SendMessageNotificationArgs,
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

  const { subject, html, text } = renderMessageNotificationEmail(templateInput)

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
