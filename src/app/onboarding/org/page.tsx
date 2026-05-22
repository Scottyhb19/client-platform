import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createOrganization } from "./actions";
import { FinishSetup } from "./_components/FinishSetup";

export default async function OnboardingOrgPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // (a) Org claim present → onboarding already complete.
  const { data: orgId } = await supabase.rpc("user_organization_id");
  if (orgId) redirect("/dashboard");

  // (b) Claim absent but a membership row exists → the post-bootstrap JWT
  // refresh didn't land (G-2 stale-JWT state). A5: with a claimless JWT the
  // caller can still SELECT their own row via the `user_id = auth.uid()` branch
  // of the user_organization_roles SELECT policy. Render the recovery state,
  // NOT the form — re-rendering the form here is what produced the misleading
  // "User already belongs to an organization" loop.
  const { data: membership } = await supabase
    .from("user_organization_roles")
    .select("organization_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (membership) {
    return <FinishSetup />;
  }

  // (c) No claim and no membership → genuinely new user; show the form below.

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-lg bg-card rounded-[14px] border border-border-subtle shadow-sm px-8 py-10">
        <p className="text-xs uppercase tracking-[0.2em] text-primary/70">
          Final step
        </p>
        <h1 className="font-display text-3xl font-black text-charcoal mt-2">
          Name your practice
        </h1>
        <p className="text-sm text-slate mt-3">
          Signed in as <span className="font-medium">{user.email}</span>. This
          creates your organization and sets you as the owner.
        </p>

        {params.error && (
          <div
            role="alert"
            className="mt-6 rounded-[8px] border border-alert/30 bg-alert/5 px-4 py-3 text-sm text-alert"
          >
            {params.error}
          </div>
        )}

        <form action={createOrganization} className="mt-6 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-charcoal">
              Practice name
            </span>
            <input
              name="orgName"
              type="text"
              required
              maxLength={200}
              placeholder="e.g. Scott Harrison Exercise Physiology"
              className="h-11 px-3 bg-card rounded-[8px] border border-border-subtle focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-charcoal">
                Your first name
              </span>
              <input
                name="firstName"
                type="text"
                required
                maxLength={100}
                className="h-11 px-3 bg-card rounded-[8px] border border-border-subtle focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-charcoal">
                Your last name
              </span>
              <input
                name="lastName"
                type="text"
                required
                maxLength={100}
                className="h-11 px-3 bg-card rounded-[8px] border border-border-subtle focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-charcoal">Timezone</span>
            <select
              name="timezone"
              defaultValue="Australia/Sydney"
              className="h-11 px-3 bg-card rounded-[8px] border border-border-subtle focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value="Australia/Sydney">Australia/Sydney</option>
              <option value="Australia/Melbourne">Australia/Melbourne</option>
              <option value="Australia/Brisbane">Australia/Brisbane</option>
              <option value="Australia/Perth">Australia/Perth</option>
              <option value="Australia/Adelaide">Australia/Adelaide</option>
              <option value="Australia/Hobart">Australia/Hobart</option>
              <option value="Australia/Darwin">Australia/Darwin</option>
            </select>
          </label>

          <button
            type="submit"
            className="mt-2 h-12 rounded-[8px] bg-primary text-white font-medium hover:bg-primary-dark transition-colors"
          >
            Create practice
          </button>
        </form>
      </div>
    </main>
  );
}
