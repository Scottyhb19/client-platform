import Link from 'next/link'
import {
  AuthAlert,
  AuthEyebrow,
  AuthHeading,
  AuthShell,
  AuthSubtitle,
} from '@/components/auth/AuthShell'
import { signup } from './actions'

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; info?: string }>
}) {
  const params = await searchParams
  const isCheckEmail = params.info === 'check-email'

  return (
    <AuthShell>
      <AuthEyebrow>Create account</AuthEyebrow>
      <AuthHeading>Start your practice.</AuthHeading>

      {isCheckEmail ? (
        <>
          <AuthSubtitle>One more step.</AuthSubtitle>
          <AuthAlert kind="info">
            Check your email. We sent a confirmation link — click it to
            finish creating your account.
          </AuthAlert>
        </>
      ) : (
        <>
          <AuthSubtitle>
            Create an account. You&rsquo;ll name your practice on the next
            screen.
          </AuthSubtitle>

          {params.error && <AuthAlert>{params.error}</AuthAlert>}

          <form action={signup} className="flex flex-col gap-4">
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
              <label
                htmlFor="password"
                className="font-medium uppercase tracking-[0.04em] text-muted text-[0.7rem]"
              >
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                className="w-full bg-surface border border-border-subtle rounded-[7px] px-3 py-[9px] text-[0.85rem] text-text outline-none transition-colors focus:border-primary focus:bg-card"
              />
              <span className="text-[0.74rem] text-text-light">
                At least 12 characters.
              </span>
            </div>

            <button
              type="submit"
              className="mt-1 w-full rounded-[7px] bg-primary text-white font-semibold text-[0.92rem] px-[22px] py-3 transition-colors hover:bg-primary-dark"
            >
              Create account
            </button>
          </form>
        </>
      )}

      <div className="mt-6 text-center text-[0.84rem] text-text-light">
        Already have an account?{' '}
        <Link
          href="/login"
          className="font-semibold text-primary hover:underline"
        >
          Sign in
        </Link>
      </div>
    </AuthShell>
  )
}
