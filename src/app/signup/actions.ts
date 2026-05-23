"use server";

import { redirect } from "next/navigation";
import { getPublicOrigin } from "@/lib/env/site-url";
import { isPublicSignupEnabled } from "@/lib/env/signup";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function signup(formData: FormData) {
  if (!isPublicSignupEnabled()) {
    redirect("/signup?closed=1");
  }

  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!email || !password) {
    redirect(
      `/signup?error=${encodeURIComponent("Email and password required")}`,
    );
  }
  if (password.length < 12) {
    redirect(
      `/signup?error=${encodeURIComponent(
        "Password must be at least 12 characters",
      )}`,
    );
  }

  const supabase = await createSupabaseServerClient();

  const origin = getPublicOrigin();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });

  if (error) {
    redirect(`/signup?error=${encodeURIComponent(error.message)}`);
  }

  // If email confirmations are ON (the default for self-signup), session is null
  // until the user clicks the confirmation link. Tell them to check mail.
  // If confirmations are OFF, the session is already set; onboard now.
  if (data.session) {
    redirect("/onboarding/org");
  }

  redirect("/signup?info=check-email");
}
