import { requireRole } from "@/lib/auth/require-role";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logout } from "../login/actions";

export default async function DashboardPage() {
  const { email, role, organizationId } = await requireRole(["owner", "staff"]);

  const supabase = await createSupabaseServerClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("name, timezone")
    .eq("id", organizationId)
    .single();

  return (
    <main className="flex flex-1 flex-col px-8 py-10">
      <header className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-primary/70">
            Dashboard · placeholder
          </p>
          <h1 className="font-display text-4xl font-black text-charcoal mt-2">
            {org?.name ?? "Your practice"}
          </h1>
          <p className="text-sm text-slate mt-1">
            Signed in as {email} · role {role} · tz {org?.timezone ?? "—"}
          </p>
        </div>

        <form action={logout}>
          <button
            type="submit"
            className="h-10 px-4 rounded-[8px] border border-border-subtle bg-card text-charcoal text-sm hover:bg-surface transition-colors"
          >
            Sign out
          </button>
        </form>
      </header>

      <section className="mt-10 max-w-2xl bg-card rounded-[14px] border border-border-subtle shadow-sm p-8">
        <h2 className="font-display text-2xl font-black text-charcoal">
          Backend is live
        </h2>
        <p className="text-sm text-slate mt-3 leading-6">
          You&rsquo;re seeing this because the full Gate 1–4 stack worked end
          to end: schema, RLS, audit triggers, signup bootstrap, and the
          Next.js auth wiring. The dashboard content (stat cards, needs-
          attention panel, today&rsquo;s sessions, client list) comes next.
        </p>
      </section>
    </main>
  );
}
