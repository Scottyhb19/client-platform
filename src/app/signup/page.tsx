import Link from 'next/link'
import {
  AuthEyebrow,
  AuthHeading,
  AuthShell,
} from '@/components/auth/AuthShell'
import { isPublicSignupEnabled } from '@/lib/env/signup'
import { SignupForm } from './_components/SignupForm'

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
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

  return (
    <AuthShell>
      <AuthEyebrow>Create account</AuthEyebrow>
      <AuthHeading>Start your practice.</AuthHeading>

      <SignupForm urlError={params.error} />

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
