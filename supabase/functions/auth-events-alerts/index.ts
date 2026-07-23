// ============================================================================
// auth-events-alerts — hourly auth.md §11 threshold alerting (G-6 F-2)
// ============================================================================
// Runs as a Supabase Edge Function on an hourly pg_cron schedule
// (auth-events-alerts-hourly, migration 20260723170000). Calls the
// auth_events_threshold_scan RPC (20260723150000) over the trailing hour and
// emails the operator (ALERT_EMAIL) via Resend when either §11 threshold is
// breached:
//
//   * >10 signup failures / hour           (investigation trigger)
//   * >50 login failures / hour / IP       (account-lock trigger — the lock
//                                           itself is a manual response; the
//                                           alert is the pager)
//
// A sustained attack re-alerts each hour by design (the scan window is the
// trailing hour) — no dedupe state to go stale.
//
// Secrets: shares the project secret set with the other two functions
// (CRON_SHARED_SECRET, RESEND_API_KEY, EMAIL_FROM, REMINDER_SERVICE_KEY).
// ALERT_EMAIL is the one addition — the operator's alert inbox. Fail-loud:
// missing config is a 500, never a silent skip (an unconfigured alerter that
// returns 200 is worse than none).
//
// Deploy:
//   supabase functions deploy auth-events-alerts --project-ref <prod-ref>
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.3'

interface IpBreach {
  ip: string
  count: number
}

interface ScanResult {
  window_minutes: number
  signup_failures: number
  login_failures_total: number
  login_failure_ip_breaches: IpBreach[]
}

const SIGNUP_FAILURES_PER_HOUR = 10 // auth.md §11: >10/hour → investigate

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
  const fromAddress = Deno.env.get('EMAIL_FROM') ?? ''
  const alertEmail = Deno.env.get('ALERT_EMAIL') ?? ''

  if (!supabaseUrl || !serviceKey) {
    return new Response('missing supabase config', { status: 500 })
  }
  if (!resendKey || !fromAddress || !alertEmail) {
    console.error(
      'auth-events-alerts misconfigured: RESEND_API_KEY / EMAIL_FROM / ALERT_EMAIL must all be set.',
    )
    return new Response('missing alert config', { status: 500 })
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await supabase.rpc('auth_events_threshold_scan')
  if (error) {
    return jsonResponse(500, { error: error.message })
  }

  const scan = data as unknown as ScanResult
  const breaches: string[] = []

  if (scan.signup_failures > SIGNUP_FAILURES_PER_HOUR) {
    breaches.push(
      `${scan.signup_failures} signup failures in the last hour (threshold ${SIGNUP_FAILURES_PER_HOUR}) — investigate (auth.md §11).`,
    )
  }
  for (const b of scan.login_failure_ip_breaches ?? []) {
    breaches.push(
      `${b.count} login failures from ${b.ip} in the last hour (threshold 50) — consider locking the targeted account(s) (auth.md §11).`,
    )
  }

  if (breaches.length === 0) {
    return jsonResponse(200, { breaches: 0, scan })
  }

  const subject = `Odyssey auth alert: ${breaches.length} threshold breach${breaches.length === 1 ? '' : 'es'} in the last hour`
  const text = [
    'The hourly auth-event threshold scan (docs/auth.md §11) found:',
    '',
    ...breaches.map((b) => `- ${b}`),
    '',
    `Totals this window: ${scan.login_failures_total} login failures, ${scan.signup_failures} signup failures.`,
    '',
    'Raw rows: query public.auth_events (operator-side) for the trailing hour.',
    'Response playbook: docs/incident-response.md.',
  ].join('\n')

  const send = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: fromAddress, to: alertEmail, subject, text }),
  })

  if (!send.ok) {
    const body = await send.text().catch(() => '')
    console.error(
      `auth alert email FAILED (resend ${send.status}): ${body.slice(0, 300)} — breaches were: ${breaches.join(' | ')}`,
    )
    return jsonResponse(500, { breaches: breaches.length, emailed: false })
  }

  return jsonResponse(200, { breaches: breaches.length, emailed: true })
})

// Fail closed: verify_jwt=false means this is the only barrier — an unset
// secret must 500, never fall through. (Mirrors send-appointment-reminders.)
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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
