import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/database'

/**
 * Supabase client for Server Components, Server Actions, and Route Handlers.
 *
 * Uses the project's anon key, so RLS applies based on the caller's JWT.
 * The cookie store carries the auth session between requests.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Server Components cannot set cookies. The middleware refreshes
            // the session on each request so this is a tolerable no-op here.
          }
        },
      },
    },
  )
}

/**
 * Service-role client. BYPASSES RLS. Use ONLY in code paths that the client
 * cannot trigger directly — bootstrap functions, retention purge, audit log
 * shipping. Importing this from a Client Component or Route Handler that
 * accepts user input is a security incident waiting to happen.
 *
 * The service role key is server-only and never ships to the browser.
 */
export async function createSupabaseServiceRoleClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll() {
          // Service-role flows shouldn't write session cookies.
        },
      },
    },
  )
}
