/**
 * Booking reminder email — sent T-24h before the appointment by the
 * send-appointment-reminders Edge Function. Tighter than the confirmation
 * (no eyebrow on the appointment-type field, no "your booking is
 * confirmed" headline) — this is a glance, not a celebration.
 */
export interface BookingReminderEmailInput {
  firstName: string
  practiceName: string
  practitionerName: string
  appointmentType: string
  dateLine: string
  timeLine: string
  location: string | null
  bookingUrl: string
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

export function renderBookingReminderEmail(
  input: BookingReminderEmailInput,
): RenderedEmail {
  const {
    firstName,
    practiceName,
    practitionerName,
    appointmentType,
    dateLine,
    timeLine,
    location,
    bookingUrl,
  } = input
  const safeFirstName = escapeHtml(firstName)
  const safePracticeName = escapeHtml(practiceName)
  const safePractitionerName = escapeHtml(practitionerName)
  const safeAppointmentType = escapeHtml(appointmentType)
  const safeDateLine = escapeHtml(dateLine)
  const safeTimeLine = escapeHtml(timeLine)
  const safeLocation = location ? escapeHtml(location) : null
  const safeUrl = escapeHtml(bookingUrl)

  const subject = `Tomorrow: ${appointmentType} at ${timeLine}`

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
                Reminder
              </div>
              <h1 style="font-family:Georgia,'Times New Roman',serif; font-weight:700; font-size:22px; line-height:1.25; margin:0 0 12px; color:#231F20; letter-spacing:-.005em;">
                ${safeFirstName}, you&rsquo;ve got a session tomorrow.
              </h1>
              <p style="font-size:15px; line-height:1.55; color:#1C1917; margin:0 0 22px;">
                ${safeAppointmentType} with ${safePractitionerName}.
              </p>

              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 22px; border-collapse:separate; border-spacing:0; width:100%;">
                <tr>
                  <td style="padding:6px 0; font-size:12px; color:#A09890; text-transform:uppercase; letter-spacing:.06em; font-weight:700; width:120px;">Date</td>
                  <td style="padding:6px 0; font-size:15px; color:#1C1917;">${safeDateLine}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0; font-size:12px; color:#A09890; text-transform:uppercase; letter-spacing:.06em; font-weight:700;">Time</td>
                  <td style="padding:6px 0; font-size:15px; color:#1C1917;">${safeTimeLine}</td>
                </tr>
                ${
                  safeLocation
                    ? `<tr>
                  <td style="padding:6px 0; font-size:12px; color:#A09890; text-transform:uppercase; letter-spacing:.06em; font-weight:700;">Location</td>
                  <td style="padding:6px 0; font-size:15px; color:#1C1917;">${safeLocation}</td>
                </tr>`
                    : ''
                }
              </table>

              <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="left">
                <tr>
                  <td style="background:#1E1A18; border-radius:7px;">
                    <a href="${safeUrl}" target="_blank" style="display:inline-block; padding:14px 28px; font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif; font-weight:600; font-size:15px; color:#FFFFFF; text-decoration:none; line-height:1;">
                      View booking
                    </a>
                  </td>
                </tr>
              </table>
              <div style="clear:both;"></div>

              <p style="font-size:13px; line-height:1.5; color:#A09890; margin:28px 0 0;">
                Need to message ${safePractitionerName}? Open the portal &mdash; the cancel window has now passed.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 4px 0; font-size:12px; color:#A09890; line-height:1.55;">
              ${safePracticeName}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  const text = [
    `${firstName}, you've got a session tomorrow.`,
    '',
    `${appointmentType} with ${practitionerName}.`,
    '',
    `Date: ${dateLine}`,
    `Time: ${timeLine}`,
    ...(location ? [`Location: ${location}`] : []),
    '',
    `View booking: ${bookingUrl}`,
    '',
    `Need to message ${practitionerName}? Open the portal — the cancel window has now passed.`,
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
