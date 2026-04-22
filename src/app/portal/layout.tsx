import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { BottomNav } from './_components/BottomNav'

/**
 * Client portal layout.
 *
 * This route group has its own auth posture: only authenticated users
 * with a linked `clients` row can see the portal. Staff/owners are
 * routed to /dashboard; anyone without a client record is sent to
 * /welcome to finish onboarding.
 *
 * Mobile-first: on a phone the layout is full-bleed; on desktop the
 * portal is a 480px-wide centered column so the same UI works for
 * EPs previewing their client's view.
 */
export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: role } = await supabase.rpc('user_role')

  if (role === 'owner' || role === 'staff') redirect('/dashboard')
  if (role !== 'client') redirect('/unauthorized')

  // Confirm they have a clients row linked. If not, they hit /welcome to
  // finish onboarding — by design, this is the only path that creates
  // the clients.user_id link.
  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!client) redirect('/welcome')

  return (
    <div
      style={{
        background: '#E8ECE9',
        minHeight: '100vh',
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 480,
          minHeight: '100vh',
          background: 'var(--color-surface)',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 0 40px rgba(0,0,0,.04)',
        }}
      >
        <main style={{ flex: 1, overflowY: 'auto' }}>{children}</main>
        <BottomNav />
      </div>
    </div>
  )
}
