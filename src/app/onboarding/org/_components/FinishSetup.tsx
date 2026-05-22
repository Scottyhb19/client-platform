"use client";

import { useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { logout } from "../../../login/actions";

/**
 * G-2 recovery state. Reached when onboarding created the organization but the
 * JWT refresh in the bootstrap action did not land, leaving a claimless session
 * (see docs/polish/auth-onboarding-staff.md G-2).
 *
 * Behaviour is deliberately bounded:
 *  - Exactly ONE automatic browser-side refreshSession() attempt. The browser
 *    client (@supabase/ssr) writes the refreshed session into the same cookie
 *    the SSR middleware reads, so a hard navigation to /dashboard then carries
 *    the organization_id claim (A6).
 *  - On success → hard-navigate to /dashboard.
 *  - On failure, or if /dashboard bounces back here (the refresh did not carry
 *    through), STOP — no retries, no indefinite spinner — and offer a plain
 *    sign-out / sign-in escape wired to the existing logout action. This is
 *    what keeps the ~1h self-healing soft-lockout from becoming a hard loop.
 */
export function FinishSetup() {
  const [state, setState] = useState<"working" | "failed">("working");
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    const KEY = "odyssey_g2_recovery_at";

    // All state changes happen inside this async scope (never synchronously in
    // the effect body) to avoid cascading renders.
    (async () => {
      // A recent value means we already took our one shot and /dashboard
      // bounced back — stop and show the manual escape rather than looping. A
      // timestamp (not a bare flag) so a stale value from earlier in the
      // session doesn't suppress a fresh, legitimate attempt later.
      const prev = sessionStorage.getItem(KEY);
      if (prev && Date.now() - Number(prev) < 30000) {
        setState("failed");
        return;
      }

      const supabase = createSupabaseBrowserClient();
      try {
        const { error } = await supabase.auth.refreshSession();
        if (error) {
          setState("failed");
          return;
        }
        // Mark the single shot, then hard-navigate so the new request carries
        // the freshly-written cookie.
        sessionStorage.setItem(KEY, String(Date.now()));
        window.location.assign("/dashboard");
      } catch {
        setState("failed");
      }
    })();
  }, []);

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-lg bg-card rounded-[14px] border border-border-subtle shadow-sm px-8 py-10">
        <p className="text-xs uppercase tracking-[0.2em] text-primary/70">
          Almost there
        </p>
        {state === "working" ? (
          <>
            <h1 className="font-display text-3xl font-black text-charcoal mt-2">
              Finishing setup
            </h1>
            <p className="text-sm text-slate mt-3">
              Loading your practice. One moment.
            </p>
          </>
        ) : (
          <>
            <h1 className="font-display text-3xl font-black text-charcoal mt-2">
              Finish setting up
            </h1>
            <p className="text-sm text-slate mt-3">
              Your practice is created. Sign out and sign back in to load it.
            </p>
            <form action={logout} className="mt-6">
              <button
                type="submit"
                className="h-12 w-full rounded-[8px] bg-primary text-white font-medium hover:bg-primary-dark transition-colors"
              >
                Sign out
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
