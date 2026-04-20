import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'
import type { Database } from '@/types/database'

/**
 * Refreshes the Supabase auth session on every request.
 *
 * Per Supabase SSR docs, this MUST run early in the request lifecycle so
 * that downstream Server Components see a valid session cookie. Without
 * this middleware, expired access tokens won't refresh and users get
 * unexpectedly signed out mid-session.
 *
 * Route protection (redirect unauthenticated to /login) lives here too,
 * but is intentionally minimal — the deeper authorization decisions live
 * in Server Components via require-role helpers.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // IMPORTANT: re-verify the JWT against the auth server. getSession() reads
  // the cookie without re-verifying, which can be spoofed.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Route protection (kept minimal — Server Components do role-level gating)
  const path = request.nextUrl.pathname
  const isProtected =
    path.startsWith('/dashboard') ||
    path.startsWith('/portal') ||
    path.startsWith('/onboarding')

  if (isProtected && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', path)
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
