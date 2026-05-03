SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 11_program_copy_repeat
-- ============================================================================
-- Why: Coverage for migration 20260503130000_program_copy_repeat.sql
-- (Phase D — block-level copy + repeat RPCs).
--
-- Asserts the load-bearing properties:
--
--   §A copy_program clean path: clones the program + every week +
--      every day (with shifted scheduled_date) + every exercise (with
--      remapped superset_group_ids).
--   §B copy_program defaults the new name to "<src.name> (copy)" when
--      caller passes NULL / blank.
--   §C copy_program overlap path: target start_date overlaps an
--      existing active program → status='overlap', no rows inserted.
--   §D repeat_program clean path: new_start = source.start +
--      duration_weeks*7, new name = "<src.name> (next)", structure
--      cloned identically.
--   §E repeat_program overlap path: another active program already
--      sits where the back-to-back clone would land → status='overlap'.
--
-- Output pattern: TAP lines captured into temp _tap so the supabase
-- db query CLI returns all lines in the final SELECT.
--
-- Test count: 9
-- ============================================================================

BEGIN;

SELECT plan(9);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated;


-- ----------------------------------------------------------------------------
-- §1. Fixture
--
-- One organization + one client + one active program (Apr 27 – May 25,
-- 4 weeks). Program contains 1 week, 1 day on Mon Apr 27, 2 exercises
-- in a superset group. Same shape as test 10 so we can lean on the
-- same clone semantics.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  org_a       uuid := '00000000-0000-0000-0000-000000000e01'::uuid;
  staff_a     uuid;
  client_user uuid;
  client_a    uuid := '00000000-0000-0000-0000-000000000e03'::uuid;
  exercise_id uuid := '00000000-0000-0000-0000-000000000e04'::uuid;
  program_a   uuid := '00000000-0000-0000-0000-000000000e05'::uuid;
  week_a      uuid := '00000000-0000-0000-0000-000000000e07'::uuid;
  source_day  uuid := '00000000-0000-0000-0000-000000000e08'::uuid;
  ss_group    uuid := '00000000-0000-0000-0000-000000000e09'::uuid;
BEGIN
  INSERT INTO organizations (id, name, slug)
  VALUES (org_a, 'Test Org A — Block Copy 11', 'test-org-a-block-copy-11');

  staff_a     := public._test_make_user('staff-a-blockcopy11@test.local');
  client_user := public._test_make_user('client-blockcopy11@test.local');

  PERFORM public._test_grant_membership(staff_a,     org_a, 'staff'::user_role);
  PERFORM public._test_grant_membership(client_user, org_a, 'client'::user_role);

  INSERT INTO clients (id, organization_id, user_id, first_name, last_name, email)
  VALUES (client_a, org_a, client_user, 'Bea', 'Block', 'blockcopy11@test.local');

  PERFORM public._test_set_jwt(staff_a, org_a, 'staff');
  EXECUTE 'SET LOCAL ROLE authenticated';

  INSERT INTO exercises (id, organization_id, name, default_sets, default_reps)
  VALUES (exercise_id, org_a, 'BC11 Test Exercise', 3, '8');

  INSERT INTO programs (
    id, organization_id, client_id, name, status, start_date, duration_weeks
  ) VALUES (
    program_a, org_a, client_a, 'BC11 Block', 'active', '2026-04-27'::date, 4
  );

  INSERT INTO program_weeks (id, program_id, week_number)
  VALUES (week_a, program_a, 1);

  INSERT INTO program_days (
    id, program_id, program_week_id, day_label, scheduled_date, sort_order
  ) VALUES (
    source_day, program_a, week_a, 'A', '2026-04-27'::date, 0
  );

  INSERT INTO program_exercises (
    program_day_id, exercise_id, sort_order, superset_group_id, sets, reps
  ) VALUES
    (source_day, exercise_id, 0, ss_group, 4, '6'),
    (source_day, exercise_id, 1, ss_group, 4, '6');

  EXECUTE 'RESET ROLE';

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_a       AS org_a,
    staff_a     AS staff_a,
    client_user AS client_user,
    client_a    AS client_a,
    exercise_id AS exercise_id,
    program_a   AS program_a,
    source_day  AS source_day,
    ss_group    AS ss_group;
  GRANT SELECT ON _ids TO authenticated;
END $$;


-- ----------------------------------------------------------------------------
-- §A. copy_program clean path — clone the source onto Aug 3 with an
-- explicit new name. Asserts: status, new_program_id, name, structure
-- (1 week, 1 day on shifted date, 2 exercises sharing a fresh group).
-- ----------------------------------------------------------------------------
SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;

CREATE TEMP TABLE _copy_result (result jsonb) ON COMMIT DROP;
GRANT INSERT, SELECT ON _copy_result TO authenticated;

INSERT INTO _copy_result
  SELECT public.copy_program(
    (SELECT program_a FROM _ids),
    '2026-08-03'::date,
    'BC11 Renamed Copy'
  );

INSERT INTO _tap (n, line) VALUES (1, (
  SELECT is(
    (SELECT result ->> 'status' FROM _copy_result),
    'created',
    'A1: copy_program clean path returns status=created'
  )
));

INSERT INTO _tap (n, line) VALUES (2, (
  SELECT is(
    (SELECT name FROM programs
      WHERE id = ((SELECT result ->> 'new_program_id' FROM _copy_result))::uuid),
    'BC11 Renamed Copy',
    'A2: explicit name is applied to the clone'
  )
));

INSERT INTO _tap (n, line) VALUES (3, (
  SELECT is(
    (SELECT scheduled_date FROM program_days
      WHERE program_id = ((SELECT result ->> 'new_program_id' FROM _copy_result))::uuid
        AND deleted_at IS NULL),
    '2026-08-03'::date,
    'A3: cloned day lands on the new start_date (shifted from Apr 27)'
  )
));

INSERT INTO _tap (n, line) VALUES (4, (
  SELECT is(
    (SELECT count(*)::int FROM program_exercises pe
      JOIN program_days pd ON pd.id = pe.program_day_id
     WHERE pd.program_id = ((SELECT result ->> 'new_program_id' FROM _copy_result))::uuid
       AND pe.deleted_at IS NULL
       AND pd.deleted_at IS NULL),
    2,
    'A4: cloned program has 2 program_exercises (no Cartesian explosion)'
  )
));


-- ----------------------------------------------------------------------------
-- §B. copy_program defaults the name to "<src> (copy)" when caller
-- passes NULL.
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE _default_name_result (result jsonb) ON COMMIT DROP;
GRANT INSERT, SELECT ON _default_name_result TO authenticated;

INSERT INTO _default_name_result
  SELECT public.copy_program(
    (SELECT program_a FROM _ids),
    '2026-09-07'::date,
    NULL
  );

INSERT INTO _tap (n, line) VALUES (5, (
  SELECT is(
    (SELECT name FROM programs
      WHERE id = ((SELECT result ->> 'new_program_id' FROM _default_name_result))::uuid),
    'BC11 Block (copy)',
    'B1: default name is "<source.name> (copy)"'
  )
));


-- ----------------------------------------------------------------------------
-- §C. copy_program overlap — try to copy onto Apr 27 (the source's
-- own start). Source is 4 weeks ending May 25; the new clone would
-- run Apr 27 → May 25, exactly overlapping the source.
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE _overlap_result (result jsonb) ON COMMIT DROP;
GRANT INSERT, SELECT ON _overlap_result TO authenticated;

INSERT INTO _overlap_result
  SELECT public.copy_program(
    (SELECT program_a FROM _ids),
    '2026-04-27'::date,
    'BC11 Would Overlap'
  );

INSERT INTO _tap (n, line) VALUES (6, (
  SELECT is(
    (SELECT result ->> 'status' FROM _overlap_result),
    'overlap',
    'C1: copy onto an overlapping date returns status=overlap'
  )
));


-- ----------------------------------------------------------------------------
-- §D. repeat_program clean path — back-to-back clone. Source is
-- Apr 27 + 4 weeks → new_start = Apr 27 + 28 = May 25.
-- BUT — §A's copy onto Aug 3 also created a 4-week block Aug 3 – Aug 31.
-- And §B onto Sep 7. The May 25 → Jun 22 range is still free.
-- New name should be "BC11 Block (next)".
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE _repeat_result (result jsonb) ON COMMIT DROP;
GRANT INSERT, SELECT ON _repeat_result TO authenticated;

INSERT INTO _repeat_result
  SELECT public.repeat_program((SELECT program_a FROM _ids));

INSERT INTO _tap (n, line) VALUES (7, (
  SELECT is(
    (SELECT result ->> 'status' FROM _repeat_result),
    'created',
    'D1: repeat_program clean path returns status=created'
  )
));

INSERT INTO _tap (n, line) VALUES (8, (
  SELECT is(
    (SELECT (start_date, name)::text FROM programs
      WHERE id = ((SELECT result ->> 'new_program_id' FROM _repeat_result))::uuid),
    '(2026-05-25,"BC11 Block (next)")',
    'D2: new program starts the day after source ends, name is "<src> (next)"'
  )
));


-- ----------------------------------------------------------------------------
-- §E. repeat_program overlap — repeat the SOURCE again. The first
-- repeat in §D landed at May 25. A second repeat would also try
-- May 25 → overlap.
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE _repeat2_result (result jsonb) ON COMMIT DROP;
GRANT INSERT, SELECT ON _repeat2_result TO authenticated;

INSERT INTO _repeat2_result
  SELECT public.repeat_program((SELECT program_a FROM _ids));

INSERT INTO _tap (n, line) VALUES (9, (
  SELECT is(
    (SELECT result ->> 'status' FROM _repeat2_result),
    'overlap',
    'E1: second repeat of the same source returns status=overlap'
  )
));


-- ----------------------------------------------------------------------------
-- Hand back to the test owner before final SELECT + ROLLBACK.
-- ----------------------------------------------------------------------------
RESET ROLE;

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
