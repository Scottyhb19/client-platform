/**
 * New-message notification — sent to the practitioner (org owner) when a
 * client sends a message, so an unread message doesn't sit unseen until the
 * EP next opens the app (messaging premortem FM-5, gap P1-1c). EP-facing, not
 * client-facing.
 *
 * Deliberately carries NO message body or clinical detail — only the client's
 * first name. The health-adjacent content stays inside the platform's
 * RLS/audit perimeter; the email only says "you have a message, come read it"
 * and links back in. This keeps the owner-approved messaging deviation's
 * compliance posture (content never leaves the perimeter) intact even for the
 * notification path.
 *
 * Mirrors the visual + tonal language of booking-confirmation.ts. Raw hex is
 * intentional: email clients don't support CSS variables, so the design tokens
 * can't be referenced here (same as every other template).
 */
export interface MessageNotificationEmailInput {
  /** Client's first name — the only client detail included (no surname, no body). */
  clientFirstName: string
  practiceName: string
  /** Link to the staff inbox — points to /messages. */
  inboxUrl: string
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

export function renderMessageNotificationEmail(
  input: MessageNotificationEmailInput,
): RenderedEmail {
  const { clientFirstName, practiceName, inboxUrl } = input
  const safeFirstName = escapeHtml(clientFirstName)
  const safePracticeName = escapeHtml(practiceName)
  const safeUrl = escapeHtml(inboxUrl)

  const subject = `New message from ${clientFirstName}`

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0; padding:0; background:#F7F4F0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif; color:#1C1917;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F7F4F0;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="540" cellspacing="0" cellpadding="0" border="0" style="max-width:540px; width:100%;">
          <tr>
            <td style="padding:0 0 24px; text-align:left;">
              <span style="font-family:'Helvetica Neue',Arial,sans-serif; font-weight:800; font-size:20px; letter-spacing:.01em; color:#1E1A18;">
                Odyssey<span style="color:#2DB24C;">.</span>
              </span>
            </td>
          </tr>
          <tr>
            <td style="background:#FFFFFF; border:1px solid #E2DDD7; border-radius:14px; padding:32px;">
              <div style="font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:#A09890; margin-bottom:8px;">
                ${safePracticeName}
              </div>
              <h1 style="font-family:Georgia,'Times New Roman',serif; font-weight:700; font-size:24px; line-height:1.2; margin:0 0 14px; color:#231F20; letter-spacing:-.005em;">
                New message from ${safeFirstName}.
              </h1>
              <p style="font-size:15px; line-height:1.55; color:#1C1917; margin:0 0 22px;">
                ${safeFirstName} sent you a message. Open your inbox to read it and reply &mdash; the message is waiting in Odyssey.
              </p>

              <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="left">
                <tr>
                  <td style="background:#1E1A18; border-radius:7px;">
                    <a href="${safeUrl}" target="_blank" style="display:inline-block; padding:14px 28px; font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif; font-weight:600; font-size:15px; color:#FFFFFF; text-decoration:none; line-height:1;">
                      Open inbox
                    </a>
                  </td>
                </tr>
              </table>
              <div style="clear:both;"></div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 4px 0; font-size:12px; color:#A09890; line-height:1.55;">
              You&rsquo;re receiving this because a client messaged you in ${safePracticeName} on Odyssey.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  const text = [
    `New message from ${clientFirstName}.`,
    '',
    `${clientFirstName} sent you a message. Open your inbox to read it and reply:`,
    inboxUrl,
    '',
    `You're receiving this because a client messaged you in ${practiceName} on Odyssey.`,
  ].join('\n')

  return { subject, html, text }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
