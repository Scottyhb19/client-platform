-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), is(), ok(), throws_ok() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 41_session_templates
-- ============================================================================
-- Why: S-7 of the Library Sessions/Programs editors pass
-- (docs/polish/library-sessions-programs.md). Locks the session-template engine
-- (20260624130000 tables + 20260624140000 RPCs) against the premortem:
--
--   §A grant posture (FM-B): anon holds EXECUTE on NONE of the 7 RPCs.
--   §B save_day_as_session (FM-C/E): copies a real day -> a new session, in
--      order, preserving the superset group, section_title, and rep_metric;
--      duplicate name guarded.
--   §C apply_session_to_program_day (FM-C/E): copies into an EXISTING day,
--      appended, every superset group remapped to a FRESH id, rep_metric +
--      section preserved.
--   §D divergence (FM-D): editing the session after apply leaves the placed
--      program rows untouched.
--   §E engine (full parity): insert_session_exercise_at fans out sets from the
--      exercise defaults (rep_metric included); reorder_session_exercises
--      re-derives the moved card's group from its new neighbours.
--   §F cross-org (FM-A): staff_b cannot SELECT org_a's session; save/apply
--      reject a cross-org day/session; the enforce-org trigger rejects a planted
--      cross-org exercise_id.
--
-- Test count: 25
-- ============================================================================

BEGIN;

SELECT plan(25);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated;


-- ----------------------------------------------------------------------------
-- §1. Fixture — org_a program with a source day: pe1+pe2 in ONE superset group,
-- section 'Main', 3 per-set rows (one timed). Empty target day for apply.
-- org_b for cross-org. ex_a3 carries a timed default for the insert fan-out test.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  org_a    uuid := '00000000-0000-0000-0000-0000000c4101'::uuid;
  org_b    uuid := '00000000-0000-0000-0000-0000000c4102'::uuid;
  staff_a  uuid;
  staff_b  uuid;
  cli_usr  uuid;
  client_a uuid := '00000000-0000-0000-0000-0000000c4103'::uuid;
  ex_a1    uuid := '00000000-0000-0000-0000-0000000c4104'::uuid;
  ex_a2    uuid := '00000000-0000-0000-0000-0000000c4105'::uuid;
  ex_a3    uuid := '00000000-0000-0000-0000-0000000c4106'::uuid;
  ex_b     uuid := '00000000-0000-0000-0000-0000000c4107'::uuid;
  prog_a   uuid := '00000000-0000-0000-0000-0000000c4108'::uuid;
  week_1   uuid := '00000000-0000-0000-0000-0000000c4109'::uuid;
  day_src  uuid := '00000000-0000-0000-0000-0000000c410a'::uuid;
  day_dst  uuid := '00000000-0000-0000-0000-0000000c410b'::uuid;
  pe1      uuid := '00000000-0000-0000-0000-0000000c410c'::uuid;
  pe2      uuid := '00000000-0000-0000-0000-0000000c410d'::uuid;
  grp_src  uuid := '00000000-0000-0000-0000-0000000c410e'::uuid;
BEGIN
  INSERT INTO organizations (id, name, slug) VALUES
    (org_a, 'Test Org A — Sessions 41', 'test-org-a-sessions-41'),
    (org_b, 'Test Org B — Sessions 41', 'test-org-b-sessions-41');

  staff_a := public._test_make_user('staff-a-sess41@test.local');
  staff_b := public._test_make_user('staff-b-sess41@test.local');
  cli_usr := public._test_make_user('client-sess41@test.local');

  PERFORM public._test_grant_membership(staff_a, org_a, 'staff'::user_role);
  PERFORM public._test_grant_membership(staff_b, org_b, 'staff'::user_role);
  PERFORM public._test_grant_membership(cli_usr, org_a, 'client'::user_role);

  INSERT INTO clients (id, organization_id, user_id, first_name, last_name, email)
  VALUES (client_a, org_a, cli_usr, 'Sess', 'Ion', 'sess41@test.local');

  INSERT INTO exercises (id, organization_id, name, default_sets, default_reps, default_rep_metric) VALUES
    (ex_a1, org_a, 'S41 Ex A1', 3, '10', NULL),
    (ex_a2, org_a, 'S41 Ex A2', 3, '8',  NULL),
    (ex_a3, org_a, 'S41 Ex A3', 3, '12', 'time_minsec'),
    (ex_b,  org_b, 'S41 Ex B',  3, '12', NULL);

  PERFORM public._test_set_jwt(staff_a, org_a, 'staff');
  EXECUTE 'SET LOCAL ROLE authenticated';

  INSERT INTO programs (id, organization_id, client_id, name, status, start_date, duration_weeks)
  VALUES (prog_a, org_a, client_a, 'S41 Block', 'active', '2026-05-04'::date, 1);

  INSERT INTO program_weeks (id, program_id, week_number) VALUES (week_1, prog_a, 1);

  INSERT INTO program_days (id, program_id, program_week_id, day_label, scheduled_date, sort_order) VALUES
    (day_src, prog_a, week_1, 'Source', '2026-05-04'::date, 0),
    (day_dst, prog_a, week_1, 'Target', '2026-05-05'::date, 1);

  -- pe1 + pe2 share ONE superset group + section 'Main'.
  INSERT INTO program_exercises (id, program_day_id, exercise_id, sort_order, section_title, superset_group_id) VALUES
    (pe1, day_src, ex_a1, 0, 'Main', grp_src),
    (pe2, day_src, ex_a2, 1, 'Main', grp_src);

  INSERT INTO program_exercise_sets (program_exercise_id, set_number, reps, rep_metric, optional_metric, optional_value) VALUES
    (pe1, 1, '10', NULL,          'kg', '60'),
    (pe1, 2, '30', 'time_minsec', NULL, NULL),
    (pe2, 1, '8',  NULL,          'kg', '40');

  EXECUTE 'RESET ROLE';

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_a AS org_a, org_b AS org_b, staff_a AS staff_a, staff_b AS staff_b,
    ex_a1 AS ex_a1, ex_a2 AS ex_a2, ex_a3 AS ex_a3, ex_b AS ex_b,
    day_src AS day_src, day_dst AS day_dst, grp_src AS grp_src;
  GRANT SELECT ON _ids TO authenticated;
END $$;


-- ----------------------------------------------------------------------------
-- §A. Grant posture (FM-B) — anon holds EXECUTE on none of the 7 RPCs.
-- ----------------------------------------------------------------------------
INSERT INTO _tap (n, line) VALUES (1, (
  SELECT ok(NOT has_function_privilege('anon',
    'public.insert_session_exercise_at(uuid,uuid,uuid,text)', 'EXECUTE'),
    'A1: anon cannot execute insert_session_exercise_at')));
INSERT INTO _tap (n, line) VALUES (2, (
  SELECT ok(NOT has_function_privilege('anon',
    'public.reorder_session_exercises(uuid,uuid[],uuid)', 'EXECUTE'),
    'A2: anon cannot execute reorder_session_exercises')));
INSERT INTO _tap (n, line) VALUES (3, (
  SELECT ok(NOT has_function_privilege('anon',
    'public.apply_session_to_program_day(uuid,uuid)', 'EXECUTE'),
    'A3: anon cannot execute apply_session_to_program_day')));
INSERT INTO _tap (n, line) VALUES (4, (
  SELECT ok(NOT has_function_privilege('anon',
    'public.save_day_as_session(uuid,text)', 'EXECUTE'),
    'A4: anon cannot execute save_day_as_session')));
INSERT INTO _tap (n, line) VALUES (5, (
  SELECT ok(NOT has_function_privilege('anon',
    'public.soft_delete_session_template(uuid)', 'EXECUTE'),
    'A5: anon cannot execute soft_delete_session_template')));
INSERT INTO _tap (n, line) VALUES (6, (
  SELECT ok(NOT has_function_privilege('anon',
    'public.soft_delete_session_template_exercise(uuid)', 'EXECUTE'),
    'A6: anon cannot execute soft_delete_session_template_exercise')));
INSERT INTO _tap (n, line) VALUES (7, (
  SELECT ok(NOT has_function_privilege('anon',
    'public.soft_delete_session_template_exercise_set(uuid)', 'EXECUTE'),
    'A7: anon cannot execute soft_delete_session_template_exercise_set')));


-- ----------------------------------------------------------------------------
-- §B. save_day_as_session — copy + group + section + rep_metric + dup-name.
-- ----------------------------------------------------------------------------
SELECT public._test_set_jwt((SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff');
SET LOCAL ROLE authenticated;

CREATE TEMP TABLE _save (result jsonb) ON COMMIT DROP;
GRANT INSERT, SELECT ON _save TO authenticated;
INSERT INTO _save SELECT public.save_day_as_session((SELECT day_src FROM _ids), 'Sess A');

INSERT INTO _tap (n, line) VALUES (8, (
  SELECT is((SELECT result ->> 'status' FROM _save), 'created',
    'A8: save_day_as_session returns status=created')));

INSERT INTO _tap (n, line) VALUES (9, (
  SELECT is(
    (SELECT array_agg(se.sort_order || ':' || e.name ORDER BY se.sort_order)
       FROM session_template_exercises se JOIN exercises e ON e.id = se.exercise_id
      WHERE se.session_template_id = ((SELECT result ->> 'session_id' FROM _save))::uuid
        AND se.deleted_at IS NULL),
    ARRAY['0:S41 Ex A1', '1:S41 Ex A2'],
    'A9: session exercises copied in order')));

INSERT INTO _tap (n, line) VALUES (10, (
  SELECT ok(
    (SELECT count(DISTINCT superset_group_id)::int FROM session_template_exercises
      WHERE session_template_id = ((SELECT result ->> 'session_id' FROM _save))::uuid
        AND superset_group_id IS NOT NULL AND deleted_at IS NULL) = 1
    AND (SELECT count(*)::int FROM session_template_exercises
      WHERE session_template_id = ((SELECT result ->> 'session_id' FROM _save))::uuid
        AND superset_group_id IS NULL AND deleted_at IS NULL) = 0,
    'A10: both exercises copied into ONE superset group (none left solo)')));

INSERT INTO _tap (n, line) VALUES (11, (
  SELECT ok(EXISTS (
    SELECT 1 FROM session_template_exercise_sets ses
      JOIN session_template_exercises se ON se.id = ses.session_template_exercise_id
     WHERE se.session_template_id = ((SELECT result ->> 'session_id' FROM _save))::uuid
       AND se.exercise_id = (SELECT ex_a1 FROM _ids)
       AND ses.set_number = 2 AND ses.reps = '30' AND ses.rep_metric = 'time_minsec'),
    'A11: the timed set keeps reps=30 + rep_metric=time_minsec through save')));

INSERT INTO _tap (n, line) VALUES (12, (
  SELECT is(
    (SELECT count(*)::int FROM session_template_exercises
      WHERE session_template_id = ((SELECT result ->> 'session_id' FROM _save))::uuid
        AND section_title = 'Main' AND deleted_at IS NULL),
    2,
    'A12: section_title Main copied to both exercises')));

INSERT INTO _tap (n, line) VALUES (13, (
  SELECT is(
    (public.save_day_as_session((SELECT day_src FROM _ids), 'sess a')) ->> 'status',
    'duplicate_name',
    'A13: case-insensitive name collision returns status=duplicate_name')));


-- ----------------------------------------------------------------------------
-- §C. apply_session_to_program_day — copy-on-apply, fresh group remap.
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE _ins (result jsonb) ON COMMIT DROP;
GRANT INSERT, SELECT ON _ins TO authenticated;
INSERT INTO _ins SELECT public.apply_session_to_program_day(
  ((SELECT result ->> 'session_id' FROM _save))::uuid, (SELECT day_dst FROM _ids));

INSERT INTO _tap (n, line) VALUES (14, (
  SELECT ok(
    (SELECT result ->> 'status' FROM _ins) = 'inserted'
    AND (SELECT (result ->> 'inserted_count')::int FROM _ins) = 2,
    'A14: apply returns status=inserted, inserted_count=2')));

INSERT INTO _tap (n, line) VALUES (15, (
  SELECT ok(
    (SELECT count(*)::int FROM program_exercises
      WHERE program_day_id = (SELECT day_dst FROM _ids) AND deleted_at IS NULL) = 2
    AND (SELECT count(DISTINCT superset_group_id)::int FROM program_exercises
      WHERE program_day_id = (SELECT day_dst FROM _ids)
        AND superset_group_id IS NOT NULL AND deleted_at IS NULL) = 1,
    'A15: 2 exercises placed in the target day under ONE group')));

INSERT INTO _tap (n, line) VALUES (16, (
  SELECT is(
    (SELECT count(*)::int FROM program_exercises
      WHERE program_day_id = (SELECT day_dst FROM _ids)
        AND superset_group_id = (SELECT grp_src FROM _ids) AND deleted_at IS NULL),
    0,
    'A16: the placed group id is FRESH (not the source day''s group id)')));

INSERT INTO _tap (n, line) VALUES (17, (
  SELECT ok(EXISTS (
    SELECT 1 FROM program_exercise_sets pes
      JOIN program_exercises pe ON pe.id = pes.program_exercise_id
     WHERE pe.program_day_id = (SELECT day_dst FROM _ids)
       AND pes.set_number = 2 AND pes.reps = '30' AND pes.rep_metric = 'time_minsec'),
    'A17: rep_metric=time_minsec survived save->apply end-to-end')));

INSERT INTO _tap (n, line) VALUES (18, (
  SELECT is(
    (SELECT count(*)::int FROM program_exercises
      WHERE program_day_id = (SELECT day_dst FROM _ids)
        AND section_title = 'Main' AND deleted_at IS NULL),
    2,
    'A18: section_title Main copied to the placed rows')));


-- ----------------------------------------------------------------------------
-- §D. Divergence (FM-D) — editing the session leaves the placed program rows alone.
-- ----------------------------------------------------------------------------
UPDATE session_template_exercise_sets ses
   SET reps = '999'
  FROM session_template_exercises se
 WHERE ses.session_template_exercise_id = se.id
   AND se.session_template_id = ((SELECT result ->> 'session_id' FROM _save))::uuid;

INSERT INTO _tap (n, line) VALUES (19, (
  SELECT is(
    (SELECT count(*)::int FROM program_exercise_sets pes
       JOIN program_exercises pe ON pe.id = pes.program_exercise_id
      WHERE pe.program_day_id = (SELECT day_dst FROM _ids) AND pes.reps = '999'),
    0,
    'A19: editing the session''s sets does NOT mutate the already-placed program rows')));


-- ----------------------------------------------------------------------------
-- §E. Engine (full parity) — insert fan-out + reorder group re-derivation.
-- ----------------------------------------------------------------------------
-- Append ex_a3 (default 3 sets, reps 12, timed) to the session.
CREATE TEMP TABLE _eng (id uuid) ON COMMIT DROP;
GRANT INSERT, SELECT ON _eng TO authenticated;
INSERT INTO _eng SELECT public.insert_session_exercise_at(
  ((SELECT result ->> 'session_id' FROM _save))::uuid, (SELECT ex_a3 FROM _ids), NULL, 'append');

INSERT INTO _tap (n, line) VALUES (20, (
  SELECT ok(
    (SELECT count(*)::int FROM session_template_exercise_sets
      WHERE session_template_exercise_id = (SELECT id FROM _eng) AND deleted_at IS NULL) = 3
    AND (SELECT count(*)::int FROM session_template_exercise_sets
      WHERE session_template_exercise_id = (SELECT id FROM _eng)
        AND reps = '12' AND rep_metric = 'time_minsec') = 3,
    'A20: insert append fanned out 3 sets carrying default reps=12 + rep_metric=time_minsec')));

-- Reorder so the freshly-appended solo (ex_a3) lands BETWEEN the two grouped
-- members -> it must join their group (group re-derivation).
SELECT public.reorder_session_exercises(
  ((SELECT result ->> 'session_id' FROM _save))::uuid,
  ARRAY[
    (SELECT id FROM session_template_exercises WHERE session_template_id = ((SELECT result ->> 'session_id' FROM _save))::uuid AND exercise_id = (SELECT ex_a1 FROM _ids) AND deleted_at IS NULL),
    (SELECT id FROM _eng),
    (SELECT id FROM session_template_exercises WHERE session_template_id = ((SELECT result ->> 'session_id' FROM _save))::uuid AND exercise_id = (SELECT ex_a2 FROM _ids) AND deleted_at IS NULL)
  ]::uuid[],
  (SELECT id FROM _eng));

INSERT INTO _tap (n, line) VALUES (21, (
  SELECT ok(
    (SELECT superset_group_id FROM session_template_exercises WHERE id = (SELECT id FROM _eng)) IS NOT NULL
    AND (SELECT superset_group_id FROM session_template_exercises WHERE id = (SELECT id FROM _eng))
        = (SELECT superset_group_id FROM session_template_exercises
            WHERE session_template_id = ((SELECT result ->> 'session_id' FROM _save))::uuid
              AND exercise_id = (SELECT ex_a1 FROM _ids) AND deleted_at IS NULL),
    'A21: reorder re-derived the moved card into its new neighbours'' group')));


-- ----------------------------------------------------------------------------
-- §F. Cross-org (FM-A).
-- ----------------------------------------------------------------------------
-- A22: enforce-org trigger rejects planting org_b's exercise into the session.
INSERT INTO _tap (n, line) VALUES (22, (
  SELECT throws_ok(
    format('INSERT INTO session_template_exercises (session_template_id, exercise_id, sort_order) VALUES (%L,%L,9)',
      ((SELECT result ->> 'session_id' FROM _save))::uuid, (SELECT ex_b FROM _ids)),
    '23514',
    NULL,
    'A22: enforce trigger rejects a cross-org exercise planted into a session')));

-- Switch to staff_b (org_b) for the read + apply/save cross-org checks.
SELECT public._test_set_jwt((SELECT staff_b FROM _ids), (SELECT org_b FROM _ids), 'staff');

INSERT INTO _tap (n, line) VALUES (23, (
  SELECT is(
    (SELECT count(*)::int FROM session_templates
      WHERE id = ((SELECT result ->> 'session_id' FROM _save))::uuid),
    0,
    'A23: cross-org staff cannot SELECT another org''s session (RLS hides it)')));

INSERT INTO _tap (n, line) VALUES (24, (
  SELECT throws_ok(
    format('SELECT public.save_day_as_session(%L,%L)', (SELECT day_src FROM _ids), 'Stolen'),
    'P0002',
    NULL,
    'A24: cross-org staff cannot save another org''s program day as a session')));

INSERT INTO _tap (n, line) VALUES (25, (
  SELECT throws_ok(
    format('SELECT public.apply_session_to_program_day(%L,%L)',
      ((SELECT result ->> 'session_id' FROM _save))::uuid, (SELECT day_dst FROM _ids)),
    'P0002',
    NULL,
    'A25: cross-org staff cannot apply another org''s session (session not found in their org)')));

RESET ROLE;

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
