"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function createOrganization(formData: FormData) {
  const orgName = (formData.get("orgName") as string)?.trim();
  const timezone = (formData.get("timezone") as string) || "Australia/Sydney";
  const firstName = (formData.get("firstName") as string)?.trim();
  const lastName = (formData.get("lastName") as string)?.trim();

  if (!orgName || !firstName || !lastName) {
    redirect(
      `/onboarding/org?error=${encodeURIComponent("All fields are required")}`,
    );
  }

  const supabase = await createSupabaseServerClient();

  // Must be signed in (middleware already enforces this, but defence-in-depth).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { error } = await supabase.rpc("create_organization_with_owner", {
    p_org_name: orgName,
    p_timezone: timezone,
    p_first_name: firstName,
    p_last_name: lastName,
  });

  if (error) {
    redirect(
      `/onboarding/org?error=${encodeURIComponent(error.message)}`,
    );
  }

  // Force a JWT refresh so organization_id + user_role claims are picked up.
  // G-2: refreshSession() returns { error } on ordinary failure (A3); the thin
  // try/catch guards the rare non-AuthError / lock-timeout throw. On failure —
  // or if the refreshed JWT still carries no org claim — route to the recovery
  // state on /onboarding/org, NOT through /dashboard. Sending a still-claimless
  // user to /dashboard is what requireRole bounces back, causing the loop.
  let needsRecovery = false;
  try {
    const { error: refreshErr } = await supabase.auth.refreshSession();
    if (refreshErr) needsRecovery = true;
  } catch {
    needsRecovery = true;
  }

  if (!needsRecovery) {
    // Post-refresh claim re-check: only go to /dashboard if the new JWT actually
    // carries the org claim; otherwise the redirect would bounce.
    const { data: orgId } = await supabase.rpc("user_organization_id");
    if (!orgId) needsRecovery = true;
  }

  // redirect() throws NEXT_REDIRECT, so it stays outside the try/catch above.
  if (needsRecovery) {
    redirect("/onboarding/org");
  }

  redirect("/dashboard");
}
