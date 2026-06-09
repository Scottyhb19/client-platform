import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  AuthEyebrow,
  AuthHeading,
  AuthShell,
  AuthSubtitle,
} from '@/components/auth/AuthShell'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { WelcomeForm } from './_components/WelcomeForm'

export const dynamic = 'force-dynamic'

/**
 * Invite-acceptance landing.
 *
 * Arrives here via the Supabase invite email → /auth/callback exchange
 * → redirect here with ?client_id=<id>. The user is already authenticated
 * at this point; they just need to set a password + link their clients
 * row. Layout shares the AuthShell with /login + /signup so the journey
 * from email click to portal feels continuous.
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ client_id?: string }>
}) {
  const { client_id: clientId } = await searchParams

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    // No session. We do NOT claim the invite expired — only the invite gate
    // at /i/[id] knows that (it checks expires_at). Here we can see exactly
    // one thing: there's no session. Say only what we know. (C-2)
    if (!clientId) {
      // No invite context at all — they just need to sign in.
      redirect('/login')
    }
    // Invite context present but the session is gone (cleared cookies, an old
    // email tab, or a lapsed invite session). Keep them here with the recovery
    // path rather than bouncing to a "sign in" they may have no password for.
    return (
      <AuthShell>
        <AuthEyebrow>Welcome</AuthEyebrow>
        <AuthHeading>You&rsquo;re signed out.</AuthHeading>
        <AuthSubtitle>
          We couldn&rsquo;t read your invite session. Ask your practitioner to
          resend the invite link.
        </AuthSubtitle>
        <p className="mt-6 text-center text-[0.84rem] text-text-light">
          Already set up?{' '}
          <Link
            href="/login"
            className="font-semibold text-primary hover:underline"
          >
            Sign in
          </Link>
        </p>
      </AuthShell>
    )
  }

  // If already linked + onboarded as a client, send straight to the portal.
  const { data: existing } = await supabase
    .from('clients')
    .select('id, first_name, last_name')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .maybeSingle()

  if (existing) redirect('/portal')

  if (!clientId) {
    return (
      <AuthShell>
        <AuthEyebrow>Welcome</AuthEyebrow>
        <AuthHeading>Something&rsquo;s missing.</AuthHeading>
        <AuthSubtitle>
          Your invite link is missing a reference to your client record. Ask
          your practitioner to resend the invite.
        </AuthSubtitle>
      </AuthShell>
    )
  }

  // Greet by name when we can. RLS hides non-own clients before linking,
  // so we may not be able to read first_name; fall back to a plain greeting.
  const { data: client } = await supabase
    .from('clients')
    .select('first_name, last_name, organization:organizations(name)')
    .eq('id', clientId)
    .maybeSingle()

  return (
    <AuthShell>
      <AuthEyebrow>{client?.organization?.name ?? 'Welcome'}</AuthEyebrow>
      <AuthHeading>
        {client?.first_name ? `Welcome, ${client.first_name}.` : 'Welcome.'}
      </AuthHeading>
      <AuthSubtitle>
        Set a password to finish setting up your portal. You&rsquo;ll sign in
        with {user.email ?? 'your email'} after this.
      </AuthSubtitle>
      <WelcomeForm clientId={clientId} />
    </AuthShell>
  )
}
