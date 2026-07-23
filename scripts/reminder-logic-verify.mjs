// ============================================================================
// reminder-logic-verify.mjs
// ============================================================================
// Section 9 (Scheduling) — P2-5 / P2-6 reminder Edge Function decision logic.
//
// The send-appointment-reminders Edge Function is Deno: outside tsconfig (no
// tsc), not exercised by pgTAP (those test the trigger/RPCs, not the send
// loop), not touched by the other node scripts. P2-5 (email-gating cancel) and
// P2-6 (the retry/fail/cancel state machine) added new BRANCHING there with no
// automated coverage. This script is that coverage: it mirrors the EF's
// per-reminder decision and asserts every branch. Extended 2026-07-23 with the
// unbounded-resend send-bound model (assertions 13–17, see below).
//
//   node scripts/reminder-logic-verify.mjs
//
// MIRRORS supabase/functions/send-appointment-reminders/index.ts — keep in sync.
// This is a hand-written re-implementation of the EF's per-reminder decision
// tree, NOT an import (the Deno EF can't be imported into node here). It proves
// the DECISION LOGIC is correct; it does NOT prove the EF executes that logic —
// the tie between the two is this comment + discipline, not the compiler. The
// live send + EF env config are verified separately by invoking the deployed
// function, but the live proof is HAPPY-PATH ONLY (a sent reminder); the cancel
// and retry branches are proven here, "by proxy". See docs/polish/scheduling.md
// §8c/§8d. To retire the by-proxy gap, extract this decision into a module that
// BOTH the EF and this script import (then this test exercises the EF's code).
// ============================================================================

const MAX_RETRIES = 5

// The EF's per-reminder decision, distilled. Inputs mirror the loop:
//   hasEmail      — ctx && ctx.client_email (else terminal: no address)
//   emailEnabled  — ctx.email_notifications_enabled (P2-5 gate)
//   sendStatus    — the Resend HTTP status, or 0 for a network/throw; null if
//                   the send wasn't attempted (no-email / email-off paths)
//   retryCount    — the row's current retry_count
// Returns the terminal action: 'fail' | 'cancel' | 'sent' | 'retry'.
function decideReminderOutcome({ hasEmail, emailEnabled, sendStatus, retryCount }) {
  if (!hasEmail) return 'fail' // terminal — no address to send to
  if (!emailEnabled) return 'cancel' // P2-5 — practice has email off
  // The EF treats ANY 2xx as success (it checks `send.ok`, not `=== 200`); mirror that.
  if (sendStatus >= 200 && sendStatus < 300) return 'sent'
  // P2-6 — transient (network / 429 / 5xx) retries to the cap, then fails; 4xx terminal.
  const retryable = sendStatus === 0 || sendStatus === 429 || sendStatus >= 500
  return retryable && retryCount < MAX_RETRIES ? 'retry' : 'fail'
}

let pass = 0
let fail = 0
function eq(label, got, want) {
  if (got === want) {
    pass++
    console.log(`  ok   ${label} → ${got}`)
  } else {
    fail++
    console.log(`  FAIL ${label} → got ${got}, want ${want}`)
  }
}

const E = { hasEmail: true, emailEnabled: true } // happy-path defaults

// Terminal / gating branches.
eq('no client email', decideReminderOutcome({ ...E, hasEmail: false, sendStatus: null }), 'fail')
eq('email notifications off (P2-5)', decideReminderOutcome({ ...E, emailEnabled: false, sendStatus: null }), 'cancel')
eq('successful send (200)', decideReminderOutcome({ ...E, sendStatus: 200, retryCount: 0 }), 'sent')
eq('successful send (2xx non-200, e.g. 202)', decideReminderOutcome({ ...E, sendStatus: 202, retryCount: 0 }), 'sent')

// P2-6 retry vs terminal.
eq('5xx under cap → retry', decideReminderOutcome({ ...E, sendStatus: 503, retryCount: 0 }), 'retry')
eq('5xx at cap → fail', decideReminderOutcome({ ...E, sendStatus: 503, retryCount: MAX_RETRIES }), 'fail')
eq('5xx one below cap → retry', decideReminderOutcome({ ...E, sendStatus: 500, retryCount: MAX_RETRIES - 1 }), 'retry')
eq('429 rate-limit → retry', decideReminderOutcome({ ...E, sendStatus: 429, retryCount: 0 }), 'retry')
eq('network error (status 0) → retry', decideReminderOutcome({ ...E, sendStatus: 0, retryCount: 0 }), 'retry')
eq('401 invalid key (4xx) → fail (terminal)', decideReminderOutcome({ ...E, sendStatus: 401, retryCount: 0 }), 'fail')
eq('422 validation (4xx) → fail (terminal)', decideReminderOutcome({ ...E, sendStatus: 422, retryCount: 0 }), 'fail')
eq('400 bad request (4xx) → fail (terminal)', decideReminderOutcome({ ...E, sendStatus: 400, retryCount: 2 }), 'fail')

// ============================================================================
// 2026-07-23 extension — the unbounded-resend fix shape (3): the EF send bound.
// Models ONE reminder row across cron ticks, with the tick's DB-write outcomes
// injectable, mirroring the loop in send-appointment-reminders/index.ts:
//   - pre-send ceiling: a row at retry_count >= MAX_RETRIES is terminally
//     failed WITHOUT another send (markFailed; if that write fails the row
//     stays 'scheduled' but STILL never sends again — the ceiling gates first)
//   - bump-on-failed-terminal-write: send succeeded but markSent failed →
//     markRetry bumps retry_count (trigger-safe) so the ceiling advances
//   - the honest residual (assertion 17): if the bump ALSO fails on the same
//     tick (correlated failure — DB unreachable, EF killed between send and
//     write), retry_count never moves and the row re-sends every tick. The
//     bound holds only when the bump can land. This assertion EXISTS so the
//     model can never silently claim the stronger bound the 2026-07-23 review
//     rejected. Same by-proxy caveat as above: hand-mirrored, kept in sync.
// ============================================================================

function tickOnce(row, { terminalWriteOk, bumpWriteOk }) {
  if (row.status !== 'scheduled') return { sent: false }
  // Pre-send ceiling — refuse to send, terminally fail instead.
  if (row.retryCount >= MAX_RETRIES) {
    if (terminalWriteOk) row.status = 'failed'
    return { sent: false }
  }
  // Send succeeds (2xx) in this model; then the terminal write is attempted.
  if (terminalWriteOk) {
    row.status = 'sent'
  } else if (bumpWriteOk) {
    row.retryCount = Math.min(row.retryCount + 1, MAX_RETRIES)
  } // else: neither write landed — row unchanged (correlated-failure residual)
  return { sent: true }
}

function simulateTicks(row, n, writes) {
  let sends = 0
  for (let i = 0; i < n; i++) sends += tickOnce(row, writes).sent ? 1 : 0
  return sends
}

// 13. Ceiling refusal: a row arriving at the ceiling is failed without a send.
{
  const row = { status: 'scheduled', retryCount: MAX_RETRIES }
  const { sent } = tickOnce(row, { terminalWriteOk: true, bumpWriteOk: true })
  eq('at ceiling → no send, terminally failed', `${sent}/${row.status}`, 'false/failed')
}

// 14. Ceiling refusal holds even while the terminal write keeps failing:
// the row is stuck 'scheduled' (and logged loud) but NEVER sends again.
{
  const row = { status: 'scheduled', retryCount: MAX_RETRIES }
  const sends = simulateTicks(row, 3, { terminalWriteOk: false, bumpWriteOk: true })
  eq('at ceiling + terminal write failing → still zero sends', `${sends}/${row.status}`, '0/scheduled')
}

// 15. Bump-on-failed-terminal-write: sent, markSent failed, bump lands.
{
  const row = { status: 'scheduled', retryCount: 0 }
  const { sent } = tickOnce(row, { terminalWriteOk: false, bumpWriteOk: true })
  eq('sent + markSent failed → retry_count bumped', `${sent}/${row.retryCount}`, 'true/1')
}

// 16. The bound, as honestly claimed: terminal writes fail on EVERY tick but
// the bump lands → total real sends across any number of ticks == MAX_RETRIES.
{
  const row = { status: 'scheduled', retryCount: 0 }
  const sends = simulateTicks(row, 20, { terminalWriteOk: false, bumpWriteOk: true })
  eq('persistent terminal-write failure, bump landing → sends bounded at MAX_RETRIES', sends, MAX_RETRIES)
}

// 17. The disclosed residual, locked in: correlated failure (terminal write
// AND bump both fail every tick) → one send per tick, unbounded. This is the
// EXPECTED model output — the claim is "bounded when the bump can land", not
// "bounded under any failure". If this assertion ever starts failing, the EF
// gained a stronger mechanism (e.g. a Resend Idempotency-Key) — update the
// closure record in docs/polish/email-and-sms.md, then this test.
{
  const row = { status: 'scheduled', retryCount: 0 }
  const sends = simulateTicks(row, 8, { terminalWriteOk: false, bumpWriteOk: false })
  eq('correlated failure (bump also failing) → unbounded, one send per tick (the documented residual)', sends, 8)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
