-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), ok(), is() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 35_rep_metric_round_trip
-- ============================================================================
-- Why: VU-9 of the prescription-volume-unit pass
-- (docs/polish/prescription-volume-unit.md). Locks the new volume axis
-- (rep_metric, 20260623100000) end to end: a timed prescription must seed
-- the unit, surface it to the portal, log it, and survive every copy path.
--
--   A1 seed   — insert_program_exercise_at fans out rep_metric from the
--               exercise's default_rep_metric.
--   A2 read   — client_get_program_day_exercises returns rep_metric inside
--               prescription_sets.
--   A3 write  — client_log_set persists rep_metric to set_logs.
--   A4 clone  — copy_program_day preserves rep_metric on the cloned sets.
--   A5 template — save_program_as_template + create_program_from_template
--               preserve rep_metric through the round trip (acceptance gate 4).
--
-- Fixture: org A, one staff, two clients. A timed exercise (3 × 30, unit
-- time_minsec, no load). A 2-week active program for client A with a
-- published day_1. Writes run role-switched (staff for prescribe/clone/save,
-- client A for start/log); all assertions run as the test owner (BYPASSRLS)
-- so they read persisted state without RLS filtering.
--
-- Test count: 5
-- ============================================================================

BEGIN;

SELECT plan(5);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;


-- ----------------------------------------------------------------------------
-- §1. Fixture
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  org_a         uuid := '00000000-0000-0000-0000-0000000a3501'::uuid;
  staff_a       uuid;
  client_user   uuid;
  client_b_user uuid;
  client_a      uuid := '00000000-0000-0000-0000-0000000a3502'::uuid;
  client_b      uuid := '00000000-0000-0000-0000-0000000a3503'::uuid;
  ex_timed      uuid := '00000000-0000-0000-0000-0000000a3504'::uuid;
  program_a     uuid := '00000000-0000-0000-0000-0000000a3505'::uuid;
  week_a        uuid := '00000000-0000-0000-0000-0000000a3506'::uuid;
  day_1         uuid := '00000000-0000-0000-0000-0000000a3507'::uuid;
BEGIN
  INSERT INTO organizations (id, name, slug) VALUES
    (org_a, 'Test Org A — Rep Metric 35', 'test-org-a-repmetric-35');

  staff_a       := public._test_make_user('staff-a-rm35@test.local');
  client_user   := public._test_make_user('client-a-rm35@test.local');
  client_b_user := public._test_make_user('client-b-rm35@test.local');

  PERFORM public._test_grant_membership(staff_a,       org_a, 'staff'::user_role);
  PERFORM public._test_grant_membership(client_user,   org_a, 'client'::user_role);
  PERFORM public._test_grant_membership(client_b_user, org_a, 'client'::user_role);

  INSERT INTO clients (id, organization_id, user_id, first_name, last_name, email)
  VALUES
    (client_a, org_a, client_user,   'Tess', 'Timed', 'rm35a@test.local'),
    (client_b, org_a, client_b_user, 'Cara', 'Carry', 'rm35b@test.local');

  PERFORM public._test_set_jwt(staff_a, org_a, 'staff');
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- A timed exercise: 3 × 30 (seconds), no load. The unit lives on
  -- default_rep_metric; default_metric/value (the LOAD axis) stays NULL.
  INSERT INTO exercises (
    id, organization_id, name, default_sets, default_reps,
    default_rep_metric, default_metric, default_metric_value
  ) VALUES (
    ex_timed, org_a, 'RM35 Plank', 3, '30', 'time_minsec', NULL, NULL
  );

  INSERT INTO programs (
    id, organization_id, client_id, name, status, start_date, duration_weeks
  ) VALUES (
    program_a, org_a, client_a, 'RM35 Block', 'active', '2026-04-27'::date, 2
  );

  INSERT INTO program_weeks (id, program_id, week_number)
  VALUES (week_a, program_a, 1);

  -- day_1 published so client A can start a session on it.
  INSERT INTO program_days (
    id, program_id, program_week_id, day_label, scheduled_date, sort_order,
    published_at
  ) VALUES (
    day_1, program_a, week_a, 'Day 1', '2026-04-27'::date, 0, now()
  );

  EXECUTE 'RESET ROLE';

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_a AS org_a, staff_a AS staff_a,
    client_user AS client_user, client_a AS client_a, client_b AS client_b,
    ex_timed AS ex_timed, program_a AS program_a, day_1 AS day_1;
  GRANT SELECT ON _ids TO authenticated;
END $$;


-- ----------------------------------------------------------------------------
-- §2. Staff: prescribe the timed exercise, clone its day, snapshot a template.
-- ----------------------------------------------------------------------------
SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;

CREATE TEMP TABLE _rt (label text PRIMARY KEY, val uuid) ON COMMIT DROP;
GRANT INSERT, SELECT ON _rt TO authenticated;

-- Prescribe (VU-3 seed path): fan-out copies default_rep_metric → rep_metric.
INSERT INTO _rt
  SELECT 'pe', public.insert_program_exercise_at(
    (SELECT day_1 FROM _ids), (SELECT ex_timed FROM _ids), NULL, 'append'
  );

-- Clone the day onto a later in-coverage date (VU-3 clone path).
SELECT public.copy_program_day(
  (SELECT day_1 FROM _ids), '2026-05-04'::date
);

-- Snapshot → instantiate for client B (VU-3 template round trip).
INSERT INTO _rt
  SELECT 'tpl', (public.save_program_as_template(
    (SELECT program_a FROM _ids), 'RM35 Template'
  ) ->> 'template_id')::uuid;

INSERT INTO _rt
  SELECT 'newprog', (public.create_program_from_template(
    (SELECT val FROM _rt WHERE label = 'tpl'),
    (SELECT client_b FROM _ids), '2026-06-01'::date, 'RM35 Instance'
  ) ->> 'new_program_id')::uuid;


-- ----------------------------------------------------------------------------
-- §3. Client A: read the prescription, log a 30-second set.
-- ----------------------------------------------------------------------------
SELECT public._test_set_jwt(
  (SELECT client_user FROM _ids), (SELECT org_a FROM _ids), 'client'
);

-- Capture the portal read under the client JWT (the RPC pins to auth.uid()).
CREATE TEMP TABLE _read ON COMMIT DROP AS
  SELECT prescription_sets
    FROM public.client_get_program_day_exercises((SELECT day_1 FROM _ids))
   WHERE program_exercise_id = (SELECT val FROM _rt WHERE label = 'pe');

INSERT INTO _rt
  SELECT 'session', public.client_start_session((SELECT day_1 FROM _ids));

-- Log set 1 as a 30-second hold: reps_performed = 30, rep_metric time_minsec,
-- no load. (Trailing p_rep_metric is the new 11th arg.)
SELECT public.client_log_set(
  (SELECT val FROM _rt WHERE label = 'session'),
  (SELECT val FROM _rt WHERE label = 'pe'),
  1::smallint,
  NULL::numeric, NULL::text,    -- weight_value, weight_metric
  30::smallint,                 -- reps_performed
  NULL::text, NULL::text,       -- optional_metric, optional_value (load axis)
  NULL::smallint, NULL::text,   -- rpe, notes
  'time_minsec'::text           -- rep_metric (volume unit)
);


-- ----------------------------------------------------------------------------
-- §4. Assertions — as the test owner (BYPASSRLS), reading persisted state.
-- ----------------------------------------------------------------------------
RESET ROLE;

INSERT INTO _tap (n, line) VALUES (1, (
  SELECT is(
    (SELECT count(*)::int FROM program_exercise_sets
      WHERE program_exercise_id = (SELECT val FROM _rt WHERE label = 'pe')
        AND rep_metric = 'time_minsec'
        AND deleted_at IS NULL),
    3,
    'A1: insert_program_exercise_at seeds rep_metric on every fanned-out set'
  )
));

INSERT INTO _tap (n, line) VALUES (2, (
  SELECT is(
    (SELECT prescription_sets -> 0 ->> 'rep_metric' FROM _read),
    'time_minsec',
    'A2: client_get_program_day_exercises returns rep_metric in prescription_sets'
  )
));

INSERT INTO _tap (n, line) VALUES (3, (
  SELECT is(
    (SELECT sl.rep_metric
       FROM set_logs sl
       JOIN exercise_logs el ON el.id = sl.exercise_log_id
      WHERE el.program_exercise_id = (SELECT val FROM _rt WHERE label = 'pe')
        AND sl.set_number = 1),
    'time_minsec',
    'A3: client_log_set persists rep_metric to set_logs'
  )
));

INSERT INTO _tap (n, line) VALUES (4, (
  SELECT ok(
    EXISTS (
      SELECT 1
        FROM program_exercise_sets pes
        JOIN program_exercises pe ON pe.id = pes.program_exercise_id
        JOIN program_days pd ON pd.id = pe.program_day_id
       WHERE pd.program_id = (SELECT program_a FROM _ids)
         AND pd.scheduled_date = '2026-05-04'::date
         AND pes.rep_metric = 'time_minsec'
         AND pes.deleted_at IS NULL
    ),
    'A4: copy_program_day preserves rep_metric on the cloned per-set rows'
  )
));

INSERT INTO _tap (n, line) VALUES (5, (
  SELECT ok(
    EXISTS (
      SELECT 1
        FROM program_exercise_sets pes
        JOIN program_exercises pe ON pe.id = pes.program_exercise_id
        JOIN program_days pd ON pd.id = pe.program_day_id
       WHERE pd.program_id = (SELECT val FROM _rt WHERE label = 'newprog')
         AND pes.rep_metric = 'time_minsec'
         AND pes.deleted_at IS NULL
    ),
    'A5: save + create_program_from_template preserve rep_metric (gate 4)'
  )
));

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
