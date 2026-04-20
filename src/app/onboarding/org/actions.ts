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
  await supabase.auth.refreshSession();

  redirect("/dashboard");
}
