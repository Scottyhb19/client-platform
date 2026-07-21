'use server'

import { redirect } from 'next/navigation'
import { mintAcceptLink } from '@/lib/clients/invite-link'
import { getPublicOrigin } from '@/lib/env/site-url'
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
    .select('action_link, client_id')
    .maybeSingle()

  if (claimed) {
    // Legacy row (written before migration 20260721150000): the link was
    // minted at send time and stored — redirect it. Keeps the deploy
    // skew-safe with no shim.
    if (claimed.action_link) redirect(claimed.action_link)

    // C-14 mint-at-POST: the accept URL is minted HERE, at the human's
    // tap — no live OTP link existed anywhere until this moment, and the
    // OTP's TTL starts now rather than at send. The minted link is stored
    // on the row so the C-11 grace window below can serve a double-tap.
    const minted = await mintLinkForToken(admin, tokenId, claimed.client_id)
    if (minted) redirect(minted)

    // Mint failed (GoTrue hiccup, deleted client, …). Un-claim so the
    // human can simply tap again — safe to re-open because scanners never
    // POST (the whole C-11 premise), and the gate's expiry still applies.
    console.error(`[invite-gate] mint-at-POST failed for token=${tokenId}`)
    await admin
      .from('invite_tokens')
      .update({ consumed_at: null })
      .eq('id', tokenId)
    redirect(`/i/${tokenId}?retry=1`)
  }

  // Claim lost — re-read once to decide between grace and a dead token.
  const { data: row } = await admin
    .from('invite_tokens')
    .select('action_link, consumed_at')
    .eq('id', tokenId)
    .maybeSingle()

  if (
    row?.consumed_at &&
    row.action_link &&
    Date.now() - new Date(row.consumed_at).getTime() < CONSUMED_GRACE_MS
  ) {
    // Mint-at-POST note: action_link is present here only after the winning
    // claim stored its minted link. A double-tap that lands before the
    // winner's mint completes (or whose store failed) falls through to the
    // bounce below — the winner's own redirect is already in flight.
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

/**
 * Mint the accept URL for a claimed token and persist it for the grace
 * window. Returns the link, or null on any failure (caller un-claims).
 * Never throws — redirect() must stay outside this function.
 */
async function mintLinkForToken(
  admin: ReturnType<typeof createSupabaseServiceRoleClient>,
  tokenId: string,
  clientId: string,
): Promise<string | null> {
  try {
    const { data: client } = await admin
      .from('clients')
      .select('email')
      .eq('id', clientId)
      .maybeSingle()
    if (!client?.email) return null

    const origin = getPublicOrigin()
    const welcomeNext = `/welcome?client_id=${clientId}`
    const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(welcomeNext)}`

    const minted = await mintAcceptLink(admin, client.email, redirectTo)
    if (!minted.link) {
      console.error(`[invite-gate] mintAcceptLink failed: ${minted.error}`)
      return null
    }

    // Best-effort store for the C-11 double-tap grace; the redirect must
    // not fail on a store hiccup — the link is already in hand.
    const { error: storeErr } = await admin
      .from('invite_tokens')
      .update({ action_link: minted.link })
      .eq('id', tokenId)
    if (storeErr) {
      console.warn(
        `[invite-gate] minted-link store failed (grace window degraded): ${storeErr.message}`,
      )
    }
    return minted.link
  } catch (e) {
    console.error('[invite-gate] mintLinkForToken threw:', e)
    return null
  }
}
