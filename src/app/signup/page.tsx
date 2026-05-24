import Link from 'next/link'
import {
  AuthAlert,
  AuthEyebrow,
  AuthHeading,
  AuthShell,
  AuthSubtitle,
} from '@/components/auth/AuthShell'
import { isPublicSignupEnabled } from '@/lib/env/signup'
import { SignupForm } from './_components/SignupForm'

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; info?: string }>
}) {
  if (!isPublicSignupEnabled()) {
    return (
      <AuthShell>
        <AuthEyebrow>Create account</AuthEyebrow>
        <AuthHeading>Signup is currently closed</AuthHeading>
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

          <SignupForm urlError={params.error} />
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
