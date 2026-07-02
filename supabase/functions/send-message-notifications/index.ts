// ============================================================================
// send-message-notifications — client→EP new-message email worker (P1-1c)
// ============================================================================
// Runs as a Supabase Edge Function on a 5-minute pg_cron schedule
// (message-notifications-5min). Drains message_notifications rows where
// status='scheduled' AND scheduled_for is in the past, sends each via
// Resend, and flips status to 'sent' or 'failed'. This is the queue+cron
// upgrade of the messaging P1-1(c) email (docs/polish/messaging.md) — the
// former best-effort `after()` send is gone; the DB trigger
// message_notification_enqueue (20260702140000) enqueues, this worker
// sends, and every outcome is a queryable row (`succeeded≥1` synthetic
// check, mirroring send-appointment-reminders).
//
// Honesty gate at send time: if the EP has read the thread before the tick
// (no unread client messages remain), the row is retired as 'cancelled'
// instead of sent — never email "you have a message" about a read thread.
//
// The email carries NO message body — client first name only (the P1-1c
// compliance posture: health-adjacent content stays inside the RLS/audit
// perimeter). Template inlined below, ported verbatim from the former
// src/lib/email/templates/message-notification.ts, which is deleted with
// this change so there is no second copy to drift from (the P2-7 lesson).
//
// Secrets: the same project-level Edge secret set as
// send-appointment-reminders — CRON_SHARED_SECRET (bearer gate),
// REMINDER_SERVICE_KEY (sb_secret DB key; named for the first worker but
// project-scoped), RESEND_API_KEY, EMAIL_FROM (fail loud if unset),
// NEXT_PUBLIC_APP_URL. No new secrets.
//
// Deploy (config.toml already carries verify_jwt=false for this function —
// required BEFORE first deploy or the gateway rejects the cron's non-JWT
// bearer):
//   supabase functions deploy send-message-notifications
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.3'

interface NotificationRow {
  id: string
  thread_id: string
  organization_id: string
  recipient_user_id: string
  retry_count: number
}

const BATCH_SIZE = 50
// Matches the message_notifications.retry_count CHECK (0–5).
const MAX_RETRIES = 5

// Mirrors src/lib/email/client.ts EmailConfigError (same duplication note as
// send-appointment-reminders — Deno can't import from the Next app's src/lib).
class EmailConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EmailConfigError'
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 })
  }

  const expectedToken = Deno.env.get('CRON_SHARED_SECRET')
  const denied = authorizeCronRequest(req, expectedToken)
  if (denied) return denied

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey =
    Deno.env.get('REMINDER_SERVICE_KEY') ??
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
    ''
  const resendKey = Deno.env.get('RESEND_API_KEY') ?? ''
  const fromAddress = Deno.env.get('EMAIL_FROM')
  if (!fromAddress) {
    throw new EmailConfigError(
      'EMAIL_FROM environment variable is not set. Refusing to send email from the Resend sandbox sender. Set EMAIL_FROM to a verified-domain address in your environment configuration.',
    )
  }
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

  const { data: due, error: dueErr } = await supabase
    .from('message_notifications')
    .select('id, thread_id, organization_id, recipient_user_id, retry_count')
    .eq('status', 'scheduled')
    .eq('provider', 'resend')
    .lte('scheduled_for', new Date().toISOString())
    .limit(BATCH_SIZE)

  if (dueErr) {
    return jsonResponse(500, { error: dueErr.message })
  }

  const rows: NotificationRow[] = (due ?? []) as NotificationRow[]
  if (rows.length === 0) {
    return jsonResponse(200, { processed: 0 })
  }

  let succeeded = 0
  let failed = 0
  let retried = 0
  let skipped = 0

  for (const row of rows) {
    // Honesty gate: if nothing is unread any more (EP read the thread since
    // enqueue), retire the row rather than send a stale notification.
    const { count: unread, error: unreadErr } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('thread_id', row.thread_id)
      .eq('sender_role', 'client')
      .is('read_at', null)
      .is('deleted_at', null)
    if (unreadErr) {
      // Transient DB read failure — leave the row for the next tick.
      retried += 1
      continue
    }
    if ((unread ?? 0) === 0) {
      await markCancelled(supabase, row.id, 'thread read before send')
      skipped += 1
      continue
    }

    // Recipient email: canonical auth email via the admin API
    // (user_profiles carries no email).
    const { data: u } = await supabase.auth.admin.getUserById(
      row.recipient_user_id,
    )
    const to = u?.user?.email
    if (!to) {
      await markFailed(supabase, row.id, 'recipient has no auth email')
      failed += 1
      continue
    }

    // Client first name (the only client detail in the email) + practice name.
    const { data: threadRow } = await supabase
      .from('message_threads')
      .select('client_id')
      .eq('id', row.thread_id)
      .maybeSingle()
    let clientFirstName = 'A client'
    if (threadRow?.client_id) {
      const { data: clientRow } = await supabase
        .from('clients')
        .select('first_name')
        .eq('id', threadRow.client_id)
        .maybeSingle()
      if (clientRow?.first_name) clientFirstName = clientRow.first_name
    }
    const { data: orgRow } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', row.organization_id)
      .maybeSingle()
    const practiceName = orgRow?.name ?? 'Odyssey'

    const { subject, html, text } = renderMessageNotificationEmail({
      clientFirstName,
      practiceName,
      inboxUrl: appUrl ? `${appUrl}/messages` : '#',
    })

    let ok = false
    let status = 0
    let errBody = ''
    try {
      const send = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: fromAddress, to, subject, html, text }),
      })
      status = send.status
      if (send.ok) {
        let messageId: string | null = null
        try {
          const json = (await send.json()) as { id?: string }
          messageId = json.id ?? null
        } catch {
          // Resend usually returns JSON; if not, leave messageId null.
        }
        await markSent(supabase, row.id, messageId)
        succeeded += 1
        ok = true
      } else {
        errBody = await send.text().catch(() => '')
      }
    } catch (e) {
      status = 0
      errBody = e instanceof Error ? e.message : String(e)
    }

    if (ok) continue

    // Retry transient failures (network / 429 / 5xx) on later ticks by
    // leaving status='scheduled' and bumping retry_count, up to MAX_RETRIES;
    // then fail terminally. A 4xx is a permanent client error → fail now.
    const reason = `resend ${status || 'network'}: ${errBody.slice(0, 400)}`
    const retryable = status === 0 || status === 429 || status >= 500
    if (retryable && row.retry_count < MAX_RETRIES) {
      await markRetry(supabase, row.id, row.retry_count + 1, reason)
      retried += 1
    } else {
      await markFailed(supabase, row.id, reason)
      failed += 1
    }
  }

  return jsonResponse(200, {
    processed: rows.length,
    succeeded,
    failed,
    retried,
    skipped,
  })
})

// Fail closed: verify_jwt=false means this is the only barrier — an unset
// secret must 500, never fall through. (Verbatim mirror of
// send-appointment-reminders; the two workers share the one CRON_SHARED_SECRET.)
export function authorizeCronRequest(
  req: Request,
  expectedToken: string | undefined,
): Response | null {
  if (!expectedToken || expectedToken.trim().length === 0) {
    console.error('CRON_SHARED_SECRET is not configured — refusing request.')
    return new Response('server misconfigured', { status: 500 })
  }
  const authHeader = req.headers.get('Authorization') ?? ''
  if (authHeader !== `Bearer ${expectedToken}`) {
    return new Response('unauthorized', { status: 401 })
  }
  return null
}

async function markSent(
  supabase: ReturnType<typeof createClient>,
  notificationId: string,
  messageId: string | null,
): Promise<void> {
  // Atomic flip — the WHERE on status='scheduled' means a concurrent
  // invocation that already won this row can't have its update overwritten.
  await supabase
    .from('message_notifications')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      provider_message_id: messageId,
    })
    .eq('id', notificationId)
    .eq('status', 'scheduled')
}

async function markFailed(
  supabase: ReturnType<typeof createClient>,
  notificationId: string,
  reason: string,
): Promise<void> {
  await supabase
    .from('message_notifications')
    .update({
      status: 'failed',
      failed_at: new Date().toISOString(),
      failure_reason: reason.slice(0, 500),
    })
    .eq('id', notificationId)
    .eq('status', 'scheduled')
}

async function markRetry(
  supabase: ReturnType<typeof createClient>,
  notificationId: string,
  retryCount: number,
  reason: string,
): Promise<void> {
  await supabase
    .from('message_notifications')
    .update({
      retry_count: retryCount,
      failure_reason: reason.slice(0, 500),
    })
    .eq('id', notificationId)
    .eq('status', 'scheduled')
}

async function markCancelled(
  supabase: ReturnType<typeof createClient>,
  notificationId: string,
  reason: string,
): Promise<void> {
  await supabase
    .from('message_notifications')
    .update({
      status: 'cancelled',
      failure_reason: reason.slice(0, 500),
    })
    .eq('id', notificationId)
    .eq('status', 'scheduled')
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ----------------------------------------------------------------------------
// Email rendering — THE CANONICAL source for the new-message notification.
// Ported verbatim from the deleted src/lib/email/templates/message-notification.ts
// (P1-1c); first-name-only by design, no message body, ever.
// ----------------------------------------------------------------------------

interface MessageNotificationEmailInput {
  /** Client's first name — the only client detail included (no surname, no body). */
  clientFirstName: string
  practiceName: string
  /** Link to the staff inbox — points to /messages. */
  inboxUrl: string
}

function renderMessageNotificationEmail(input: MessageNotificationEmailInput): {
  subject: string
  html: string
  text: string
} {
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
              <h1 style="font-family:'Helvetica Neue',Arial,sans-serif; font-weight:800; font-size:24px; line-height:1.2; margin:0 0 14px; color:#231F20; letter-spacing:-.005em;">
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
