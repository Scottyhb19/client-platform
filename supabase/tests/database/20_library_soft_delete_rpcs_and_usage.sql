-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), is(), throws_ok(), lives_ok() resolve
-- unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 20_library_soft_delete_rpcs_and_usage
-- ============================================================================
-- Closes gap G-4 of the exercise-library re-audit pass
-- (docs/polish/exercise-library.md, 2026-06-12). Two coverage holes:
--
--   1. The library soft-delete RPC trio (soft_delete_exercise,
--      soft_delete_movement_pattern, soft_delete_exercise_tag — migration
--      20260505100000) had no pgTAP coverage. Tests 05/06 cover the
--      earlier RPC families only; test 17's cross-tenant matrix does not
--      include library tables. Per rls-policies.md §1: every policy needs
--      an authorized-path test and a denied-path test.
--
--   2. The usage_count trigger (bump_exercise_usage_count, migration
--      20260612090000) is brand new — assert it fires on both insert
--      paths (direct INSERT and the insert_program_exercise_at RPC) and
--      that soft-deleting a prescription does NOT decrement (monotonic
--      "times prescribed" semantics).
--
-- Pattern (mirrors 05/06): postgres-owned fixture in a DO block, then
-- SET LOCAL ROLE authenticated with _test_set_jwt swaps between staff_a /
-- staff_b / client. Deny assertions run FIRST against live rows (the RPCs
-- raise no_data_found for already-deleted rows, which would mask a deny).
--
-- Style: buffered into _tap (mirrors 15-19) so all TAP lines surface in
-- one Supabase SQL-Editor grid — this project has no non-prod test target
-- (no Docker), so the file is run as a single batch in the editor; the
-- BEGIN/ROLLBACK is what makes that safe. finish() is intentionally
-- dropped (same as 15-19); the seventeen-row plan count is the check.
--
-- Assertions (17), in _tap order:
--   1-5   soft_delete_exercise: cross-org deny (P0002), client deny
--         (42501), staff happy path, library invisibility, double-delete
--         raises (P0002).
--   6-10  soft_delete_movement_pattern: same trio + chip invisibility +
--         the exercise still referencing the deleted pattern remains
--         visible (RESTRICT FK + soft delete leave exercises intact).
--   11-14 soft_delete_exercise_tag: same trio + chip invisibility.
--   15-17 usage_count: fixture INSERT bumped 0→1; insert_program_
--         exercise_at bumps 1→2; soft_delete_program_exercise leaves 2.
-- ============================================================================

BEGIN;

SELECT plan(17);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;


-- ----------------------------------------------------------------------------
-- §1. Fixture
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  org_a        uuid := '00000000-0000-0000-0000-0000000020a1'::uuid;
  org_b        uuid := '00000000-0000-0000-0000-0000000020a2'::uuid;
  staff_a      uuid;
  staff_b      uuid;
  client_user  uuid;
  client_row   uuid := '00000000-0000-0000-0000-0000000020a3'::uuid;
  pattern_1    uuid := '00000000-0000-0000-0000-0000000020b1'::uuid;
  tag_1        uuid := '00000000-0000-0000-0000-0000000020b2'::uuid;
  exercise_1   uuid := '00000000-0000-0000-0000-0000000020c1'::uuid;
  exercise_2   uuid := '00000000-0000-0000-0000-0000000020c2'::uuid;
  program_id   uuid := '00000000-0000-0000-0000-0000000020d1'::uuid;
  week_id      uuid := '00000000-0000-0000-0000-0000000020d2'::uuid;
  day_id       uuid := '00000000-0000-0000-0000-0000000020d3'::uuid;
  prog_ex_id   uuid := '00000000-0000-0000-0000-0000000020d4'::uuid;
BEGIN
  INSERT INTO organizations (id, name, slug) VALUES
    (org_a, 'Test Org A — Library RPCs', 'test-org-a-library-rpcs'),
    (org_b, 'Test Org B — Library RPCs', 'test-org-b-library-rpcs');

  staff_a     := public._test_make_user('staff-a-lib20@test.local');
  staff_b     := public._test_make_user('staff-b-lib20@test.local');
  client_user := public._test_make_user('client-lib20@test.local');

  PERFORM public._test_grant_membership(staff_a,     org_a, 'staff'::user_role);
  PERFORM public._test_grant_membership(staff_b,     org_b, 'staff'::user_role);
  PERFORM public._test_grant_membership(client_user, org_a, 'client'::user_role);

  INSERT INTO clients (
    id, organization_id, user_id, first_name, last_name, email
  ) VALUES (
    client_row, org_a, client_user, 'Lib', 'Subject', 'lib20@test.local'
  );

  -- Library rows in org_a. exercise_2 references pattern_1 so §3 can prove
  -- that soft-deleting a referenced pattern leaves the exercise intact.
  INSERT INTO movement_patterns (id, organization_id, name, sort_order)
  VALUES (pattern_1, org_a, 'Lib20 Pattern', 500);

  INSERT INTO exercise_tags (id, organization_id, name, sort_order)
  VALUES (tag_1, org_a, 'Lib20 Tag', 500);

  INSERT INTO exercises (id, organization_id, name)
  VALUES (exercise_1, org_a, 'Lib20 Deletable Exercise');

  INSERT INTO exercises (id, organization_id, name, movement_pattern_id)
  VALUES (exercise_2, org_a, 'Lib20 Prescribed Exercise', pattern_1);

  -- Program scaffold for the usage-count assertions. The fixture
  -- program_exercises INSERT below is itself the first trigger firing
  -- (exercise_2 usage_count 0 → 1, asserted as test 15).
  INSERT INTO programs (
    id, organization_id, client_id, name, start_date, duration_weeks
  ) VALUES (
    program_id, org_a, client_row, 'Lib20 Program', '2026-06-08'::date, 4
  );

  INSERT INTO program_weeks (id, program_id, week_number)
  VALUES (week_id, program_id, 1);

  INSERT INTO program_days (
    id, program_id, program_week_id, day_label, scheduled_date, sort_order
  ) VALUES (
    day_id, program_id, week_id, 'Day 1', '2026-06-08'::date, 0
  );

  INSERT INTO program_exercises (
    id, program_day_id, exercise_id, sort_order, sets, reps
  ) VALUES (
    prog_ex_id, day_id, exercise_2, 0, 3, '8'
  );

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_a       AS org_a,
    org_b       AS org_b,
    staff_a     AS staff_a,
    staff_b     AS staff_b,
    client_user AS client_user,
    pattern_1   AS pattern_1,
    tag_1       AS tag_1,
    exercise_1  AS exercise_1,
    exercise_2  AS exercise_2,
    day_id      AS day_id,
    prog_ex_id  AS prog_ex_id;
  GRANT SELECT ON _ids TO authenticated;
END $$;


-- ============================================================================
-- §2. soft_delete_exercise
-- ============================================================================

-- Deny cases first — against the LIVE row.
SELECT public._test_set_jwt(
  (SELECT staff_b FROM _ids), (SELECT org_b FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;

INSERT INTO _tap
SELECT 1, throws_ok(
  format(
    $q$SELECT public.soft_delete_exercise(%L::uuid)$q$,
    (SELECT exercise_1 FROM _ids)
  ),
  'P0002',
  NULL::text,
  'staff_b cannot soft_delete an exercise in another org'
);

SELECT public._test_set_jwt(
  (SELECT client_user FROM _ids), (SELECT org_a FROM _ids), 'client'
);
INSERT INTO _tap
SELECT 2, throws_ok(
  format(
    $q$SELECT public.soft_delete_exercise(%L::uuid)$q$,
    (SELECT exercise_1 FROM _ids)
  ),
  '42501',
  'Unauthorized',
  'client cannot soft_delete an exercise'
);

-- Happy path.
SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);
INSERT INTO _tap
SELECT 3, lives_ok(
  format(
    $q$SELECT public.soft_delete_exercise(%L::uuid)$q$,
    (SELECT exercise_1 FROM _ids)
  ),
  'staff_a soft_delete_exercise in own org succeeds'
);

-- The deleted exercise disappears from the staff library read
-- (the SELECT policy filters deleted_at IS NULL).
INSERT INTO _tap
SELECT 4, is(
  (SELECT count(*)::int FROM exercises
    WHERE id = (SELECT exercise_1 FROM _ids)),
  0,
  'soft-deleted exercise is invisible to the staff library SELECT'
);

-- Double delete raises — the RPC's WHERE deleted_at IS NULL finds nothing.
INSERT INTO _tap
SELECT 5, throws_ok(
  format(
    $q$SELECT public.soft_delete_exercise(%L::uuid)$q$,
    (SELECT exercise_1 FROM _ids)
  ),
  'P0002',
  NULL::text,
  'double soft_delete_exercise raises no_data_found'
);


-- ============================================================================
-- §3. soft_delete_movement_pattern
-- ============================================================================
SELECT public._test_set_jwt(
  (SELECT staff_b FROM _ids), (SELECT org_b FROM _ids), 'staff'
);
INSERT INTO _tap
SELECT 6, throws_ok(
  format(
    $q$SELECT public.soft_delete_movement_pattern(%L::uuid)$q$,
    (SELECT pattern_1 FROM _ids)
  ),
  'P0002',
  NULL::text,
  'staff_b cannot soft_delete a movement_pattern in another org'
);

SELECT public._test_set_jwt(
  (SELECT client_user FROM _ids), (SELECT org_a FROM _ids), 'client'
);
INSERT INTO _tap
SELECT 7, throws_ok(
  format(
    $q$SELECT public.soft_delete_movement_pattern(%L::uuid)$q$,
    (SELECT pattern_1 FROM _ids)
  ),
  '42501',
  'Unauthorized',
  'client cannot soft_delete a movement_pattern'
);

SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);
INSERT INTO _tap
SELECT 8, lives_ok(
  format(
    $q$SELECT public.soft_delete_movement_pattern(%L::uuid)$q$,
    (SELECT pattern_1 FROM _ids)
  ),
  'staff_a soft_delete_movement_pattern in own org succeeds (even while referenced by an exercise)'
);

INSERT INTO _tap
SELECT 9, is(
  (SELECT count(*)::int FROM movement_patterns
    WHERE id = (SELECT pattern_1 FROM _ids)),
  0,
  'soft-deleted pattern is invisible to the staff chips/dropdown SELECT'
);

-- The exercise that references the deleted pattern is untouched —
-- RESTRICT FK was never exercised and the library row stays live.
INSERT INTO _tap
SELECT 10, is(
  (SELECT count(*)::int FROM exercises
    WHERE id = (SELECT exercise_2 FROM _ids)),
  1,
  'exercise referencing the soft-deleted pattern remains visible and intact'
);


-- ============================================================================
-- §4. soft_delete_exercise_tag
-- ============================================================================
SELECT public._test_set_jwt(
  (SELECT staff_b FROM _ids), (SELECT org_b FROM _ids), 'staff'
);
INSERT INTO _tap
SELECT 11, throws_ok(
  format(
    $q$SELECT public.soft_delete_exercise_tag(%L::uuid)$q$,
    (SELECT tag_1 FROM _ids)
  ),
  'P0002',
  NULL::text,
  'staff_b cannot soft_delete an exercise_tag in another org'
);

SELECT public._test_set_jwt(
  (SELECT client_user FROM _ids), (SELECT org_a FROM _ids), 'client'
);
INSERT INTO _tap
SELECT 12, throws_ok(
  format(
    $q$SELECT public.soft_delete_exercise_tag(%L::uuid)$q$,
    (SELECT tag_1 FROM _ids)
  ),
  '42501',
  'Unauthorized',
  'client cannot soft_delete an exercise_tag'
);

SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);
INSERT INTO _tap
SELECT 13, lives_ok(
  format(
    $q$SELECT public.soft_delete_exercise_tag(%L::uuid)$q$,
    (SELECT tag_1 FROM _ids)
  ),
  'staff_a soft_delete_exercise_tag in own org succeeds'
);

INSERT INTO _tap
SELECT 14, is(
  (SELECT count(*)::int FROM exercise_tags
    WHERE id = (SELECT tag_1 FROM _ids)),
  0,
  'soft-deleted tag is invisible to the staff chips SELECT'
);


-- ============================================================================
-- §5. usage_count trigger (still as staff_a)
-- ============================================================================

-- The fixture's program_exercises INSERT already fired the trigger once.
INSERT INTO _tap
SELECT 15, is(
  (SELECT usage_count FROM exercises
    WHERE id = (SELECT exercise_2 FROM _ids)),
  1,
  'fixture prescription INSERT bumped usage_count 0 -> 1'
);

-- The SQL RPC insert path bumps too (insert at start of the day). Bare
-- call, 05-style — an RPC failure aborts the batch, which is its own
-- loud signal.
SELECT public.insert_program_exercise_at(
  (SELECT day_id FROM _ids),
  (SELECT exercise_2 FROM _ids),
  NULL::uuid
);

INSERT INTO _tap
SELECT 16, is(
  (SELECT usage_count FROM exercises
    WHERE id = (SELECT exercise_2 FROM _ids)),
  2,
  'insert_program_exercise_at bumped usage_count 1 -> 2'
);

-- Monotonic: soft-deleting a prescription does NOT decrement.
SELECT public.soft_delete_program_exercise((SELECT prog_ex_id FROM _ids));

INSERT INTO _tap
SELECT 17, is(
  (SELECT usage_count FROM exercises
    WHERE id = (SELECT exercise_2 FROM _ids)),
  2,
  'soft_delete_program_exercise leaves usage_count at 2 (times prescribed is monotonic)'
);


-- Single grid output.
SELECT line FROM _tap ORDER BY n;

ROLLBACK;
