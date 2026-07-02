-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), is() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 51_cmh_occ_version
-- ============================================================================
-- Locks in the CN-6 deferred-item closure (migration
-- 20260702120000_cmh_occ_version; docs/go-live-checklist.md §8;
-- docs/polish/client-profile-clinical-notes.md CN-6): client_medical_history
-- now carries the §12 OCC pattern — a version column bumped by
-- bump_version_and_touch(), with the application including the last-read
-- version in its UPDATE WHERE clause so a concurrent write matches zero
-- rows. Before this, the two-staff beta had a live last-write-wins clobber
-- window on medical-history edits.
--
-- The test exercises the exact contract updateMedicalConditionAction
-- relies on, under a real staff JWT session (not owner bypass):
--
-- Assertions (4), most-critical-first:
--   1. LOAD-BEARING — an UPDATE keyed on the CURRENT version matches 1 row
--      (the happy-path write goes through).
--   2. LOAD-BEARING — the trigger bumped version to 2, so the row a
--      concurrent editor read at version 1 is now stale.
--   3. LOAD-BEARING — an UPDATE keyed on the STALE version matches 0 rows.
--      This zero is what the action maps to its conflict message; if a
--      future migration drops the trigger or the column default, this is
--      the assertion that fails.
--   4. control — the stale write did not land: the row still holds the
--      first writer's text. Proves assertion 3's zero was a refusal, not a
--      silently-succeeded write with a weird rowcount.
--
-- Style: buffered into _tap (mirrors 19/46) so all TAP lines surface in one
-- grid whether run in the SQL editor or via `supabase db query --linked -f`.
-- BEGIN/ROLLBACK makes the live-project run safe; finish() intentionally
-- dropped (same as 15/16/17/19).
-- ============================================================================

BEGIN;

SELECT plan(4);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated;


-- ----------------------------------------------------------------------------
-- Fixture (owner-privileged inserts; client_medical_history has RLS but not
-- FORCE RLS, same property 17/19 rely on).
--
--   org_e — staff_e (staff), one client row, one condition row at version 1.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  org_e         uuid := '00000000-0000-0000-0000-00000000e101'::uuid;
  staff_e       uuid;
  client_row_id uuid := '00000000-0000-0000-0000-00000000e102'::uuid;
  cmh_id        uuid := '00000000-0000-0000-0000-00000000e103'::uuid;
BEGIN
  INSERT INTO organizations (id, name, slug)
  VALUES (org_e, 'Test Org E — CMH OCC 51', 'test-org-e-cmh-occ-51');

  staff_e := public._test_make_user('staff-cmh-occ51@test.local');
  PERFORM public._test_grant_membership(staff_e, org_e, 'staff'::user_role);

  INSERT INTO clients (id, organization_id, first_name, last_name, email)
  VALUES (client_row_id, org_e, 'Occa', 'Patient', 'occa-cmh51@test.local');

  INSERT INTO client_medical_history
    (id, organization_id, client_id, condition, is_active)
  VALUES (cmh_id, org_e, client_row_id, 'OCC canary condition', true);

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_e AS org_e, staff_e AS staff_e,
    client_row_id AS client_row_id, cmh_id AS cmh_id;
  GRANT SELECT ON _ids TO authenticated;
END $$;


-- Rowcount capture tables. Created as owner so they exist before the role
-- drop; authenticated gets INSERT+SELECT (same idiom as _tap). A
-- data-modifying CTE must sit on a top-level INSERT/SELECT/UPDATE/DELETE,
-- so each write below is `WITH w AS (UPDATE …) INSERT INTO _wN`.
CREATE TEMP TABLE _w1 (n int NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE _w2 (n int NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _w1, _w2 TO authenticated;

-- ============================================================================
-- All four tests run under the staff session — the role the action runs as.
-- ============================================================================
SELECT public._test_set_jwt(
  (SELECT staff_e FROM _ids), (SELECT org_e FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;

-- Test 1 (LOAD-BEARING): current-version UPDATE matches exactly 1 row.
WITH w AS (
  UPDATE client_medical_history
     SET condition = 'First writer won'
   WHERE id = (SELECT cmh_id FROM _ids) AND version = 1
  RETURNING id
)
INSERT INTO _w1 (n) SELECT count(*)::int FROM w;

INSERT INTO _tap (n, line) VALUES (1, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT n FROM _w1),
    1,
    'LOAD-BEARING (CN-6): UPDATE keyed on the current version matches 1 row'
  ) AS l
));

-- Test 2 (LOAD-BEARING): the trigger bumped version 1 -> 2.
INSERT INTO _tap (n, line) VALUES (2, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT version FROM client_medical_history
      WHERE id = (SELECT cmh_id FROM _ids)),
    2,
    'LOAD-BEARING (CN-6): bump_version_and_touch incremented version to 2'
  ) AS l
));

-- Test 3 (LOAD-BEARING): a second writer still holding version 1 matches
-- zero rows — the refusal updateMedicalConditionAction surfaces as a 409.
WITH w AS (
  UPDATE client_medical_history
     SET condition = 'Stale writer must not land'
   WHERE id = (SELECT cmh_id FROM _ids) AND version = 1
  RETURNING id
)
INSERT INTO _w2 (n) SELECT count(*)::int FROM w;

INSERT INTO _tap (n, line) VALUES (3, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT n FROM _w2),
    0,
    'LOAD-BEARING (CN-6): UPDATE keyed on the stale version matches 0 rows'
  ) AS l
));

-- Test 4 (control): the first writer's text survived the stale attempt.
INSERT INTO _tap (n, line) VALUES (4, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT condition FROM client_medical_history
      WHERE id = (SELECT cmh_id FROM _ids)),
    'First writer won',
    'control: stale write did not land — first writer''s value survives'
  ) AS l
));


-- ----------------------------------------------------------------------------
-- Surface all four captured TAP lines in one grid.
-- ----------------------------------------------------------------------------
RESET ROLE;
SELECT line FROM _tap ORDER BY n;

ROLLBACK;
