import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { WelcomeForm } from './_components/WelcomeForm'

export const dynamic = 'force-dynamic'

/**
 * Invite-acceptance landing.
 *
 * Arrives here via the Supabase invite email → /auth/callback
 * exchange → redirect here with ?client_id=<id>. The user is already
 * authenticated at this point (callback set the session cookie); they
 * just need to set a password + link their clients row.
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

  // Not authenticated → back to login
  if (!user) {
    redirect('/login?error=Invite+link+expired')
  }

  // If already linked + onboarded as a client, just send them to the portal
  const { data: existing } = await supabase
    .from('clients')
    .select('id, first_name, last_name')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .maybeSingle()

  if (existing) {
    redirect('/portal')
  }

  if (!clientId) {
    return (
      <main
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
        }}
      >
        <div
          style={{
            maxWidth: 460,
            background: 'var(--color-card)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 14,
            padding: '28px 32px',
            textAlign: 'center',
          }}
        >
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '1.5rem',
              margin: '0 0 8px',
            }}
          >
            Welcome
          </h1>
          <p
            style={{
              fontSize: '.9rem',
              color: 'var(--color-text-light)',
              lineHeight: 1.55,
            }}
          >
            Your invite link is missing a reference to your client record.
            Ask your EP to resend the invite.
          </p>
        </div>
      </main>
    )
  }

  // Look up the invited client record to greet them by name. RLS blocks
  // non-own rows, but this page runs BEFORE the user is linked — so we
  // need the service role OR a public-read lookup. Safer: use the RPC
  // signature of client_accept_invite which validates email match on
  // write. For the greeting, just show a generic "Welcome" if we can't
  // resolve the name without elevated privileges.
  const { data: client } = await supabase
    .from('clients')
    .select('first_name, last_name, email, organization:organizations(name)')
    .eq('id', clientId)
    .maybeSingle()

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 460,
          background: 'var(--color-card)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 14,
          padding: '28px 32px',
          boxShadow: '0 2px 8px rgba(0,0,0,.04)',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '.72rem',
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            color: 'var(--color-muted)',
            marginBottom: 4,
          }}
        >
          {client?.organization?.name ?? 'Odyssey'}
        </div>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1.6rem',
            margin: 0,
            letterSpacing: '-.01em',
          }}
        >
          {client?.first_name
            ? `Welcome, ${client.first_name}.`
            : 'Welcome.'}
        </h1>
        <p
          style={{
            fontSize: '.9rem',
            color: 'var(--color-text-light)',
            lineHeight: 1.55,
            marginTop: 8,
          }}
        >
          Set a password to finish setting up your portal. You&rsquo;ll sign
          in with {user.email ?? 'your email'} after this.
        </p>

        <WelcomeForm clientId={clientId} />
      </div>
    </main>
  )
}
