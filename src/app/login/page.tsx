import Link from "next/link";
import { login } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;
  const next = params.next ?? "/dashboard";

  return (
    <main className="flex flex-1 min-h-[920px] bg-surface">
      <div className="grid grid-cols-1 lg:grid-cols-2 w-full">
        {/* Left: brand panel */}
        <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-charcoal text-white px-16 py-[60px]">
          <div>
            <div
              className="font-display font-extrabold leading-none"
              style={{ fontSize: "110.4px" }}
            >
              <span className="text-white/95">Odyssey</span>
              <span className="text-accent">.</span>
            </div>
          </div>

          <div className="relative z-10">
            <div className="font-display font-bold uppercase tracking-[0.08em] text-white/40 mb-5 text-[0.7rem]">
              For Exercise Physiologists
            </div>
            <h1 className="font-display font-extrabold text-white m-0 leading-[1.05] tracking-[-0.015em] text-[3.2rem]">
              One platform.
              <br />
              <span className="text-white/50">Your clinical practice.</span>
              <br />
              <span className="text-white/50">Your programming.</span>
            </h1>
            <p className="text-white/60 text-[0.95rem] leading-[1.6] mt-6 max-w-[380px]">
              One platform for clinical practice and programming. Built for solo
              practitioners who care about both the clinic note and the rep
              range.
            </p>
          </div>

          <div className="relative z-10 flex gap-8 pt-7 border-t border-white/[0.08]">
            <Stat n="48k" l="Sessions logged" />
            <Stat n="9.2/10" l="Practitioner NPS" />
            <Stat n="3" l="Surfaces unified" />
          </div>

          {/* Decorative accent glow */}
          <div
            aria-hidden
            className="absolute pointer-events-none rounded-full"
            style={{
              right: -120,
              top: 200,
              width: 360,
              height: 360,
              background:
                "radial-gradient(circle, rgba(45,178,76,.18), transparent 70%)",
            }}
          />
        </aside>

        {/* Right: form */}
        <section className="flex items-center justify-center px-6 py-16 lg:px-20 lg:py-[60px]">
          <div className="w-full max-w-[420px]">
            {/* Mobile-only brand */}
            <div className="lg:hidden mb-10">
              <div className="font-display font-extrabold text-charcoal text-4xl leading-none">
                Odyssey<span className="text-accent">.</span>
              </div>
            </div>

            <div className="font-display font-bold uppercase tracking-[0.06em] text-muted text-[0.68rem] mb-2">
              Sign in
            </div>
            <h2 className="font-display font-extrabold text-charcoal text-[1.9rem] m-0 mb-2 leading-tight">
              Welcome back.
            </h2>
            <p className="text-text-light text-[0.9rem] mb-7">
              Sign in to your practice account.
            </p>

            {params.error && (
              <div
                role="alert"
                className="mb-5 rounded-[8px] border border-alert/30 bg-alert/5 px-4 py-3 text-sm text-alert"
              >
                {params.error}
              </div>
            )}

            <form action={login} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="email"
                  className="font-medium uppercase tracking-[0.04em] text-muted text-[0.7rem]"
                >
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className="w-full bg-surface border border-border-subtle rounded-[7px] px-3 py-[9px] text-[0.85rem] text-text outline-none transition-colors focus:border-primary focus:bg-card"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="password"
                    className="font-medium uppercase tracking-[0.04em] text-muted text-[0.7rem]"
                  >
                    Password
                  </label>
                  <Link
                    href="/login"
                    className="text-[0.7rem] font-medium text-primary hover:underline"
                  >
                    Forgot?
                  </Link>
                </div>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="w-full bg-surface border border-border-subtle rounded-[7px] px-3 py-[9px] text-[0.85rem] text-text outline-none transition-colors focus:border-primary focus:bg-card"
                />
              </div>

              <label className="mt-1 flex cursor-pointer items-center gap-2 text-[0.82rem] text-text-light">
                <input
                  type="checkbox"
                  name="remember"
                  defaultChecked
                  className="h-4 w-4 accent-primary"
                />
                Keep me signed in for 30 days
              </label>

              <input type="hidden" name="next" value={next} />

              <button
                type="submit"
                className="mt-1 w-full rounded-[7px] bg-primary text-white font-semibold text-[0.92rem] px-[22px] py-3 transition-colors hover:bg-primary-dark"
              >
                Sign in
              </button>

              <div className="my-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                <div className="h-px bg-border-subtle" />
                <div className="text-[0.7rem] tracking-[0.04em] text-muted">
                  OR
                </div>
                <div className="h-px bg-border-subtle" />
              </div>

              <button
                type="button"
                disabled
                title="Google sign-in coming soon"
                className="w-full rounded-[7px] border border-border-subtle bg-card text-text font-semibold text-[0.92rem] px-[22px] py-3 transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                Continue with Google
              </button>

              <div className="mt-4 text-center text-[0.84rem] text-text-light">
                New to Odyssey?{" "}
                <Link
                  href="/signup"
                  className="font-semibold text-primary hover:underline"
                >
                  Set up your practice
                </Link>
              </div>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}

function Stat({ n, l }: { n: string; l: string }) {
  return (
    <div>
      <div className="font-display font-extrabold text-white text-[1.5rem] leading-none">
        {n}
      </div>
      <div className="text-white/45 text-[0.72rem] mt-1 tracking-[0.02em]">
        {l}
      </div>
    </div>
  );
}
