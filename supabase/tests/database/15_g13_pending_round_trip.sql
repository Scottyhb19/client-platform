-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), is(), lives_ok() etc. resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 15_g13_pending_round_trip
-- ============================================================================
-- Round-trip proof for G-13 (migration 20260524202523_bootstrap_drop_pending_
-- filter). create_organization_with_owner must overwrite the 'Pending'
-- placeholder names that handle_new_auth_user() stamps onto user_profiles at
-- auth.users INSERT time, replacing them with the real first/last names passed
-- to the RPC.
--
-- This is a genuine round trip, not an end-state check: it asserts the
-- 'Pending' starting state BEFORE the RPC, so the post-RPC assertion is only
-- meaningful in contrast. If handle_new_auth_user ever stopped writing
-- 'Pending', the before-assertions fail and flag that the premise — not the
-- RPC — has moved (exactly the silent-coupling risk G-13's migration note
-- calls out).
--
-- Caller model: a brand-new signup that has authenticated but does NOT yet
-- belong to an organization. The spoofed JWT therefore carries the new user's
-- sub but a NULL organization_id. 07 always spoofs a real org; the
-- _test_set_jwt signature (uuid, uuid, text) accepts NULL::uuid, so a pre-org
-- caller is expressible without a workaround. The RPC reads only auth.uid(),
-- so the NULL org is immaterial to it, and the post-RPC self-read on
-- user_profiles resolves via the `user_id = auth.uid()` branch of the
-- "select own profile or co-members" policy — also independent of org.
--
-- Exception safety: 07 has no precedent for surfacing an RPC throw — it only
-- uses is(). The wider suite (05, 06, 09, 12, 13, 14) uses lives_ok()/
-- throws_ok(), confirmed to resolve in this harness, so the RPC is called
-- inside lives_ok(). Be precise about what a throw produces here: this
-- harness has no idiom for gating later assertions on a prior call's success
-- (verified — no such pattern exists in any test file), and we deliberately
-- did not invent one. So if the caller context is wrong and the RPC raises,
-- you will see THREE failing tests from one root cause: the lives_ok() at
-- test 3 fails carrying the error text, AND tests 4 and 5 also fail because
-- the row is still 'Pending'. The lives_ok() failure at test 3 is the
-- authoritative cause; the test-4 and test-5 failures are downstream symptoms
-- of the same throw, not independent name-mismatch failures. When this file
-- fails, read test 3 first: if it failed, the names never round-tripped
-- because the RPC never ran, and tests 4 and 5 tell you nothing new. Only
-- treat tests 4 or 5 as real name-mismatch evidence when test 3 passed.
--
-- Real values: the first/last names are distinct and obviously not 'Pending',
-- and each is asserted separately, so a swapped first/last argument bug fails
-- the per-name assertions too.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Run discipline: this suite has no non-production test target, so this file
-- is run by hand against the live production database via the Supabase SQL
-- editor, protected only by the BEGIN/ROLLBACK wrapper. Always execute the
-- ENTIRE file as a single run so the closing ROLLBACK fires. A partial or
-- aborted run can leave the fixture auth.users row committed on production;
-- because _test_make_user is idempotent on email, a leftover row would skip
-- fresh trigger insertion on the next run and make the before-assertions
-- (tests 1 and 2) unreliable. If a run is interrupted, confirm no
-- g13-pending-round-trip@test.local user persists before re-running.
-- ----------------------------------------------------------------------------

BEGIN;

SELECT plan(5);
-- plan(5) is kept for convention; with finish() dropped (see foot of file) it
-- is not reconciled by pgTAP. The real plan check now is that the final SELECT
-- returns five rows — one captured TAP line per assertion.

-- _tap collects each assertion's TAP line so the final SELECT can surface all
-- five in one editor grid (output mechanism modelled on 09 and 12). The GRANT
-- is load-bearing: writes n=3..5 run under SET LOCAL ROLE authenticated, so
-- authenticated needs INSERT, and the final read also runs as authenticated,
-- so it needs SELECT (precedent: 12 line 37, 09).
CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated;


-- ----------------------------------------------------------------------------
-- Fixture: a fresh authenticated user, pre-org. _test_make_user inserts the
-- auth.users row, whose on_auth_user_created trigger stamps the matching
-- user_profiles row with ('Pending','Pending'). The uid is handed to the
-- assertion phase through the same _ids temp-table pattern 07 uses.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  new_uid uuid;
BEGIN
  new_uid := public._test_make_user('g13-pending-round-trip@test.local');

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    new_uid AS new_uid;
  GRANT SELECT ON _ids TO authenticated;
END $$;


-- ============================================================================
-- Starting state — BEFORE the RPC. These run as the test owner: the DO block's
-- role context does not carry across (same note as 07), and the owner bypasses
-- RLS, so the placeholder row is readable directly.
--
-- Each assertion is captured into _tap via string_agg over the assertion's
-- SETOF text output, collapsing any multi-row failure output (not ok +
-- diagnostics) into a single row so the scalar-subquery INSERT can never raise
-- "more than one row returned by a subquery used as an expression".
-- ============================================================================

-- 1: the trigger stamped the first-name placeholder.
INSERT INTO _tap (n, line) VALUES (1, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT first_name FROM user_profiles
      WHERE user_id = (SELECT new_uid FROM _ids)),
    'Pending',
    'before: first_name is the Pending placeholder from handle_new_auth_user'
  ) AS l
));

-- 2: the trigger stamped the last-name placeholder.
INSERT INTO _tap (n, line) VALUES (2, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT last_name FROM user_profiles
      WHERE user_id = (SELECT new_uid FROM _ids)),
    'Pending',
    'before: last_name is the Pending placeholder from handle_new_auth_user'
  ) AS l
));


-- ============================================================================
-- Caller context — transition to the pre-org authenticated caller, mirroring
-- 07's _test_set_jwt + SET LOCAL ROLE handoff. organization_id is NULL because
-- the caller has no org until this very RPC creates one.
-- ============================================================================
SELECT public._test_set_jwt(
  (SELECT new_uid FROM _ids),
  NULL::uuid,
  NULL::text
);
SET LOCAL ROLE authenticated;


-- ============================================================================
-- The RPC under test — called inside lives_ok so a raise (e.g. a wrong caller
-- context returning 42501) is a loud, distinct failure rather than a swallowed
-- name mismatch.
-- ============================================================================

-- 3: the RPC runs without raising for the pre-org authenticated caller.
INSERT INTO _tap (n, line) VALUES (3, (
  SELECT string_agg(l, E'\n') FROM lives_ok(
    $q$SELECT public.create_organization_with_owner(
         'G-13 Pending Round-Trip Org',
         'Australia/Sydney',
         'Marigold',
         'Thornbury'
       )$q$,
    'create_organization_with_owner runs without raising for a pre-org authenticated caller'
  ) AS l
));


-- ============================================================================
-- Round trip — AFTER the RPC. These run as the authenticated caller; the
-- self-read resolves via user_profiles' `user_id = auth.uid()` SELECT branch.
-- Each name is asserted separately so a swapped first/last argument is caught.
-- ============================================================================

-- 4: first_name was overwritten with the real value passed to the RPC.
INSERT INTO _tap (n, line) VALUES (4, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT first_name FROM user_profiles
      WHERE user_id = (SELECT new_uid FROM _ids)),
    'Marigold',
    'after: first_name overwritten with the real first name from the RPC'
  ) AS l
));

-- 5: last_name was overwritten with the real value passed to the RPC.
INSERT INTO _tap (n, line) VALUES (5, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT last_name FROM user_profiles
      WHERE user_id = (SELECT new_uid FROM _ids)),
    'Thornbury',
    'after: last_name overwritten with the real last name from the RPC'
  ) AS l
));


-- ----------------------------------------------------------------------------
-- Final SELECT: surface all five captured TAP lines in one grid. The editor
-- only shows the last statement's result, so this is what makes lines 1..5
-- visible together. finish() is intentionally dropped — the five-row count is
-- the plan check now. Runs as authenticated; relies on the SELECT grant above.
-- ----------------------------------------------------------------------------
SELECT line FROM _tap ORDER BY n;

ROLLBACK;
