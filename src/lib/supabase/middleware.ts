import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Strict base64url → UTF-8 decode mirroring @supabase/ssr's cookie decoding.
 * Returns null instead of throwing on malformed input. Runtime-agnostic
 * (atob + TextDecoder, no Buffer) so it behaves identically under the Node
 * and Edge proxy runtimes.
 */
function decodeBase64UrlStrict(value: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null
  try {
    const b64 = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const bin = atob(padded)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/**
 * Names of sb-* cookies whose payload @supabase/ssr cannot decode (invalid
 * base64url / invalid UTF-8), or — for the session-carrying `…-auth-token`
 * cookie — whose payload is not a JSON object (covers a truncated value or
 * a lost chunk). Chunked cookies (`name.0`, `name.1`, …) are joined before
 * validation, exactly as the library joins them.
 *
 * WHY THIS EXISTS: a malformed auth cookie does not just fail the awaited
 * getUser() call — constructing a Supabase client over a poisoned cookie
 * jar also spawns detached promise chains inside supabase-js
 * (_initialize / _emitInitialSession) that re-read the cookie and reject
 * where no try/catch can reach (unhandledRejection). The only complete fix
 * is to never let the library see the poison. Production incident
 * 2026-06-10: one such cookie 500'd every proxied route for that browser
 * until cookies were manually cleared.
 */
function poisonedSupabaseCookieNames(request: NextRequest): string[] {
  const groups = new Map<
    string,
    { name: string; index: number; value: string }[]
  >()
  for (const { name, value } of request.cookies.getAll()) {
    if (!name.startsWith('sb-')) continue
    const chunkMatch = name.match(/^(.*)\.(\d+)$/)
    const base = chunkMatch ? chunkMatch[1] : name
    const index = chunkMatch ? Number(chunkMatch[2]) : -1
    const group = groups.get(base) ?? []
    group.push({ name, index, value })
    groups.set(base, group)
  }

  const poisoned: string[] = []
  for (const [base, parts] of groups) {
    const whole = parts.find((p) => p.index === -1)
    const joined = whole
      ? whole.value
      : parts
          .filter((p) => p.index >= 0)
          .sort((a, b) => a.index - b.index)
          .map((p) => p.value)
          .join('')

    let decoded: string | null = joined
    if (joined.startsWith('base64-')) {
      decoded = decodeBase64UrlStrict(joined.slice('base64-'.length))
    }

    // The session cookie must parse to a JSON object. Other sb-* cookies
    // (e.g. …-auth-token-code-verifier) carry plain strings — only the
    // decode check applies to them.
    if (decoded !== null && base.endsWith('-auth-token')) {
      try {
        const parsed: unknown = JSON.parse(decoded)
        if (parsed === null || typeof parsed !== 'object') decoded = null
      } catch {
        decoded = null
      }
    }

    if (decoded === null) poisoned.push(...parts.map((p) => p.name))
  }
  return poisoned
}

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
  // Purge unreadable sb-* cookies BEFORE constructing the client, so neither
  // the awaited getUser() below nor supabase-js's internal detached promise
  // chains ever parse them. Deleting from request.cookies cleanses the
  // request that NextResponse.next({ request }) forwards to Server
  // Components; the response deletions clear the browser, which otherwise
  // re-sends the poison on every request and can never recover on its own.
  const purgedCookieNames = poisonedSupabaseCookieNames(request)
  purgedCookieNames.forEach((name) => request.cookies.delete(name))

  let supabaseResponse = NextResponse.next({ request })
  purgedCookieNames.forEach((name) => supabaseResponse.cookies.delete(name))

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
          // Re-apply the purge first so a library write to the same cookie
          // name (a fresh, valid value) wins over the deletion.
          purgedCookieNames.forEach((name) =>
            supabaseResponse.cookies.delete(name),
          )
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // IMPORTANT: re-verify the JWT against the auth server. getSession() reads
  // the cookie without re-verifying, which can be spoofed.
  //
  // The sanitizer above should make a throw here unreachable, but getUser()
  // can throw (not just return an error) on cookie shapes it cannot parse —
  // if one slips through, treat the session as unreadable and purge, rather
  // than 500 every proxied route for that browser.
  let user: User | null = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch {
    const remaining = request.cookies
      .getAll()
      .map(({ name }) => name)
      .filter((name) => name.startsWith('sb-'))
    remaining.forEach((name) => request.cookies.delete(name))
    purgedCookieNames.push(...remaining)
    supabaseResponse = NextResponse.next({ request })
    purgedCookieNames.forEach((name) => supabaseResponse.cookies.delete(name))
  }

  // Route protection (kept minimal — Server Components do role-level gating).
  //
  // G-15 (2026-07-23): the staff route prefixes are listed here so a
  // logged-out deep link to any of them redirects with ?next=<path> and
  // SURVIVES login — previously only /dashboard did, and every other staff
  // route silently landed on /dashboard after login (requireRole redirects
  // to bare /login). The middleware only checks user PRESENCE; requireRole
  // stays the sole authority for the claimless (/onboarding/org) and
  // wrong-role (/unauthorized) branches. Maintenance coupling, named at the
  // G-15 sign-off: a NEW top-level staff route must join this list or its
  // deep-links silently drop — see the pointer comment in
  // src/app/(staff)/layout.tsx.
  const path = request.nextUrl.pathname
  const isProtected =
    path.startsWith('/dashboard') ||
    path.startsWith('/portal') ||
    path.startsWith('/onboarding') ||
    path.startsWith('/analytics') ||
    path.startsWith('/clients') ||
    path.startsWith('/contacts') ||
    path.startsWith('/library') ||
    path.startsWith('/messages') ||
    path.startsWith('/schedule') ||
    path.startsWith('/settings')

  if (isProtected && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', path)
    const redirectResponse = NextResponse.redirect(url)
    // A redirect replaces supabaseResponse — carry the purge across so the
    // browser still drops the poison cookies.
    purgedCookieNames.forEach((name) => redirectResponse.cookies.delete(name))
    return redirectResponse
  }

  return supabaseResponse
}
