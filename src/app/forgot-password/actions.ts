"use server";

import { redirect } from "next/navigation";
import { getPublicOrigin } from "@/lib/env/site-url";
import {
  createSupabaseServerClient,
  createSupabaseServiceRoleClient,
} from "@/lib/supabase/server";

const TICKET_LIFETIME_HOURS = 1;

export async function requestPasswordReset(formData: FormData) {
  const email = formData.get("email") as string;

  if (!email) {
    redirect(`/forgot-password?error=${encodeURIComponent("Email required")}`);
  }

  const supabase = await createSupabaseServerClient();

  const origin = getPublicOrigin();

  // Mint a recovery ticket (Gate-2 wiring; the password_recovery_tickets
  // table and atomic consume RPC landed in Gate 1, commit 1152df8).
  // Service-role client: this form is public, has no authenticated
  // session, and the table has RLS enabled with no permissive policy —
  // only service-role inserts and the SECURITY DEFINER consume RPC can
  // touch it. The service role key is server-only and never reaches
  // the browser (see src/lib/supabase/server.ts:56-68).
  //
  // No enumeration risk: an attacker calling this form with an arbitrary
  // email mints a ticket that no real session can ever consume.
  // consume_recovery_ticket's WHERE-clause email-match resolves against
  // auth.uid()'s auth.users row, so a ticket whose email doesn't match
  // the caller's session is permanently NULL on consume. Forging a
  // ticket for someone else's email yields nothing.
  const admin = createSupabaseServiceRoleClient();
  const expiresAt = new Date(
    Date.now() + TICKET_LIFETIME_HOURS * 60 * 60 * 1000,
  );
  const { data: ticketRow, error: ticketErr } = await admin
    .from("password_recovery_tickets")
    .insert({ email, expires_at: expiresAt.toISOString() })
    .select("id")
    .single();

  if (ticketErr || !ticketRow) {
    // Same non-enumerating posture as the rest of this flow: log
    // server-side, never branch the user-visible outcome on the error.
    // The reset-password page bounces missing-ticket arrivals to
    // /forgot-password anyway, so this falls through to the same UX
    // the user would see if the email never matched an account.
    console.error(
      "[requestPasswordReset] password_recovery_tickets insert error:",
      ticketErr?.message ?? "no row returned",
    );
    redirect("/forgot-password?info=sent");
  }

  // The reset link lands on /auth/callback, which validates `next` via
  // safeNext (open-redirect fix, commit a81c1ca) and forwards the
  // ticket through to the reset-password page as a separate query
  // param. The two security controls (safeNext-validated next; opaque
  // ticket) are deliberately kept in distinct URL params so they
  // cannot cross-contaminate.
  const next = "/auth/reset-password";
  const redirectTo =
    `${origin}/auth/callback?next=${encodeURIComponent(next)}` +
    `&ticket=${encodeURIComponent(ticketRow.id)}`;

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
