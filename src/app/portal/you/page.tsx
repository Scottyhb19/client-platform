import { cookies } from 'next/headers'
import { SignOutButton } from './_components/SignOutButton'
import { SessionThemeToggle } from './_components/SessionThemeToggle'
import { SessionAutofillToggle } from './_components/SessionAutofillToggle'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PortalTop } from '../_components/PortalTop'
import { PORTAL_AUTOFILL_COOKIE } from '../_lib/portal-helpers'

export const dynamic = 'force-dynamic'

export default async function PortalYouPage() {
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [{ data: client }, { data: activePrograms }] = await Promise.all([
    supabase
      .from('clients')
      .select(
        `id, first_name, last_name, email, phone, created_at,
         organization:organizations(name)`,
      )
      .eq('user_id', user?.id ?? '')
      .is('deleted_at', null)
      .maybeSingle(),
    // FM-1 (item 3): never .maybeSingle() — it throws once a loose one-off
    // container coexists with a dated block. Fetch all active; resolve below.
    supabase
      .from('programs')
      .select('name, is_loose, start_date')
      .eq('status', 'active')
      .is('deleted_at', null)
      .order('is_loose', { ascending: true })
      .order('start_date', { ascending: true, nullsFirst: false }),
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

  // Earliest dated block's name; if the client only has one-off sessions,
  // "Your sessions" (Q-B — never the internal container name); else none.
  const datedBlock = (activePrograms ?? []).find((p) => !p.is_loose)
  const activeProgramName = datedBlock
    ? datedBlock.name
    : (activePrograms ?? []).some((p) => p.is_loose)
      ? 'Your sessions'
      : null

  const rows: Array<[string, string]> = [
    ['Active program', activeProgramName ?? 'None yet'],
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

  const autofillOn =
    (await cookies()).get(PORTAL_AUTOFILL_COOKIE)?.value !== 'off'

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
            className="portal-card is-compact"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '14px 16px',
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

        {/* In-session screen theme preference (P1-1) */}
        <SessionThemeToggle />

        {/* In-session autofill preference (P1-2 follow-up) */}
        <SessionAutofillToggle initialOn={autofillOn} />

        {/* Install-to-home tip */}
        <div
          className="portal-card is-compact"
          style={{
            marginTop: 18,
            padding: '14px 16px',
            fontSize: '.8rem',
            lineHeight: 1.5,
            color: 'var(--color-text-light)',
          }}
        >
          <div
            className="portal-eyebrow"
            // Override muted → primary: this tip's eyebrow is its own
            // anchor (no surrounding section title to depend on).
            style={{
              fontSize: '.7rem',
              color: 'var(--color-primary)',
              marginBottom: 4,
            }}
          >
            Pin to home screen
          </div>
          On iPhone, tap <strong>Share</strong> →{' '}
          <strong>Add to Home Screen</strong>. On Android, tap{' '}
          <strong>Install</strong> in the browser menu. Your portal then
          launches like any other app.
        </div>

        <SignOutButton />
      </div>
    </>
  )
}
