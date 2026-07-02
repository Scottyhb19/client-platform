-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), is() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 55_cmed_occ_version
-- ============================================================================
-- Locks in the client_medications OCC parity fix (migration
-- 20260702180000_cmed_occ_version; docs/go-live-checklist.md §8, the CN-6
-- residual): client_medications now carries the §12 OCC pattern — a version
-- column bumped by bump_version_and_touch(), with the application including the
-- last-read version in its UPDATE WHERE clause so a concurrent write matches
-- zero rows. Before this, the two-staff beta had a live last-write-wins clobber
-- window on medication edits, identical to the one CN-6 closed on
-- client_medical_history (see pgTAP 51, which this file mirrors).
--
-- The test exercises the exact contract updateMedicationAction relies on,
-- under a real staff JWT session (not owner bypass):
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
--      first writer's name. Proves assertion 3's zero was a refusal, not a
--      silently-succeeded write with a weird rowcount.
--
-- Style: buffered into _tap (mirrors 19/46/51) so all TAP lines surface in one
-- grid whether run in the SQL editor or via `supabase db query --linked -f`.
-- BEGIN/ROLLBACK makes the live-project run safe; finish() intentionally
-- dropped (same as 15/16/17/19/51).
-- ============================================================================

BEGIN;

SELECT plan(4);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated;


-- ----------------------------------------------------------------------------
-- Fixture (owner-privileged inserts; client_medications has RLS but not FORCE
-- RLS, same property 17/19/51 rely on).
--
--   org_f — staff_f (staff), one client row, one medication row at version 1.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  org_f         uuid := '00000000-0000-0000-0000-00000000f201'::uuid;
  staff_f       uuid;
  client_row_id uuid := '00000000-0000-0000-0000-00000000f202'::uuid;
  cmed_id       uuid := '00000000-0000-0000-0000-00000000f203'::uuid;
BEGIN
  INSERT INTO organizations (id, name, slug)
  VALUES (org_f, 'Test Org F — CMED OCC 54', 'test-org-f-cmed-occ-54');

  staff_f := public._test_make_user('staff-cmed-occ54@test.local');
  PERFORM public._test_grant_membership(staff_f, org_f, 'staff'::user_role);

  INSERT INTO clients (id, organization_id, first_name, last_name, email)
  VALUES (client_row_id, org_f, 'Occa', 'Medrow', 'occa-cmed54@test.local');

  INSERT INTO client_medications
    (id, organization_id, client_id, name, is_active)
  VALUES (cmed_id, org_f, client_row_id, 'OCC canary med', true);

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_f AS org_f, staff_f AS staff_f,
    client_row_id AS client_row_id, cmed_id AS cmed_id;
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
  (SELECT staff_f FROM _ids), (SELECT org_f FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;

-- Test 1 (LOAD-BEARING): current-version UPDATE matches exactly 1 row.
WITH w AS (
  UPDATE client_medications
     SET name = 'First writer won'
   WHERE id = (SELECT cmed_id FROM _ids) AND version = 1
  RETURNING id
)
INSERT INTO _w1 (n) SELECT count(*)::int FROM w;

INSERT INTO _tap (n, line) VALUES (1, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT n FROM _w1),
    1,
    'LOAD-BEARING (cmed OCC): UPDATE keyed on the current version matches 1 row'
  ) AS l
));

-- Test 2 (LOAD-BEARING): the trigger bumped version 1 -> 2.
INSERT INTO _tap (n, line) VALUES (2, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT version FROM client_medications
      WHERE id = (SELECT cmed_id FROM _ids)),
    2,
    'LOAD-BEARING (cmed OCC): bump_version_and_touch incremented version to 2'
  ) AS l
));

-- Test 3 (LOAD-BEARING): a second writer still holding version 1 matches
-- zero rows — the refusal updateMedicationAction surfaces as a conflict.
WITH w AS (
  UPDATE client_medications
     SET name = 'Stale writer must not land'
   WHERE id = (SELECT cmed_id FROM _ids) AND version = 1
  RETURNING id
)
INSERT INTO _w2 (n) SELECT count(*)::int FROM w;

INSERT INTO _tap (n, line) VALUES (3, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT n FROM _w2),
    0,
    'LOAD-BEARING (cmed OCC): UPDATE keyed on the stale version matches 0 rows'
  ) AS l
));

-- Test 4 (control): the first writer's name survived the stale attempt.
INSERT INTO _tap (n, line) VALUES (4, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT name FROM client_medications
      WHERE id = (SELECT cmed_id FROM _ids)),
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
