// ============================================================================
// Tests for the cron auth gate (fail-closed) — verbatim mirror of
// send-appointment-reminders/index.test.ts; the two workers share the gate
// shape and the one CRON_SHARED_SECRET.
// ============================================================================
// LIMITATION — NOT YET EXECUTABLE IN CI:
//   Same as the reminder worker's test file: no Edge Function test runner is
//   configured, and importing `./index.ts` evaluates its top-level
//   `Deno.serve(...)`. Committed as proof-of-logic; see the reminder test
//   file's header for the tracked resolution options.
//   Once resolved, run: deno test supabase/functions/send-message-notifications/index.test.ts
// ============================================================================

import { authorizeCronRequest } from './index.ts'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg)
}

const SECRET = 'test-shared-secret'

function reqWith(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/', { method: 'POST', headers })
}

// 1. Valid secret + matching bearer → gate allows through (returns null).
Deno.test('valid secret and matching bearer is allowed', () => {
  const res = authorizeCronRequest(
    reqWith({ Authorization: `Bearer ${SECRET}` }),
    SECRET,
  )
  assert(res === null, `expected null (allowed), got ${res?.status}`)
})

// 2. Missing Authorization header → 401.
Deno.test('missing Authorization header is 401', () => {
  const res = authorizeCronRequest(reqWith(), SECRET)
  assert(res?.status === 401, `expected 401, got ${res?.status}`)
})

// 3. Malformed Authorization header ("Bearer " with nothing after) → 401.
Deno.test('malformed bearer ("Bearer " only) is 401', () => {
  const res = authorizeCronRequest(
    reqWith({ Authorization: 'Bearer ' }),
    SECRET,
  )
  assert(res?.status === 401, `expected 401, got ${res?.status}`)
})

// 4. Wrong bearer token → 401.
Deno.test('wrong bearer token is 401', () => {
  const res = authorizeCronRequest(
    reqWith({ Authorization: 'Bearer wrong-value' }),
    SECRET,
  )
  assert(res?.status === 401, `expected 401, got ${res?.status}`)
})

// 5. Secret unset (undefined — what Deno.env.get returns when unset) → 500.
Deno.test('unset secret is 500 (fail closed)', () => {
  const res = authorizeCronRequest(
    reqWith({ Authorization: `Bearer ${SECRET}` }),
    undefined,
  )
  assert(res?.status === 500, `expected 500, got ${res?.status}`)
})

// 6. Secret empty or whitespace-only → 500.
Deno.test('empty or whitespace secret is 500 (fail closed)', () => {
  for (const blank of ['', '   ']) {
    const res = authorizeCronRequest(
      reqWith({ Authorization: `Bearer ${blank}` }),
      blank,
    )
    assert(
      res?.status === 500,
      `expected 500 for ${JSON.stringify(blank)}, got ${res?.status}`,
    )
  }
})
