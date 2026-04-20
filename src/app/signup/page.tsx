import Link from "next/link";
import { signup } from "./actions";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; info?: string }>;
}) {
  const params = await searchParams;
  const isCheckEmail = params.info === "check-email";

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md bg-card rounded-[14px] border border-border-subtle shadow-sm px-8 py-10">
        <Link
          href="/"
          className="text-xs uppercase tracking-[0.2em] text-primary/70 hover:text-primary"
        >
          ← Client Platform
        </Link>
        <h1 className="font-display text-3xl font-black text-charcoal mt-6">
          Start your practice
        </h1>

        {isCheckEmail ? (
          <div className="mt-6 rounded-[8px] border border-primary/30 bg-primary/5 px-4 py-4 text-sm text-primary">
            Check your email. We sent a confirmation link — click it to finish
            creating your account.
          </div>
        ) : (
          <>
            <p className="text-sm text-slate mt-3">
              Create an account. You&rsquo;ll name your practice on the next screen.
            </p>

            {params.error && (
              <div
                role="alert"
                className="mt-6 rounded-[8px] border border-alert/30 bg-alert/5 px-4 py-3 text-sm text-alert"
              >
                {params.error}
              </div>
            )}

            <form action={signup} className="mt-6 flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-charcoal">Email</span>
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className="h-11 px-3 bg-card rounded-[8px] border border-border-subtle focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-charcoal">
                  Password
                </span>
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  className="h-11 px-3 bg-card rounded-[8px] border border-border-subtle focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                <span className="text-xs text-slate">
                  At least 12 characters.
                </span>
              </label>
              <button
                type="submit"
                className="mt-2 h-12 rounded-[8px] bg-primary text-white font-medium hover:bg-primary-dark transition-colors"
              >
                Create account
              </button>
            </form>
          </>
        )}

        <p className="mt-8 text-sm text-slate">
          Already have an account?{" "}
          <Link href="/login" className="text-primary font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
