import { logout } from '../../login/actions'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PortalTop } from '../_components/PortalTop'

export const dynamic = 'force-dynamic'

export default async function PortalYouPage() {
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [{ data: client }, { data: program }] = await Promise.all([
    supabase
      .from('clients')
      .select(
        `id, first_name, last_name, email, phone, created_at,
         organization:organizations(name)`,
      )
      .eq('user_id', user?.id ?? '')
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('programs')
      .select('name, start_date')
      .eq('status', 'active')
      .is('deleted_at', null)
      .maybeSingle(),
  ])

  if (!client) {
    return (
      <>
        <PortalTop title="You" />
        <div
          style={{
            margin: '0 16px 16px',
            fontSize: '.88rem',
            color: 'var(--color-text-light)',
          }}
        >
          We couldn&rsquo;t load your profile. Try signing out and back in.
        </div>
      </>
    )
  }

  const rows: Array<[string, string]> = [
    ['Active program', program?.name ?? 'None yet'],
    ['Practice', client.organization?.name ?? '—'],
    ['Email', client.email],
    ['Phone', client.phone ?? '—'],
    [
      'Since',
      new Intl.DateTimeFormat('en-AU', {
        month: 'short',
        year: 'numeric',
      }).format(new Date(client.created_at)),
    ],
  ]

  return (
    <>
      <PortalTop
        title="You"
        greeting={`${client.first_name} ${client.last_name}`}
      />
      <div style={{ padding: '0 16px' }}>
        {rows.map(([k, v]) => (
          <div
            key={k}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '14px 16px',
              background: '#fff',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 10,
              marginBottom: 8,
              gap: 12,
            }}
          >
            <span
              style={{ color: 'var(--color-text-light)', fontSize: '.84rem' }}
            >
              {k}
            </span>
            <span
              style={{
                fontWeight: 600,
                fontSize: '.84rem',
                textAlign: 'right',
              }}
            >
              {v}
            </span>
          </div>
        ))}

        <form action={logout} style={{ marginTop: 18 }}>
          <button
            type="submit"
            style={{
              width: '100%',
              padding: 14,
              background: '#fff',
              color: 'var(--color-text)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 10,
              fontFamily: 'var(--font-sans)',
              fontWeight: 600,
              fontSize: '.9rem',
              cursor: 'pointer',
            }}
          >
            Sign out
          </button>
        </form>
      </div>
    </>
  )
}
