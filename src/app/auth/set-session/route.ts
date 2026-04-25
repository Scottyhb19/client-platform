import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Receives the access_token + refresh_token that Supabase's implicit auth
 * flow returns in the URL fragment, and writes them into the session cookie
 * so subsequent server routes can read the user.
 *
 * The fragment is client-side only — never reaches the server on a normal
 * request — so /auth/callback's HTML bridge POSTs the parsed values here.
 * setSession validates the JWT with Supabase's keys, so a forged token
 * fails at this hop, not later.
 */
export async function POST(request: Request) {
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
