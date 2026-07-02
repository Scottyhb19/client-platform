-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), is() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 46_clients_update_role_anon_denial
-- ============================================================================
-- Closes the coverage gap left by dashboard polish item 3
-- (clients.overdue_followed_up_at). That column is written by the EP-facing
-- acknowledge action via a direct PostgREST UPDATE on clients. The polish doc
-- originally waived a new pgTAP gate on the claim that client- and anon-role
-- callers cannot UPDATE clients — but nothing exercised it. The only existing
-- UPDATE clients probe lives in 17_cross_tenant_isolation and runs as
-- staff-in-wrong-org, which trips ONLY the org half of the policy's USING
-- clause and never the role half.
--
-- The clients UPDATE policy (20260420102600, "staff update clients in own org")
-- is:
--   USING (organization_id = public.user_organization_id()
--          AND public.user_role() IN ('owner','staff'))
-- A same-org client-role caller satisfies the org half but fails the role half
-- -> the USING clause hides the row -> UPDATE affects 0 rows. An anon caller
-- is now denied one layer EARLIER: migration 20260702170000 (go-live §4b)
-- revoked anon's default table grants across public, so anon DML raises
-- 42501 at the grant layer before RLS is even consulted. (This file's
-- original header pre-wrote exactly this contingency; the historical
-- pre-4b behaviour was a 0-row UPDATE through the absent-policy path.)
--
-- Assertions (3):
--   1. client-role UPDATE of an own-org client (the overdue_followed_up_at
--      column) affects 0 rows  — the role predicate.
--   2. anon UPDATE of the same client raises 42501 — the grant-layer denial
--      (post-4b; was the 0-row no-policy case before 20260702170000).
--   3. anti-trivial control: a staff caller in the same org CAN UPDATE that
--      client (1 row), proving 1-2 are real role/anon denial and not a locked
--      or absent fixture.
--
-- ANON IDIOM. There is no _test_set_jwt(...,'anon'): anon is a Postgres
-- role, not a JWT claim. So assertion 2 uses `SET LOCAL ROLE anon`, the
-- direct analog of the `SET LOCAL ROLE authenticated` the other tests use.
-- Post-4b, the assertion is throws_ok('42501') run under the anon role;
-- companion suite 54_anon_table_grants.sql holds the platform-wide dynamic
-- zero-anon-grants tripwire.
--
-- Run discipline: BEGIN/ROLLBACK so fixtures never persist. The _tap temp table
-- surfaces all three TAP lines in one editor grid (same mechanism as
-- 15/16/17). This project has no non-prod test target (no local Docker); the
-- file runs as a single batch in the SQL editor against the live project, and
-- the BEGIN/ROLLBACK is what makes that safe. finish() is intentionally dropped
-- (same as 15/16/17) — the three-row plan count is the check.
-- ============================================================================

BEGIN;

SELECT plan(3);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
-- anon needs _tap because assertion 2's throws_ok line is captured while the
-- session is dropped to the anon role.
GRANT INSERT, SELECT ON _tap TO authenticated, anon;

-- _probe carries each UPDATE's row-count out of a data-modifying CTE (a
-- data-modifying WITH cannot be nested inside is()'s scalar-subquery arg).
CREATE TEMP TABLE _probe (k text PRIMARY KEY, v int NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _probe TO authenticated;


-- ----------------------------------------------------------------------------
-- Fixture (fully privileged — clients carries RLS but NOT FORCE ROW LEVEL
-- SECURITY, so the editor's table-owner role bypasses RLS here):
--   org_a — staff_a (staff), client_a (a client row), and client_user, a
--   client-role login linked to client_a (clients.user_id). Linking makes
--   assertion 1 the strongest case: a client cannot UPDATE even their OWN
--   linked record (they may SELECT it via the self-read policy, but there is
--   no client UPDATE policy).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  org_a       uuid := '00000000-0000-0000-0000-0000000046a1'::uuid;
  staff_a     uuid;
  client_user uuid;
  client_a    uuid := '00000000-0000-0000-0000-0000000046a2'::uuid;
BEGIN
  INSERT INTO organizations (id, name, slug) VALUES
    (org_a, 'Test Org A — clients UPDATE denial 46', 'test-org-a-clients-update-46');

  staff_a     := public._test_make_user('staff-a-clients46@test.local');
  client_user := public._test_make_user('client-clients46@test.local');

  PERFORM public._test_grant_membership(staff_a,     org_a, 'staff'::user_role);
  PERFORM public._test_grant_membership(client_user, org_a, 'client'::user_role);

  INSERT INTO clients (id, organization_id, first_name, last_name, email, user_id) VALUES
    (client_a, org_a, 'Alpha', 'FortySix', 'client-a-clients46@test.local', client_user);

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_a AS org_a, staff_a AS staff_a,
    client_user AS client_user, client_a AS client_a;
  -- anon reads client_a from _ids in assertion 2.
  GRANT SELECT ON _ids TO authenticated, anon;
END $$;


-- ----------------------------------------------------------------------------
-- Test 1 (role predicate): a same-org client-role caller cannot UPDATE the
-- clients row. The role half of the USING clause is false for a client, so the
-- row is hidden from the UPDATE and it affects 0 rows.
-- ----------------------------------------------------------------------------
SELECT public._test_set_jwt(
  (SELECT client_user FROM _ids), (SELECT org_a FROM _ids), 'client'
);
SET LOCAL ROLE authenticated;

WITH u AS (
  UPDATE clients SET overdue_followed_up_at = now()
  WHERE id = (SELECT client_a FROM _ids)
  RETURNING 1
)
INSERT INTO _probe (k, v) SELECT 'update_rows_client_role', count(*)::int FROM u;

INSERT INTO _tap (n, line) VALUES (1, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT v FROM _probe WHERE k = 'update_rows_client_role'),
    0,
    'write isolation: client-role UPDATE of own-org client affects 0 rows'
  ) AS l
));


-- ----------------------------------------------------------------------------
-- Test 2 (grant-layer / anon): an anon caller cannot UPDATE clients — post-4b
-- (20260702170000) the denial is 42501 at the grant layer, raised before RLS
-- is consulted. throws_ok runs its SQL under the current role, so the line is
-- captured while the session is dropped to anon (_tap is anon-granted above).
-- ----------------------------------------------------------------------------
RESET ROLE;                       -- back to the owner (postgres) session
SELECT public._test_clear_jwt();  -- anon is unauthenticated — drop the claims
SET LOCAL ROLE anon;

INSERT INTO _tap (n, line) VALUES (2, (
  SELECT string_agg(l, E'\n') FROM throws_ok(
    'UPDATE clients SET overdue_followed_up_at = now() WHERE id = (SELECT client_a FROM _ids)',
    '42501',
    NULL,
    'write isolation: anon UPDATE of clients raises 42501 (grant-layer denial, post-4b)'
  ) AS l
));

RESET ROLE;                       -- privileged role for the remaining tests


-- ----------------------------------------------------------------------------
-- Test 3 (anti-trivial control): a staff caller in the same org CAN UPDATE the
-- client (1 row). If this failed, tests 1-2's zeros could be a locked/absent
-- fixture rather than real role/anon denial.
-- ----------------------------------------------------------------------------
SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;

WITH u AS (
  UPDATE clients SET overdue_followed_up_at = now()
  WHERE id = (SELECT client_a FROM _ids)
  RETURNING 1
)
INSERT INTO _probe (k, v) SELECT 'update_rows_staff', count(*)::int FROM u;

INSERT INTO _tap (n, line) VALUES (3, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT v FROM _probe WHERE k = 'update_rows_staff'),
    1,
    'control: staff UPDATE of own-org client affects 1 row (fixture is updatable)'
  ) AS l
));


-- ----------------------------------------------------------------------------
-- Surface all three captured TAP lines in one editor grid. finish() is
-- intentionally dropped (same pattern as 15/16/17); the three-row plan count
-- is the check.
-- ----------------------------------------------------------------------------
SELECT line FROM _tap ORDER BY n;

ROLLBACK;
