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

  return NextResponse.redirect(
    new URL('/login?error=Missing+auth+code', url.origin),
  )
}
