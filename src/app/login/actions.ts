"use server";

import { redirect } from "next/navigation";
import { safeNext } from "@/lib/auth/safe-next";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { LoginState } from "./types";

export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = (formData.get("email") as string) ?? "";
  const password = (formData.get("password") as string) ?? "";
  // Validate `next` as a local same-origin path before honouring it on
  // successful sign-in. Open-redirect protection — see src/lib/auth/safe-next.ts.
  const next = safeNext(formData.get("next"));

  if (!email || !password) {
    return { error: "Email and password required", email };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: error.message, email };
  }

  redirect(next);
}

export async function logout() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/");
}
