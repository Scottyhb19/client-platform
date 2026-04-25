import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { InstallScreen } from './_components/InstallScreen'

export const dynamic = 'force-dynamic'

/**
 * Install interstitial.
 *
 * Sits between /welcome (set password) and /portal (Today screen). The point
 * is to nudge the client to install the PWA to their home screen BEFORE they
 * start using it day-to-day, because the install moment is fleeting — once
 * they're inside the portal they forget the app is installable at all.
 *
 * Auth gate: requires a logged-in client. If they reach this URL without a
 * session (bookmark, sharing) we send them to /login.
 */
export default async function InstallPage() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Practice name for the welcome eyebrow — same lookup as /welcome.
  const { data: client } = await supabase
    .from('clients')
    .select('first_name, organization:organizations(name)')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .maybeSingle()

  return (
    <InstallScreen
      practiceName={client?.organization?.name ?? 'Odyssey'}
      firstName={client?.first_name ?? null}
    />
  )
}
