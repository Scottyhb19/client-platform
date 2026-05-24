"use server";

import { getPublicOrigin } from "@/lib/env/site-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ResendResult =
  | { status: "sent" }
  | { status: "error"; error: string };

/**
 * Re-sends the signup confirmation email for an address that signed up but
 * has not yet confirmed. Runs on the normal cookie-scoped server client, not
 * service-role — `auth.resend` is a public GoTrue method.
 */
export async function resendConfirmation(email: string): Promise<ResendResult> {
  if (!email) {
    return { status: "error", error: "No email address to send to." };
  }

  const supabase = await createSupabaseServerClient();
  const origin = getPublicOrigin();

  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });

  if (error) {
    return { status: "error", error: error.message };
  }

  return { status: "sent" };
}
