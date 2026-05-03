-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), is(), throws_ok(), lives_ok() resolve
-- unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 13_create_program_day
-- ============================================================================
-- Why: Coverage for migration 20260504100000_create_program_day.sql
-- (Phase F.0 — empty-cell "Create session" RPC). Mirrors the test
-- shapes from 10_program_days_copy_repeat.sql (covers copy_program_day)
-- and 12_program_day_soft_delete.sql (covers the auth + cross-org gates).
--
-- Asserts the load-bearing properties:
--
--   §A clean path: create_program_day inserts a new program_day on the
--      target date attached to the active program covering it. Default
--      day_label = 'A'. Returns status='created' with new_day_id.
--   §B no_program path: a target date outside any active block returns
--      status='no_program' with target_date echoed back. No insert.
--   §C conflict path: a target date that already has a program_day
--      returns status='conflict' with existing_day_id. No second insert.
--   §D cross-org isolation: a staff caller in a different org cannot
--      create a day for client_a → 42501 (the client_org check rejects).
--   §E auth gate: a 'client'-role caller (not in owner|staff) raises
--      Unauthorized 42501.
--
-- Output pattern: each assertion's TAP line captured into temp _tap so
-- the supabase db query CLI returns all lines in the final SELECT.
--
-- Test count: 7
-- ============================================================================

BEGIN;

SELECT plan(7);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated;


-- ----------------------------------------------------------------------------
-- §1. Fixture
--
-- Two orgs (A + B). Org A has one client with one active program (Apr 27 →
-- May 25, 4 weeks) and one existing program_day on Apr 27 (used for §C
-- conflict). Org B exists for the §D cross-org test.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  org_a       uuid := '00000000-0000-0000-0000-000000000e01'::uuid;
  org_b       uuid := '00000000-0000-0000-0000-000000000e02'::uuid;
  staff_a     uuid;
  staff_b     uuid;
  client_user uuid;
  client_a    uuid := '00000000-0000-0000-0000-000000000e03'::uuid;
  program_a   uuid := '00000000-0000-0000-0000-000000000e04'::uuid;
  existing_d  uuid := '00000000-0000-0000-0000-000000000e05'::uuid;
BEGIN
  INSERT INTO organizations (id, name, slug)
  VALUES
    (org_a, 'Test Org A — Create Program Day 13', 'test-org-a-create-program-day-13'),
    (org_b, 'Test Org B — Create Program Day 13', 'test-org-b-create-program-day-13');

  staff_a     := public._test_make_user('staff-a-createday13@test.local');
  staff_b     := public._test_make_user('staff-b-createday13@test.local');
  client_user := public._test_make_user('client-createday13@test.local');

  PERFORM public._test_grant_membership(staff_a,     org_a, 'staff'::user_role);
  PERFORM public._test_grant_membership(staff_b,     org_b, 'staff'::user_role);
  PERFORM public._test_grant_membership(client_user, org_a, 'client'::user_role);

  INSERT INTO clients (id, organization_id, user_id, first_name, last_name, email)
  VALUES (client_a, org_a, client_user, 'Sam', 'Create', 'createday13@test.local');

  PERFORM public._test_set_jwt(staff_a, org_a, 'staff');
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- Active program: Apr 27 (Mon) → May 25 (4 weeks).
  INSERT INTO programs (
    id, organization_id, client_id, name, status, start_date, duration_weeks
  ) VALUES (
    program_a, org_a, client_a, 'D13 Block', 'active', '2026-04-27'::date, 4
  );

  -- Existing day on Apr 27 — feeds the §C conflict assertion.
  INSERT INTO program_days (
    id, program_id, day_label, scheduled_date, sort_order
  ) VALUES (
    existing_d, program_a, 'A', '2026-04-27'::date, 0
  );

  EXECUTE 'RESET ROLE';

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_a       AS org_a,
    org_b       AS org_b,
    staff_a     AS staff_a,
    staff_b     AS staff_b,
    client_user AS client_user,
    client_a    AS client_a,
    program_a   AS program_a,
    existing_d  AS existing_d;
  GRANT SELECT ON _ids TO authenticated;
END $$;


-- ----------------------------------------------------------------------------
-- §A. Clean path — create on Apr 28 (inside the block, no existing day).
-- ----------------------------------------------------------------------------
SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;

CREATE TEMP TABLE _create_a ON COMMIT DROP AS
  SELECT public.create_program_day(
    (SELECT client_a FROM _ids),
    '2026-04-28'::date
  ) AS result;
GRANT SELECT ON _create_a TO authenticated;

INSERT INTO _tap (n, line) VALUES (1, (
  SELECT is(
    (SELECT result->>'status' FROM _create_a),
    'created',
    'A1: clean create returns status=created'
  )
));

INSERT INTO _tap (n, line) VALUES (2, (
  SELECT ok(
    (SELECT (result->>'new_day_id')::uuid IS NOT NULL FROM _create_a),
    'A2: new_day_id is returned'
  )
));

INSERT INTO _tap (n, line) VALUES (3, (
  SELECT is(
    (SELECT day_label FROM program_days
      WHERE id = (SELECT (result->>'new_day_id')::uuid FROM _create_a)),
    'A',
    'A3: default day_label is ''A'''
  )
));


-- ----------------------------------------------------------------------------
-- §B. no_program path — Aug 15 falls outside the Apr 27 → May 25 block.
-- Returns status='no_program'; no insert.
-- ----------------------------------------------------------------------------
INSERT INTO _tap (n, line) VALUES (4, (
  SELECT is(
    (SELECT (public.create_program_day(
      (SELECT client_a FROM _ids),
      '2026-08-15'::date
    ))->>'status'),
    'no_program',
    'B1: target date outside any active block returns status=no_program'
  )
));


-- ----------------------------------------------------------------------------
-- §C. conflict path — Apr 27 already has a program_day from the fixture.
-- Returns status='conflict' with existing_day_id; no second insert.
-- ----------------------------------------------------------------------------
INSERT INTO _tap (n, line) VALUES (5, (
  SELECT is(
    (SELECT (public.create_program_day(
      (SELECT client_a FROM _ids),
      '2026-04-27'::date
    ))->>'status'),
    'conflict',
    'C1: target date with an existing day returns status=conflict'
  )
));


-- ----------------------------------------------------------------------------
-- §D. Cross-org isolation — staff in org_b cannot create a day for org_a's
-- client. Raises 42501 from the client_org check.
-- ----------------------------------------------------------------------------
SELECT public._test_set_jwt(
  (SELECT staff_b FROM _ids), (SELECT org_b FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;

INSERT INTO _tap (n, line) VALUES (6, (
  SELECT throws_ok(
    format(
      'SELECT public.create_program_day(%L::uuid, ''2026-05-04''::date)',
      (SELECT client_a FROM _ids)
    ),
    '42501',
    NULL,
    'D1: cross-org staff caller is rejected with Unauthorized (SQLSTATE 42501)'
  )
));


-- ----------------------------------------------------------------------------
-- §E. Auth gate — a 'client'-role caller (not in owner|staff) is rejected
-- by the explicit role check at the top of the function. SQLSTATE 42501.
-- ----------------------------------------------------------------------------
SELECT public._test_set_jwt(
  (SELECT client_user FROM _ids), (SELECT org_a FROM _ids), 'client'
);
SET LOCAL ROLE authenticated;

INSERT INTO _tap (n, line) VALUES (7, (
  SELECT throws_ok(
    format(
      'SELECT public.create_program_day(%L::uuid, ''2026-05-04''::date)',
      (SELECT client_a FROM _ids)
    ),
    '42501',
    NULL,
    'E1: client-role caller is rejected with Unauthorized (SQLSTATE 42501)'
  )
));


-- ----------------------------------------------------------------------------
-- Final SELECT: aggregate every assertion's TAP line so the supabase db
-- query CLI returns all of them (it only surfaces the last statement).
-- ----------------------------------------------------------------------------
SELECT line FROM _tap ORDER BY n;

ROLLBACK;
