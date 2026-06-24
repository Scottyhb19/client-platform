SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 43_program_from_template_on_dates  (now: weekday-apply)
-- ============================================================================
-- Why: locks create_program_from_template_on_weekdays (20260624170000) — the
-- weekday-apply path (reviewer follow-up 2026-06-24, moving the date producer
-- from untested client code into TZ-immune SQL):
--
--   §A grant posture: anon cannot EXECUTE it.
--   §B placement: each session lands on (Monday of the start week) + (week-1)*7
--      + chosen weekday; the weekly pattern repeats. **A4 schedules week 2 after
--      the Sydney April fall-back (Apr 5 2026) and asserts the exact date — the
--      DST case the JS producer could only be assumed correct for; SQL date
--      arithmetic has no timezone, so it is correct by construction.**
--   §C validation: duplicate weekday in a week / invalid weekday / missing
--      weekday are all rejected.
--   §D overlap: a second apply over the same range returns status=overlap.
--   §E cross-org: staff_b cannot apply org_a's template.
--
-- Test count: 10
-- ============================================================================

BEGIN;

SELECT plan(10);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated;

-- ----------------------------------------------------------------------------
-- §1. Fixture — org_a template, 2 weeks × 2 days; Day 1A has an exercise + set.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  org_a    uuid := '00000000-0000-0000-0000-0000000c4301'::uuid;
  org_b    uuid := '00000000-0000-0000-0000-0000000c4302'::uuid;
  staff_a  uuid;
  staff_b  uuid;
  cli_usr  uuid;
  client_a uuid := '00000000-0000-0000-0000-0000000c4303'::uuid;
  ex_a1    uuid := '00000000-0000-0000-0000-0000000c4304'::uuid;
  tmpl_a   uuid := '00000000-0000-0000-0000-0000000c4308'::uuid;
  week_1   uuid := '00000000-0000-0000-0000-0000000c4309'::uuid;
  week_2   uuid := '00000000-0000-0000-0000-0000000c4310'::uuid;
  day_1a   uuid := '00000000-0000-0000-0000-0000000c4311'::uuid;
  day_1b   uuid := '00000000-0000-0000-0000-0000000c4312'::uuid;
  day_2a   uuid := '00000000-0000-0000-0000-0000000c4313'::uuid;
  day_2b   uuid := '00000000-0000-0000-0000-0000000c4314'::uuid;
  te_a     uuid := '00000000-0000-0000-0000-0000000c4315'::uuid;
BEGIN
  INSERT INTO organizations (id, name, slug) VALUES
    (org_a, 'Test Org A — Apply 43', 'test-org-a-apply-43'),
    (org_b, 'Test Org B — Apply 43', 'test-org-b-apply-43');

  staff_a := public._test_make_user('staff-a-apply43@test.local');
  staff_b := public._test_make_user('staff-b-apply43@test.local');
  cli_usr := public._test_make_user('client-apply43@test.local');
  PERFORM public._test_grant_membership(staff_a, org_a, 'staff'::user_role);
  PERFORM public._test_grant_membership(staff_b, org_b, 'staff'::user_role);
  PERFORM public._test_grant_membership(cli_usr, org_a, 'client'::user_role);

  INSERT INTO clients (id, organization_id, user_id, first_name, last_name, email)
  VALUES (client_a, org_a, cli_usr, 'App', 'Ly', 'apply43@test.local');

  INSERT INTO exercises (id, organization_id, name, default_sets, default_reps)
  VALUES (ex_a1, org_a, 'A43 Ex A1', 3, '10');

  PERFORM public._test_set_jwt(staff_a, org_a, 'staff');
  EXECUTE 'SET LOCAL ROLE authenticated';

  INSERT INTO program_templates (id, organization_id, name) VALUES (tmpl_a, org_a, 'A43 Template');
  INSERT INTO template_weeks (id, template_id, week_number) VALUES (week_1, tmpl_a, 1), (week_2, tmpl_a, 2);
  INSERT INTO template_days (id, template_week_id, day_label, sort_order) VALUES
    (day_1a, week_1, 'Day 1A', 0),
    (day_1b, week_1, 'Day 1B', 1),
    (day_2a, week_2, 'Day 2A', 0),
    (day_2b, week_2, 'Day 2B', 1);
  INSERT INTO template_exercises (id, template_day_id, exercise_id, sort_order) VALUES (te_a, day_1a, ex_a1, 0);
  INSERT INTO template_exercise_sets (template_exercise_id, set_number, reps) VALUES (te_a, 1, '10');

  EXECUTE 'RESET ROLE';

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_a, org_b, staff_a, staff_b, client_a, ex_a1, tmpl_a,
    day_1a, day_1b, day_2a, day_2b;
  GRANT SELECT ON _ids TO authenticated;
END $$;


-- §A. Grant posture.
INSERT INTO _tap (n, line) VALUES (1, (
  SELECT ok(NOT has_function_privilege('anon',
    'public.create_program_from_template_on_weekdays(uuid,uuid,date,jsonb,text)', 'EXECUTE'),
    'A1: anon cannot execute create_program_from_template_on_weekdays')));


-- §B. Placement — start the week of Mon 30 Mar 2026; sessions Tue (1) + Fri (4).
-- Week 1 → Tue 31 Mar / Fri 3 Apr; week 2 → Tue 7 Apr / Fri 10 Apr (AFTER the
-- Sydney fall-back Sun 5 Apr 2026 — the DST case).
SELECT public._test_set_jwt((SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff');
SET LOCAL ROLE authenticated;

CREATE TEMP TABLE _ins (result jsonb) ON COMMIT DROP;
GRANT INSERT, SELECT ON _ins TO authenticated;
INSERT INTO _ins SELECT public.create_program_from_template_on_weekdays(
  (SELECT tmpl_a FROM _ids), (SELECT client_a FROM _ids), '2026-03-30'::date,
  jsonb_build_object(
    (SELECT day_1a FROM _ids)::text, 1, (SELECT day_1b FROM _ids)::text, 4,
    (SELECT day_2a FROM _ids)::text, 1, (SELECT day_2b FROM _ids)::text, 4
  ), NULL);

INSERT INTO _tap (n, line) VALUES (2, (
  SELECT is((SELECT result ->> 'status' FROM _ins), 'created',
    'A2: weekday apply returns status=created')));

INSERT INTO _tap (n, line) VALUES (3, (
  SELECT is(
    (SELECT scheduled_date::text FROM program_days
      WHERE program_id = ((SELECT result ->> 'new_program_id' FROM _ins))::uuid
        AND day_label = 'Day 1A' AND deleted_at IS NULL),
    '2026-03-31',
    'A3: week-1 Tuesday session lands on 2026-03-31')));

INSERT INTO _tap (n, line) VALUES (4, (
  SELECT is(
    (SELECT scheduled_date::text FROM program_days
      WHERE program_id = ((SELECT result ->> 'new_program_id' FROM _ins))::uuid
        AND day_label = 'Day 2A' AND deleted_at IS NULL),
    '2026-04-07',
    'A4: week-2 Tuesday repeats at +7 = 2026-04-07 (after the Apr-5 DST fall-back; SQL is TZ-immune)')));

INSERT INTO _tap (n, line) VALUES (5, (
  SELECT is(
    (SELECT count(*)::int FROM program_exercises pe
       JOIN program_days pd ON pd.id = pe.program_day_id
      WHERE pd.program_id = ((SELECT result ->> 'new_program_id' FROM _ins))::uuid
        AND pe.exercise_id = (SELECT ex_a1 FROM _ids) AND pe.deleted_at IS NULL),
    1,
    'A5: the template exercise was copied into the new program')));


-- §C. Validation.
INSERT INTO _tap (n, line) VALUES (6, (
  SELECT throws_ok(
    format('SELECT public.create_program_from_template_on_weekdays(%L,%L,%L::date,%L::jsonb,NULL)',
      (SELECT tmpl_a FROM _ids), (SELECT client_a FROM _ids), '2026-05-04',
      jsonb_build_object((SELECT day_1a FROM _ids)::text, 1, (SELECT day_1b FROM _ids)::text, 1,
                         (SELECT day_2a FROM _ids)::text, 1, (SELECT day_2b FROM _ids)::text, 4)::text),
    '22023', NULL,
    'A6: two sessions in the same week on the same weekday is rejected')));

INSERT INTO _tap (n, line) VALUES (7, (
  SELECT throws_ok(
    format('SELECT public.create_program_from_template_on_weekdays(%L,%L,%L::date,%L::jsonb,NULL)',
      (SELECT tmpl_a FROM _ids), (SELECT client_a FROM _ids), '2026-05-04',
      jsonb_build_object((SELECT day_1a FROM _ids)::text, 7, (SELECT day_1b FROM _ids)::text, 4,
                         (SELECT day_2a FROM _ids)::text, 1, (SELECT day_2b FROM _ids)::text, 4)::text),
    '22023', NULL,
    'A7: an out-of-range weekday (7) is rejected')));

INSERT INTO _tap (n, line) VALUES (8, (
  SELECT throws_ok(
    format('SELECT public.create_program_from_template_on_weekdays(%L,%L,%L::date,%L::jsonb,NULL)',
      (SELECT tmpl_a FROM _ids), (SELECT client_a FROM _ids), '2026-05-04',
      jsonb_build_object((SELECT day_1a FROM _ids)::text, 1, (SELECT day_2a FROM _ids)::text, 1,
                         (SELECT day_2b FROM _ids)::text, 4)::text),
    '22023', NULL,
    'A8: a missing session weekday is rejected')));


-- §D. Overlap — a second apply over the same client + range returns overlap.
INSERT INTO _tap (n, line) VALUES (9, (
  SELECT is(
    (public.create_program_from_template_on_weekdays(
      (SELECT tmpl_a FROM _ids), (SELECT client_a FROM _ids), '2026-04-01'::date,
      jsonb_build_object((SELECT day_1a FROM _ids)::text, 2, (SELECT day_1b FROM _ids)::text, 3,
                         (SELECT day_2a FROM _ids)::text, 2, (SELECT day_2b FROM _ids)::text, 3),
      NULL)) ->> 'status',
    'overlap',
    'A9: a second apply overlapping the first active block returns status=overlap')));


-- §E. Cross-org.
SELECT public._test_set_jwt((SELECT staff_b FROM _ids), (SELECT org_b FROM _ids), 'staff');

INSERT INTO _tap (n, line) VALUES (10, (
  SELECT throws_ok(
    format('SELECT public.create_program_from_template_on_weekdays(%L,%L,%L::date,%L::jsonb,NULL)',
      (SELECT tmpl_a FROM _ids), (SELECT client_a FROM _ids), '2026-06-01',
      jsonb_build_object((SELECT day_1a FROM _ids)::text, 1, (SELECT day_1b FROM _ids)::text, 4,
                         (SELECT day_2a FROM _ids)::text, 1, (SELECT day_2b FROM _ids)::text, 4)::text),
    '42501', NULL,
    'A10: cross-org staff cannot apply another org''s template')));

RESET ROLE;

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
