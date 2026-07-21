"use server";

import { redirect } from "next/navigation";
import { logAuthEvent } from "@/lib/auth/events";
import { getPublicOrigin } from "@/lib/env/site-url";
import { isPublicSignupEnabled } from "@/lib/env/signup";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SignupState } from "./types";

export async function signup(
  _prev: SignupState,
  formData: FormData,
): Promise<SignupState> {
  if (!isPublicSignupEnabled()) {
    redirect("/signup?closed=1");
  }

  const email = (formData.get("email") as string) ?? "";
  const password = (formData.get("password") as string) ?? "";

  if (!email || !password) {
    return { error: "Email and password required", email };
  }
  if (password.length < 12) {
    return { error: "Password must be at least 12 characters", email };
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
    // G-6: auth.signup.failure (docs/auth.md §11).
    await logAuthEvent("auth.signup.failure", {
      email,
      detail: { reason: error.message },
    });
    return { error: error.message, email };
  }

  // G-6: auth.signup.success. organization_id is unknown at this point —
  // the org is created later at /onboarding/org.
  await logAuthEvent("auth.signup.success", {
    userId: data.user?.id ?? null,
    email,
  });

  if (data.session) {
    redirect("/onboarding/org");
  }

  return { status: "check-email", email, error: null };
}
