import { redirect } from 'next/navigation'
import {
  AuthEyebrow,
  AuthHeading,
  AuthShell,
  AuthSubtitle,
} from '@/components/auth/AuthShell'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { FinishSetup } from './_components/FinishSetup'
import { InstallScreen } from './_components/InstallScreen'

export const dynamic = 'force-dynamic'

/**
 * Install interstitial — sits between /welcome (set password) and /portal
 * so newly-onboarded clients get nudged to add the PWA to their home screen
 * while the install moment is fresh. AuthShell wrapper keeps the visual
 * journey consistent with /login → /welcome.
 *
 * Also hosts the C-1 recovery branch: when the welcome action's
 * refreshSession() failed silently and left a claimless JWT, this page
 * detects "membership row exists but user_role() claim absent" and renders
 * FinishSetup instead of the install screen. See
 * docs/polish/auth-onboarding-client.md C-1.
 */
export default async function InstallPage() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Read role claim, membership row, and clients row in parallel.
  //
  // The user_organization_roles SELECT policy carries a `user_id = auth.uid()`
  // arm that does NOT depend on custom claims, so a stale-JWT client can
  // still confirm their own membership row (see docs/polish/auth-onboarding-
  // client.md, user_organization_roles RLS verbatim). The clients SELECT
  // policy gates on custom claims, so the clients read returns null in the
  // recovery branch — fine, we only need the linked-row read for the happy
  // path's eyebrow + heading.
  const [
    { data: role },
    { data: membership },
    { data: client },
  ] = await Promise.all([
    supabase.rpc('user_role'),
    supabase
      .from('user_organization_roles')
      .select('organization_id')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('clients')
      .select('first_name, organization:organizations(name)')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .maybeSingle(),
  ])

  // Branch (b): membership row exists but JWT carries no role claim. The
  // C-1 stale-JWT state — welcome action's refreshSession failed. Render
  // FinishSetup, which makes exactly one browser-side refresh attempt and
  // offers a bounded sign-out escape on failure.
  if (membership && !role) {
    return (
      <AuthShell>
        <FinishSetup />
      </AuthShell>
    )
  }

  // Branch (c): no membership row at all. The invite acceptance never
  // linked. Could be (i) a direct visit to /welcome/install by a non-
  // invitee, or (ii) the C-1 R-5 sub-case (welcome step 1 succeeded but
  // step 2 RPC failed). The R-5 path is handled operationally by
  // docs/runbooks/recover-stuck-client-onboarding.md; here we just route
  // back to /welcome, which renders the "Something's missing" copy state
  // when no client_id is supplied.
  if (!membership) {
    redirect('/welcome')
  }

  // Branch (a): claim present + (likely) clients row linked → install screen.
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
