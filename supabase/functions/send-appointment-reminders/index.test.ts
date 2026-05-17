// ============================================================================
// Tests for the cron auth gate (Finding #3 — fail-closed).
// ============================================================================
// LIMITATION — NOT YET EXECUTABLE IN CI:
//   No Edge Function test runner is configured for this repo, and importing
//   `./index.ts` evaluates its top-level `Deno.serve(...)`, which binds a port
//   under `deno test`. These tests are committed as proof-of-logic and are
//   reviewable as such, but do NOT execute in CI yet.
//   TODO: configure an Edge Function test runner — track via a follow-up
//   (docs/runbooks/ entry or a tracked issue) covering one of: an
//   `import.meta.main` guard (verify behaviour under Supabase's edge runtime
//   first — getting it wrong silently kills the worker), extracting the gate
//   to its own module, or an integration harness that runs with the server up.
//   Once resolved, run: deno test supabase/functions/send-appointment-reminders/index.test.ts
//
// No third-party assertion library — Deno's built-in test runner plus a tiny
// inline assert (constraint: no new dependencies / no new imports).
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
