import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function HomePage() {
  // If already signed in, skip the landing — route them to their home.
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: role } = await supabase.rpc("user_role");
    if (role === "client") redirect("/portal");
    if (role === "owner" || role === "staff") redirect("/dashboard");
    redirect("/onboarding/org");
  }

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-lg bg-card rounded-[14px] border border-border-subtle shadow-sm px-10 py-14">
        <p className="font-display text-xs uppercase tracking-[0.2em] text-primary/70">
          Client Platform
        </p>
        <h1 className="font-display text-4xl sm:text-5xl font-black text-charcoal leading-[1.05] mt-4 text-balance">
          Clinical care and exercise programming, under one roof.
        </h1>
        <p className="text-slate text-base leading-7 mt-6">
          Built for Exercise Physiologists. Notes, programs, scheduling, and
          client communication — one workflow, your data.
        </p>

        <div className="mt-10 flex flex-col gap-3">
          <Link
            href="/signup"
            className="inline-flex items-center justify-center h-12 rounded-[8px] bg-primary text-white font-medium text-base hover:bg-primary-dark transition-colors"
          >
            Start your practice
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center h-12 rounded-[8px] border border-border-subtle bg-card text-charcoal font-medium text-base hover:bg-surface transition-colors"
          >
            Sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
