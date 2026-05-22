import Link from 'next/link'
import {
  AuthAlert,
  AuthEyebrow,
  AuthHeading,
  AuthShell,
  AuthSubtitle,
} from '@/components/auth/AuthShell'
import { requestPasswordReset } from './actions'

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; info?: string }>
}) {
  const params = await searchParams
  const isSent = params.info === 'sent'

  return (
    <AuthShell>
      <AuthEyebrow>Reset password</AuthEyebrow>
      <AuthHeading>Forgot your password?</AuthHeading>

      {isSent ? (
        <>
          <AuthSubtitle>Check your email.</AuthSubtitle>
          <AuthAlert kind="info">
            If an account exists for that email, a reset link is on its way.
            Click it to choose a new password.
          </AuthAlert>
        </>
      ) : (
        <>
          <AuthSubtitle>
            Enter your email and we&rsquo;ll send a link to reset your
            password.
          </AuthSubtitle>

          {params.error && <AuthAlert>{params.error}</AuthAlert>}

          <form action={requestPasswordReset} className="flex flex-col gap-4">
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

            <button
              type="submit"
              className="mt-1 w-full rounded-[7px] bg-primary text-white font-semibold text-[0.92rem] px-[22px] py-3 transition-colors hover:bg-primary-dark"
            >
              Send reset link
            </button>
          </form>
        </>
      )}

      <div className="mt-6 text-center text-[0.84rem] text-text-light">
        Remember your password?{' '}
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
