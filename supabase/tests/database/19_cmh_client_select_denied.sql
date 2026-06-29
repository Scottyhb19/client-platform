-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), is() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 19_cmh_client_select_denied
-- ============================================================================
-- Closes the automated-coverage gap for CN-2 (gap CN-2 of
-- docs/polish/client-profile-clinical-notes.md; migration
-- 20260611120000_cn2_cmh_staff_only_select.sql). CN-2 tightened the
-- client_medical_history SELECT policy from Pattern B (client could read
-- their OWN rows) to Pattern A (staff-only). The `notes` column carries
-- practitioner clinical reasoning, walled from clients per master brief §4.
--
-- This is WITHIN-org role gating, distinct from 17_cross_tenant_isolation
-- (which proves org A cannot read org B). 17 cannot catch a CN-2
-- regression: its property is cross-org, and CN-2's is same-org-client-
-- denied. rls-policies.md §4.5 prescribes a test of this shape
-- (rls_cmh_select_client_denied) but none existed until this file.
--
-- The fixture deliberately reproduces the exact condition the OLD Pattern B
-- policy keyed on — a client_medical_history row whose client_id is the
-- requesting client's OWN clients.id, in the client's OWN org, with
-- clients.user_id = the client's auth uid. Under Pattern B the client WOULD
-- have seen this row; under Pattern A (CN-2) they see zero. That is the
-- load-bearing assertion.
--
-- Style: buffered into _tap (mirrors 15/16/17) so all TAP lines surface in
-- one Supabase SQL-Editor grid — this project has no non-prod test target
-- (no Docker), so the file is run as a single batch in the editor; the
-- BEGIN/ROLLBACK is what makes that safe. finish() is intentionally dropped
-- (same as 15/16/17); the three-row plan count is the check.
--
-- Assertions (3), most-critical-first:
--   1. LOAD-BEARING — a client session sees ZERO of its own org's
--      client_medical_history rows, even for its own client_id.
--   2. positive control — a staff session in the SAME org sees that row
--      (count 1). Proves assertion 1's zero is role-gating, not an absent
--      or broken fixture.
--   3. anti-trivial control — the same client session CAN see its own
--      clients row (count 1). Proves the client JWT context is live, not a
--      blind session that sees nothing. Relies on the clients SELECT policy
--      admitting client self-read (user_role='client' AND user_id=auth.uid()).
--
-- Reading the result grid (so the ok N numbers are not misread as a
-- failure): pgTAP stamps each ok N in is() EXECUTION order — load-bearing
-- first, then the client-self-read control, then the staff control (the
-- staff block runs last, after RESET ROLE). The final SELECT instead sorts
-- the printed lines by the _tap.n column (1, then 2 = staff, then 3 =
-- client-self-read). Because those two orders differ, the ok N prefixes
-- print out of sequence in the grid: ok 1, then ok 3 on the staff row,
-- then ok 2 on the client-self-read row. All three are ok; the out-of-order
-- numbering is expected, not a failure.
-- ============================================================================

BEGIN;

SELECT plan(3);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated;


-- ----------------------------------------------------------------------------
-- Fixture (fully privileged — client_medical_history carries RLS but NOT
-- FORCE ROW LEVEL SECURITY, so the editor's table-owner role bypasses RLS
-- for these inserts; same property 17 relies on).
--
--   org_d — staff_d (staff), client_d (client) linked via clients.user_id,
--           one client_medical_history row owned by client_d's clients row.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  org_d         uuid := '00000000-0000-0000-0000-00000000d901'::uuid;
  staff_d       uuid;
  client_d      uuid;
  client_row_id uuid := '00000000-0000-0000-0000-00000000d902'::uuid;
  cmh_id        uuid := '00000000-0000-0000-0000-00000000d903'::uuid;
BEGIN
  INSERT INTO organizations (id, name, slug)
  VALUES (org_d, 'Test Org D — CMH client-deny 19', 'test-org-d-cmh-deny-19');

  staff_d  := public._test_make_user('staff-cmh-deny19@test.local');
  client_d := public._test_make_user('client-cmh-deny19@test.local');

  PERFORM public._test_grant_membership(staff_d,  org_d, 'staff'::user_role);
  PERFORM public._test_grant_membership(client_d, org_d, 'client'::user_role);

  -- The clients row links client_d's auth user to the org. clients.user_id
  -- = client_d is exactly what the OLD Pattern B subquery matched on.
  INSERT INTO clients (id, organization_id, user_id, first_name, last_name, email)
  VALUES (client_row_id, org_d, client_d, 'Dana', 'Patient', 'dana-cmh19@test.local');

  -- The condition the client must NOT be able to read. notes carries the
  -- practitioner commentary CN-2 exists to wall off.
  INSERT INTO client_medical_history
    (id, organization_id, client_id, condition, notes, is_active)
  VALUES (
    cmh_id, org_d, client_row_id,
    'CN-2 canary condition',
    'Practitioner reasoning that must never reach the client.', true
  );

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_d AS org_d, staff_d AS staff_d, client_d AS client_d,
    client_row_id AS client_row_id, cmh_id AS cmh_id;
  GRANT SELECT ON _ids TO authenticated;
END $$;


-- ============================================================================
-- Tests 1 and 3 run under the client session (org_d) — the denial target.
-- ============================================================================
SELECT public._test_set_jwt(
  (SELECT client_d FROM _ids), (SELECT org_d FROM _ids), 'client'
);
SET LOCAL ROLE authenticated;

-- Test 1 (LOAD-BEARING): client session sees ZERO of its own CMH rows.
INSERT INTO _tap (n, line) VALUES (1, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM client_medical_history
      WHERE client_id = (SELECT client_row_id FROM _ids)),
    0,
    'LOAD-BEARING (CN-2): client sees zero of its own client_medical_history rows'
  ) AS l
));

-- Test 3 (anti-trivial control): still under the client session, the client
-- CAN read its own clients row, proving the session is live, not blind.
INSERT INTO _tap (n, line) VALUES (3, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM clients
      WHERE id = (SELECT client_row_id FROM _ids)),
    1,
    'control: client CAN see its own clients row (session is live, not blind)'
  ) AS l
));


-- ============================================================================
-- Test 2 (positive control): staff session in the SAME org sees the row.
-- Reset to the owner role first, then spoof the staff JWT and drop back to
-- authenticated — the between-block reset idiom from 02_never_hard_wall.sql.
-- ============================================================================
RESET ROLE;

SELECT public._test_set_jwt(
  (SELECT staff_d FROM _ids), (SELECT org_d FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;

INSERT INTO _tap (n, line) VALUES (2, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM client_medical_history
      WHERE id = (SELECT cmh_id FROM _ids)),
    1,
    'control: staff in same org sees the CMH row (test 1 zero is role-gating, not absent fixture)'
  ) AS l
));


-- ----------------------------------------------------------------------------
-- Surface all three captured TAP lines in one editor grid.
-- ----------------------------------------------------------------------------
SELECT line FROM _tap ORDER BY n;

ROLLBACK;
