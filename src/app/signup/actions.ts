"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function signup(formData: FormData) {
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

  // Site URL used for the email confirmation callback.
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.VERCEL_URL ??
    "http://localhost:3000";

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${origin.startsWith("http") ? origin : `https://${origin}`}/auth/callback`,
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
