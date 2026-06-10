'use server'

import { redirect } from 'next/navigation'
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server'

/**
 * C-11 burn-on-click. The gate button POSTs here; this action atomically
 * claims the token (writes consumed_at) and redirects to the Supabase
 * action_link. Consequences of doing it this way:
 *
 *  - The action_link never appears in the gate page's HTML or bundle. A
 *    body-parsing scanner (Safe Links / Proofpoint class — the C-14
 *    deferred design weakness) that GETs the gate finds nothing to
 *    follow, and scanners do not execute form POSTs.
 *  - A GET of /i/<id> burns nothing — the gate's design premise
 *    ("rendering is safe; only the human tap consumes") is preserved.
 *    Burning on render would let a scanner's fetch brick the invite.
 *  - The second render of a used link finally reaches the page's
 *    existing "already been used" shell, which was dead code until
 *    something wrote consumed_at.
 *
 * This is a PUBLIC, unauthenticated endpoint by design (invitees have no
 * session yet) — same posture as the gate page itself. The bound tokenId
 * is signed by Next's action encryption, but it is still re-validated
 * here; an invalid shape exits to /login without touching the database.
 */

/**
 * Grace window: a claim that loses because the token was consumed this
 * recently still redirects to the action_link. Covers double-taps and a
 * dropped redirect retried by the human holding the link; gives scanners
 * nothing (they don't POST). If the link was already exchanged at
 * Supabase, GoTrue rejects the second exchange downstream and the
 * /auth/callback error path handles it — the grace never weakens
 * Supabase's own single-use gate.
 */
const CONSUMED_GRACE_MS = 2 * 60 * 1000

export async function continueInviteAction(tokenId: string): Promise<void> {
  if (!isUuid(tokenId)) redirect('/login')

  const admin = createSupabaseServiceRoleClient()
  const nowIso = new Date().toISOString()

  // Atomic claim: one UPDATE wins consumed_at; the expiry check rides in
  // the WHERE so an expired token cannot be claimed at all. Service-role
  // client — invite_tokens RLS denies authenticated by design.
  const { data: claimed } = await admin
    .from('invite_tokens')
    .update({ consumed_at: nowIso })
    .eq('id', tokenId)
    .is('consumed_at', null)
    .gt('expires_at', nowIso)
    .select('action_link')
    .maybeSingle()

  if (claimed) redirect(claimed.action_link)

  // Claim lost — re-read once to decide between grace and a dead token.
  const { data: row } = await admin
    .from('invite_tokens')
    .select('action_link, consumed_at')
    .eq('id', tokenId)
    .maybeSingle()

  if (
    row?.consumed_at &&
    Date.now() - new Date(row.consumed_at).getTime() < CONSUMED_GRACE_MS
  ) {
    redirect(row.action_link)
  }

  // Genuinely dead: consumed beyond grace, expired, or unknown id. The
  // gate page already renders the right error shell for each — bounce
  // back and let its branches speak.
  redirect(`/i/${tokenId}`)
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    s,
  )
}
