-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), is(), throws_ok(), lives_ok() resolve
-- unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 10_program_days_copy_repeat
-- ============================================================================
-- Why: Coverage for migration 20260503120000_program_days_copy_repeat.sql
-- (Phase C — day-level copy + repeat RPCs).
--
-- Asserts the load-bearing properties:
--
--   §A copy_program_day clean path: clone → new day exists on target
--      date with same day_label, exercises copied with superset group
--      ids remapped (no collision with source).
--   §B copy_program_day no-program path: target date outside any active
--      program → status='no_program', no insert.
--   §C copy_program_day conflict + force: existing day on target date,
--      p_force=false returns conflict; p_force=true soft-deletes it
--      and inserts the new one.
--   §D repeat_program_day_weekly clean path: source on Mon, end_date
--      3 weeks ahead → 3 new Mondays created. day_ids returned.
--   §E repeat_program_day_weekly invalid_end_date: end_date before
--      source date → status='invalid_end_date', no inserts.
--   §F repeat_program_day_weekly auto-extends source program's
--      duration when end_date falls past the block end.
--   §G repeat_program_day_weekly multi-block fallback: extension would
--      overlap a second active block, so silently skip extension and
--      land copies wherever blocks already cover them.
--
-- Output pattern: each assertion's TAP line captured into temp _tap so
-- the supabase db query CLI returns all lines in the final SELECT.
--
-- Test count: 14
-- ============================================================================

BEGIN;

SELECT plan(14);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated;


-- ----------------------------------------------------------------------------
-- §1. Fixture
--
-- One organization, one client, ONE active program (Apr 27 – May 25,
-- 4 weeks). Source day on Apr 27 (Mon, Day A) with two exercises in a
-- superset.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  org_a       uuid := '00000000-0000-0000-0000-000000000c01'::uuid;
  staff_a     uuid;
  client_user uuid;
  client_a    uuid := '00000000-0000-0000-0000-000000000c03'::uuid;
  exercise_id uuid := '00000000-0000-0000-0000-000000000c04'::uuid;
  program_a   uuid := '00000000-0000-0000-0000-000000000c05'::uuid;
  week_a      uuid := '00000000-0000-0000-0000-000000000c07'::uuid;
  source_day  uuid := '00000000-0000-0000-0000-000000000c08'::uuid;
  ss_group    uuid := '00000000-0000-0000-0000-000000000c09'::uuid;
BEGIN
  INSERT INTO organizations (id, name, slug)
  VALUES (org_a, 'Test Org A — Copy/Repeat 10', 'test-org-a-copy-repeat-10');

  staff_a     := public._test_make_user('staff-a-copyrepeat10@test.local');
  client_user := public._test_make_user('client-copyrepeat10@test.local');

  PERFORM public._test_grant_membership(staff_a,     org_a, 'staff'::user_role);
  PERFORM public._test_grant_membership(client_user, org_a, 'client'::user_role);

  INSERT INTO clients (id, organization_id, user_id, first_name, last_name, email)
  VALUES (client_a, org_a, client_user, 'Sam', 'Copy', 'copyrepeat10@test.local');

  PERFORM public._test_set_jwt(staff_a, org_a, 'staff');
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- One exercise in the org so program_exercises FK can resolve.
  INSERT INTO exercises (id, organization_id, name, default_sets, default_reps)
  VALUES (exercise_id, org_a, 'CR10 Test Exercise', 3, '8');

  -- Active program: Apr 27 (Mon) → May 25 (4 weeks).
  INSERT INTO programs (
    id, organization_id, client_id, name, status, start_date, duration_weeks
  ) VALUES (
    program_a, org_a, client_a, 'CR10 Block', 'active', '2026-04-27'::date, 4
  );

  INSERT INTO program_weeks (id, program_id, week_number)
  VALUES (week_a, program_a, 1);

  -- Source day: Mon Apr 27, Day A. Two exercises grouped into one superset.
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
    week_a      AS week_a,
    source_day  AS source_day,
    ss_group    AS ss_group;
  GRANT SELECT ON _ids TO authenticated;
END $$;


-- ----------------------------------------------------------------------------
-- §A. copy_program_day clean path — clone Day A from Apr 27 to Apr 28.
-- ----------------------------------------------------------------------------
SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;

CREATE TEMP TABLE _copy_result (result jsonb) ON COMMIT DROP;
GRANT INSERT, SELECT ON _copy_result TO authenticated;

INSERT INTO _copy_result
  SELECT public.copy_program_day(
    (SELECT source_day FROM _ids),
    '2026-04-28'::date
  );

INSERT INTO _tap (n, line) VALUES (1, (
  SELECT is(
    (SELECT result ->> 'status' FROM _copy_result),
    'created',
    'A1: copy_program_day returns status=created on clean path'
  )
));

INSERT INTO _tap (n, line) VALUES (2, (
  SELECT is(
    (SELECT day_label FROM program_days
      WHERE id = ((SELECT result ->> 'new_day_id' FROM _copy_result))::uuid),
    'A',
    'A2: cloned day inherits the source day_label'
  )
));

INSERT INTO _tap (n, line) VALUES (3, (
  SELECT is(
    (SELECT scheduled_date FROM program_days
      WHERE id = ((SELECT result ->> 'new_day_id' FROM _copy_result))::uuid),
    '2026-04-28'::date,
    'A3: cloned day lands on the target date'
  )
));

INSERT INTO _tap (n, line) VALUES (4, (
  SELECT is(
    (SELECT count(*)::int FROM program_exercises
      WHERE program_day_id = ((SELECT result ->> 'new_day_id' FROM _copy_result))::uuid
        AND deleted_at IS NULL),
    2,
    'A4: cloned day has 2 program_exercises'
  )
));

INSERT INTO _tap (n, line) VALUES (5, (
  SELECT ok(
    (SELECT count(DISTINCT superset_group_id)::int FROM program_exercises
      WHERE program_day_id = ((SELECT result ->> 'new_day_id' FROM _copy_result))::uuid
        AND deleted_at IS NULL) = 1
    AND (SELECT superset_group_id FROM program_exercises
          WHERE program_day_id = ((SELECT result ->> 'new_day_id' FROM _copy_result))::uuid
            AND deleted_at IS NULL
          LIMIT 1) <> (SELECT ss_group FROM _ids),
    'A5: cloned exercises share a fresh superset_group_id (not the source group)'
  )
));


-- ----------------------------------------------------------------------------
-- §B. copy_program_day no-program path — target date outside the
-- program's range (May 25 is the exclusive end; May 26 is outside).
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE _no_prog_result (result jsonb) ON COMMIT DROP;
GRANT INSERT, SELECT ON _no_prog_result TO authenticated;

INSERT INTO _no_prog_result
  SELECT public.copy_program_day(
    (SELECT source_day FROM _ids),
    '2026-05-26'::date
  );

INSERT INTO _tap (n, line) VALUES (6, (
  SELECT is(
    (SELECT result ->> 'status' FROM _no_prog_result),
    'no_program',
    'B1: target date outside any program returns status=no_program'
  )
));


-- ----------------------------------------------------------------------------
-- §C. copy_program_day conflict + force.
-- May 1 already exists (from §A we copied to Apr 28; let's manually
-- insert May 1 first, then attempt to copy onto it without force, then
-- with force).
-- ----------------------------------------------------------------------------
RESET ROLE;
DO $$
DECLARE
  program_a uuid := (SELECT program_a FROM _ids);
  week_a    uuid := (SELECT week_a FROM _ids);
  staff_a   uuid := (SELECT staff_a FROM _ids);
  org_a     uuid := (SELECT org_a FROM _ids);
BEGIN
  PERFORM public._test_set_jwt(staff_a, org_a, 'staff');
  EXECUTE 'SET LOCAL ROLE authenticated';

  INSERT INTO program_days (
    id, program_id, program_week_id, day_label, scheduled_date, sort_order
  ) VALUES (
    '00000000-0000-0000-0000-000000000c0a'::uuid,
    program_a, week_a, 'C', '2026-05-01'::date, 2
  );
END $$;

CREATE TEMP TABLE _conflict_result (result jsonb) ON COMMIT DROP;
GRANT INSERT, SELECT ON _conflict_result TO authenticated;

INSERT INTO _conflict_result
  SELECT public.copy_program_day(
    (SELECT source_day FROM _ids),
    '2026-05-01'::date,
    false
  );

INSERT INTO _tap (n, line) VALUES (7, (
  SELECT is(
    (SELECT result ->> 'status' FROM _conflict_result),
    'conflict',
    'C1: copy onto an existing date returns status=conflict when not forced'
  )
));

INSERT INTO _tap (n, line) VALUES (8, (
  SELECT is(
    (SELECT (result -> 'conflicts' -> 0 ->> 'date')::date FROM _conflict_result),
    '2026-05-01'::date,
    'C2: conflict payload identifies the conflicting date'
  )
));

CREATE TEMP TABLE _force_result (result jsonb) ON COMMIT DROP;
GRANT INSERT, SELECT ON _force_result TO authenticated;

INSERT INTO _force_result
  SELECT public.copy_program_day(
    (SELECT source_day FROM _ids),
    '2026-05-01'::date,
    true
  );

INSERT INTO _tap (n, line) VALUES (9, (
  SELECT is(
    (SELECT result ->> 'status' FROM _force_result),
    'created',
    'C3: copy with p_force=true overwrites and returns status=created'
  )
));


-- ----------------------------------------------------------------------------
-- §D. repeat_program_day_weekly clean path — repeat from Apr 27 to
-- May 11 (target dates: May 4, May 11). Both should fall inside the
-- program (which ends May 25).
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE _repeat_result (result jsonb) ON COMMIT DROP;
GRANT INSERT, SELECT ON _repeat_result TO authenticated;

INSERT INTO _repeat_result
  SELECT public.repeat_program_day_weekly(
    (SELECT source_day FROM _ids),
    '2026-05-11'::date
  );

INSERT INTO _tap (n, line) VALUES (10, (
  SELECT is(
    (SELECT jsonb_array_length(result -> 'new_day_ids') FROM _repeat_result),
    2,
    'D1: repeat over 2 same-weekdays creates 2 new days'
  )
));


-- ----------------------------------------------------------------------------
-- §E. repeat_program_day_weekly invalid_end_date — end_date <= source
-- date should short-circuit.
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE _invalid_result (result jsonb) ON COMMIT DROP;
GRANT INSERT, SELECT ON _invalid_result TO authenticated;

INSERT INTO _invalid_result
  SELECT public.repeat_program_day_weekly(
    (SELECT source_day FROM _ids),
    '2026-04-20'::date
  );

INSERT INTO _tap (n, line) VALUES (11, (
  SELECT is(
    (SELECT result ->> 'status' FROM _invalid_result),
    'invalid_end_date',
    'E1: end_date <= source date returns status=invalid_end_date'
  )
));


-- ----------------------------------------------------------------------------
-- §F. repeat_program_day_weekly auto-extends the source program's
-- duration_weeks when the picked end_date falls past the block end.
--
-- Source block: Apr 27 – May 25 (4 weeks). Repeat until Jun 22.
-- Source is Mon Apr 27. Targets: May 4, 11, 18, 25, Jun 1, 8, 15, 22.
-- Without auto-extend: only May targets (4 dates inside the block).
-- With auto-extend: all 8 dates created; block now 9 weeks.
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE _extend_result (result jsonb) ON COMMIT DROP;
GRANT INSERT, SELECT ON _extend_result TO authenticated;

INSERT INTO _extend_result
  SELECT public.repeat_program_day_weekly(
    (SELECT source_day FROM _ids),
    '2026-06-22'::date,
    true   -- force, since §C left a row on May 1 that would conflict on the May 4 attempt
  );

INSERT INTO _tap (n, line) VALUES (12, (
  SELECT is(
    (SELECT jsonb_array_length(result -> 'new_day_ids') FROM _extend_result),
    8,
    'F1: repeat past block end auto-extends and creates all 8 weekly copies'
  )
));

INSERT INTO _tap (n, line) VALUES (13, (
  SELECT cmp_ok(
    (SELECT duration_weeks FROM programs WHERE id = (SELECT program_a FROM _ids)),
    '>=',
    9::smallint,
    'F2: source program duration_weeks extended to >= 9 (covers Jun 22)'
  )
));


-- ----------------------------------------------------------------------------
-- §G. Multi-block fallback. Insert a SECOND active program for the
-- same client immediately after the (already-extended) first one. Then
-- repeat from the source past the second block's end. Auto-extend
-- can't fire on the source (would overlap block B); RPC falls through
-- to the original behavior — copies that fall in block B land there;
-- copies past both blocks get reported in no_program_dates.
--
-- After §F, source block runs Apr 27 → at least 9 weeks (end Jun 28).
-- Make block B start Jul 6 (the Mon after) for 4 weeks (end Aug 3).
-- Then repeat source until Aug 31. Targets: Mondays from May 4 → Aug 31.
-- Many already exist from §F; with force=true those soft-delete + replace.
-- Targets in block B's range (Jul 6 – Aug 3) land in block B.
-- Targets between source-end and block B's start (if any) get skipped.
-- Targets past Aug 3 get skipped.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  org_a    uuid := (SELECT org_a    FROM _ids);
  client_a uuid := (SELECT client_a FROM _ids);
BEGIN
  INSERT INTO programs (
    id, organization_id, client_id, name, status, start_date, duration_weeks
  ) VALUES (
    '00000000-0000-0000-0000-000000000c0b'::uuid,
    org_a, client_a, 'CR10 Block B', 'active', '2026-07-06'::date, 4
  );
END $$;

CREATE TEMP TABLE _multi_result (result jsonb) ON COMMIT DROP;
GRANT INSERT, SELECT ON _multi_result TO authenticated;

INSERT INTO _multi_result
  SELECT public.repeat_program_day_weekly(
    (SELECT source_day FROM _ids),
    '2026-08-31'::date,
    true
  );

INSERT INTO _tap (n, line) VALUES (14, (
  SELECT is(
    (SELECT result ->> 'status' FROM _multi_result),
    'created',
    'G1: multi-block fallback completes successfully (status=created)'
  )
));


-- ----------------------------------------------------------------------------
-- Hand back to the test owner before final SELECT + ROLLBACK.
-- ----------------------------------------------------------------------------
RESET ROLE;

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
