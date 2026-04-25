import { redirect } from 'next/navigation'
import {
  AuthEyebrow,
  AuthHeading,
  AuthShell,
  AuthSubtitle,
} from '@/components/auth/AuthShell'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { InstallScreen } from './_components/InstallScreen'

export const dynamic = 'force-dynamic'

/**
 * Install interstitial — sits between /welcome (set password) and /portal
 * so newly-onboarded clients get nudged to add the PWA to their home screen
 * while the install moment is fresh. AuthShell wrapper keeps the visual
 * journey consistent with /login → /welcome.
 */
export default async function InstallPage() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: client } = await supabase
    .from('clients')
    .select('first_name, organization:organizations(name)')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .maybeSingle()

  const practiceName = client?.organization?.name ?? 'Odyssey'
  const firstName = client?.first_name ?? null

  return (
    <AuthShell>
      <AuthEyebrow>{practiceName}</AuthEyebrow>
      <AuthHeading>
        {firstName ? `One more step, ${firstName}.` : 'One more step.'}
      </AuthHeading>
      <AuthSubtitle>
        Add Odyssey to your home screen so it opens like an app — no Safari
        tabs, no scrolling through bookmarks.
      </AuthSubtitle>
      <InstallScreen />
    </AuthShell>
  )
}
