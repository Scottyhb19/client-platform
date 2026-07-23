import type { Viewport } from 'next'
import { redirect } from 'next/navigation'
import {
  createSupabaseServerClient,
  createSupabaseServiceRoleClient,
} from '@/lib/supabase/server'
import { AccessEnded } from './_components/AccessEnded'
import { BottomNav } from './_components/BottomNav'
import { RegisterSW } from './_components/RegisterSW'
import { TimezoneSync } from './_components/TimezoneSync'

// PWA identity (manifest, apple-touch-icon, app title) is declared once in
// the ROOT layout and inherited here — clients install from /welcome/install,
// outside this segment, so it cannot live only on portal routes.

export const viewport: Viewport = {
  themeColor: '#1E1A18',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover', // lets us use env(safe-area-inset-*) on iOS
}

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

  if (!client) {
    // P2-3 (2026-07-23): distinguish "never onboarded" from "archived".
    // The client's own RLS view cannot see their archived row (deliberate),
    // so this one probe uses the service-role client, keyed strictly on the
    // authenticated user's id — no caller-supplied input. An archived client
    // gets the designed closed door instead of the onboarding funnel.
    const svc = createSupabaseServiceRoleClient()
    const { data: archived } = await svc
      .from('clients')
      .select('organization_id, organization:organizations(name)')
      .eq('user_id', user.id)
      .not('deleted_at', 'is', null)
      .maybeSingle()

    if (archived) {
      return <AccessEnded practiceName={archived.organization?.name ?? null} />
    }
    redirect('/welcome')
  }

  // Resolve the client's thread (if any) once so BottomNav can subscribe to
  // realtime with a filter. Supabase realtime postgres_changes silently drops
  // events when there's no filter on certain configurations — using the same
  // thread_id filter as the working ClientThread subscription rules that out.
  const { data: thread } = await supabase
    .from('message_threads')
    .select('id')
    .is('deleted_at', null)
    .maybeSingle()

  // Unread staff→client messages count for the portal nav badge, scoped to
  // the live thread resolved above (no thread → nothing to count, skip the
  // query). Scoping to thread.id rather than relying on RLS alone keeps an
  // archived thread's messages out of the badge — the mirror of the staff
  // TopBar bug. Today an archived client never reaches this layout (the
  // AccessEnded gate above), but the scope holds if a thread-level archive
  // path ever lands.
  let unreadFromStaff = 0
  if (thread) {
    const { count } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('thread_id', thread.id)
      .eq('sender_role', 'staff')
      .is('read_at', null)
      .is('deleted_at', null)
    unreadFromStaff = count ?? 0
  }

  return (
    <div className="portal-shell">
      <div className="portal-shell__column">
        <main style={{ flex: 1, overflowY: 'auto' }}>{children}</main>
        <BottomNav
          messageCount={unreadFromStaff}
          threadId={thread?.id ?? null}
        />
      </div>
      <RegisterSW />
      <TimezoneSync />
    </div>
  )
}
