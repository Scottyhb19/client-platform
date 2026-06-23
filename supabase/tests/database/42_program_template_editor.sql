-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), is(), ok(), throws_ok() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 42_program_template_editor
-- ============================================================================
-- Why: P-3 of the Library Sessions/Programs editors pass
-- (docs/polish/library-sessions-programs.md). Locks the program-template editor
-- RPCs (20260624150000) against the premortem:
--
--   §A grant posture (FM-B): anon holds EXECUTE on NONE of the 6 RPCs.
--   §B duplicate_template_day (FM-C/E): copies a day (+ per-set rows, rep_metric)
--      within its week, one fresh superset group, "(copy)" label.
--   §C/§D engine (full parity): insert_template_exercise_at fan-out (rep_metric);
--      reorder_template_exercises re-derives the moved card's group.
--   §E divergence (FM-D) + soft-deletes: editing the source day after a duplicate
--      leaves the copy untouched; soft_delete_template_exercise / _day hide rows.
--   §F cross-org (FM-A): staff_b cannot SELECT / insert / duplicate / delete in
--      another org's template; the enforce-org trigger rejects a planted exercise.
--
-- Test count: 19
-- ============================================================================

BEGIN;

SELECT plan(19);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated;


-- ----------------------------------------------------------------------------
-- §1. Fixture — org_a template: week 1 → Day A with te1+te2 in ONE superset
-- group (section 'Main'), 3 per-set rows (one timed). org_b for cross-org.
-- ex_a3 carries a timed default for the insert fan-out test.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  org_a    uuid := '00000000-0000-0000-0000-0000000c4201'::uuid;
  org_b    uuid := '00000000-0000-0000-0000-0000000c4202'::uuid;
  staff_a  uuid;
  staff_b  uuid;
  ex_a1    uuid := '00000000-0000-0000-0000-0000000c4204'::uuid;
  ex_a2    uuid := '00000000-0000-0000-0000-0000000c4205'::uuid;
  ex_a3    uuid := '00000000-0000-0000-0000-0000000c4206'::uuid;
  ex_b     uuid := '00000000-0000-0000-0000-0000000c4207'::uuid;
  tmpl_a   uuid := '00000000-0000-0000-0000-0000000c4208'::uuid;
  week_1   uuid := '00000000-0000-0000-0000-0000000c4209'::uuid;
  day_1    uuid := '00000000-0000-0000-0000-0000000c420a'::uuid;
  te1      uuid := '00000000-0000-0000-0000-0000000c420b'::uuid;
  te2      uuid := '00000000-0000-0000-0000-0000000c420c'::uuid;
  grp      uuid := '00000000-0000-0000-0000-0000000c420d'::uuid;
BEGIN
  INSERT INTO organizations (id, name, slug) VALUES
    (org_a, 'Test Org A — TmplEditor 42', 'test-org-a-tmpl-42'),
    (org_b, 'Test Org B — TmplEditor 42', 'test-org-b-tmpl-42');

  staff_a := public._test_make_user('staff-a-tmpl42@test.local');
  staff_b := public._test_make_user('staff-b-tmpl42@test.local');
  PERFORM public._test_grant_membership(staff_a, org_a, 'staff'::user_role);
  PERFORM public._test_grant_membership(staff_b, org_b, 'staff'::user_role);

  INSERT INTO exercises (id, organization_id, name, default_sets, default_reps, default_rep_metric) VALUES
    (ex_a1, org_a, 'T42 Ex A1', 3, '10', NULL),
    (ex_a2, org_a, 'T42 Ex A2', 3, '8',  NULL),
    (ex_a3, org_a, 'T42 Ex A3', 3, '12', 'time_minsec'),
    (ex_b,  org_b, 'T42 Ex B',  3, '12', NULL);

  PERFORM public._test_set_jwt(staff_a, org_a, 'staff');
  EXECUTE 'SET LOCAL ROLE authenticated';

  INSERT INTO program_templates (id, organization_id, name) VALUES (tmpl_a, org_a, 'T42 Template');
  INSERT INTO template_weeks (id, template_id, week_number) VALUES (week_1, tmpl_a, 1);
  INSERT INTO template_days (id, template_week_id, day_label, sort_order) VALUES (day_1, week_1, 'Day A', 0);

  INSERT INTO template_exercises (id, template_day_id, exercise_id, sort_order, section_title, superset_group_id) VALUES
    (te1, day_1, ex_a1, 0, 'Main', grp),
    (te2, day_1, ex_a2, 1, 'Main', grp);

  INSERT INTO template_exercise_sets (template_exercise_id, set_number, reps, rep_metric, optional_metric, optional_value) VALUES
    (te1, 1, '10', NULL,          'kg', '60'),
    (te1, 2, '30', 'time_minsec', NULL, NULL),
    (te2, 1, '8',  NULL,          'kg', '40');

  EXECUTE 'RESET ROLE';

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_a AS org_a, org_b AS org_b, staff_a AS staff_a, staff_b AS staff_b,
    ex_a3 AS ex_a3, ex_b AS ex_b, tmpl_a AS tmpl_a, day_1 AS day_1,
    te1 AS te1, te2 AS te2, grp AS grp;
  GRANT SELECT ON _ids TO authenticated;
END $$;


-- ----------------------------------------------------------------------------
-- §A. Grant posture (FM-B) — anon holds EXECUTE on none of the 6 RPCs.
-- ----------------------------------------------------------------------------
INSERT INTO _tap (n, line) VALUES (1, (
  SELECT ok(NOT has_function_privilege('anon',
    'public.insert_template_exercise_at(uuid,uuid,uuid,text)', 'EXECUTE'),
    'A1: anon cannot execute insert_template_exercise_at')));
INSERT INTO _tap (n, line) VALUES (2, (
  SELECT ok(NOT has_function_privilege('anon',
    'public.reorder_template_exercises(uuid,uuid[],uuid)', 'EXECUTE'),
    'A2: anon cannot execute reorder_template_exercises')));
INSERT INTO _tap (n, line) VALUES (3, (
  SELECT ok(NOT has_function_privilege('anon',
    'public.soft_delete_template_exercise(uuid)', 'EXECUTE'),
    'A3: anon cannot execute soft_delete_template_exercise')));
INSERT INTO _tap (n, line) VALUES (4, (
  SELECT ok(NOT has_function_privilege('anon',
    'public.soft_delete_template_exercise_set(uuid)', 'EXECUTE'),
    'A4: anon cannot execute soft_delete_template_exercise_set')));
INSERT INTO _tap (n, line) VALUES (5, (
  SELECT ok(NOT has_function_privilege('anon',
    'public.soft_delete_template_day(uuid)', 'EXECUTE'),
    'A5: anon cannot execute soft_delete_template_day')));
INSERT INTO _tap (n, line) VALUES (6, (
  SELECT ok(NOT has_function_privilege('anon',
    'public.duplicate_template_day(uuid)', 'EXECUTE'),
    'A6: anon cannot execute duplicate_template_day')));


-- ----------------------------------------------------------------------------
-- §B. duplicate_template_day — copy + group remap + rep_metric + label.
-- ----------------------------------------------------------------------------
SELECT public._test_set_jwt((SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff');
SET LOCAL ROLE authenticated;

CREATE TEMP TABLE _dup (result jsonb) ON COMMIT DROP;
GRANT INSERT, SELECT ON _dup TO authenticated;
INSERT INTO _dup SELECT public.duplicate_template_day((SELECT day_1 FROM _ids));

INSERT INTO _tap (n, line) VALUES (7, (
  SELECT ok(
    (SELECT count(*)::int FROM template_exercises
      WHERE template_day_id = ((SELECT result ->> 'new_day_id' FROM _dup))::uuid AND deleted_at IS NULL) = 2
    AND (SELECT count(DISTINCT superset_group_id)::int FROM template_exercises
      WHERE template_day_id = ((SELECT result ->> 'new_day_id' FROM _dup))::uuid
        AND superset_group_id IS NOT NULL AND deleted_at IS NULL) = 1
    AND (SELECT count(*)::int FROM template_exercises
      WHERE template_day_id = ((SELECT result ->> 'new_day_id' FROM _dup))::uuid
        AND superset_group_id = (SELECT grp FROM _ids)) = 0,
    'A7: duplicated day has 2 exercises under ONE FRESH superset group')));

INSERT INTO _tap (n, line) VALUES (8, (
  SELECT ok(EXISTS (
    SELECT 1 FROM template_exercise_sets tes
      JOIN template_exercises te ON te.id = tes.template_exercise_id
     WHERE te.template_day_id = ((SELECT result ->> 'new_day_id' FROM _dup))::uuid
       AND tes.set_number = 2 AND tes.reps = '30' AND tes.rep_metric = 'time_minsec'),
    'A8: duplicated per-set rows keep reps=30 + rep_metric=time_minsec')));

INSERT INTO _tap (n, line) VALUES (9, (
  SELECT is(
    (SELECT day_label FROM template_days WHERE id = ((SELECT result ->> 'new_day_id' FROM _dup))::uuid),
    'Day A (copy)',
    'A9: duplicated day gets the "(copy)" label')));


-- ----------------------------------------------------------------------------
-- §C/§D. Engine — insert fan-out + reorder group re-derivation (on day_1).
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE _eng (id uuid) ON COMMIT DROP;
GRANT INSERT, SELECT ON _eng TO authenticated;
INSERT INTO _eng SELECT public.insert_template_exercise_at(
  (SELECT day_1 FROM _ids), (SELECT ex_a3 FROM _ids), NULL, 'append');

INSERT INTO _tap (n, line) VALUES (10, (
  SELECT ok(
    (SELECT count(*)::int FROM template_exercise_sets
      WHERE template_exercise_id = (SELECT id FROM _eng) AND deleted_at IS NULL) = 3
    AND (SELECT count(*)::int FROM template_exercise_sets
      WHERE template_exercise_id = (SELECT id FROM _eng)
        AND reps = '12' AND rep_metric = 'time_minsec') = 3,
    'A10: insert append fanned out 3 sets with default reps=12 + rep_metric=time_minsec')));

-- Reorder so the appended solo lands between the two grouped members -> joins.
SELECT public.reorder_template_exercises(
  (SELECT day_1 FROM _ids),
  ARRAY[(SELECT te1 FROM _ids), (SELECT id FROM _eng), (SELECT te2 FROM _ids)]::uuid[],
  (SELECT id FROM _eng));

INSERT INTO _tap (n, line) VALUES (11, (
  SELECT ok(
    (SELECT superset_group_id FROM template_exercises WHERE id = (SELECT id FROM _eng)) IS NOT NULL
    AND (SELECT superset_group_id FROM template_exercises WHERE id = (SELECT id FROM _eng))
        = (SELECT superset_group_id FROM template_exercises WHERE id = (SELECT te1 FROM _ids)),
    'A11: reorder re-derived the moved card into its new neighbours'' group')));


-- ----------------------------------------------------------------------------
-- §E. Divergence (FM-D) + soft-deletes.
-- ----------------------------------------------------------------------------
-- The day_1 edits above (insert + reorder) must NOT have touched the duplicate.
INSERT INTO _tap (n, line) VALUES (12, (
  SELECT is(
    (SELECT count(*)::int FROM template_exercises
      WHERE template_day_id = ((SELECT result ->> 'new_day_id' FROM _dup))::uuid AND deleted_at IS NULL),
    2,
    'A12: editing the source day did NOT change the duplicated copy (still 2)')));

SELECT public.soft_delete_template_exercise((SELECT id FROM _eng));
INSERT INTO _tap (n, line) VALUES (13, (
  SELECT is(
    (SELECT count(*)::int FROM template_exercises
      WHERE id = (SELECT id FROM _eng)),
    0,
    'A13: soft-deleted template_exercise is invisible through the staff SELECT policy')));

SELECT public.soft_delete_template_day(((SELECT result ->> 'new_day_id' FROM _dup))::uuid);
INSERT INTO _tap (n, line) VALUES (14, (
  SELECT is(
    (SELECT count(*)::int FROM template_days
      WHERE id = ((SELECT result ->> 'new_day_id' FROM _dup))::uuid),
    0,
    'A14: soft-deleted template_day is invisible through the staff SELECT policy')));


-- ----------------------------------------------------------------------------
-- §F. Cross-org (FM-A).
-- ----------------------------------------------------------------------------
-- A15: planting org_b's exercise into the template is rejected (as staff_a —
-- RLS allows the day, the foreign exercise must still be refused). NOTE:
-- enforce_template_exercise_same_org (20260420101700) is NOT SECURITY DEFINER,
-- so under the caller's RLS the org_b exercise is invisible → the parent-lookup
-- guard fires (P0001) rather than the explicit cross-org branch (23000) the
-- DEFINER circuit/session triggers hit. Either path REJECTS the plant — the
-- security property is identical; assert it throws.
INSERT INTO _tap (n, line) VALUES (15, (
  SELECT throws_ok(
    format('INSERT INTO template_exercises (template_day_id, exercise_id, sort_order) VALUES (%L,%L,9)',
      (SELECT day_1 FROM _ids), (SELECT ex_b FROM _ids)),
    NULL::text,
    NULL::text,
    'A15: enforce trigger rejects a cross-org exercise planted into a template')));

-- Switch to staff_b (org_b).
SELECT public._test_set_jwt((SELECT staff_b FROM _ids), (SELECT org_b FROM _ids), 'staff');

INSERT INTO _tap (n, line) VALUES (16, (
  SELECT is(
    (SELECT count(*)::int FROM program_templates WHERE id = (SELECT tmpl_a FROM _ids)),
    0,
    'A16: cross-org staff cannot SELECT another org''s template (RLS hides it)')));

INSERT INTO _tap (n, line) VALUES (17, (
  SELECT throws_ok(
    format('SELECT public.insert_template_exercise_at(%L,%L,NULL,%L)',
      (SELECT day_1 FROM _ids), (SELECT ex_a3 FROM _ids), 'append'),
    'P0002',
    NULL,
    'A17: cross-org staff cannot insert into another org''s template day')));

INSERT INTO _tap (n, line) VALUES (18, (
  SELECT throws_ok(
    format('SELECT public.duplicate_template_day(%L)', (SELECT day_1 FROM _ids)),
    'P0002',
    NULL,
    'A18: cross-org staff cannot duplicate another org''s template day')));

INSERT INTO _tap (n, line) VALUES (19, (
  SELECT throws_ok(
    format('SELECT public.soft_delete_template_exercise(%L)', (SELECT te1 FROM _ids)),
    'P0002',
    NULL,
    'A19: cross-org staff cannot soft-delete another org''s template_exercise')));

RESET ROLE;

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
