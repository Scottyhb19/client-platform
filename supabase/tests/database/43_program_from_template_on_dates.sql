SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 43_program_from_template_on_dates
-- ============================================================================
-- Why: locks create_program_from_template_on_dates (20260624160000) — the
-- per-day-date apply path (operator dogfooding follow-up 2026-06-24):
--
--   §A grant posture: anon cannot EXECUTE it.
--   §B happy path: each program day lands on its CHOSEN date (NOT the stored
--      weekday-offset), exercises copied.
--   §C validation: duplicate dates rejected; a missing day's date rejected.
--   §D overlap: a second apply over the same range returns status=overlap.
--   §E cross-org: staff_b cannot apply org_a's template.
--
-- Test count: 9
-- ============================================================================

BEGIN;

SELECT plan(9);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated;

-- ----------------------------------------------------------------------------
-- §1. Fixture — org_a template: week 1 with Day A (sort_order 0) + Day B
-- (sort_order 3, so the OLD offset math would place it start+3). Day A has one
-- exercise + a set. A client for the apply. org_b for cross-org.
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
  day_A    uuid := '00000000-0000-0000-0000-0000000c430a'::uuid;
  day_B    uuid := '00000000-0000-0000-0000-0000000c430b'::uuid;
  te_a     uuid := '00000000-0000-0000-0000-0000000c430c'::uuid;
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
  INSERT INTO template_weeks (id, template_id, week_number) VALUES (week_1, tmpl_a, 1);
  INSERT INTO template_days (id, template_week_id, day_label, sort_order) VALUES
    (day_A, week_1, 'Day A', 0),
    (day_B, week_1, 'Day B', 3);
  INSERT INTO template_exercises (id, template_day_id, exercise_id, sort_order) VALUES (te_a, day_A, ex_a1, 0);
  INSERT INTO template_exercise_sets (template_exercise_id, set_number, reps) VALUES (te_a, 1, '10');

  EXECUTE 'RESET ROLE';

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_a AS org_a, org_b AS org_b, staff_a AS staff_a, staff_b AS staff_b,
    client_a AS client_a, ex_a1 AS ex_a1, tmpl_a AS tmpl_a, day_A AS day_A, day_B AS day_B;
  GRANT SELECT ON _ids TO authenticated;
END $$;


-- §A. Grant posture.
INSERT INTO _tap (n, line) VALUES (1, (
  SELECT ok(NOT has_function_privilege('anon',
    'public.create_program_from_template_on_dates(uuid,uuid,jsonb,text)', 'EXECUTE'),
    'A1: anon cannot execute create_program_from_template_on_dates')));


-- §B. Happy path — Day A on 2026-07-07, Day B on 2026-07-20 (NOT start+3 = 07-10).
SELECT public._test_set_jwt((SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff');
SET LOCAL ROLE authenticated;

CREATE TEMP TABLE _ins (result jsonb) ON COMMIT DROP;
GRANT INSERT, SELECT ON _ins TO authenticated;
INSERT INTO _ins SELECT public.create_program_from_template_on_dates(
  (SELECT tmpl_a FROM _ids),
  (SELECT client_a FROM _ids),
  jsonb_build_object(
    (SELECT day_A FROM _ids)::text, '2026-07-07',
    (SELECT day_B FROM _ids)::text, '2026-07-20'
  ),
  NULL);

INSERT INTO _tap (n, line) VALUES (2, (
  SELECT is((SELECT result ->> 'status' FROM _ins), 'created',
    'A2: per-day apply returns status=created')));

INSERT INTO _tap (n, line) VALUES (3, (
  SELECT is(
    (SELECT scheduled_date::text FROM program_days
      WHERE program_id = ((SELECT result ->> 'new_program_id' FROM _ins))::uuid
        AND day_label = 'Day A' AND deleted_at IS NULL),
    '2026-07-07',
    'A3: Day A landed on its chosen date 2026-07-07')));

INSERT INTO _tap (n, line) VALUES (4, (
  SELECT is(
    (SELECT scheduled_date::text FROM program_days
      WHERE program_id = ((SELECT result ->> 'new_program_id' FROM _ins))::uuid
        AND day_label = 'Day B' AND deleted_at IS NULL),
    '2026-07-20',
    'A4: Day B landed on its CHOSEN date 2026-07-20, not the stored offset (start+3)')));

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
    format('SELECT public.create_program_from_template_on_dates(%L,%L,%L::jsonb,NULL)',
      (SELECT tmpl_a FROM _ids), (SELECT client_a FROM _ids),
      jsonb_build_object((SELECT day_A FROM _ids)::text, '2026-08-01',
                         (SELECT day_B FROM _ids)::text, '2026-08-01')::text),
    '22023',
    NULL,
    'A6: two days on the same date is rejected')));

INSERT INTO _tap (n, line) VALUES (7, (
  SELECT throws_ok(
    format('SELECT public.create_program_from_template_on_dates(%L,%L,%L::jsonb,NULL)',
      (SELECT tmpl_a FROM _ids), (SELECT client_a FROM _ids),
      jsonb_build_object((SELECT day_A FROM _ids)::text, '2026-08-01')::text),
    '22023',
    NULL,
    'A7: a missing day date is rejected')));


-- §D. Overlap — a second apply over the same client + range returns overlap.
INSERT INTO _tap (n, line) VALUES (8, (
  SELECT is(
    (public.create_program_from_template_on_dates(
      (SELECT tmpl_a FROM _ids), (SELECT client_a FROM _ids),
      jsonb_build_object((SELECT day_A FROM _ids)::text, '2026-07-08',
                         (SELECT day_B FROM _ids)::text, '2026-07-09'),
      NULL)) ->> 'status',
    'overlap',
    'A8: a second apply overlapping the first active block returns status=overlap')));


-- §E. Cross-org.
SELECT public._test_set_jwt((SELECT staff_b FROM _ids), (SELECT org_b FROM _ids), 'staff');

INSERT INTO _tap (n, line) VALUES (9, (
  SELECT throws_ok(
    format('SELECT public.create_program_from_template_on_dates(%L,%L,%L::jsonb,NULL)',
      (SELECT tmpl_a FROM _ids), (SELECT client_a FROM _ids),
      jsonb_build_object((SELECT day_A FROM _ids)::text, '2026-09-01',
                         (SELECT day_B FROM _ids)::text, '2026-09-04')::text),
    '42501',
    NULL,
    'A9: cross-org staff cannot apply another org''s template')));

RESET ROLE;

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
