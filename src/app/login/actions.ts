"use server";

import { redirect } from "next/navigation";
import { logAuthEvent } from "@/lib/auth/events";
import { postAuthLanding } from "@/lib/auth/post-auth-landing";
import type { UserRole } from "@/lib/auth/require-role";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { LoginState } from "./types";

export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = (formData.get("email") as string) ?? "";
  const password = (formData.get("password") as string) ?? "";
  // Raw `next` — postAuthLanding owns safeNext sanitisation for staff/owner
  // and ignores `next` entirely for clients. See src/lib/auth/post-auth-landing.ts.
  const next = (formData.get("next") as string) ?? "";

  if (!email || !password) {
    return { error: "Email and password required", email };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    // G-6: auth.login.failure — email + reason (docs/auth.md §11).
    await logAuthEvent("auth.login.failure", {
      email,
      detail: { reason: error.message },
    });
    return { error: error.message, email };
  }

  // Role-aware redirect (C-4). signInWithPassword issued a fresh JWT through
  // the Custom Access Token Hook, so user_role() reads the just-injected
  // claim. NULL is handled by postAuthLanding's stale-JWT branch.
  const { data: role } = await supabase.rpc("user_role");
  await logAuthEvent("auth.login.success", {
    userId: data.user?.id ?? null,
    detail: { role: role ?? null },
  });
  redirect(postAuthLanding(role as UserRole | null, next));
}

export async function logout() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/");
}
