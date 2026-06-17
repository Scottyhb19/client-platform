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
// per-reminder decision and asserts every branch.
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

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
