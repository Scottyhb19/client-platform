-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), is(), throws_ok(), lives_ok() resolve
-- unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 21_program_templates_lifecycle
-- ============================================================================
-- Why: Coverage for migration 20260612120000_program_templates_lifecycle
-- (G-2 of the program-engine polish pass — docs/polish/
-- program-engine-session-builder.md). The brief §5.2 round trip:
--
--   §A save_program_as_template: weeks derived from scheduled_date,
--      template_days.sort_order = weekday offset (0–6), exercises with
--      fresh superset group ids, per-set rows paired to the right clone.
--   §B duplicate template name → status='duplicate_name'.
--   §C create_program_from_template for a DIFFERENT client: weekday
--      rhythm reproduced on the new start date, labels carried, fresh
--      group ids (≠ template's), per-set fan-out + pairing, provenance
--      template_id stamped.
--   §D instantiating over an existing active block → status='overlap'.
--   §E divergence (brief §5.2): template edits do NOT propagate to the
--      instantiated program.
--   §F security: cross-org staff deny + client-role deny on both RPCs.
--
-- Fixture: 2-week program for client_a, start Mon 2026-04-27.
--   Day A  Mon Apr 27 (w1, offset 0): 2 exercises in one superset;
--          per-set rows pe0: (6,kg,60)/(6,kg,70); pe1: (10)/(12).
--   Day B  Wed Apr 29 (w1, offset 2): 1 solo exercise; 1 set row (8).
--   Day A  Mon May 4  (w2, offset 0): no exercises (empty-day case).
--
-- Output pattern: TAP lines captured into temp _tap (single SQL-Editor /
-- db query batch; BEGIN/ROLLBACK makes it safe on the live project).
--
-- Test count: 15
-- ============================================================================

BEGIN;

SELECT plan(15);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated;


-- ----------------------------------------------------------------------------
-- §1. Fixture
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  org_a        uuid := '00000000-0000-0000-0000-000000000f01'::uuid;
  org_b        uuid := '00000000-0000-0000-0000-000000000f02'::uuid;
  staff_a      uuid;
  staff_b      uuid;
  client_user  uuid;
  client_b_usr uuid;
  client_a     uuid := '00000000-0000-0000-0000-000000000f03'::uuid;
  client_b     uuid := '00000000-0000-0000-0000-000000000f0a'::uuid;
  exercise_id  uuid := '00000000-0000-0000-0000-000000000f04'::uuid;
  program_a    uuid := '00000000-0000-0000-0000-000000000f05'::uuid;
  week_1       uuid := '00000000-0000-0000-0000-000000000f06'::uuid;
  week_2       uuid := '00000000-0000-0000-0000-000000000f07'::uuid;
  day_mon      uuid := '00000000-0000-0000-0000-000000000f08'::uuid;
  day_wed      uuid := '00000000-0000-0000-0000-000000000f09'::uuid;
  day_mon_w2   uuid := '00000000-0000-0000-0000-000000000f0b'::uuid;
  ss_group     uuid := '00000000-0000-0000-0000-000000000f0c'::uuid;
  pe_first     uuid := '00000000-0000-0000-0000-000000000f0d'::uuid;
  pe_second    uuid := '00000000-0000-0000-0000-000000000f0e'::uuid;
  pe_solo      uuid := '00000000-0000-0000-0000-000000000f0f'::uuid;
BEGIN
  INSERT INTO organizations (id, name, slug) VALUES
    (org_a, 'Test Org A — Templates 21', 'test-org-a-templates-21'),
    (org_b, 'Test Org B — Templates 21', 'test-org-b-templates-21');

  staff_a      := public._test_make_user('staff-a-templates21@test.local');
  staff_b      := public._test_make_user('staff-b-templates21@test.local');
  client_user  := public._test_make_user('client-templates21@test.local');
  client_b_usr := public._test_make_user('client-b-templates21@test.local');

  PERFORM public._test_grant_membership(staff_a,      org_a, 'staff'::user_role);
  PERFORM public._test_grant_membership(staff_b,      org_b, 'staff'::user_role);
  PERFORM public._test_grant_membership(client_user,  org_a, 'client'::user_role);
  PERFORM public._test_grant_membership(client_b_usr, org_a, 'client'::user_role);

  INSERT INTO clients (id, organization_id, user_id, first_name, last_name, email) VALUES
    (client_a, org_a, client_user,  'Tess', 'Template', 'templates21@test.local'),
    (client_b, org_a, client_b_usr, 'Bree', 'Blank',    'templates21b@test.local');

  PERFORM public._test_set_jwt(staff_a, org_a, 'staff');
  EXECUTE 'SET LOCAL ROLE authenticated';

  INSERT INTO exercises (id, organization_id, name, default_sets, default_reps)
  VALUES (exercise_id, org_a, 'T21 Test Exercise', 3, '8');

  INSERT INTO programs (
    id, organization_id, client_id, name, status, start_date, duration_weeks, notes
  ) VALUES (
    program_a, org_a, client_a, 'T21 Block', 'active', '2026-04-27'::date, 2,
    'Strength base. RPE 8 cap.'
  );

  INSERT INTO program_weeks (id, program_id, week_number) VALUES
    (week_1, program_a, 1),
    (week_2, program_a, 2);

  INSERT INTO program_days (
    id, program_id, program_week_id, day_label, scheduled_date, sort_order
  ) VALUES
    (day_mon,    program_a, week_1, 'Day A', '2026-04-27'::date, 0),
    (day_wed,    program_a, week_1, 'Day B', '2026-04-29'::date, 1),
    (day_mon_w2, program_a, week_2, 'Day A', '2026-05-04'::date, 0);

  INSERT INTO program_exercises (
    id, program_day_id, exercise_id, sort_order, superset_group_id
  ) VALUES
    (pe_first,  day_mon, exercise_id, 0, ss_group),
    (pe_second, day_mon, exercise_id, 1, ss_group),
    (pe_solo,   day_wed, exercise_id, 0, NULL);

  INSERT INTO program_exercise_sets (
    program_exercise_id, set_number, reps, optional_metric, optional_value
  ) VALUES
    (pe_first,  1, '6',  'kg', '60'),
    (pe_first,  2, '6',  'kg', '70'),
    (pe_second, 1, '10', NULL, NULL),
    (pe_second, 2, '12', NULL, NULL),
    (pe_solo,   1, '8',  NULL, NULL);

  EXECUTE 'RESET ROLE';

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_a       AS org_a,
    org_b       AS org_b,
    staff_a     AS staff_a,
    staff_b     AS staff_b,
    client_user AS client_user,
    client_a    AS client_a,
    client_b    AS client_b,
    exercise_id AS exercise_id,
    program_a   AS program_a,
    ss_group    AS ss_group;
  GRANT SELECT ON _ids TO authenticated;
END $$;


-- ----------------------------------------------------------------------------
-- §A. save_program_as_template — happy path.
-- ----------------------------------------------------------------------------
SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;

CREATE TEMP TABLE _save_result (result jsonb) ON COMMIT DROP;
GRANT INSERT, SELECT ON _save_result TO authenticated;

INSERT INTO _save_result
  SELECT public.save_program_as_template(
    (SELECT program_a FROM _ids),
    'T21 Protocol'
  );

INSERT INTO _tap (n, line) VALUES (1, (
  SELECT is(
    (SELECT result ->> 'status' FROM _save_result),
    'created',
    'A1: save_program_as_template returns status=created'
  )
));

INSERT INTO _tap (n, line) VALUES (2, (
  SELECT is(
    (SELECT array_agg(week_number ORDER BY week_number) FROM template_weeks
      WHERE template_id = ((SELECT result ->> 'template_id' FROM _save_result))::uuid
        AND deleted_at IS NULL),
    ARRAY[1, 2]::smallint[],
    'A2: weeks derived from scheduled dates (1 and 2)'
  )
));

INSERT INTO _tap (n, line) VALUES (3, (
  SELECT is(
    (SELECT array_agg(td.day_label || ':' || tw.week_number || ':' || td.sort_order
                      ORDER BY tw.week_number, td.sort_order)
       FROM template_days td
       JOIN template_weeks tw ON tw.id = td.template_week_id
      WHERE tw.template_id = ((SELECT result ->> 'template_id' FROM _save_result))::uuid
        AND td.deleted_at IS NULL),
    ARRAY['Day A:1:0', 'Day B:1:2', 'Day A:2:0'],
    'A3: template days carry labels + weekday offsets (Mon=0, Wed=2)'
  )
));

INSERT INTO _tap (n, line) VALUES (4, (
  SELECT ok(
    (SELECT count(*)::int FROM template_exercises te
       JOIN template_days td ON td.id = te.template_day_id
       JOIN template_weeks tw ON tw.id = td.template_week_id
      WHERE tw.template_id = ((SELECT result ->> 'template_id' FROM _save_result))::uuid
        AND te.deleted_at IS NULL) = 3
    AND (SELECT count(DISTINCT te.superset_group_id)::int FROM template_exercises te
       JOIN template_days td ON td.id = te.template_day_id
       JOIN template_weeks tw ON tw.id = td.template_week_id
      WHERE tw.template_id = ((SELECT result ->> 'template_id' FROM _save_result))::uuid
        AND te.superset_group_id IS NOT NULL
        AND te.deleted_at IS NULL) = 1
    AND NOT EXISTS (SELECT 1 FROM template_exercises te
       JOIN template_days td ON td.id = te.template_day_id
       JOIN template_weeks tw ON tw.id = td.template_week_id
      WHERE tw.template_id = ((SELECT result ->> 'template_id' FROM _save_result))::uuid
        AND te.superset_group_id = (SELECT ss_group FROM _ids)),
    'A4: 3 template exercises; superset pair shares one FRESH group id'
  )
));

INSERT INTO _tap (n, line) VALUES (5, (
  SELECT ok(
    (SELECT count(*)::int FROM template_exercise_sets ts
       JOIN template_exercises te ON te.id = ts.template_exercise_id
       JOIN template_days td ON td.id = te.template_day_id
       JOIN template_weeks tw ON tw.id = td.template_week_id
      WHERE tw.template_id = ((SELECT result ->> 'template_id' FROM _save_result))::uuid
        AND ts.deleted_at IS NULL) = 5
    AND EXISTS (SELECT 1 FROM template_exercise_sets ts
       JOIN template_exercises te ON te.id = ts.template_exercise_id
       JOIN template_days td ON td.id = te.template_day_id
       JOIN template_weeks tw ON tw.id = td.template_week_id
      WHERE tw.template_id = ((SELECT result ->> 'template_id' FROM _save_result))::uuid
        AND tw.week_number = 1 AND td.sort_order = 0
        AND te.sort_order = 1 AND ts.set_number = 2 AND ts.reps = '12'),
    'A5: 5 per-set rows fanned into the template, paired to the right clone'
  )
));


-- ----------------------------------------------------------------------------
-- §B. Duplicate name.
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE _dupe_result (result jsonb) ON COMMIT DROP;
GRANT INSERT, SELECT ON _dupe_result TO authenticated;

INSERT INTO _dupe_result
  SELECT public.save_program_as_template(
    (SELECT program_a FROM _ids),
    't21 protocol'   -- case-insensitive collision
  );

INSERT INTO _tap (n, line) VALUES (6, (
  SELECT is(
    (SELECT result ->> 'status' FROM _dupe_result),
    'duplicate_name',
    'B1: case-insensitive name collision returns status=duplicate_name'
  )
));


-- ----------------------------------------------------------------------------
-- §C. create_program_from_template — different client, new Monday start.
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE _inst_result (result jsonb) ON COMMIT DROP;
GRANT INSERT, SELECT ON _inst_result TO authenticated;

INSERT INTO _inst_result
  SELECT public.create_program_from_template(
    ((SELECT result ->> 'template_id' FROM _save_result))::uuid,
    (SELECT client_b FROM _ids),
    '2026-06-01'::date,
    NULL
  );

INSERT INTO _tap (n, line) VALUES (7, (
  SELECT is(
    (SELECT result ->> 'status' FROM _inst_result),
    'created',
    'C1: create_program_from_template returns status=created'
  )
));

INSERT INTO _tap (n, line) VALUES (8, (
  SELECT ok(
    EXISTS (SELECT 1 FROM programs
      WHERE id = ((SELECT result ->> 'new_program_id' FROM _inst_result))::uuid
        AND client_id = (SELECT client_b FROM _ids)
        AND start_date = '2026-06-01'::date
        AND duration_weeks = 2
        AND name = 'T21 Protocol'
        AND template_id = ((SELECT result ->> 'template_id' FROM _save_result))::uuid
        AND status = 'active'),
    'C2: program lands on the new client with template name, span, and provenance'
  )
));

INSERT INTO _tap (n, line) VALUES (9, (
  SELECT is(
    (SELECT array_agg(pd.day_label || ':' || pd.scheduled_date::text
                      ORDER BY pd.scheduled_date)
       FROM program_days pd
      WHERE pd.program_id = ((SELECT result ->> 'new_program_id' FROM _inst_result))::uuid
        AND pd.deleted_at IS NULL),
    ARRAY['Day A:2026-06-01', 'Day B:2026-06-03', 'Day A:2026-06-08'],
    'C3: weekday rhythm reproduced (Mon/Wed week 1, Mon week 2)'
  )
));

INSERT INTO _tap (n, line) VALUES (10, (
  SELECT ok(
    (SELECT count(*)::int FROM program_exercises pe
       JOIN program_days pd ON pd.id = pe.program_day_id
      WHERE pd.program_id = ((SELECT result ->> 'new_program_id' FROM _inst_result))::uuid
        AND pe.deleted_at IS NULL) = 3
    AND (SELECT count(*)::int FROM program_exercise_sets ps
       JOIN program_exercises pe ON pe.id = ps.program_exercise_id
       JOIN program_days pd ON pd.id = pe.program_day_id
      WHERE pd.program_id = ((SELECT result ->> 'new_program_id' FROM _inst_result))::uuid
        AND ps.deleted_at IS NULL AND pe.deleted_at IS NULL) = 5
    AND EXISTS (SELECT 1 FROM program_exercise_sets ps
       JOIN program_exercises pe ON pe.id = ps.program_exercise_id
       JOIN program_days pd ON pd.id = pe.program_day_id
      WHERE pd.program_id = ((SELECT result ->> 'new_program_id' FROM _inst_result))::uuid
        AND pd.scheduled_date = '2026-06-01'::date
        AND pe.sort_order = 1 AND ps.set_number = 2 AND ps.reps = '12'),
    'C4: 3 exercises + 5 per-set rows instantiated, pairing intact'
  )
));

INSERT INTO _tap (n, line) VALUES (11, (
  SELECT ok(
    (SELECT count(DISTINCT pe.superset_group_id)::int FROM program_exercises pe
       JOIN program_days pd ON pd.id = pe.program_day_id
      WHERE pd.program_id = ((SELECT result ->> 'new_program_id' FROM _inst_result))::uuid
        AND pe.superset_group_id IS NOT NULL
        AND pe.deleted_at IS NULL) = 1
    AND NOT EXISTS (
      SELECT 1 FROM program_exercises pe
        JOIN program_days pd ON pd.id = pe.program_day_id
       WHERE pd.program_id = ((SELECT result ->> 'new_program_id' FROM _inst_result))::uuid
         AND pe.superset_group_id IN (
           SELECT te.superset_group_id FROM template_exercises te
             JOIN template_days td ON td.id = te.template_day_id
             JOIN template_weeks tw ON tw.id = td.template_week_id
            WHERE tw.template_id = ((SELECT result ->> 'template_id' FROM _save_result))::uuid
              AND te.superset_group_id IS NOT NULL
         )),
    'C5: instantiated superset uses a fresh group id (not the template''s)'
  )
));


-- ----------------------------------------------------------------------------
-- §D. Overlap — same client, same dates again.
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE _overlap_result (result jsonb) ON COMMIT DROP;
GRANT INSERT, SELECT ON _overlap_result TO authenticated;

INSERT INTO _overlap_result
  SELECT public.create_program_from_template(
    ((SELECT result ->> 'template_id' FROM _save_result))::uuid,
    (SELECT client_b FROM _ids),
    '2026-06-08'::date,   -- inside the block just created
    'T21 Again'
  );

INSERT INTO _tap (n, line) VALUES (12, (
  SELECT is(
    (SELECT result ->> 'status' FROM _overlap_result),
    'overlap',
    'D1: instantiating into an occupied date range returns status=overlap'
  )
));


-- ----------------------------------------------------------------------------
-- §E. Divergence — template edits do NOT propagate (brief §5.2).
-- ----------------------------------------------------------------------------
UPDATE template_exercise_sets ts
   SET reps = '99'
  FROM template_exercises te
  JOIN template_days td ON td.id = te.template_day_id
  JOIN template_weeks tw ON tw.id = td.template_week_id
 WHERE ts.template_exercise_id = te.id
   AND tw.template_id = ((SELECT result ->> 'template_id' FROM _save_result))::uuid;

INSERT INTO _tap (n, line) VALUES (13, (
  SELECT is(
    (SELECT count(*)::int FROM program_exercise_sets ps
       JOIN program_exercises pe ON pe.id = ps.program_exercise_id
       JOIN program_days pd ON pd.id = pe.program_day_id
      WHERE pd.program_id = ((SELECT result ->> 'new_program_id' FROM _inst_result))::uuid
        AND ps.reps = '99'),
    0,
    'E1: editing the template leaves the instantiated program untouched'
  )
));


-- ----------------------------------------------------------------------------
-- §F. Security — cross-org staff deny; client-role deny.
-- ----------------------------------------------------------------------------
SELECT public._test_set_jwt(
  (SELECT staff_b FROM _ids), (SELECT org_b FROM _ids), 'staff'
);

INSERT INTO _tap (n, line) VALUES (14, (
  SELECT throws_ok(
    format(
      'SELECT public.save_program_as_template(%L::uuid, %L)',
      (SELECT program_a FROM _ids), 'Stolen Protocol'
    ),
    '42501',
    'Source program not in your organization',
    'F1: cross-org staff cannot save another org''s program as a template'
  )
));

SELECT public._test_set_jwt(
  (SELECT client_user FROM _ids), (SELECT org_a FROM _ids), 'client'
);

INSERT INTO _tap (n, line) VALUES (15, (
  SELECT throws_ok(
    format(
      'SELECT public.create_program_from_template(%L::uuid, %L::uuid, %L::date, NULL)',
      (SELECT result ->> 'template_id' FROM _save_result),
      (SELECT client_a FROM _ids),
      '2026-09-07'
    ),
    '42501',
    'Unauthorized',
    'F2: client role cannot instantiate templates'
  )
));


-- ----------------------------------------------------------------------------
-- Hand back to the test owner before final SELECT + ROLLBACK.
-- ----------------------------------------------------------------------------
RESET ROLE;

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
