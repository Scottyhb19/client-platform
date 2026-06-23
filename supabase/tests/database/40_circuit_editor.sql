SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 40_circuit_editor
-- ============================================================================
-- Why: #3 of the Library Circuits workbench. Locks the two editor soft-delete
-- RPCs (20260624120000): grant posture (anon revoked), cross-org deny, and the
-- happy-path soft-delete. The editor's other writes are plain RLS-guarded staff
-- writes already covered by the circuit RLS (test 39).
--
--   A1/A2 anon holds EXECUTE on neither RPC (grant tripwire).
--   A3/A4 cross-org staff cannot soft-delete another org's ce / set (P0002).
--   A5    happy: staff soft-deletes a set → invisible.
--   A6    happy: staff soft-deletes an exercise → invisible.
--
-- Test count: 6
-- ============================================================================

BEGIN;

SELECT plan(6);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated;

DO $$
DECLARE
  org_a  uuid := '00000000-0000-0000-0000-0000000c4001'::uuid;
  org_b  uuid := '00000000-0000-0000-0000-0000000c4002'::uuid;
  stf_a  uuid;
  stf_b  uuid;
  ex_a   uuid := '00000000-0000-0000-0000-0000000c4003'::uuid;
  cir    uuid := '00000000-0000-0000-0000-0000000c4004'::uuid;
  ce1    uuid := '00000000-0000-0000-0000-0000000c4005'::uuid;
  ce2    uuid := '00000000-0000-0000-0000-0000000c4006'::uuid;
  set1   uuid := '00000000-0000-0000-0000-0000000c4007'::uuid;
BEGIN
  INSERT INTO organizations (id, name, slug) VALUES
    (org_a, 'Test Org A — Circuit Editor 40', 'test-org-a-circedit-40'),
    (org_b, 'Test Org B — Circuit Editor 40', 'test-org-b-circedit-40');

  stf_a := public._test_make_user('staff-a-circedit40@test.local');
  stf_b := public._test_make_user('staff-b-circedit40@test.local');
  PERFORM public._test_grant_membership(stf_a, org_a, 'staff'::user_role);
  PERFORM public._test_grant_membership(stf_b, org_b, 'staff'::user_role);

  INSERT INTO exercises (id, organization_id, name, default_sets, default_reps)
  VALUES (ex_a, org_a, 'C40 Ex', 3, '10');

  -- Author the circuit + children as staff_a so the INSERT policies pass.
  PERFORM public._test_set_jwt(stf_a, org_a, 'staff');
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO circuits (id, organization_id, created_by_user_id, name, circuit_type)
  VALUES (cir, org_a, stf_a, 'C40 Circuit', 'circuit');
  INSERT INTO circuit_exercises (id, circuit_id, exercise_id, sort_order) VALUES
    (ce1, cir, ex_a, 0),
    (ce2, cir, ex_a, 1);
  INSERT INTO circuit_exercise_sets (id, circuit_exercise_id, set_number, reps)
  VALUES (set1, ce1, 1, '10');
  EXECUTE 'RESET ROLE';

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_a AS org_a, org_b AS org_b, stf_a AS stf_a, stf_b AS stf_b,
    cir AS cir, ce1 AS ce1, ce2 AS ce2, set1 AS set1;
  GRANT SELECT ON _ids TO authenticated;
END $$;

-- §A1/A2 — grant posture.
INSERT INTO _tap (n, line) VALUES (1, (
  SELECT ok(NOT has_function_privilege('anon',
    'public.soft_delete_circuit_exercise(uuid)', 'EXECUTE'),
    'A1: anon cannot execute soft_delete_circuit_exercise')));
INSERT INTO _tap (n, line) VALUES (2, (
  SELECT ok(NOT has_function_privilege('anon',
    'public.soft_delete_circuit_exercise_set(uuid)', 'EXECUTE'),
    'A2: anon cannot execute soft_delete_circuit_exercise_set')));

-- §A3/A4 — cross-org deny (staff_b on org_a rows).
SELECT public._test_set_jwt((SELECT stf_b FROM _ids), (SELECT org_b FROM _ids), 'staff');
SET LOCAL ROLE authenticated;

INSERT INTO _tap (n, line) VALUES (3, (
  SELECT throws_ok(
    format('SELECT public.soft_delete_circuit_exercise(%L::uuid)', (SELECT ce2 FROM _ids)),
    'P0002', NULL,
    'A3: cross-org staff cannot soft-delete another org''s circuit_exercise')));
INSERT INTO _tap (n, line) VALUES (4, (
  SELECT throws_ok(
    format('SELECT public.soft_delete_circuit_exercise_set(%L::uuid)', (SELECT set1 FROM _ids)),
    'P0002', NULL,
    'A4: cross-org staff cannot soft-delete another org''s circuit_exercise_set')));

-- §A5/A6 — happy path (staff_a).
SELECT public._test_set_jwt((SELECT stf_a FROM _ids), (SELECT org_a FROM _ids), 'staff');

SELECT public.soft_delete_circuit_exercise_set((SELECT set1 FROM _ids));
INSERT INTO _tap (n, line) VALUES (5, (
  SELECT ok(
    NOT EXISTS (SELECT 1 FROM circuit_exercise_sets WHERE id = (SELECT set1 FROM _ids)),
    'A5: soft-deleted set is invisible through the staff SELECT policy')));

SELECT public.soft_delete_circuit_exercise((SELECT ce2 FROM _ids));
INSERT INTO _tap (n, line) VALUES (6, (
  SELECT ok(
    NOT EXISTS (SELECT 1 FROM circuit_exercises WHERE id = (SELECT ce2 FROM _ids)),
    'A6: soft-deleted circuit_exercise is invisible through the staff SELECT policy')));

RESET ROLE;

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
