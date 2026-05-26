import { NextResponse } from 'next/server'
import { getPublicOrigin } from '@/lib/env/site-url'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Receives the access_token + refresh_token that Supabase's implicit auth
 * flow returns in the URL fragment, and writes them into the session cookie
 * so subsequent server routes can read the user.
 *
 * The fragment is client-side only — never reaches the server on a normal
 * request — so /auth/callback's HTML bridge POSTs the parsed values here.
 *
 * Important: supabase.auth.setSession() in @supabase/auth-js v2 does NOT
 * re-verify the JWT signature locally. It writes the tokens to the session
 * cookie after at most an expiry check; signature verification is deferred
 * to the next supabase.auth.getUser() call, which hits Supabase's /user
 * endpoint. A forged access_token therefore survives setSession and only
 * fails at the next protected page-load.
 *
 * That deferral means the same-origin guard below — not any local token
 * validation — is the control that prevents login-CSRF here. Without the
 * guard, a cross-origin page could POST attacker-owned (real, not forged)
 * tokens with mode:'no-cors': the JS could not read the response, but the
 * Set-Cookie would still land in the victim's jar, signing them in as the
 * attacker. The only legitimate caller is the same-origin browser fetch in
 * /auth/callback's HTML bridge; browsers send Origin on POSTs per the
 * fetch spec, so a missing Origin is treated as illegitimate.
 */
export async function POST(request: Request) {
  // Same-origin guard — login-CSRF defence. Browsers send Origin on POSTs
  // for both same-origin and cross-origin requests (WHATWG fetch spec), so
  // the legitimate /auth/callback bridge always carries Origin = trusted
  // origin; an attacker page's cross-origin POST carries its own origin and
  // is rejected before any cookie write. Missing Origin is rejected
  // outright — the only legitimate caller is a browser fetch which always
  // sends it. Comparison is exact equality after canonicalising
  // getPublicOrigin() through new URL(...).origin (strips trailing slash),
  // mirroring src/lib/auth/safe-next.ts.
  const trustedOrigin = new URL(getPublicOrigin()).origin
  const requestOrigin = request.headers.get('origin')
  if (requestOrigin !== trustedOrigin) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  let access_token: string | null = null
  let refresh_token: string | null = null
  try {
    const body = (await request.json()) as {
      access_token?: string
      refresh_token?: string
    }
    access_token = body.access_token ?? null
    refresh_token = body.refresh_token ?? null
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  if (!access_token || !refresh_token) {
    return NextResponse.json(
      { error: 'access_token and refresh_token are required.' },
      { status: 400 },
    )
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.setSession({
    access_token,
    refresh_token,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 401 })
  }
  return NextResponse.json({ ok: true })
}
