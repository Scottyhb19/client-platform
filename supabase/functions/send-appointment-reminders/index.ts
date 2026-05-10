// ============================================================================
// send-appointment-reminders — T-24h booking reminder worker
// ============================================================================
// Runs as a Supabase Edge Function on a 5-minute pg_cron schedule. Drains
// appointment_reminders rows where status='scheduled' AND scheduled_for is
// in the past, sends each via Resend, and flips status to 'sent' or
// 'failed'.
//
// Idempotency: the UPDATE WHERE clause checks status='scheduled' so two
// concurrent invocations cannot mark the same row as sent twice. The
// appointments table also gates: cancelled appointments have their reminder
// rows flipped to 'cancelled' by client_cancel_appointment, so this worker
// never sees them.
//
// Service role: required because RLS denies authenticated SELECT on
// appointment_reminders (see 20260420102600 line 1136). The service role
// key is provided via Supabase Secrets — the env vars below come from the
// platform automatically (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
// RESEND_API_KEY must be set explicitly via:
//   supabase secrets set RESEND_API_KEY=re_...
//
// Deploy:
//   supabase functions deploy send-appointment-reminders
//
// Schedule (run once via SQL Editor after the function URL is known):
//   SELECT cron.schedule(
//     'appointment-reminders-5min',
//     '*/5 * * * *',
//     $$
//       SELECT net.http_post(
//         url := '<function-url>',
//         headers := jsonb_build_object(
//           'Authorization', 'Bearer ' || current_setting('app.cron_token'),
//           'Content-Type',  'application/json'
//         ),
//         body := '{}'::jsonb
//       );
//     $$
//   );
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.0'

interface ReminderRow {
  id: string
  appointment_id: string
  reminder_type: string
  scheduled_for: string
  retry_count: number
}

interface AppointmentContext {
  appointment_id: string
  start_at: string
  end_at: string
  appointment_type: string
  location: string | null
  staff_user_id: string
  practice_name: string
  timezone: string
  client_first_name: string | null
  client_email: string | null
  staff_first_name: string | null
  staff_last_name: string | null
}

const BATCH_SIZE = 50

Deno.serve(async (req) => {
  // Allow only POST + a small auth check via a shared secret. Cron callers
  // include the bearer token; manual debug calls can use the same.
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 })
  }

  const expectedToken = Deno.env.get('CRON_SHARED_SECRET')
  const authHeader = req.headers.get('Authorization') ?? ''
  if (
    expectedToken &&
    authHeader !== `Bearer ${expectedToken}`
  ) {
    return new Response('unauthorized', { status: 401 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const resendKey = Deno.env.get('RESEND_API_KEY') ?? ''
  const fromAddress =
    Deno.env.get('EMAIL_FROM') ?? 'Odyssey <onboarding@resend.dev>'
  const appUrl = Deno.env.get('NEXT_PUBLIC_APP_URL') ?? ''

  if (!supabaseUrl || !serviceKey) {
    return new Response('missing supabase config', { status: 500 })
  }
  if (!resendKey) {
    return new Response('missing RESEND_API_KEY', { status: 500 })
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Pull a bounded batch of due reminders. provider='resend' filter is
  // explicit — when SMS lands, that worker is a separate function.
  const { data: due, error: dueErr } = await supabase
    .from('appointment_reminders')
    .select('id, appointment_id, reminder_type, scheduled_for, retry_count')
    .eq('status', 'scheduled')
    .eq('provider', 'resend')
    .lte('scheduled_for', new Date().toISOString())
    .limit(BATCH_SIZE)

  if (dueErr) {
    return jsonResponse(500, { error: dueErr.message })
  }

  const rows: ReminderRow[] = (due ?? []) as ReminderRow[]
  if (rows.length === 0) {
    return jsonResponse(200, { processed: 0 })
  }

  let succeeded = 0
  let failed = 0

  for (const row of rows) {
    const ctx = await loadAppointmentContext(supabase, row.appointment_id)
    if (!ctx || !ctx.client_email) {
      // Record the failure so the row doesn't sit forever as 'scheduled'.
      await markFailed(
        supabase,
        row.id,
        ctx ? 'client has no email on file' : 'appointment not found',
      )
      failed += 1
      continue
    }

    const { subject, html, text } = renderReminderEmail({
      firstName: ctx.client_first_name ?? 'there',
      practiceName: ctx.practice_name,
      practitionerName:
        `${ctx.staff_first_name ?? ''} ${ctx.staff_last_name ?? ''}`.trim() ||
        'your EP',
      appointmentType: ctx.appointment_type,
      dateLine: formatDateLine(ctx.start_at, ctx.timezone),
      timeLine: formatTimeRange(ctx.start_at, ctx.end_at, ctx.timezone),
      location: ctx.location,
      bookingUrl: appUrl ? `${appUrl}/portal/book` : '#',
    })

    const send = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress,
        to: ctx.client_email,
        subject,
        html,
        text,
      }),
    })

    if (!send.ok) {
      const body = await send.text().catch(() => '')
      await markFailed(
        supabase,
        row.id,
        `resend ${send.status}: ${body.slice(0, 400)}`,
      )
      failed += 1
      continue
    }

    let messageId: string | null = null
    try {
      const json = (await send.json()) as { id?: string }
      messageId = json.id ?? null
    } catch {
      // Resend usually returns JSON; if not, leave messageId null. Sent flag
      // still flips below.
    }

    await markSent(supabase, row.id, messageId)
    succeeded += 1
  }

  return jsonResponse(200, {
    processed: rows.length,
    succeeded,
    failed,
  })
})

async function loadAppointmentContext(
  supabase: ReturnType<typeof createClient>,
  appointmentId: string,
): Promise<AppointmentContext | null> {
  const { data: appt } = await supabase
    .from('appointments')
    .select(
      `id, start_at, end_at, appointment_type, location, staff_user_id, status,
       organization:organizations(name, timezone),
       client:clients(first_name, email)`,
    )
    .eq('id', appointmentId)
    .maybeSingle()

  if (!appt || appt.status === 'cancelled') return null

  const { data: staff } = await supabase
    .from('user_profiles')
    .select('first_name, last_name')
    .eq('user_id', appt.staff_user_id)
    .maybeSingle()

  return {
    appointment_id: appt.id,
    start_at: appt.start_at,
    end_at: appt.end_at,
    appointment_type: appt.appointment_type,
    location: appt.location,
    staff_user_id: appt.staff_user_id,
    practice_name: appt.organization?.name ?? 'your practice',
    timezone: appt.organization?.timezone ?? 'Australia/Sydney',
    client_first_name: appt.client?.first_name ?? null,
    client_email: appt.client?.email ?? null,
    staff_first_name: staff?.first_name ?? null,
    staff_last_name: staff?.last_name ?? null,
  }
}

async function markSent(
  supabase: ReturnType<typeof createClient>,
  reminderId: string,
  messageId: string | null,
): Promise<void> {
  // Atomic flip — the WHERE on status='scheduled' means a concurrent
  // invocation that already won this row can't have its update overwritten.
  await supabase
    .from('appointment_reminders')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      provider_message_id: messageId,
    })
    .eq('id', reminderId)
    .eq('status', 'scheduled')
}

async function markFailed(
  supabase: ReturnType<typeof createClient>,
  reminderId: string,
  reason: string,
): Promise<void> {
  await supabase
    .from('appointment_reminders')
    .update({
      status: 'failed',
      failed_at: new Date().toISOString(),
      failure_reason: reason.slice(0, 500),
    })
    .eq('id', reminderId)
    .eq('status', 'scheduled')
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ----------------------------------------------------------------------------
// Inlined date + email rendering. Deno can't import from the Next app's
// src/lib so the templates are duplicated here in a slimmer form. If the
// templates need to evolve, both this file AND src/lib/email/templates/
// must change together.
// ----------------------------------------------------------------------------

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

function partsInTz(iso: string, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-AU', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(new Date(iso))
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === t)?.value ?? ''
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  }
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday: weekdayMap[get('weekday')] ?? 0,
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
  }
}

function formatDateLine(iso: string, tz: string): string {
  const p = partsInTz(iso, tz)
  return `${WEEKDAY[p.weekday]} ${p.day} ${MONTH[p.month - 1]} ${p.year}`
}

function formatTime(iso: string, tz: string): string {
  const p = partsInTz(iso, tz)
  const h = p.hour % 12 === 0 ? 12 : p.hour % 12
  const m = p.minute.toString().padStart(2, '0')
  return `${h}:${m}${p.hour < 12 ? 'am' : 'pm'}`
}

function formatTimeRange(start: string, end: string, tz: string): string {
  return `${formatTime(start, tz)} – ${formatTime(end, tz)}`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

interface RenderInput {
  firstName: string
  practiceName: string
  practitionerName: string
  appointmentType: string
  dateLine: string
  timeLine: string
  location: string | null
  bookingUrl: string
}

function renderReminderEmail(input: RenderInput): {
  subject: string
  html: string
  text: string
} {
  const safeFirstName = escapeHtml(input.firstName)
  const safePractice = escapeHtml(input.practiceName)
  const safePractitioner = escapeHtml(input.practitionerName)
  const safeType = escapeHtml(input.appointmentType)
  const safeDate = escapeHtml(input.dateLine)
  const safeTime = escapeHtml(input.timeLine)
  const safeLoc = input.location ? escapeHtml(input.location) : null
  const safeUrl = escapeHtml(input.bookingUrl)

  const subject = `Tomorrow: ${input.appointmentType} at ${input.timeLine}`

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#F7F4F0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#1C1917;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F7F4F0;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="540" cellspacing="0" cellpadding="0" border="0" style="max-width:540px;width:100%;">
<tr><td style="padding:0 0 24px;text-align:left;">
<span style="font-family:'Helvetica Neue',Arial,sans-serif;font-weight:800;font-size:20px;letter-spacing:.01em;color:#1E1A18;">Odyssey<span style="color:#2DB24C;">.</span></span>
</td></tr>
<tr><td style="background:#FFFFFF;border:1px solid #E2DDD7;border-radius:14px;padding:32px;">
<div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#A09890;margin-bottom:8px;">Reminder</div>
<h1 style="font-family:Georgia,'Times New Roman',serif;font-weight:700;font-size:22px;line-height:1.25;margin:0 0 12px;color:#231F20;letter-spacing:-.005em;">${safeFirstName}, you&rsquo;ve got a session tomorrow.</h1>
<p style="font-size:15px;line-height:1.55;color:#1C1917;margin:0 0 22px;">${safeType} with ${safePractitioner}.</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 22px;border-collapse:separate;border-spacing:0;width:100%;">
<tr><td style="padding:6px 0;font-size:12px;color:#A09890;text-transform:uppercase;letter-spacing:.06em;font-weight:700;width:120px;">Date</td><td style="padding:6px 0;font-size:15px;color:#1C1917;">${safeDate}</td></tr>
<tr><td style="padding:6px 0;font-size:12px;color:#A09890;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Time</td><td style="padding:6px 0;font-size:15px;color:#1C1917;">${safeTime}</td></tr>
${safeLoc ? `<tr><td style="padding:6px 0;font-size:12px;color:#A09890;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Location</td><td style="padding:6px 0;font-size:15px;color:#1C1917;">${safeLoc}</td></tr>` : ''}
</table>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="left"><tr><td style="background:#1E1A18;border-radius:7px;">
<a href="${safeUrl}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif;font-weight:600;font-size:15px;color:#FFFFFF;text-decoration:none;line-height:1;">View booking</a>
</td></tr></table>
<div style="clear:both;"></div>
<p style="font-size:13px;line-height:1.5;color:#A09890;margin:28px 0 0;">Need to message ${safePractitioner}? Open the portal &mdash; the cancel window has now passed.</p>
</td></tr>
<tr><td style="padding:18px 4px 0;font-size:12px;color:#A09890;line-height:1.55;">${safePractice}</td></tr>
</table>
</td></tr></table>
</body></html>`

  const text = [
    `${input.firstName}, you've got a session tomorrow.`,
    '',
    `${input.appointmentType} with ${input.practitionerName}.`,
    '',
    `Date: ${input.dateLine}`,
    `Time: ${input.timeLine}`,
    ...(input.location ? [`Location: ${input.location}`] : []),
    '',
    `View booking: ${input.bookingUrl}`,
    '',
    `Need to message ${input.practitionerName}? Open the portal — the cancel window has now passed.`,
    '',
    `— ${input.practiceName}`,
  ].join('\n')

  return { subject, html, text }
}
