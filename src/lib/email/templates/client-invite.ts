/**
 * Client invite email — sent when an EP creates a client with the "send
 * invite" checkbox ticked.
 *
 * The HTML targets Apple Mail (default for ~80% of Australian opens) and
 * Gmail. No external CSS, no <style> blocks beyond the table-based reset —
 * mail clients strip both unpredictably. Inline styles only. Layout is a
 * single centred 540px column on a beige background, mirroring the portal's
 * cream-and-charcoal palette.
 *
 * Returns BOTH html and a plain-text fallback. Resend uses the text version
 * for deliverability scoring + accessibility (screen readers in some Mail
 * apps fall back to text/plain when HTML rendering is disabled).
 */
export interface ClientInviteEmailInput {
  firstName: string
  practiceName: string
  /** Practitioner sending the invite — e.g. "Scott Browning". */
  practitionerName: string
  /** The full invite URL — magic-link landing on /auth/callback?next=... */
  acceptUrl: string
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

export function renderClientInviteEmail(
  input: ClientInviteEmailInput,
): RenderedEmail {
  const { firstName, practiceName, practitionerName, acceptUrl } = input
  const safeFirstName = escapeHtml(firstName)
  const safePracticeName = escapeHtml(practiceName)
  const safePractitionerName = escapeHtml(practitionerName)
  const safeUrl = escapeHtml(acceptUrl)

  const subject = `${practitionerName} invited you to ${practiceName}`

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${subject}</title>
</head>
<body style="margin:0; padding:0; background:#F7F4F0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif; color:#1C1917;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F7F4F0;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="540" cellspacing="0" cellpadding="0" border="0" style="max-width:540px; width:100%;">
          <!-- Brand -->
          <tr>
            <td style="padding:0 0 24px; text-align:left;">
              <span style="font-family:'Helvetica Neue',Arial,sans-serif; font-weight:800; font-size:20px; letter-spacing:.01em; color:#1E1A18;">
                Odyssey<span style="color:#2DB24C;">.</span>
              </span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#FFFFFF; border:1px solid #E2DDD7; border-radius:14px; padding:32px;">
              <div style="font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:#A09890; margin-bottom:8px;">
                ${safePracticeName}
              </div>
              <h1 style="font-family:Georgia,'Times New Roman',serif; font-weight:700; font-size:28px; line-height:1.2; margin:0 0 14px; color:#231F20; letter-spacing:-.005em;">
                Welcome, ${safeFirstName}.
              </h1>
              <p style="font-size:16px; line-height:1.55; color:#1C1917; margin:0 0 14px;">
                ${safePractitionerName} invited you to your private client portal.
                It&rsquo;s where you&rsquo;ll see your program, log sessions, and
                message ${safePractitionerName} between visits.
              </p>
              <p style="font-size:15px; line-height:1.55; color:#78746F; margin:0 0 22px;">
                Tap the button below on your phone to set up. The portal is
                designed for mobile — we&rsquo;ll show you how to add it to your
                home screen so it opens like an app.
              </p>

              <!-- CTA -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="left">
                <tr>
                  <td style="background:#1E1A18; border-radius:7px;">
                    <a href="${safeUrl}" target="_blank" style="display:inline-block; padding:14px 28px; font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif; font-weight:600; font-size:16px; color:#FFFFFF; text-decoration:none; line-height:1;">
                      Set up my portal
                    </a>
                  </td>
                </tr>
              </table>

              <div style="clear:both;"></div>

              <p style="font-size:13px; line-height:1.5; color:#A09890; margin:28px 0 0;">
                Or copy and paste this link into your phone&rsquo;s browser:<br>
                <a href="${safeUrl}" target="_blank" style="color:#0A5540; word-break:break-all; text-decoration:underline;">${safeUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:18px 4px 0; font-size:12px; color:#A09890; line-height:1.55;">
              You received this because ${safePractitionerName} added you as a
              client at ${safePracticeName}. If this looks unexpected, just
              ignore the email &mdash; nothing happens until you click the link.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  const text = [
    `Welcome, ${firstName}.`,
    '',
    `${practitionerName} invited you to your private client portal at ${practiceName}.`,
    '',
    'Set up your portal here:',
    acceptUrl,
    '',
    'The portal is built for your phone — once you sign in, we will show you how to add it to your home screen so it opens like an app.',
    '',
    `If this email looks unexpected, just ignore it. Nothing happens until you click the link.`,
    '',
    `— ${practiceName}`,
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
