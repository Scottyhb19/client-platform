import Link from 'next/link'
import {
  AuthAlert,
  AuthEyebrow,
  AuthHeading,
  AuthShell,
  AuthSubtitle,
} from '@/components/auth/AuthShell'
import { login } from './actions'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>
}) {
  const params = await searchParams
  const next = params.next ?? '/dashboard'

  return (
    <AuthShell>
      <AuthEyebrow>Sign in</AuthEyebrow>
      <AuthHeading>Welcome back.</AuthHeading>
      <AuthSubtitle>Sign in to your practice account.</AuthSubtitle>

      {params.error && <AuthAlert>{params.error}</AuthAlert>}

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

        <div className="mt-4 text-center text-[0.84rem] text-text-light">
          New to Odyssey?{' '}
          <Link
            href="/signup"
            className="font-semibold text-primary hover:underline"
          >
            Set up your practice
          </Link>
        </div>
      </form>
    </AuthShell>
  )
}
