import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Application-level rate limiting (per `docs/auth.md §7.2`).
 *
 * This module exports exactly two live entry points:
 *
 *   - `checkAndRecordStaffInvite(uid)` — all-attempts gate for the
 *     staff invite flow. 20 attempts per hour per staff uid.
 *
 *   - `checkAcceptInvite(uid)` — failed-only gate for the client
 *     accept-invite flow. 10 failures per hour per client uid. The
 *     returned object carries a `recordFailure()` closure called from
 *     the catch branch of the protected operation. No success
 *     counterpart is exposed — the failed-only semantics is encoded
 *     into the API surface so a call site cannot get the count-set
 *     wrong.
 *
 * Deliberately omitted: a `sendCommunication` wrapper. The spec's
 * `sendCommunication` (email/SMS) limit at 100/hr/org is
 * infrastructure-ready (the generic
 * `rate_limit_check_and_record` RPC covers it) but has NO live call
 * site today — there is no broadcast/reply send path to wrap, and the
 * existing invite-send is already inside `staffInviteClient`'s
 * perimeter. Adding a wrapper now would invite a wrong wire-up. The
 * generic RPC is the integration point when a real broadcast path
 * lands. See flag P-I in
 * `docs/polish/auth-onboarding-client.md`.
 *
 * Failure modes are deliberately OPPOSITE for the two exports —
 * see the per-export JSDoc and the inline rationale at each call
 * site:
 *
 *   - `checkAndRecordStaffInvite` FAILS OPEN. Anti-spam soft guard;
 *     locking out the legitimate practitioner because the log table
 *     is temporarily unreachable is the worse harm than admitting a
 *     short burst of invites past the limit.
 *
 *   - `checkAcceptInvite` FAILS CLOSED. Adversarial brute-force
 *     guard; the load that hammers the RPC is exactly the load that
 *     induces transient errors. Failing open would disable the limit
 *     at the moment it should engage — i.e. a self-defeating
 *     bypass. A transient onboarding retry for a legitimate client
 *     during infrastructure degradation is the lesser harm.
 *
 * Both failure paths funnel through `underLimit: false` at the call
 * site, so the welcome action's response to "over limit" and to
 * "infra unreachable" is identical and a probing attacker cannot
 * distinguish them. The opposition is named loudly here because the
 * default symmetric pattern is wrong and easy to silently reintroduce
 * on a future refactor.
 */

export type RateLimitResult = {
  /** True if the operation may proceed. */
  underLimit: boolean
  /**
   * When `underLimit` is false, the integer seconds until the limit
   * would admit another attempt (the oldest in-window row dropping
   * out). When `underLimit` is true, 0.
   */
  secondsToReset: number
}

export type CheckAcceptInviteResult = RateLimitResult & {
  /**
   * Record a failure under this caller's accept-invite key. Called
   * from the catch branch of `client_accept_invite` when the RPC
   * returns an error. No success counterpart — recording a success
   * is a non-operation under the failed-only semantics.
   *
   * Soft-fails on infrastructure error: the operation already errored,
   * a failed-to-record failure is bounded throttle drift, not a
   * correctness issue.
   */
  recordFailure: () => Promise<void>
}

// PostgreSQL interval literals. Both live limits use a 1-hour window
// per §7.2. The cron sweep at migration 20260604120100 has a 2-hour
// cutoff (1-hour window + 1-hour safety buffer); changing these here
// requires reviewing the buffer.
const ONE_HOUR = '01:00:00'

const STAFF_INVITE_MAX = 20
const ACCEPT_INVITE_MAX = 10

type RpcCheckShape = {
  under_limit: boolean
  seconds_to_reset: number
}

/**
 * Call an RPC bypassing the not-yet-narrowed Functions union in
 * `src/types/database.ts`. The three RPCs in
 * `supabase/migrations/20260604120000_rate_limit_log.sql` will land
 * in the generated types on the next `supabase gen types` run after
 * deploy; until then, this helper localizes the bypass.
 *
 * The runtime contract is the SQL OUT parameters; the generic `T`
 * here is the wrapper's own assertion of that shape.
 */
async function callRpc<T>(
  fn: 'rate_limit_check_and_record' | 'rate_limit_check_failures' | 'rate_limit_record_failure',
  args: Record<string, unknown>,
): Promise<{ data: T | null; error: { message: string } | null }> {
  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rpc = supabase.rpc as any
  const result = await rpc(fn, args)
  return result as { data: T | null; error: { message: string } | null }
}

/**
 * Staff invite rate-limit gate. All-attempts: every admitted call is
 * recorded once admitted, including those that subsequently fail
 * downstream (e.g. Resend send-error). 20 attempts per hour per
 * staff uid. Key: `staff_invite:<uid>` — matches spec §7.2 per-user.
 *
 * Returns `{ underLimit, secondsToReset }`. On `underLimit === false`
 * the call site should refuse the invite operation and surface a
 * staff-facing error including the reset time as a human duration.
 *
 * FAILS OPEN on infrastructure error. This is an anti-spam soft
 * guard; locking out the legitimate practitioner because
 * `rate_limit_log` is temporarily unreachable is a worse harm than
 * admitting a small burst of invites past the limit. The protected
 * surface here is invite-spam to client email addresses — not a
 * brute-force target — so the symmetric failure-closed posture is
 * not warranted.
 */
export async function checkAndRecordStaffInvite(
  uid: string,
): Promise<RateLimitResult> {
  const { data, error } = await callRpc<RpcCheckShape>(
    'rate_limit_check_and_record',
    {
      p_key: `staff_invite:${uid}`,
      p_window: ONE_HOUR,
      p_max: STAFF_INVITE_MAX,
    },
  )
  if (error || !data) {
    // FAIL OPEN — see JSDoc.
    console.error(
      '[rate-limit] staff_invite check failed (failing open):',
      error?.message ?? 'no data returned',
    )
    return { underLimit: true, secondsToReset: 0 }
  }
  return {
    underLimit: data.under_limit,
    secondsToReset: data.seconds_to_reset,
  }
}

/**
 * Client accept-invite rate-limit gate. Failed-only: the check counts
 * only rows with `outcome = 'failure'`; recording happens via the
 * returned `recordFailure()` closure, called from the catch branch of
 * `client_accept_invite` when it errors. 10 failures per hour per
 * client uid.
 *
 * Key: `accept_invite:<uid>` — OVERRIDES spec §7.2's per-IP key.
 * Rationale captured in migration 20260604120000 and flag P-H in
 * `docs/polish/auth-onboarding-client.md`. Briefly: call site is
 * post-authentication; rotating uid requires creating a new
 * auth.users row (subject to Supabase signup throttle), rotating IP
 * is cheaper. Per-uid throttles the more expensive dimension. Per-IP
 * would also collaterally throttle friends-and-family testers on
 * shared carrier NAT.
 *
 * Over-limit error UX: a generic "too many attempts, try again
 * later" with NO seconds-to-reset rendered and NO discrimination
 * between "limit hit" and other failures — the call site must not
 * leak the limit state to a probing attacker.
 *
 * FAILS CLOSED on infrastructure error — DELIBERATELY OPPOSITE to
 * `checkAndRecordStaffInvite`. This is an adversarial brute-force
 * guard. The load that hammers the RPC is exactly the load that
 * induces transient errors (table contention, PostgREST timeout,
 * pgbouncer pool exhaustion). Failing open here would disable the
 * limit at the moment it should engage — a self-defeating bypass an
 * attacker can induce on demand. §7.3 acknowledges this limit cannot
 * stop a botnet; that is a reason to preserve the modest guard it
 * gives against a single attacker, not to add a bypass. A transient
 * onboarding retry for a legitimate client during infrastructure
 * degradation is the lesser harm.
 *
 * The fail-closed return uses the same `underLimit: false` shape as
 * an over-limit return, so the welcome action's response to "over
 * limit" and to "infra unreachable" is identical — same generic
 * "Too many attempts. Try again later." with no time-to-reset and
 * no diagnostic content. An attacker cannot distinguish the two
 * conditions.
 */
export async function checkAcceptInvite(
  uid: string,
): Promise<CheckAcceptInviteResult> {
  const key = `accept_invite:${uid}`

  const recordFailure = async (): Promise<void> => {
    const { error } = await callRpc<undefined>(
      'rate_limit_record_failure',
      { p_key: key },
    )
    if (error) {
      // Soft-fail: the operation already errored. A failed-to-record
      // failure is bounded throttle drift, not a correctness issue.
      console.error(
        '[rate-limit] accept_invite record_failure failed:',
        error.message,
      )
    }
  }

  const { data, error } = await callRpc<RpcCheckShape>(
    'rate_limit_check_failures',
    {
      p_key: key,
      p_window: ONE_HOUR,
      p_max: ACCEPT_INVITE_MAX,
    },
  )

  if (error || !data) {
    // FAIL CLOSED — see JSDoc. Refuse the attempt, no diagnostic
    // content surfaced to the caller; secondsToReset is 0 because the
    // call site does not render it for accept-invite anyway (generic
    // message, no time-to-reset), but stays a stable shape.
    console.error(
      '[rate-limit] accept_invite check failed (failing closed):',
      error?.message ?? 'no data returned',
    )
    return { underLimit: false, secondsToReset: 0, recordFailure }
  }
  return {
    underLimit: data.under_limit,
    secondsToReset: data.seconds_to_reset,
    recordFailure,
  }
}
