import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Email confirmation + OAuth callback.
 *
 * Supabase sends users here after signup email confirmation, magic-link,
 * or OAuth provider flows. We exchange the one-time `code` for a session
 * cookie, then redirect to the onboarding or dashboard.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/onboarding/org";

  if (!code) {
    return NextResponse.redirect(
      new URL("/login?error=Missing+auth+code", url.origin),
    );
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin),
    );
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
