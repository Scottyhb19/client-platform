/**
 * Reschedule notification email — sent to the client when an EP moves their
 * appointment to a new time from the staff schedule. Mirrors the visual + tonal
 * language of booking-confirmation.ts (cream surface, charcoal CTA button,
 * table-based layout for Apple Mail / Gmail compatibility).
 *
 * Returns BOTH html and a plain-text fallback for Resend's deliverability
 * scoring + accessibility.
 */
export interface RescheduleNotificationEmailInput {
  firstName: string
  practiceName: string
  practitionerName: string
  /** Appointment type display name, e.g. "Initial assessment". */
  appointmentType: string
  /** Already-formatted NEW date line, e.g. "Sat 16 May 2026". */
  dateLine: string
  /** Already-formatted NEW time range, e.g. "7:00am – 8:00am". */
  timeLine: string
  /** Already-formatted previous date + time, or null to omit the "was" row. */
  previousLine: string | null
  /** Optional location text, e.g. "ExCo Clinic, 123 Smith St". */
  location: string | null
  /** Link the client can tap to view the booking — points to /portal/book. */
  bookingUrl: string
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

export function renderRescheduleNotificationEmail(
  input: RescheduleNotificationEmailInput,
): RenderedEmail {
  const {
    firstName,
    practiceName,
    practitionerName,
    appointmentType,
    dateLine,
    timeLine,
    previousLine,
    location,
    bookingUrl,
  } = input
  const safeFirstName = escapeHtml(firstName)
  const safePracticeName = escapeHtml(practiceName)
  const safePractitionerName = escapeHtml(practitionerName)
  const safeAppointmentType = escapeHtml(appointmentType)
  const safeDateLine = escapeHtml(dateLine)
  const safeTimeLine = escapeHtml(timeLine)
  const safePreviousLine = previousLine ? escapeHtml(previousLine) : null
  const safeLocation = location ? escapeHtml(location) : null
  const safeUrl = escapeHtml(bookingUrl)

  const subject = `Rescheduled: ${appointmentType} — ${dateLine}, ${timeLine}`

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
              <h1 style="font-family:'Helvetica Neue',Arial,sans-serif; font-weight:800; font-size:24px; line-height:1.2; margin:0 0 14px; color:#231F20; letter-spacing:-.005em;">
                Your session has been rescheduled.
              </h1>
              <p style="font-size:15px; line-height:1.55; color:#1C1917; margin:0 0 22px;">
                ${safeFirstName}, your ${safeAppointmentType} with ${safePractitionerName} has moved to the time below. We&rsquo;ll remind you beforehand.
              </p>

              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 22px; border-collapse:separate; border-spacing:0; width:100%;">
                <tr>
                  <td style="padding:6px 0; font-size:12px; color:#A09890; text-transform:uppercase; letter-spacing:.06em; font-weight:700; width:120px;">Type</td>
                  <td style="padding:6px 0; font-size:15px; color:#1C1917;">${safeAppointmentType}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0; font-size:12px; color:#A09890; text-transform:uppercase; letter-spacing:.06em; font-weight:700;">Date</td>
                  <td style="padding:6px 0; font-size:15px; color:#1C1917;">${safeDateLine}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0; font-size:12px; color:#A09890; text-transform:uppercase; letter-spacing:.06em; font-weight:700;">Time</td>
                  <td style="padding:6px 0; font-size:15px; color:#1C1917;">${safeTimeLine}</td>
                </tr>
                ${
                  safePreviousLine
                    ? `<tr>
                  <td style="padding:6px 0; font-size:12px; color:#A09890; text-transform:uppercase; letter-spacing:.06em; font-weight:700;">Was</td>
                  <td style="padding:6px 0; font-size:14px; color:#A09890; text-decoration:line-through;">${safePreviousLine}</td>
                </tr>`
                    : ''
                }
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
                This time doesn&rsquo;t suit? Open the portal and message ${safePractitionerName}.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 4px 0; font-size:12px; color:#A09890; line-height:1.55;">
              You&rsquo;re receiving this because your session with ${safePracticeName} was rescheduled. Open the portal to review your bookings.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  const text = [
    `Your session has been rescheduled.`,
    '',
    `${firstName}, your ${appointmentType} with ${practitionerName} at ${practiceName} has moved.`,
    '',
    `Type: ${appointmentType}`,
    `Date: ${dateLine}`,
    `Time: ${timeLine}`,
    ...(previousLine ? [`Was: ${previousLine}`] : []),
    ...(location ? [`Location: ${location}`] : []),
    '',
    `View booking: ${bookingUrl}`,
    '',
    `This time doesn't suit? Open the portal and message ${practitionerName}.`,
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
