import { NextResponse } from 'next/server'
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
  const next = url.searchParams.get('next') ?? '/onboarding/org'

  // TEMP DEBUG — print every incoming param so we can see what's being
  // sent. Some flows redirect with `error=...&error_code=...` instead
  // of code/token_hash; surfacing those helps us diagnose. Remove once
  // the invite flow is verified end-to-end.
  console.info('[callback] full url:', request.url)
  console.info(
    '[callback] params:',
    Object.fromEntries(url.searchParams.entries()),
  )

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
    return NextResponse.redirect(new URL(next, url.origin))
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
    return NextResponse.redirect(new URL(next, url.origin))
  }

  // Supabase's implicit flow puts both successes (access_token) and errors
  // (error_description) in the URL FRAGMENT, which never reaches the server.
  // Return a tiny HTML bridge that reads the fragment client-side and
  // re-redirects to /login with the real error in the query string —
  // otherwise every magic-link error reads as the bland "Missing auth code".
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Continuing…</title></head>
<body style="font-family:-apple-system,sans-serif;padding:32px;color:#78746f;">
<p>Continuing…</p>
<script>
  (function(){
    var hash = location.hash.slice(1);
    var params = new URLSearchParams(hash);
    var msg = params.get('error_description')
      || params.get('error_code')
      || params.get('error')
      || 'No auth code received from the verifier.';
    var u = new URL('/login', location.origin);
    u.searchParams.set('error', msg);
    location.replace(u.toString());
  })();
</script>
</body></html>`
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}
