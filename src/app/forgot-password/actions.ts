"use server";

import { redirect } from "next/navigation";
import { getPublicOrigin } from "@/lib/env/site-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function requestPasswordReset(formData: FormData) {
  const email = formData.get("email") as string;

  if (!email) {
    redirect(`/forgot-password?error=${encodeURIComponent("Email required")}`);
  }

  const supabase = await createSupabaseServerClient();

  const origin = getPublicOrigin();

  // The reset link lands on /auth/callback, which exchanges the recovery token
  // and forwards to `next`. `next` is URL-encoded exactly as the invite flow
  // encodes its next param (clients/new/actions.ts).
  const next = "/auth/reset-password";
  const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(next)}`;

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo,
  });

  // No email enumeration: the user-facing outcome is identical whether or not
  // the email matched an account. We never branch the visible result on
  // existence — every path lands on the same success state below. Any error is
  // logged server-side only (non-enumerating); it is never shown to the user.
  if (error) {
    console.error(
      "[requestPasswordReset] resetPasswordForEmail error:",
      error.message,
    );
  }

  redirect("/forgot-password?info=sent");
}
