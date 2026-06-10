-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), is(), lives_ok() etc. resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 18_c12_client_pending_round_trip
-- ============================================================================
-- Round-trip proof for C-12 (migration 20260611090000_c12_client_accept_
-- invite_profile_sync). client_accept_invite must overwrite the 'Pending'
-- placeholder names that handle_new_auth_user() stamps onto user_profiles at
-- auth.users INSERT time, replacing them with the canonical names on the
-- clients row being accepted. This is the client-path twin of
-- 15_g13_pending_round_trip (staff path via create_organization_with_owner).
--
-- Like 15, this is a genuine round trip, not an end-state check: it asserts
-- the 'Pending' starting state BEFORE the RPC, so the post-RPC assertion is
-- only meaningful in contrast. If handle_new_auth_user ever stopped writing
-- 'Pending', the before-assertions fail and flag that the premise — not the
-- RPC — has moved.
--
-- Caller model: an invitee who has authenticated (via the invite-link
-- exchange) but does not yet belong to any organization — sub present,
-- organization_id NULL, role claim NULL. client_accept_invite reads only
-- auth.uid() and the caller's auth.users email, so the NULL org/role claims
-- are immaterial to it. The post-RPC self-read on user_profiles resolves via
-- the `user_id = auth.uid()` branch of "select own profile or co-members".
--
-- Exception safety: identical posture to 15 — the RPC runs inside lives_ok(),
-- and this harness has no idiom for gating later assertions on a prior call's
-- success. If the RPC raises, you will see THREE failing tests from one root
-- cause: test 3 fails carrying the error text, AND tests 4 and 5 fail because
-- the row is still 'Pending'. Read test 3 first; only treat tests 4 or 5 as
-- real name-mismatch evidence when test 3 passed.
--
-- Real values: 'Marisol' / 'Featherstone' are distinct, obviously not
-- 'Pending', and asserted separately so a swapped first/last bug is caught.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Run discipline: this suite has no non-production test target, so this file
-- is run by hand against the live production database via the Supabase SQL
-- editor, protected only by the BEGIN/ROLLBACK wrapper. Always execute the
-- ENTIRE file as a single run so the closing ROLLBACK fires. If a run is
-- interrupted, confirm that no c12-pending-round-trip@test.local auth user
-- and no organizations row with slug 'c12-pending-round-trip-org' persist
-- before re-running — a committed leftover of either breaks the fixture
-- (idempotent user skips the Pending re-stamp; the org slug is UNIQUE).
-- ----------------------------------------------------------------------------

BEGIN;

SELECT plan(5);
-- plan(5) kept for convention; with finish() dropped (see foot of file) it is
-- not reconciled by pgTAP. The real plan check is that the final SELECT
-- returns five rows — one captured TAP line per assertion.

-- _tap collects each assertion's TAP line so the final SELECT can surface all
-- five in one editor grid (mechanism modelled on 15/09/12). The GRANT is
-- load-bearing: writes n=3..5 run under SET LOCAL ROLE authenticated, so
-- authenticated needs INSERT, and the final read also runs as authenticated,
-- so it needs SELECT.
CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated;


-- ----------------------------------------------------------------------------
-- Fixture: a fresh authenticated invitee plus the org + clients row their
-- invite belongs to. _test_make_user inserts the auth.users row, whose
-- on_auth_user_created trigger stamps the matching user_profiles row with
-- ('Pending','Pending'). The org and clients rows are inserted as the test
-- owner (bypasses RLS; everything rolls back). The clients email matches the
-- invitee's auth.users email — the RPC's email-match gate requires it.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  new_uid    uuid;
  new_org    uuid;
  new_client uuid;
BEGIN
  new_uid := public._test_make_user('c12-pending-round-trip@test.local');

  INSERT INTO organizations (name, slug)
  VALUES ('C-12 Pending Round-Trip Org', 'c12-pending-round-trip-org')
  RETURNING id INTO new_org;

  INSERT INTO clients (organization_id, first_name, last_name, email)
  VALUES (new_org, 'Marisol', 'Featherstone', 'c12-pending-round-trip@test.local')
  RETURNING id INTO new_client;

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    new_uid    AS new_uid,
    new_client AS new_client;
  GRANT SELECT ON _ids TO authenticated;
END $$;


-- ============================================================================
-- Starting state — BEFORE the RPC. These run as the test owner (bypasses RLS),
-- so the placeholder row is readable directly. Each assertion is captured into
-- _tap via string_agg over the assertion's SETOF text output (same collapse
-- rationale as 15).
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
-- Caller context — transition to the authenticated invitee, mirroring 15's
-- _test_set_jwt + SET LOCAL ROLE handoff. organization_id and role are NULL
-- because the invitee has no membership until this very RPC creates one.
-- ============================================================================
SELECT public._test_set_jwt(
  (SELECT new_uid FROM _ids),
  NULL::uuid,
  NULL::text
);
SET LOCAL ROLE authenticated;


-- ============================================================================
-- The RPC under test — inside lives_ok so a raise (e.g. an email mismatch
-- from a broken fixture) is a loud, distinct failure rather than a swallowed
-- name mismatch.
-- ============================================================================

-- 3: the RPC runs without raising for the matching-email invitee.
INSERT INTO _tap (n, line) VALUES (3, (
  SELECT string_agg(l, E'\n') FROM lives_ok(
    $q$SELECT public.client_accept_invite((SELECT new_client FROM _ids))$q$,
    'client_accept_invite runs without raising for the matching-email invitee'
  ) AS l
));


-- ============================================================================
-- Round trip — AFTER the RPC. These run as the authenticated caller; the
-- self-read resolves via user_profiles' `user_id = auth.uid()` SELECT branch.
-- Each name is asserted separately so a swapped first/last bug is caught.
-- ============================================================================

-- 4: first_name was overwritten with the clients row's canonical value.
INSERT INTO _tap (n, line) VALUES (4, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT first_name FROM user_profiles
      WHERE user_id = (SELECT new_uid FROM _ids)),
    'Marisol',
    'after: first_name synced from the clients row by client_accept_invite'
  ) AS l
));

-- 5: last_name was overwritten with the clients row's canonical value.
INSERT INTO _tap (n, line) VALUES (5, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT last_name FROM user_profiles
      WHERE user_id = (SELECT new_uid FROM _ids)),
    'Featherstone',
    'after: last_name synced from the clients row by client_accept_invite'
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
