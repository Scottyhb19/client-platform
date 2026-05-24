import {
  AuthEyebrow,
  AuthHeading,
  AuthShell,
  AuthSubtitle,
} from '@/components/auth/AuthShell'
import { LoginForm } from './_components/LoginForm'

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

      <LoginForm urlError={params.error} next={next} />
    </AuthShell>
  )
}
