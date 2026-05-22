"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function setNewPassword(formData: FormData) {
  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirmPassword") as string;

  if (!password || !confirmPassword) {
    redirect(
      `/auth/reset-password?error=${encodeURIComponent(
        "Enter and confirm your new password",
      )}`,
    );
  }

  // KNOWN DE-DUPLICATION DEBT: the 12-character literal below is duplicated
  // from signup/actions.ts:15. There is no shared password validator in the
  // repo; for G-5 we deliberately chose to duplicate the inline check (option
  // one) rather than extract a shared validator. Logged as accepted debt — if
  // a third password-entry surface appears, extract a single validator then.
  if (password.length < 12) {
    redirect(
      `/auth/reset-password?error=${encodeURIComponent(
        "Password must be at least 12 characters",
      )}`,
    );
  }

  if (password !== confirmPassword) {
    redirect(
      `/auth/reset-password?error=${encodeURIComponent(
        "Passwords do not match",
      )}`,
    );
  }

  const supabase = await createSupabaseServerClient();

  // Runs against the recovery session the callback established. If the Supabase
  // dashboard leaked-password policy is enabled, a breached password is
  // rejected here — surface that message rather than swallowing it.
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    redirect(
      `/auth/reset-password?error=${encodeURIComponent(error.message)}`,
    );
  }

  redirect("/dashboard");
}
