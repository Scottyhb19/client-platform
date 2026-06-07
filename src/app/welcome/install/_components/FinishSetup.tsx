'use client'

import { useEffect, useRef, useState } from 'react'
import {
  AuthEyebrow,
  AuthHeading,
  AuthSubtitle,
} from '@/components/auth/AuthShell'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { logout } from '../../../login/actions'

/**
 * C-1 recovery state. Reached when the welcome action's
 * setPasswordAndAcceptAction created the user_organization_roles membership
 * row via client_accept_invite but the post-RPC refreshSession() failed
 * silently, leaving a claimless JWT. See docs/polish/auth-onboarding-client.md
 * C-1.
 *
 * Behaviour is deliberately bounded:
 *  - Exactly ONE automatic browser-side refreshSession() attempt. The browser
 *    client (@supabase/ssr) writes the refreshed session into the same cookie
 *    the SSR helper reads, so a hard navigation to /portal then carries the
 *    user_role + organization_id claims.
 *  - On success → hard-navigate to /portal.
 *  - On failure, or if /portal bounces back here (the refresh did not carry
 *    through), STOP — no retries, no indefinite spinner — and offer a plain
 *    sign-out / sign-in escape wired to the existing logout action. This is
 *    what keeps the ~1h self-healing soft-lockout from becoming a hard loop.
 *
 * sessionStorage key (`odyssey_c1_recovery_at`) is distinct from staff G-2's
 * `odyssey_g2_recovery_at` so a user who hits both surfaces in one session
 * doesn't trip the wrong guard. The C-1 R-5 sub-case (membership absent
 * entirely) is handled by an operator-driven manual procedure at
 * docs/runbooks/recover-stuck-client-onboarding.md, not by this component.
 *
 * Renders inner content only; caller wraps in AuthShell.
 */
export function FinishSetup() {
  const [state, setState] = useState<'working' | 'failed'>('working')
  const attempted = useRef(false)

  useEffect(() => {
    if (attempted.current) return
    attempted.current = true

    const KEY = 'odyssey_c1_recovery_at'

    // All state changes happen inside this async scope (never synchronously
    // in the effect body) to avoid cascading renders.
    ;(async () => {
      // A recent value means we already took our one shot and /portal
      // bounced back — stop and show the manual escape rather than looping.
      // Timestamp (not a bare flag) so a stale value from earlier in the
      // session doesn't suppress a fresh, legitimate attempt later.
      const prev = sessionStorage.getItem(KEY)
      if (prev && Date.now() - Number(prev) < 30000) {
        setState('failed')
        return
      }

      const supabase = createSupabaseBrowserClient()
      try {
        const { error } = await supabase.auth.refreshSession()
        if (error) {
          setState('failed')
          return
        }
        // Mark the single shot, then hard-navigate so the new request
        // carries the freshly-written cookie.
        sessionStorage.setItem(KEY, String(Date.now()))
        window.location.assign('/portal')
      } catch {
        setState('failed')
      }
    })()
  }, [])

  if (state === 'working') {
    return (
      <>
        <AuthEyebrow>Almost there</AuthEyebrow>
        <AuthHeading>Finishing setup</AuthHeading>
        <AuthSubtitle>Loading your portal. One moment.</AuthSubtitle>
      </>
    )
  }

  return (
    <>
      <AuthEyebrow>Almost there</AuthEyebrow>
      <AuthHeading>Finish setting up</AuthHeading>
      <AuthSubtitle>
        Your invite was accepted. Sign out and sign back in to load your
        portal.
      </AuthSubtitle>
      <form action={logout}>
        <button
          type="submit"
          className="h-12 w-full rounded-[8px] bg-primary text-white font-medium hover:bg-primary-dark transition-colors"
        >
          Sign out
        </button>
      </form>
    </>
  )
}
