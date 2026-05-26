"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function setNewPassword(formData: FormData) {
  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirmPassword") as string;
  const ticketId = (formData.get("ticket") as string) ?? "";

  // The page renders the form only when ?ticket= is present, and bounces
  // to /forgot-password otherwise. Reaching the action without a ticket
  // means the page-level check was bypassed (a hand-rolled form post, a
  // stale tab, or a refresh of a page whose error redirect dropped the
  // ticket). No ticket, no path to a password update.
  if (!ticketId) {
    redirect("/forgot-password");
  }

  // Validation-error redirects preserve the ticket so the user can fix
  // and resubmit without burning a fresh recovery flow. Consumption
  // hasn't happened yet — the ticket is still valid here.
  const ticketedError = (msg: string) =>
    `/auth/reset-password?ticket=${encodeURIComponent(ticketId)}&error=${encodeURIComponent(msg)}`;

  if (!password || !confirmPassword) {
    redirect(ticketedError("Enter and confirm your new password"));
  }

  // KNOWN DE-DUPLICATION DEBT: the 12-character literal below is duplicated
  // from signup/actions.ts:15. There is no shared password validator in the
  // repo; for G-5 we deliberately chose to duplicate the inline check (option
  // one) rather than extract a shared validator. Logged as accepted debt — if
  // a third password-entry surface appears, extract a single validator then.
  if (password.length < 12) {
    redirect(ticketedError("Password must be at least 12 characters"));
  }

  if (password !== confirmPassword) {
    redirect(ticketedError("Passwords do not match"));
  }

  const supabase = await createSupabaseServerClient();

  // SECURITY GATE — Gate 2 of the recovery-session conflation fix.
  // Atomically consume the recovery ticket BEFORE the password write.
  // consume_recovery_ticket (migration 20260527140000, commit 1152df8)
  // performs the email-match-against-auth.uid() AND the consumption
  // mark in ONE UPDATE statement; returns the ticket id on success, or
  // NULL on any failure (already consumed, expired, wrong email for
  // this session, or unknown id). A NULL return MUST block updateUser.
  //
  // The hostile case this gate closes: an authenticated session
  // foothold (obtained via any means — session theft, leaked tokens,
  // any future control failure that grants a session) reaching
  // /auth/reset-password and attempting to silently change the session-
  // owner's password. Without a valid recovery ticket whose email
  // matches the session's auth.users email, the password write is
  // refused at this line.
  const { data: consumedId, error: consumeErr } = await supabase.rpc(
    "consume_recovery_ticket",
    { p_ticket_id: ticketId },
  );

  if (consumeErr || !consumedId) {
    // The ticket is unusable. Could be: not for this session's email,
    // already consumed, expired, or never existed. The user must
    // request a new reset link. Deliberately one message for every
    // NULL-return case — does not distinguish causes, to avoid leaking
    // which one fired.
    redirect(
      `/forgot-password?error=${encodeURIComponent(
        "Recovery link is invalid or expired. Please request a new one.",
      )}`,
    );
  }

  // Consume succeeded — proceed to the password write. Runs against the
  // recovery session the callback established. If the Supabase dashboard
  // leaked-password policy is enabled, a breached password is rejected
  // here — surface that message rather than swallowing it.
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    // updateUser failed AFTER the ticket was already burned by consume.
    // The user cannot retry with the same ticket — they must request a
    // new reset link.
    redirect(
      `/forgot-password?error=${encodeURIComponent(
        `Couldn't set your password (${error.message}). Please request a new reset link.`,
      )}`,
    );
  }

  redirect("/dashboard");
}
