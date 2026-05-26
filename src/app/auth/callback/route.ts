import { NextResponse } from 'next/server'
import { safeNext } from '@/lib/auth/safe-next'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Email confirmation + OAuth + invite callback.
 *
 * Supabase sends users here after:
 *   - Email signup confirmation (OTP `code`)
 *   - Password reset (OTP `code`)
 *   - OAuth providers (`code`)
 *   - Magic-link sign-in (`token_hash` + `type=magiclink`)
 *   - Admin invite (`token_hash` + `type=invite`)
 *
 * We try both code exchange and token_hash verification so every flow
 * lands in the same place. On success, redirect to `next` (defaults to
 * /onboarding/org for first-time signups).
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const tokenHash = url.searchParams.get('token_hash')
  const type = url.searchParams.get('type') as
    | 'signup'
    | 'invite'
    | 'magiclink'
    | 'recovery'
    | 'email_change'
    | 'email'
    | null
  // Validate `next` at the source AND again at each downstream sink (the
  // two NextResponse.redirect calls below and the implicit-flow HTML
  // bridge wrap `next` again with safeNext). safeNext is idempotent — a
  // value that already passes returns unchanged — so the layered wraps
  // are no-ops on the happy path; the value is that each redirect line
  // is independently safe to read in isolation and the protection cannot
  // be undone by editing one place. Open-redirect defence; see
  // src/lib/auth/safe-next.ts.
  const next = safeNext(url.searchParams.get('next'), '/onboarding/org')

  // Forward the password-recovery ticket (Gate-2 wiring; see migration
  // 20260527140000_password_recovery_tickets, commit 1152df8) as a
  // SEPARATE query param, never inside `next`. safeNext validates only
  // the next path; the ticket is an opaque UUID appended after the
  // validated path via encodeURIComponent. Non-recovery callback flows
  // (signup confirmation, OAuth, magic-link) won't carry a ticket, so
  // appendTicket is a no-op for them. Applied at every redirect sink
  // below — defense-in-depth so the ticket survives regardless of
  // which branch (code, tokenHash, or implicit-flow bridge) Supabase
  // happens to route through.
  const ticket = url.searchParams.get('ticket')
  const appendTicket = (validatedNext: string): string => {
    if (!ticket) return validatedNext
    const sep = validatedNext.includes('?') ? '&' : '?'
    return `${validatedNext}${sep}ticket=${encodeURIComponent(ticket)}`
  }

  const supabase = await createSupabaseServerClient()

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      return NextResponse.redirect(
        new URL(
          `/login?error=${encodeURIComponent(error.message)}`,
          url.origin,
        ),
      )
    }
    return NextResponse.redirect(new URL(appendTicket(safeNext(next, '/onboarding/org')), url.origin))
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    })
    if (error) {
      return NextResponse.redirect(
        new URL(
          `/login?error=${encodeURIComponent(error.message)}`,
          url.origin,
        ),
      )
    }
    return NextResponse.redirect(new URL(appendTicket(safeNext(next, '/onboarding/org')), url.origin))
  }

  // Supabase's implicit flow puts BOTH outcomes in the URL fragment:
  //   success → #access_token=...&refresh_token=...&type=invite
  //   error   → #error=access_denied&error_code=...&error_description=...
  // The fragment never reaches the server, so we render a tiny HTML bridge
  // that reads it client-side. On success it POSTs the tokens to
  // /auth/set-session (which writes them into the session cookie via
  // supabase.auth.setSession), then redirects to `next`. On error it
  // redirects to /login with the real error in the query.
  // safeNext() wraps `next` again at this sink so the bridge can only ever
  // receive a validated local path; appendTicket() then appends the
  // forwarded recovery ticket (if any) as a separate query param.
  // JSON.stringify finally JS-literal-escapes the result for XSS-safe
  // interpolation into the script body. Idempotent: when the source-level
  // validation already passed, the safeNext wrap is a no-op; appendTicket
  // is a no-op when no ticket param is present (most callback flows).
  const nextJsLiteral = JSON.stringify(appendTicket(safeNext(next, '/onboarding/org')))
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Signing you in…</title></head>
<body style="font-family:-apple-system,sans-serif;padding:32px;color:#78746f;background:#F7F4F0;">
<p>Signing you in…</p>
<script>
  (async function(){
    try {
      var hash = location.hash.slice(1);
      var params = new URLSearchParams(hash);
      var err = params.get('error_description') || params.get('error_code') || params.get('error');
      if (err) {
        var u = new URL('/login', location.origin);
        u.searchParams.set('error', err);
        location.replace(u.toString());
        return;
      }
      var access_token = params.get('access_token');
      var refresh_token = params.get('refresh_token');
      if (!access_token || !refresh_token) {
        var u2 = new URL('/login', location.origin);
        u2.searchParams.set('error', 'Sign-in link is missing an auth code. Ask for a fresh invite.');
        location.replace(u2.toString());
        return;
      }
      var resp = await fetch('/auth/set-session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ access_token: access_token, refresh_token: refresh_token })
      });
      if (!resp.ok) {
        var data = await resp.json().catch(function(){ return {}; });
        var u3 = new URL('/login', location.origin);
        u3.searchParams.set('error', (data && data.error) || 'Could not establish session.');
        location.replace(u3.toString());
        return;
      }
      // Drop the fragment so refreshes on /welcome don't leak the tokens
      // back into anything; replace() history-cleans the redirect.
      location.replace(${nextJsLiteral});
    } catch (e) {
      var u4 = new URL('/login', location.origin);
      u4.searchParams.set('error', 'Sign-in failed: ' + (e && e.message ? e.message : e));
      location.replace(u4.toString());
    }
  })();
</script>
</body></html>`
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}
