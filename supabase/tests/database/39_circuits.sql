-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), is(), ok(), throws_ok() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 39_circuits
-- ============================================================================
-- Why: C-3/C-7 of the Library Circuits/Sessions pass
-- (docs/polish/library-circuits-sessions.md). Locks the circuit engine
-- (20260624100000 tables + 20260624110000 RPCs) against the premortem:
--
--   §A grant posture (FM-B): anon holds EXECUTE on NONE of the 3 RPCs.
--   §B save-from-builder (FM-C/E): save_group_as_circuit copies exercises +
--      per-set rows (rep_metric preserved); duplicate name guarded.
--   §C insert copy-on-apply (FM-C/E): insert_circuit_into_day copies into a day
--      under one fresh superset group, rep_metric preserved end-to-end.
--   §D divergence (FM-D): editing the circuit after insert leaves the placed
--      program rows untouched.
--   §E cross-org (FM-A): staff_b cannot SELECT org_a's circuit; save rejects
--      cross-org exercises; the enforce-exercise-org trigger rejects a planted
--      cross-org exercise_id.
--
-- Test count: 15
-- ============================================================================

BEGIN;

SELECT plan(15);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated;


-- ----------------------------------------------------------------------------
-- §1. Fixture — org_a program with a source day (2 exercises, 3 per-set rows,
-- one timed set) + an empty target day; org_b for cross-org checks.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  org_a    uuid := '00000000-0000-0000-0000-0000000c3901'::uuid;
  org_b    uuid := '00000000-0000-0000-0000-0000000c3902'::uuid;
  staff_a  uuid;
  staff_b  uuid;
  cli_usr  uuid;
  client_a uuid := '00000000-0000-0000-0000-0000000c3903'::uuid;
  ex_a1    uuid := '00000000-0000-0000-0000-0000000c3904'::uuid;
  ex_a2    uuid := '00000000-0000-0000-0000-0000000c3905'::uuid;
  ex_b     uuid := '00000000-0000-0000-0000-0000000c3906'::uuid;
  prog_a   uuid := '00000000-0000-0000-0000-0000000c3907'::uuid;
  week_1   uuid := '00000000-0000-0000-0000-0000000c3908'::uuid;
  day_src  uuid := '00000000-0000-0000-0000-0000000c3909'::uuid;
  day_dst  uuid := '00000000-0000-0000-0000-0000000c390a'::uuid;
  pe1      uuid := '00000000-0000-0000-0000-0000000c390b'::uuid;
  pe2      uuid := '00000000-0000-0000-0000-0000000c390c'::uuid;
BEGIN
  INSERT INTO organizations (id, name, slug) VALUES
    (org_a, 'Test Org A — Circuits 39', 'test-org-a-circuits-39'),
    (org_b, 'Test Org B — Circuits 39', 'test-org-b-circuits-39');

  staff_a := public._test_make_user('staff-a-circ39@test.local');
  staff_b := public._test_make_user('staff-b-circ39@test.local');
  cli_usr := public._test_make_user('client-circ39@test.local');

  PERFORM public._test_grant_membership(staff_a, org_a, 'staff'::user_role);
  PERFORM public._test_grant_membership(staff_b, org_b, 'staff'::user_role);
  PERFORM public._test_grant_membership(cli_usr, org_a, 'client'::user_role);

  INSERT INTO clients (id, organization_id, user_id, first_name, last_name, email)
  VALUES (client_a, org_a, cli_usr, 'Cir', 'Cuit', 'circ39@test.local');

  -- Exercises: two in org_a, one in org_b (for the cross-org plant test).
  INSERT INTO exercises (id, organization_id, name, default_sets, default_reps) VALUES
    (ex_a1, org_a, 'C39 Ex A1', 3, '10'),
    (ex_a2, org_a, 'C39 Ex A2', 3, '8'),
    (ex_b,  org_b, 'C39 Ex B',  3, '12');

  -- Source program/day, authored as staff_a so INSERT policies pass.
  PERFORM public._test_set_jwt(staff_a, org_a, 'staff');
  EXECUTE 'SET LOCAL ROLE authenticated';

  INSERT INTO programs (id, organization_id, client_id, name, status, start_date, duration_weeks)
  VALUES (prog_a, org_a, client_a, 'C39 Block', 'active', '2026-05-04'::date, 1);

  INSERT INTO program_weeks (id, program_id, week_number) VALUES (week_1, prog_a, 1);

  INSERT INTO program_days (id, program_id, program_week_id, day_label, scheduled_date, sort_order) VALUES
    (day_src, prog_a, week_1, 'Source', '2026-05-04'::date, 0),
    (day_dst, prog_a, week_1, 'Target', '2026-05-05'::date, 1);

  INSERT INTO program_exercises (id, program_day_id, exercise_id, sort_order) VALUES
    (pe1, day_src, ex_a1, 0),
    (pe2, day_src, ex_a2, 1);

  -- pe1: two sets, the 2nd a TIMED set (rep_metric='time_minsec'); pe2: one set.
  INSERT INTO program_exercise_sets (program_exercise_id, set_number, reps, rep_metric, optional_metric, optional_value) VALUES
    (pe1, 1, '10', NULL,          'kg', '60'),
    (pe1, 2, '30', 'time_minsec', NULL, NULL),
    (pe2, 1, '8',  NULL,          'kg', '40');

  EXECUTE 'RESET ROLE';

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_a AS org_a, org_b AS org_b, staff_a AS staff_a, staff_b AS staff_b,
    cli_usr AS cli_usr, client_a AS client_a, ex_a1 AS ex_a1, ex_a2 AS ex_a2,
    ex_b AS ex_b, prog_a AS prog_a, day_src AS day_src, day_dst AS day_dst,
    pe1 AS pe1, pe2 AS pe2;
  GRANT SELECT ON _ids TO authenticated;
END $$;


-- ----------------------------------------------------------------------------
-- §A. Grant posture (FM-B) — anon holds EXECUTE on none of the 3 RPCs.
-- ----------------------------------------------------------------------------
INSERT INTO _tap (n, line) VALUES (1, (
  SELECT ok(NOT has_function_privilege('anon',
    'public.save_group_as_circuit(text,text,uuid[],text)', 'EXECUTE'),
    'A1: anon cannot execute save_group_as_circuit')));
INSERT INTO _tap (n, line) VALUES (2, (
  SELECT ok(NOT has_function_privilege('anon',
    'public.insert_circuit_into_day(uuid,uuid)', 'EXECUTE'),
    'A2: anon cannot execute insert_circuit_into_day')));
INSERT INTO _tap (n, line) VALUES (3, (
  SELECT ok(NOT has_function_privilege('anon',
    'public.soft_delete_circuit(uuid)', 'EXECUTE'),
    'A3: anon cannot execute soft_delete_circuit')));


-- ----------------------------------------------------------------------------
-- §B. save_group_as_circuit — copy + rep_metric + duplicate-name (FM-C/E).
-- ----------------------------------------------------------------------------
SELECT public._test_set_jwt((SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff');
SET LOCAL ROLE authenticated;

CREATE TEMP TABLE _save (result jsonb) ON COMMIT DROP;
GRANT INSERT, SELECT ON _save TO authenticated;
INSERT INTO _save SELECT public.save_group_as_circuit(
  'C39 Finisher', 'superset',
  ARRAY[(SELECT pe1 FROM _ids), (SELECT pe2 FROM _ids)]::uuid[], NULL);

INSERT INTO _tap (n, line) VALUES (4, (
  SELECT is((SELECT result ->> 'status' FROM _save), 'created',
    'A4: save_group_as_circuit returns status=created')));

INSERT INTO _tap (n, line) VALUES (5, (
  SELECT is(
    (SELECT array_agg(ce.sort_order || ':' || e.name ORDER BY ce.sort_order)
       FROM circuit_exercises ce JOIN exercises e ON e.id = ce.exercise_id
      WHERE ce.circuit_id = ((SELECT result ->> 'circuit_id' FROM _save))::uuid
        AND ce.deleted_at IS NULL),
    ARRAY['0:C39 Ex A1', '1:C39 Ex A2'],
    'A5: circuit_exercises copied in order with the right exercises')));

INSERT INTO _tap (n, line) VALUES (6, (
  SELECT ok(
    (SELECT count(*)::int FROM circuit_exercise_sets ces
       JOIN circuit_exercises ce ON ce.id = ces.circuit_exercise_id
      WHERE ce.circuit_id = ((SELECT result ->> 'circuit_id' FROM _save))::uuid) = 3
    AND EXISTS (
      SELECT 1 FROM circuit_exercise_sets ces
        JOIN circuit_exercises ce ON ce.id = ces.circuit_exercise_id
       WHERE ce.circuit_id = ((SELECT result ->> 'circuit_id' FROM _save))::uuid
         AND ce.sort_order = 0 AND ces.set_number = 2
         AND ces.reps = '30' AND ces.rep_metric = 'time_minsec'),
    'A6: 3 per-set rows copied; the timed set keeps reps=30 + rep_metric=time_minsec')));

-- Duplicate name (case-insensitive) → status=duplicate_name.
INSERT INTO _tap (n, line) VALUES (7, (
  SELECT is(
    (public.save_group_as_circuit('c39 finisher', 'circuit',
       ARRAY[(SELECT pe1 FROM _ids)]::uuid[], NULL)) ->> 'status',
    'duplicate_name',
    'A7: case-insensitive name collision returns status=duplicate_name')));


-- ----------------------------------------------------------------------------
-- §C. insert_circuit_into_day — copy-on-apply, fresh group, rep_metric (FM-C/E).
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE _ins (result jsonb) ON COMMIT DROP;
GRANT INSERT, SELECT ON _ins TO authenticated;
INSERT INTO _ins SELECT public.insert_circuit_into_day(
  ((SELECT result ->> 'circuit_id' FROM _save))::uuid, (SELECT day_dst FROM _ids));

INSERT INTO _tap (n, line) VALUES (8, (
  SELECT is((SELECT result ->> 'status' FROM _ins), 'inserted',
    'A8: insert_circuit_into_day returns status=inserted')));

INSERT INTO _tap (n, line) VALUES (9, (
  SELECT ok(
    (SELECT count(*)::int FROM program_exercises
      WHERE program_day_id = (SELECT day_dst FROM _ids) AND deleted_at IS NULL) = 2
    AND (SELECT count(DISTINCT superset_group_id)::int FROM program_exercises
      WHERE program_day_id = (SELECT day_dst FROM _ids)
        AND superset_group_id IS NOT NULL AND deleted_at IS NULL) = 1,
    'A9: 2 exercises placed in the target day under ONE fresh superset group')));

INSERT INTO _tap (n, line) VALUES (10, (
  SELECT ok(
    (SELECT count(*)::int FROM program_exercise_sets pes
       JOIN program_exercises pe ON pe.id = pes.program_exercise_id
      WHERE pe.program_day_id = (SELECT day_dst FROM _ids)) = 3
    AND EXISTS (
      SELECT 1 FROM program_exercise_sets pes
        JOIN program_exercises pe ON pe.id = pes.program_exercise_id
       WHERE pe.program_day_id = (SELECT day_dst FROM _ids)
         AND pes.set_number = 2 AND pes.reps = '30' AND pes.rep_metric = 'time_minsec'),
    'A10: 3 per-set rows placed; rep_metric=time_minsec survived save->insert end-to-end')));


-- ----------------------------------------------------------------------------
-- §D. Divergence (FM-D) — editing the circuit leaves the placed program rows alone.
-- ----------------------------------------------------------------------------
UPDATE circuit_exercise_sets ces
   SET reps = '999'
  FROM circuit_exercises ce
 WHERE ces.circuit_exercise_id = ce.id
   AND ce.circuit_id = ((SELECT result ->> 'circuit_id' FROM _save))::uuid;

INSERT INTO _tap (n, line) VALUES (11, (
  SELECT is(
    (SELECT count(*)::int FROM program_exercise_sets pes
       JOIN program_exercises pe ON pe.id = pes.program_exercise_id
      WHERE pe.program_day_id = (SELECT day_dst FROM _ids) AND pes.reps = '999'),
    0,
    'A11: editing the circuit''s sets does NOT mutate the already-placed program rows')));


-- ----------------------------------------------------------------------------
-- §E. Cross-org (FM-A).
-- ----------------------------------------------------------------------------
-- E1: enforce-exercise-org trigger rejects planting org_b's exercise into the
-- org_a circuit (direct insert as staff_a — RLS allows the circuit, the trigger
-- must still reject the foreign exercise).
INSERT INTO _tap (n, line) VALUES (12, (
  SELECT throws_ok(
    format('INSERT INTO circuit_exercises (circuit_id, exercise_id, sort_order) VALUES (%L,%L,9)',
      ((SELECT result ->> 'circuit_id' FROM _save))::uuid, (SELECT ex_b FROM _ids)),
    '23514',
    NULL,
    'A12: enforce trigger rejects a cross-org exercise planted into a circuit')));

-- Switch to staff_b (org_b) for the read + save cross-org checks.
SELECT public._test_set_jwt((SELECT staff_b FROM _ids), (SELECT org_b FROM _ids), 'staff');

INSERT INTO _tap (n, line) VALUES (13, (
  SELECT is(
    (SELECT count(*)::int FROM circuits
      WHERE id = ((SELECT result ->> 'circuit_id' FROM _save))::uuid),
    0,
    'A13: cross-org staff cannot SELECT another org''s circuit (RLS hides it)')));

INSERT INTO _tap (n, line) VALUES (14, (
  SELECT throws_ok(
    format('SELECT public.save_group_as_circuit(%L,%L,%L::uuid[],NULL)',
      'Stolen', 'circuit', ARRAY[(SELECT pe1 FROM _ids)]::uuid[]),
    '42501',
    'One or more exercises are not in your organization',
    'A14: cross-org staff cannot save another org''s program_exercises as a circuit')));

INSERT INTO _tap (n, line) VALUES (15, (
  SELECT throws_ok(
    format('SELECT public.insert_circuit_into_day(%L,%L)',
      ((SELECT result ->> 'circuit_id' FROM _save))::uuid, (SELECT day_dst FROM _ids)),
    'P0002',
    NULL,
    'A15: cross-org staff cannot insert another org''s circuit (circuit not found in their org)')));

RESET ROLE;

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
