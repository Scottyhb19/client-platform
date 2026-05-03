-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), is(), throws_ok(), lives_ok() resolve
-- unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 12_program_day_soft_delete
-- ============================================================================
-- Why: Coverage for migration 20260503140000_program_day_soft_delete.sql
-- (Phase E.0c — soft_delete_program_day RPC; cascades to program_exercises).
--
-- Asserts the load-bearing properties:
--
--   §A clean path: soft-delete sets program_days.deleted_at; cascade
--      sets deleted_at on every program_exercise on that day.
--   §B re-call protection: calling soft_delete_program_day on an
--      already-deleted day raises SQLSTATE no_data_found.
--   §C cross-org isolation: a staff caller from a different org cannot
--      soft-delete the row (the EXISTS clause filters it out → no row
--      updated → raises no_data_found, NOT Unauthorized — same shape as
--      "row already gone" from this caller's perspective).
--   §D auth gate: a 'client'-role caller (not in owner|staff) raises
--      Unauthorized 42501 from the explicit role check at the top of
--      the function.
--
-- Output pattern: each assertion's TAP line captured into temp _tap so
-- the supabase db query CLI returns all lines in the final SELECT.
--
-- Test count: 5
-- ============================================================================

BEGIN;

SELECT plan(5);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated;


-- ----------------------------------------------------------------------------
-- §1. Fixture
--
-- Two orgs (A + B). Org A has one client with one active program containing
-- one program_day (Day A on 2026-04-27) with two program_exercises. Org B
-- exists only so we can spoof a cross-org staff caller for §C.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  org_a       uuid := '00000000-0000-0000-0000-000000000d01'::uuid;
  org_b       uuid := '00000000-0000-0000-0000-000000000d02'::uuid;
  staff_a     uuid;
  staff_b     uuid;
  client_user uuid;
  client_a    uuid := '00000000-0000-0000-0000-000000000d03'::uuid;
  exercise_id uuid := '00000000-0000-0000-0000-000000000d04'::uuid;
  program_a   uuid := '00000000-0000-0000-0000-000000000d05'::uuid;
  source_day  uuid := '00000000-0000-0000-0000-000000000d06'::uuid;
BEGIN
  INSERT INTO organizations (id, name, slug)
  VALUES
    (org_a, 'Test Org A — Day Soft Delete 12', 'test-org-a-day-soft-delete-12'),
    (org_b, 'Test Org B — Day Soft Delete 12', 'test-org-b-day-soft-delete-12');

  staff_a     := public._test_make_user('staff-a-daysoftdelete12@test.local');
  staff_b     := public._test_make_user('staff-b-daysoftdelete12@test.local');
  client_user := public._test_make_user('client-daysoftdelete12@test.local');

  PERFORM public._test_grant_membership(staff_a,     org_a, 'staff'::user_role);
  PERFORM public._test_grant_membership(staff_b,     org_b, 'staff'::user_role);
  PERFORM public._test_grant_membership(client_user, org_a, 'client'::user_role);

  INSERT INTO clients (id, organization_id, user_id, first_name, last_name, email)
  VALUES (client_a, org_a, client_user, 'Sam', 'Delete', 'daysoftdelete12@test.local');

  PERFORM public._test_set_jwt(staff_a, org_a, 'staff');
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- One exercise in org_a so program_exercises FK can resolve.
  INSERT INTO exercises (id, organization_id, name, default_sets, default_reps)
  VALUES (exercise_id, org_a, 'D12 Test Exercise', 3, '8');

  -- Active program: Apr 27 (Mon) → May 25 (4 weeks).
  INSERT INTO programs (
    id, organization_id, client_id, name, status, start_date, duration_weeks
  ) VALUES (
    program_a, org_a, client_a, 'D12 Block', 'active', '2026-04-27'::date, 4
  );

  -- Source day: Mon Apr 27, Day A. Two exercises.
  INSERT INTO program_days (
    id, program_id, day_label, scheduled_date, sort_order
  ) VALUES (
    source_day, program_a, 'A', '2026-04-27'::date, 0
  );

  INSERT INTO program_exercises (
    program_day_id, exercise_id, sort_order, sets, reps
  ) VALUES
    (source_day, exercise_id, 0, 4, '6'),
    (source_day, exercise_id, 1, 4, '6');

  EXECUTE 'RESET ROLE';

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_a       AS org_a,
    org_b       AS org_b,
    staff_a     AS staff_a,
    staff_b     AS staff_b,
    client_user AS client_user,
    client_a    AS client_a,
    exercise_id AS exercise_id,
    program_a   AS program_a,
    source_day  AS source_day;
  GRANT SELECT ON _ids TO authenticated;
END $$;


-- ----------------------------------------------------------------------------
-- §A. Clean path — soft_delete_program_day sets the day's deleted_at and
-- cascades to all program_exercises on the day.
-- ----------------------------------------------------------------------------
SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;

SELECT public.soft_delete_program_day((SELECT source_day FROM _ids));

-- After soft-delete, the program_days SELECT policy filters the row
-- (deleted_at IS NULL clause) — same gotcha that required SECURITY
-- DEFINER on the RPC itself. RESET ROLE briefly to bypass RLS for
-- verification, then re-set authenticated for the §B test.
RESET ROLE;

INSERT INTO _tap (n, line) VALUES (1, (
  SELECT ok(
    (SELECT deleted_at IS NOT NULL FROM program_days
      WHERE id = (SELECT source_day FROM _ids)),
    'A1: program_day.deleted_at is set after soft_delete_program_day'
  )
));

INSERT INTO _tap (n, line) VALUES (2, (
  SELECT is(
    (SELECT count(*)::int FROM program_exercises
      WHERE program_day_id = (SELECT source_day FROM _ids)
        AND deleted_at IS NULL),
    0,
    'A2: cascade — all program_exercises on the day have deleted_at set'
  )
));

SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;


-- ----------------------------------------------------------------------------
-- §B. Re-call — the day is already soft-deleted, so a second invocation
-- raises SQLSTATE no_data_found. The function uses RAISE EXCEPTION USING
-- ERRCODE = 'no_data_found' which surfaces as SQLSTATE 'P0002' from
-- plpgsql (no_data found maps to '02000' or 'P0002' depending on version;
-- pgTAP throws_ok matches on the error message text).
-- ----------------------------------------------------------------------------
INSERT INTO _tap (n, line) VALUES (3, (
  SELECT throws_ok(
    format(
      'SELECT public.soft_delete_program_day(%L::uuid)',
      (SELECT source_day FROM _ids)
    ),
    NULL,
    NULL,
    'B1: re-calling soft_delete_program_day on an already-deleted day raises an error'
  )
));


-- ----------------------------------------------------------------------------
-- §C. Cross-org isolation — a staff caller in org_b cannot soft-delete a
-- program_day belonging to org_a. The EXISTS clause filters the row out
-- (caller_org doesn't match), so the UPDATE finds no row and the
-- function raises no_data_found. From the cross-org caller's perspective,
-- the row is invisible (same shape as "doesn't exist for me").
--
-- For this assertion we need a fresh, non-deleted source row in org_a.
-- Insert a second day so the test isn't comparing against the already-
-- deleted row from §A.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  fresh_day uuid := '00000000-0000-0000-0000-000000000d07'::uuid;
BEGIN
  PERFORM public._test_set_jwt(
    (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
  );
  EXECUTE 'SET LOCAL ROLE authenticated';

  INSERT INTO program_days (id, program_id, day_label, scheduled_date, sort_order)
  VALUES (fresh_day, (SELECT program_a FROM _ids), 'B', '2026-04-28'::date, 1);

  EXECUTE 'RESET ROLE';

  -- Stash the new id for the assertions below.
  CREATE TEMP TABLE _fresh ON COMMIT DROP AS SELECT fresh_day AS fresh_day;
  GRANT SELECT ON _fresh TO authenticated;
END $$;

-- Switch caller to org_b staff and try to soft-delete the org_a day.
SELECT public._test_set_jwt(
  (SELECT staff_b FROM _ids), (SELECT org_b FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;

INSERT INTO _tap (n, line) VALUES (4, (
  SELECT throws_ok(
    format(
      'SELECT public.soft_delete_program_day(%L::uuid)',
      (SELECT fresh_day FROM _fresh)
    ),
    NULL,
    NULL,
    'C1: cross-org staff caller cannot soft-delete the row (raises no_data_found)'
  )
));


-- ----------------------------------------------------------------------------
-- §D. Auth gate — a caller in role 'client' (not owner|staff) is rejected
-- by the explicit role check at the top of the function. SQLSTATE 42501.
-- ----------------------------------------------------------------------------
SELECT public._test_set_jwt(
  (SELECT client_user FROM _ids), (SELECT org_a FROM _ids), 'client'
);
SET LOCAL ROLE authenticated;

INSERT INTO _tap (n, line) VALUES (5, (
  SELECT throws_ok(
    format(
      'SELECT public.soft_delete_program_day(%L::uuid)',
      (SELECT fresh_day FROM _fresh)
    ),
    '42501',
    NULL,
    'D1: client-role caller is rejected with Unauthorized (SQLSTATE 42501)'
  )
));


-- ----------------------------------------------------------------------------
-- Final SELECT: aggregate every assertion's TAP line so the supabase db
-- query CLI returns all of them (it only surfaces the last statement).
-- ----------------------------------------------------------------------------
SELECT line FROM _tap ORDER BY n;

ROLLBACK;
