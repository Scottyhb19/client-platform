-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), is(), throws_ok(), lives_ok() resolve
-- unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 06_soft_delete_rpcs_clients_and_program_exercises
-- ============================================================================
-- Why: Coverage for migration
-- 20260429130000_soft_delete_rpcs_clients_and_program_exercises.sql —
-- the follow-up that extends the soft-delete RPC pattern from 05 to the
-- two remaining tables on the deleted_at-IS-NULL UPDATE trap.
--
-- Same shape as 05 (same-org allow / cross-org deny / client deny per
-- RPC, plus restore-conflict where a unique-active index applies):
--
--   - clients            — soft-delete sets deleted_at AND archived_at;
--                          restore clears both. Conflict on email.
--   - program_exercises  — Pattern C nested-via-parent. The function
--                          replicates the parent walk (program_days →
--                          program_weeks → programs) inside the WHERE
--                          clause to gate cross-org attempts. No
--                          unique-active index, so no conflict path.
--
-- Test count: 13
--   clients              — 6 base + 1 email-conflict = 7
--   program_exercises    — 6 base + 0 conflict       = 6
-- ============================================================================

BEGIN;

SELECT plan(13);


-- ----------------------------------------------------------------------------
-- §1. Fixture
--
-- Two organizations:
--   org_a — has staff_a, client_user, client_row, a program for
--           client_row, and one program_exercise pointing at an
--           exercise also in org_a.
--   org_b — has staff_b (cross-org denial target).
--
-- The client_row's email is 'soft06@test.local' — used to set up the
-- email-conflict restore test by inserting a duplicate clients row
-- after the original is archived.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  org_a            uuid := '00000000-0000-0000-0000-0000000000f1'::uuid;
  org_b            uuid := '00000000-0000-0000-0000-0000000000f2'::uuid;
  staff_a          uuid;
  staff_b          uuid;
  client_user      uuid;
  client_row       uuid := '00000000-0000-0000-0000-0000000000f3'::uuid;
  exercise_id      uuid := '00000000-0000-0000-0000-0000000000f4'::uuid;
  program_id       uuid := '00000000-0000-0000-0000-0000000000f5'::uuid;
  week_id          uuid := '00000000-0000-0000-0000-0000000000f6'::uuid;
  day_id           uuid := '00000000-0000-0000-0000-0000000000f7'::uuid;
  prog_ex_id       uuid := '00000000-0000-0000-0000-0000000000f8'::uuid;
BEGIN
  -- Two orgs.
  INSERT INTO organizations (id, name, slug) VALUES
    (org_a, 'Test Org A — Soft-Delete RPCs 06', 'test-org-a-soft-delete-06'),
    (org_b, 'Test Org B — Soft-Delete RPCs 06', 'test-org-b-soft-delete-06');

  -- Two staff users + one client user.
  staff_a     := public._test_make_user('staff-a-sdr06@test.local');
  staff_b     := public._test_make_user('staff-b-sdr06@test.local');
  client_user := public._test_make_user('client-sdr06@test.local');

  PERFORM public._test_grant_membership(staff_a,     org_a, 'staff'::user_role);
  PERFORM public._test_grant_membership(staff_b,     org_b, 'staff'::user_role);
  PERFORM public._test_grant_membership(client_user, org_a, 'client'::user_role);

  -- The clients row that is itself the soft_delete_client target.
  INSERT INTO clients (
    id, organization_id, user_id, first_name, last_name, email
  ) VALUES (
    client_row, org_a, client_user, 'Sam', 'Subject', 'soft06@test.local'
  );

  -- Spoof staff_a's JWT and switch role to authenticated so the
  -- exercises / programs INSERT policies (which target authenticated)
  -- actually apply and pass.
  PERFORM public._test_set_jwt(staff_a, org_a, 'staff');
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- An exercise in org_a, then a program containing one program_exercise
  -- referencing it. The cross-org-FK trigger
  -- (enforce_program_exercise_same_org) checks the exercise's org against
  -- the program's org via the program_days → program_weeks → programs
  -- walk; both must match.
  INSERT INTO exercises (
    id, organization_id, name, default_sets, default_reps
  ) VALUES (
    exercise_id, org_a, 'SDR06 Test Exercise', 3, '8'
  );

  -- Post-D-PROG-001: programs need start_date + duration_weeks for the
  -- non-overlap EXCLUDE constraint and for date-based access patterns.
  -- program_days needs scheduled_date and program_id (NOT NULL post-Phase A).
  INSERT INTO programs (
    id, organization_id, client_id, name, start_date, duration_weeks
  ) VALUES (
    program_id, org_a, client_row, 'SDR06 Test Program', '2026-04-27'::date, 4
  );

  INSERT INTO program_weeks (
    id, program_id, week_number
  ) VALUES (
    week_id, program_id, 1
  );

  INSERT INTO program_days (
    id, program_id, program_week_id, day_label, scheduled_date, sort_order
  ) VALUES (
    day_id, program_id, week_id, 'Day 1', '2026-04-27'::date, 0
  );

  INSERT INTO program_exercises (
    id, program_day_id, exercise_id, sort_order, sets, reps
  ) VALUES (
    prog_ex_id, day_id, exercise_id, 0, 3, '8'
  );

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_a       AS org_a,
    org_b       AS org_b,
    staff_a     AS staff_a,
    staff_b     AS staff_b,
    client_user AS client_user,
    client_row  AS client_row,
    prog_ex_id  AS prog_ex_id;
  GRANT SELECT ON _ids TO authenticated;
END $$;


-- ============================================================================
-- §2. clients
-- ============================================================================
SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  format(
    $q$SELECT public.soft_delete_client(%L::uuid)$q$,
    (SELECT client_row FROM _ids)
  ),
  'staff_a soft_delete_client in own org succeeds'
);

SELECT public._test_set_jwt(
  (SELECT staff_b FROM _ids), (SELECT org_b FROM _ids), 'staff'
);
SELECT throws_ok(
  format(
    $q$SELECT public.restore_client(%L::uuid)$q$,
    (SELECT client_row FROM _ids)
  ),
  'P0002',
  NULL::text,
  'staff_b cannot restore a client in another org'
);

SELECT public._test_set_jwt(
  (SELECT client_user FROM _ids), (SELECT org_a FROM _ids), 'client'
);
SELECT throws_ok(
  format(
    $q$SELECT public.restore_client(%L::uuid)$q$,
    (SELECT client_row FROM _ids)
  ),
  '42501',
  'Unauthorized',
  'client cannot restore a client'
);

SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);
SELECT lives_ok(
  format(
    $q$SELECT public.restore_client(%L::uuid)$q$,
    (SELECT client_row FROM _ids)
  ),
  'staff_a restore_client in own org succeeds'
);

SELECT public._test_set_jwt(
  (SELECT staff_b FROM _ids), (SELECT org_b FROM _ids), 'staff'
);
SELECT throws_ok(
  format(
    $q$SELECT public.soft_delete_client(%L::uuid)$q$,
    (SELECT client_row FROM _ids)
  ),
  'P0002',
  NULL::text,
  'staff_b cannot soft_delete a client in another org'
);

SELECT public._test_set_jwt(
  (SELECT client_user FROM _ids), (SELECT org_a FROM _ids), 'client'
);
SELECT throws_ok(
  format(
    $q$SELECT public.soft_delete_client(%L::uuid)$q$,
    (SELECT client_row FROM _ids)
  ),
  '42501',
  'Unauthorized',
  'client cannot soft_delete a client'
);

-- Email-conflict on restore: archive the client, INSERT a new live
-- clients row with the same email (now allowed because the partial
-- unique index released the slot), then attempt to restore the original.
SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);
SELECT public.soft_delete_client((SELECT client_row FROM _ids));

INSERT INTO clients (
  organization_id, first_name, last_name, email
) VALUES (
  (SELECT org_a FROM _ids),
  'Replacement', 'Sam', 'SOFT06@test.local'  -- same lower(email)
);

SELECT throws_ok(
  format(
    $q$SELECT public.restore_client(%L::uuid)$q$,
    (SELECT client_row FROM _ids)
  ),
  '23505',
  'cannot restore: another active client already uses the email soft06@test.local',
  'restore_client refuses when the email is now taken by a live client'
);


-- ============================================================================
-- §3. program_exercises
-- ============================================================================
SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);

SELECT lives_ok(
  format(
    $q$SELECT public.soft_delete_program_exercise(%L::uuid)$q$,
    (SELECT prog_ex_id FROM _ids)
  ),
  'staff_a soft_delete_program_exercise in own org succeeds'
);

SELECT public._test_set_jwt(
  (SELECT staff_b FROM _ids), (SELECT org_b FROM _ids), 'staff'
);
SELECT throws_ok(
  format(
    $q$SELECT public.restore_program_exercise(%L::uuid)$q$,
    (SELECT prog_ex_id FROM _ids)
  ),
  'P0002',
  NULL::text,
  'staff_b cannot restore a program_exercise in another org'
);

SELECT public._test_set_jwt(
  (SELECT client_user FROM _ids), (SELECT org_a FROM _ids), 'client'
);
SELECT throws_ok(
  format(
    $q$SELECT public.restore_program_exercise(%L::uuid)$q$,
    (SELECT prog_ex_id FROM _ids)
  ),
  '42501',
  'Unauthorized',
  'client cannot restore a program_exercise'
);

SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);
SELECT lives_ok(
  format(
    $q$SELECT public.restore_program_exercise(%L::uuid)$q$,
    (SELECT prog_ex_id FROM _ids)
  ),
  'staff_a restore_program_exercise in own org succeeds'
);

SELECT public._test_set_jwt(
  (SELECT staff_b FROM _ids), (SELECT org_b FROM _ids), 'staff'
);
SELECT throws_ok(
  format(
    $q$SELECT public.soft_delete_program_exercise(%L::uuid)$q$,
    (SELECT prog_ex_id FROM _ids)
  ),
  'P0002',
  NULL::text,
  'staff_b cannot soft_delete a program_exercise in another org'
);

SELECT public._test_set_jwt(
  (SELECT client_user FROM _ids), (SELECT org_a FROM _ids), 'client'
);
SELECT throws_ok(
  format(
    $q$SELECT public.soft_delete_program_exercise(%L::uuid)$q$,
    (SELECT prog_ex_id FROM _ids)
  ),
  '42501',
  'Unauthorized',
  'client cannot soft_delete a program_exercise'
);


SELECT * FROM finish();

ROLLBACK;
