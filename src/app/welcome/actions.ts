'use server'

import { redirect } from 'next/navigation'
import { checkAcceptInvite } from '@/lib/rate-limit'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { WelcomeState } from './types'

/**
 * Accept-invite action. Called from /welcome after the magic-link
 * callback has established a session for the user.
 *
 * Order matters:
 *   1. Set the password so the user can log in via email/password next
 *      time (Supabase auth sessions expire; they can't rely on the OTP).
 *   2. Rate-limit check (C-6, docs/auth.md §7.2): 10 failures per hour
 *      per uid. Failed-only: only RPC errors count. Generic over-limit
 *      message — do NOT distinguish "limit hit" from any other failure
 *      to a probing attacker.
 *   3. Call client_accept_invite RPC (SECURITY DEFINER) to:
 *        - verify the caller's email matches the invited clients row,
 *        - link clients.user_id = auth.uid(),
 *        - create the user_organization_roles 'client' row.
 *      On RPC error, record a failure under the rate-limit key.
 *   4. Force a session refresh so the JWT picks up the new role/org
 *      claims from the Custom Access Token Hook.
 *   5. Redirect to /portal.
 */
export async function setPasswordAndAcceptAction(
  _prev: WelcomeState,
  formData: FormData,
): Promise<WelcomeState> {
  const clientId = (formData.get('client_id') ?? '').toString()
  const password = (formData.get('password') ?? '').toString()
  const confirm = (formData.get('confirm') ?? '').toString()

  const fieldErrors: WelcomeState['fieldErrors'] = {}
  if (password.length < 12) {
    fieldErrors.password = 'At least 12 characters, please.'
  }
  if (password !== confirm) {
    fieldErrors.confirm = "Passwords don't match."
  }
  if (!clientId) {
    return { error: 'Missing invite context. Ask for a fresh invite.', fieldErrors: {} }
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors }
  }

  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    // C-2: don't claim the invite expired (we can't know that here) and use
    // "practitioner", not "EP", to match the client-facing voice. The session
    // was present when the page rendered and is gone now — say just that.
    return {
      error:
        "We couldn't confirm your session. Ask your practitioner to resend the invite link.",
      fieldErrors: {},
    }
  }

  // 1. Set password
  const { error: pwErr } = await supabase.auth.updateUser({ password })
  if (pwErr) {
    return { error: `Couldn't set password: ${pwErr.message}`, fieldErrors: {} }
  }

  // 1b. Revoke every OTHER session for this account (§3 post-reset
  //     session behaviour, go-live-checklist — applied here for parity
  //     with the reset path). Matters for re-invited accounts whose
  //     auth user predates this invite: any session from the account's
  //     previous life dies at its next token refresh (worst case ~1h,
  //     the access-token TTL). scope:'others' keeps the magic-link
  //     session doing this setup. Best-effort — the password is already
  //     set; don't fail the accept over it.
  const { error: revokeErr } = await supabase.auth.signOut({ scope: 'others' })
  if (revokeErr) {
    console.error(
      `[welcome-accept] sibling-session revoke failed: ${revokeErr.message}`,
    )
  }

  // 2. Rate-limit check (C-6, docs/auth.md §7.2). Failed-only: this
  //    refuses the attempt if recent failures for this uid already meet
  //    the cap. The wrapper FAILS CLOSED — a rate-limit infrastructure
  //    error (RPC error, table unreachable) also lands here with
  //    underLimit=false. Both paths return the identical generic
  //    message with no time-to-reset and no discrimination from an
  //    email-mismatch refusal — a probing attacker cannot distinguish
  //    "limit hit" from "infra down" from "email mismatch".
  const rl = await checkAcceptInvite(user.id)
  if (!rl.underLimit) {
    return {
      error: 'Too many attempts. Try again later.',
      fieldErrors: {},
    }
  }

  // 3. Accept the invite via the SECURITY DEFINER function.
  const { error: acceptErr } = await supabase.rpc('client_accept_invite', {
    p_client_id: clientId,
  })
  if (acceptErr) {
    // Failed-only semantics: record on the RPC error path only.
    // recordFailure soft-fails internally; we ignore its outcome here
    // because the operation has already errored.
    await rl.recordFailure()
    // C-13: the raw RPC message is server-log detail, not user copy.
    console.error(
      `[welcome-accept] client_accept_invite failed: client=${clientId} err=${acceptErr.message}`,
    )
    const mapped = mapAcceptInviteError(acceptErr.message)
    return {
      error: mapped.copy,
      recovery: mapped.recovery,
      fieldErrors: {},
    }
  }

  // 4. Refresh the session so the JWT picks up role='client' + org_id.
  //    (updateUser above already returns a fresh session, but the
  //    custom-access-token hook runs on every issuance, so we're
  //    belt-and-braces here.)
  //
  //    C-1 — see docs/polish/auth-onboarding-client.md. refreshSession()
  //    returns { error } on ordinary failure; the thin try/catch guards
  //    the rare non-AuthError throw (lock timeout, transient network).
  //    Either failure mode leaves a claimless JWT; the recovery is handled
  //    one step downstream at /welcome/install, whose page-level branch
  //    detects "membership row exists but user_role() claim absent" and
  //    renders FinishSetup. The redirect destination below stays
  //    /welcome/install unchanged because the install page IS the
  //    recovery host.
  try {
    await supabase.auth.refreshSession()
  } catch {
    // Swallow — the install page's recovery branch handles it.
  }

  // 5. Nudge the install before they reach the portal. The install screen
  //    detects the platform and serves iOS Safari instructions, an Android
  //    one-tap install, or a "open this on your phone" desktop fallback.
  //    Already-installed clients (display-mode: standalone) auto-bounce
  //    through to /portal so it never feels like an extra step on return.
  redirect('/welcome/install')
}

/**
 * C-13: map client_accept_invite's raw RAISE EXCEPTION strings to humane,
 * recovery-oriented copy. The raw string lands in the server log above —
 * these mappings are for the person standing at the welcome screen.
 *
 * Matching is lowercase-substring, ordered, so a benign rewording of the
 * RPC's message text degrades to the generic fallback rather than leaking
 * raw internals. The fallback also absorbs the two pathological raises
 * ('Not authenticated' is pre-empted by this action's own getUser() check;
 * 'Caller has no email on auth.users' cannot occur for invite-created
 * users) and any future raise added to the RPC without a mapping here.
 */
function mapAcceptInviteError(rawMessage: string): {
  copy: string
  recovery?: 'sign-out'
} {
  const m = rawMessage.toLowerCase()
  if (m.includes('email mismatch')) {
    // The copy instructs a sign-out, so the state must carry the
    // affordance — WelcomeForm renders a sign-out escape on 'sign-out'.
    return {
      copy: "It looks like you're signed in as a different account than the one your practitioner invited. Sign out, then tap the invite link again.",
      recovery: 'sign-out',
    }
  }
  if (m.includes('already been accepted')) {
    return {
      copy: 'This invite was already used by another account. Ask your practitioner to send a fresh one.',
    }
  }
  if (m.includes('revoked')) {
    return {
      copy: 'This invitation is no longer active. Check with your practitioner.',
    }
  }
  if (m.includes('client record not found')) {
    return {
      copy: "We couldn't find your invite. Ask your practitioner to send a fresh one.",
    }
  }
  if (m.includes('not authenticated')) {
    return {
      copy: "We couldn't confirm your session. Ask your practitioner to resend the invite link.",
    }
  }
  return {
    copy: 'Something went wrong linking your account. Ask your practitioner to resend the invite link.',
  }
}
