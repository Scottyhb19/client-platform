import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/database'

/**
 * Supabase client for Client Components ('use client'). Uses the anon key
 * and reads/writes auth cookies via document.cookie. RLS applies.
 *
 * Prefer the server client (lib/supabase/server.ts) where possible —
 * Server Components and Server Actions are the default in this codebase.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
