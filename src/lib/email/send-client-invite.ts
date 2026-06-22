'use server'

import { defaultFromAddress, getResendClient } from './client'
import { captureException } from '@/lib/observability/sentry'
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
    captureException(e, { where: 'email-send:client-invite' })
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
    // P1-3: log send failures at source for ops visibility. The invite caller
    // also surfaces this to the EP's UI (so they can resend), but logging here
    // means a failure is observable even if no one is watching the screen.
    captureException(new Error(error.message), {
      where: 'email-send:client-invite',
    })
    return { error: error.message, messageId: null }
  }
  return { error: null, messageId: data?.id ?? null }
}
