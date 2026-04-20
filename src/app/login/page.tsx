import Link from "next/link";
import { login } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;

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
          Sign in
        </h1>

        {params.error && (
          <div
            role="alert"
            className="mt-6 rounded-[8px] border border-alert/30 bg-alert/5 px-4 py-3 text-sm text-alert"
          >
            {params.error}
          </div>
        )}

        <form action={login} className="mt-6 flex flex-col gap-4">
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
            <span className="text-sm font-medium text-charcoal">Password</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="h-11 px-3 bg-card rounded-[8px] border border-border-subtle focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </label>
          <input type="hidden" name="next" value={params.next ?? "/dashboard"} />
          <button
            type="submit"
            className="mt-2 h-12 rounded-[8px] bg-primary text-white font-medium hover:bg-primary-dark transition-colors"
          >
            Sign in
          </button>
        </form>

        <p className="mt-8 text-sm text-slate">
          No account yet?{" "}
          <Link href="/signup" className="text-primary font-medium hover:underline">
            Start your practice
          </Link>
        </p>
      </div>
    </main>
  );
}
