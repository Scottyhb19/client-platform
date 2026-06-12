-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), is(), ok(), throws_ok() resolve
-- unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 24_program_week_copy_repeat
-- ============================================================================
-- Why: P1-1 of the program-calendar polish pass (docs/polish/program-calendar.md,
-- FM-5). copy_program_week / repeat_program_week (20260612160000) are
-- orchestrators over copy_program_day, so day-level clone correctness
-- (per-set fan-out, superset remap, label preservation) is inherited and
-- already covered by tests 10/23 — this file covers the WEEK-level
-- semantics the orchestrators add:
--
--   §A copy clean path: both days land on the right weekday offsets,
--      labels survive, exercises + per-set rows fan out through the
--      delegation, superset stays cohesive under ONE fresh group id.
--   §B copy conflict path: second copy reports BOTH conflicts in one
--      response; force=true overwrites without duplicating.
--   §C empty source week → empty_week, no writes.
--   §D non-Monday source → invalid_week.
--   §E repeat: conflict accumulation across all target weeks; force path
--      creates the full fan; day-granular end-date cutoff (a source day
--      whose target lands past p_end_date is excluded). Auto-extend is
--      inherited verbatim from repeat_program_day_weekly (test 10 F1/F2).
--   §F security: client-role caller rejected 42501; unknown client
--      rejected 42501.
--   §G end date inside the source week → invalid_end_date.
--
-- Fixture: one org, one client, ONE active program (Mon 2026-04-27 +
-- 6 weeks → ends Sun 2026-06-07). Source week 2026-04-27:
--   Mon 27 Apr 'A': two exercises in a superset; per-set rows
--     (4 × distinguishable) so fan-out through delegation is observable.
--   Wed 29 Apr 'B': one exercise, one set row.
--
-- Test count: 20
-- ============================================================================

BEGIN;

SELECT plan(20);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated;

-- ----------------------------------------------------------------------------
-- §1. Fixture
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
  day_mon     uuid := '00000000-0000-0000-0000-000000000e08'::uuid;
  day_wed     uuid := '00000000-0000-0000-0000-000000000e09'::uuid;
  ss_group    uuid := '00000000-0000-0000-0000-000000000e0a'::uuid;
  pe_mon_1    uuid := '00000000-0000-0000-0000-000000000e0c'::uuid;
  pe_mon_2    uuid := '00000000-0000-0000-0000-000000000e0d'::uuid;
  pe_wed_1    uuid := '00000000-0000-0000-0000-000000000e0e'::uuid;
BEGIN
  INSERT INTO organizations (id, name, slug)
  VALUES (org_a, 'Test Org A — Week Copy/Repeat 24', 'test-org-a-week-copy-24');

  staff_a     := public._test_make_user('staff-a-weekcopy24@test.local');
  client_user := public._test_make_user('client-weekcopy24@test.local');

  PERFORM public._test_grant_membership(staff_a,     org_a, 'staff'::user_role);
  PERFORM public._test_grant_membership(client_user, org_a, 'client'::user_role);

  INSERT INTO clients (id, organization_id, user_id, first_name, last_name, email)
  VALUES (client_a, org_a, client_user, 'Wendy', 'Week', 'weekcopy24@test.local');

  PERFORM public._test_set_jwt(staff_a, org_a, 'staff');
  EXECUTE 'SET LOCAL ROLE authenticated';

  INSERT INTO exercises (id, organization_id, name, default_sets, default_reps)
  VALUES (exercise_id, org_a, 'WK24 Test Exercise', 3, '8');

  -- Active program: Mon 27 Apr → Sun 7 Jun (6 weeks).
  INSERT INTO programs (
    id, organization_id, client_id, name, status, start_date, duration_weeks
  ) VALUES (
    program_a, org_a, client_a, 'WK24 Block', 'active', '2026-04-27'::date, 6
  );

  INSERT INTO program_weeks (id, program_id, week_number)
  VALUES (week_a, program_a, 1);

  INSERT INTO program_days (
    id, program_id, program_week_id, day_label, scheduled_date, sort_order
  ) VALUES
    (day_mon, program_a, week_a, 'A', '2026-04-27'::date, 0),
    (day_wed, program_a, week_a, 'B', '2026-04-29'::date, 0);

  INSERT INTO program_exercises (
    id, program_day_id, exercise_id, sort_order, superset_group_id, sets, reps
  ) VALUES
    (pe_mon_1, day_mon, exercise_id, 0, ss_group, 4, '6'),
    (pe_mon_2, day_mon, exercise_id, 1, ss_group, 4, '6'),
    (pe_wed_1, day_wed, exercise_id, 0, NULL,     3, '10');

  INSERT INTO program_exercise_sets (
    program_exercise_id, set_number, reps, optional_metric, optional_value
  ) VALUES
    (pe_mon_1, 1, '6',  'kg', '60'),
    (pe_mon_1, 2, '6',  'kg', '70'),
    (pe_mon_2, 1, '10', NULL, NULL),
    (pe_mon_2, 2, '12', NULL, NULL),
    (pe_wed_1, 1, '10', 'kg', '40');

  EXECUTE 'RESET ROLE';

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_a       AS org_a,
    staff_a     AS staff_a,
    client_user AS client_user,
    client_a    AS client_a,
    program_a   AS program_a,
    ss_group    AS ss_group;
  GRANT SELECT ON _ids TO authenticated;
END $$;

-- ----------------------------------------------------------------------------
-- §A. copy_program_week clean path — week of 27 Apr → week of 4 May (empty).
-- ----------------------------------------------------------------------------
SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;

CREATE TEMP TABLE _copy_result (result jsonb) ON COMMIT DROP;
GRANT INSERT, SELECT, TRUNCATE ON _copy_result TO authenticated;

INSERT INTO _copy_result
  SELECT public.copy_program_week(
    (SELECT client_a FROM _ids),
    '2026-04-27'::date,
    '2026-05-04'::date
  );

INSERT INTO _tap (n, line) VALUES (1, (
  SELECT is(
    (SELECT result->>'status' FROM _copy_result),
    'created',
    'A1: clean week copy returns status created'
  )
));

INSERT INTO _tap (n, line) VALUES (2, (
  SELECT is(
    (SELECT jsonb_array_length(result->'new_day_ids') FROM _copy_result),
    2,
    'A2: two source days produce two clones'
  )
));

INSERT INTO _tap (n, line) VALUES (3, (
  SELECT is(
    (SELECT array_agg(day_label || '/' || scheduled_date::text ORDER BY scheduled_date)
       FROM program_days
      WHERE scheduled_date IN ('2026-05-04', '2026-05-06')
        AND deleted_at IS NULL),
    ARRAY['A/2026-05-04', 'B/2026-05-06'],
    'A3: clones land on the same weekday offsets with labels preserved'
  )
));

INSERT INTO _tap (n, line) VALUES (4, (
  SELECT is(
    (SELECT count(*)::int
       FROM program_exercises pe
       JOIN program_days pd ON pd.id = pe.program_day_id
      WHERE pd.scheduled_date IN ('2026-05-04', '2026-05-06')
        AND pd.deleted_at IS NULL
        AND pe.deleted_at IS NULL),
    3,
    'A4: all three exercises cloned through the delegation'
  )
));

INSERT INTO _tap (n, line) VALUES (5, (
  SELECT is(
    (SELECT count(*)::int
       FROM program_exercise_sets pes
       JOIN program_exercises pe ON pe.id = pes.program_exercise_id
       JOIN program_days pd ON pd.id = pe.program_day_id
      WHERE pd.scheduled_date IN ('2026-05-04', '2026-05-06')
        AND pd.deleted_at IS NULL
        AND pe.deleted_at IS NULL
        AND pes.deleted_at IS NULL),
    5,
    'A5: per-set rows fan out through the delegation (4 Mon + 1 Wed)'
  )
));

INSERT INTO _tap (n, line) VALUES (6, (
  SELECT ok(
    (SELECT count(DISTINCT pe.superset_group_id) = 1
            AND min(pe.superset_group_id::text) <> (SELECT ss_group FROM _ids)::text
       FROM program_exercises pe
       JOIN program_days pd ON pd.id = pe.program_day_id
      WHERE pd.scheduled_date = '2026-05-04'
        AND pd.deleted_at IS NULL
        AND pe.deleted_at IS NULL
        AND pe.superset_group_id IS NOT NULL),
    'A6: cloned superset stays cohesive under one FRESH group id'
  )
));

-- ----------------------------------------------------------------------------
-- §B. copy conflict path — same copy again: both targets now occupied.
-- ----------------------------------------------------------------------------
TRUNCATE _copy_result;
INSERT INTO _copy_result
  SELECT public.copy_program_week(
    (SELECT client_a FROM _ids),
    '2026-04-27'::date,
    '2026-05-04'::date
  );

INSERT INTO _tap (n, line) VALUES (7, (
  SELECT is(
    (SELECT result->>'status' FROM _copy_result),
    'conflict',
    'B1: copying onto an occupied week returns status conflict'
  )
));

INSERT INTO _tap (n, line) VALUES (8, (
  SELECT is(
    (SELECT jsonb_array_length(result->'conflicts') FROM _copy_result),
    2,
    'B2: BOTH conflicting dates reported in one response'
  )
));

TRUNCATE _copy_result;
INSERT INTO _copy_result
  SELECT public.copy_program_week(
    (SELECT client_a FROM _ids),
    '2026-04-27'::date,
    '2026-05-04'::date,
    true
  );

INSERT INTO _tap (n, line) VALUES (9, (
  SELECT is(
    (SELECT result->>'status' FROM _copy_result),
    'created',
    'B3: force=true overwrites and returns created'
  )
));

INSERT INTO _tap (n, line) VALUES (10, (
  SELECT is(
    (SELECT count(*)::int
       FROM program_days
      WHERE scheduled_date = '2026-05-04'
        AND deleted_at IS NULL),
    1,
    'B4: force overwrite soft-deletes the old day — exactly one live day remains'
  )
));

-- ----------------------------------------------------------------------------
-- §C. Empty source week (25 May — covered by the block, no days).
-- ----------------------------------------------------------------------------
TRUNCATE _copy_result;
INSERT INTO _copy_result
  SELECT public.copy_program_week(
    (SELECT client_a FROM _ids),
    '2026-05-25'::date,
    '2026-06-01'::date
  );

INSERT INTO _tap (n, line) VALUES (11, (
  SELECT is(
    (SELECT result->>'status' FROM _copy_result),
    'empty_week',
    'C1: source week with no sessions returns empty_week'
  )
));

-- ----------------------------------------------------------------------------
-- §D. Non-Monday source week start.
-- ----------------------------------------------------------------------------
TRUNCATE _copy_result;
INSERT INTO _copy_result
  SELECT public.copy_program_week(
    (SELECT client_a FROM _ids),
    '2026-04-28'::date,
    '2026-05-04'::date
  );

INSERT INTO _tap (n, line) VALUES (12, (
  SELECT is(
    (SELECT result->>'status' FROM _copy_result),
    'invalid_week',
    'D1: non-Monday week start returns invalid_week'
  )
));

-- ----------------------------------------------------------------------------
-- §E. repeat_program_week — source week 27 Apr, end Tue 19 May.
-- Target weeks: 4 May (BOTH days conflict — occupied by §A/§B),
-- 11 May (both clean), 18 May (Mon 18 ≤ 19 May in; Wed 20 May OUT —
-- day-granular cutoff).
-- ----------------------------------------------------------------------------
TRUNCATE _copy_result;
INSERT INTO _copy_result
  SELECT public.repeat_program_week(
    (SELECT client_a FROM _ids),
    '2026-04-27'::date,
    '2026-05-19'::date
  );

INSERT INTO _tap (n, line) VALUES (13, (
  SELECT is(
    (SELECT result->>'status' FROM _copy_result),
    'conflict',
    'E1: repeat over an occupied target week returns conflict'
  )
));

INSERT INTO _tap (n, line) VALUES (14, (
  SELECT is(
    (SELECT jsonb_array_length(result->'conflicts') FROM _copy_result),
    2,
    'E2: conflicts accumulated across ALL target weeks in one response'
  )
));

TRUNCATE _copy_result;
INSERT INTO _copy_result
  SELECT public.repeat_program_week(
    (SELECT client_a FROM _ids),
    '2026-04-27'::date,
    '2026-05-19'::date,
    true
  );

INSERT INTO _tap (n, line) VALUES (15, (
  SELECT is(
    (SELECT result->>'status' FROM _copy_result),
    'created',
    'E3: force repeat returns created'
  )
));

INSERT INTO _tap (n, line) VALUES (16, (
  SELECT is(
    (SELECT jsonb_array_length(result->'new_day_ids') FROM _copy_result),
    5,
    'E4: 2 + 2 + 1 clones — Wed of the final week excluded by the cutoff'
  )
));

INSERT INTO _tap (n, line) VALUES (17, (
  SELECT is(
    (SELECT count(*)::int
       FROM program_days
      WHERE scheduled_date = '2026-05-20'
        AND deleted_at IS NULL),
    0,
    'E5: no day created past the end date (Wed 20 May)'
  )
));

-- ----------------------------------------------------------------------------
-- §F. Security.
-- ----------------------------------------------------------------------------
RESET ROLE;
SELECT public._test_set_jwt(
  (SELECT client_user FROM _ids), (SELECT org_a FROM _ids), 'client'
);
SET LOCAL ROLE authenticated;

INSERT INTO _tap (n, line) VALUES (18, (
  SELECT throws_ok(
    format(
      'SELECT public.copy_program_week(%L::uuid, %L::date, %L::date)',
      (SELECT client_a FROM _ids), '2026-04-27', '2026-05-04'
    ),
    '42501',
    'Unauthorized',
    'F1: client-role caller cannot copy a week'
  )
));

RESET ROLE;
SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;

INSERT INTO _tap (n, line) VALUES (19, (
  SELECT throws_ok(
    format(
      'SELECT public.copy_program_week(%L::uuid, %L::date, %L::date)',
      '00000000-0000-0000-0000-00000000dead', '2026-04-27', '2026-05-04'
    ),
    '42501',
    'Client not in your organization',
    'F2: unknown client uuid rejected'
  )
));

-- ----------------------------------------------------------------------------
-- §G. End date inside the source week.
-- ----------------------------------------------------------------------------
TRUNCATE _copy_result;
INSERT INTO _copy_result
  SELECT public.repeat_program_week(
    (SELECT client_a FROM _ids),
    '2026-04-27'::date,
    '2026-05-03'::date
  );

INSERT INTO _tap (n, line) VALUES (20, (
  SELECT is(
    (SELECT result->>'status' FROM _copy_result),
    'invalid_end_date',
    'G1: end date inside the source week returns invalid_end_date'
  )
));

-- ----------------------------------------------------------------------------
-- Hand back to the test owner before final SELECT + ROLLBACK.
-- ----------------------------------------------------------------------------
RESET ROLE;

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
