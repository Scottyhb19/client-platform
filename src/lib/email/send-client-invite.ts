'use server'

import { defaultFromAddress, getResendClient } from './client'
import {
  renderClientInviteEmail,
  type ClientInviteEmailInput,
} from './templates/client-invite'

export interface SendClientInviteArgs extends ClientInviteEmailInput {
  to: string
}

/**
 * Send the custom client-invite email via Resend.
 *
 * Returns { error } on failure rather than throwing so the caller (the
 * inviteClient action) can surface a friendly message and let the EP
 * resend without losing the clients row they just created.
 */
export async function sendClientInviteEmail(
  args: SendClientInviteArgs,
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

  const { subject, html, text } = renderClientInviteEmail(templateInput)

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
