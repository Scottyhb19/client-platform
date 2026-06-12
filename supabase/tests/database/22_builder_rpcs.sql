-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), is(), throws_ok(), lives_ok() resolve
-- unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 22_builder_rpcs
-- ============================================================================
-- Why: G-4 of the program-engine polish pass (docs/polish/
-- program-engine-session-builder.md, FM-4). The session builder's RPC
-- family — insert_program_exercise_at (20260612110000),
-- reorder_program_exercises (20260507100400), swap_program_exercise
-- (20260507100500) — owns the ordering and superset invariants of the
-- differentiator screen and had no dedicated coverage (test 20 touches
-- insert-at only for usage_count). A silent regression here is sequence
-- corruption in front of the EP.
--
--   §A insert_program_exercise_at: all three slots (append / legacy
--      NULL-anchor at_start / after), per-set fan-out from defaults,
--      parent-row defaults, Q3 group inheritance + boundary rule, slot
--      validation raises.
--   §B reorder_program_exercises: full rewrite follows the array, moved
--      card joins a group between two members (Q3), leaves it when moved
--      out, singleton cleanup nulls the abandoned member.
--   §C swap_program_exercise: in-place swap keeps the slot, old per-set
--      rows die, fresh fan-out from the new exercise's defaults.
--   §F security: cross-org staff deny (P0002 not-in-your-org shape),
--      client-role deny (42501).
--
-- Fixture: two days so §A's inserts don't complicate §B's arrays.
--   day_1 (insert/swap): pe0+pe1 superset g1, pe2 solo, pe3 solo.
--   day_2 (reorder):     q0+q1  superset g2, q2 solo, q3 solo.
--   ex_a defaults: 3 sets x reps 8, kg 50, rest 90, instructions.
--   ex_b defaults: 2 sets x reps 10.
--
-- Test count: 14
-- ============================================================================

BEGIN;

SELECT plan(14);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated;


-- ----------------------------------------------------------------------------
-- §1. Fixture
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  org_a       uuid := '00000000-0000-0000-0000-000000000a21'::uuid;
  org_b       uuid := '00000000-0000-0000-0000-000000000a22'::uuid;
  staff_a     uuid;
  staff_b     uuid;
  client_user uuid;
  client_a    uuid := '00000000-0000-0000-0000-000000000a23'::uuid;
  ex_a        uuid := '00000000-0000-0000-0000-000000000a24'::uuid;
  ex_b        uuid := '00000000-0000-0000-0000-000000000a25'::uuid;
  program_a   uuid := '00000000-0000-0000-0000-000000000a26'::uuid;
  week_a      uuid := '00000000-0000-0000-0000-000000000a27'::uuid;
  day_1       uuid := '00000000-0000-0000-0000-000000000a28'::uuid;
  day_2       uuid := '00000000-0000-0000-0000-000000000a29'::uuid;
  g1          uuid := '00000000-0000-0000-0000-000000000a2a'::uuid;
  g2          uuid := '00000000-0000-0000-0000-000000000a2b'::uuid;
  pe0         uuid := '00000000-0000-0000-0000-000000000a30'::uuid;
  pe1         uuid := '00000000-0000-0000-0000-000000000a31'::uuid;
  pe2         uuid := '00000000-0000-0000-0000-000000000a32'::uuid;
  pe3         uuid := '00000000-0000-0000-0000-000000000a33'::uuid;
  q0          uuid := '00000000-0000-0000-0000-000000000a40'::uuid;
  q1          uuid := '00000000-0000-0000-0000-000000000a41'::uuid;
  q2          uuid := '00000000-0000-0000-0000-000000000a42'::uuid;
  q3          uuid := '00000000-0000-0000-0000-000000000a43'::uuid;
BEGIN
  INSERT INTO organizations (id, name, slug) VALUES
    (org_a, 'Test Org A — Builder RPCs 22', 'test-org-a-builder-22'),
    (org_b, 'Test Org B — Builder RPCs 22', 'test-org-b-builder-22');

  staff_a     := public._test_make_user('staff-a-builder22@test.local');
  staff_b     := public._test_make_user('staff-b-builder22@test.local');
  client_user := public._test_make_user('client-builder22@test.local');

  PERFORM public._test_grant_membership(staff_a,     org_a, 'staff'::user_role);
  PERFORM public._test_grant_membership(staff_b,     org_b, 'staff'::user_role);
  PERFORM public._test_grant_membership(client_user, org_a, 'client'::user_role);

  INSERT INTO clients (id, organization_id, user_id, first_name, last_name, email)
  VALUES (client_a, org_a, client_user, 'Bill', 'Builder', 'builder22@test.local');

  PERFORM public._test_set_jwt(staff_a, org_a, 'staff');
  EXECUTE 'SET LOCAL ROLE authenticated';

  INSERT INTO exercises (
    id, organization_id, name, default_sets, default_reps,
    default_metric, default_metric_value, default_rest_seconds, instructions
  ) VALUES
    (ex_a, org_a, 'B22 Exercise A', 3, '8', 'kg', '50', 90, 'Brace and breathe.'),
    (ex_b, org_a, 'B22 Exercise B', 2, '10', NULL, NULL, NULL, NULL);

  INSERT INTO programs (
    id, organization_id, client_id, name, status, start_date, duration_weeks
  ) VALUES (
    program_a, org_a, client_a, 'B22 Block', 'active', '2026-04-27'::date, 2
  );

  INSERT INTO program_weeks (id, program_id, week_number)
  VALUES (week_a, program_a, 1);

  INSERT INTO program_days (
    id, program_id, program_week_id, day_label, scheduled_date, sort_order
  ) VALUES
    (day_1, program_a, week_a, 'Day A', '2026-04-27'::date, 0),
    (day_2, program_a, week_a, 'Day B', '2026-04-29'::date, 1);

  INSERT INTO program_exercises (
    id, program_day_id, exercise_id, sort_order, superset_group_id
  ) VALUES
    (pe0, day_1, ex_a, 0, g1),
    (pe1, day_1, ex_a, 1, g1),
    (pe2, day_1, ex_a, 2, NULL),
    (pe3, day_1, ex_a, 3, NULL),
    (q0,  day_2, ex_a, 0, g2),
    (q1,  day_2, ex_a, 1, g2),
    (q2,  day_2, ex_a, 2, NULL),
    (q3,  day_2, ex_a, 3, NULL);

  -- One live set row each so swap's old-sets-die assertion has a corpse.
  INSERT INTO program_exercise_sets (program_exercise_id, set_number, reps)
  SELECT id, 1, '5' FROM unnest(ARRAY[pe0, pe1, pe2, pe3, q0, q1, q2, q3]) AS t(id);

  EXECUTE 'RESET ROLE';

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_a AS org_a, org_b AS org_b, staff_a AS staff_a, staff_b AS staff_b,
    client_user AS client_user, client_a AS client_a,
    ex_a AS ex_a, ex_b AS ex_b, program_a AS program_a,
    day_1 AS day_1, day_2 AS day_2, g1 AS g1, g2 AS g2,
    pe0 AS pe0, pe1 AS pe1, pe2 AS pe2, pe3 AS pe3,
    q0 AS q0, q1 AS q1, q2 AS q2, q3 AS q3;
  GRANT SELECT ON _ids TO authenticated;
END $$;


-- ----------------------------------------------------------------------------
-- §A. insert_program_exercise_at — slots, fan-out, inheritance.
-- ----------------------------------------------------------------------------
SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;

CREATE TEMP TABLE _new_pes (label text PRIMARY KEY, id uuid NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _new_pes TO authenticated;

-- A1/A2: explicit append slot.
INSERT INTO _new_pes
  SELECT 'append', public.insert_program_exercise_at(
    (SELECT day_1 FROM _ids), (SELECT ex_a FROM _ids), NULL, 'append'
  );

INSERT INTO _tap (n, line) VALUES (1, (
  SELECT ok(
    EXISTS (SELECT 1 FROM program_exercises
      WHERE id = (SELECT id FROM _new_pes WHERE label = 'append')
        AND program_day_id = (SELECT day_1 FROM _ids)
        AND sort_order = 4
        AND superset_group_id IS NULL
        AND rest_seconds = 90
        AND instructions = 'Brace and breathe.'
        AND deleted_at IS NULL),
    'A1: append lands at MAX+1, solo, carrying parent-row defaults (rest, instructions)'
  )
));

INSERT INTO _tap (n, line) VALUES (2, (
  SELECT is(
    (SELECT count(*)::int FROM program_exercise_sets
      WHERE program_exercise_id = (SELECT id FROM _new_pes WHERE label = 'append')
        AND reps = '8' AND optional_metric = 'kg' AND optional_value = '50'
        AND deleted_at IS NULL),
    3,
    'A2: append fans out default_sets per-set rows with default reps/metric/value'
  )
));

-- A3: legacy positional 3-arg call, NULL anchor → at_start.
INSERT INTO _new_pes
  SELECT 'at_start', public.insert_program_exercise_at(
    (SELECT day_1 FROM _ids), (SELECT ex_b FROM _ids), NULL::uuid
  );

INSERT INTO _tap (n, line) VALUES (3, (
  SELECT ok(
    (SELECT sort_order FROM program_exercises
      WHERE id = (SELECT id FROM _new_pes WHERE label = 'at_start')) = 0
    AND (SELECT sort_order FROM program_exercises
      WHERE id = (SELECT pe0 FROM _ids)) = 1
    AND (SELECT sort_order FROM program_exercises
      WHERE id = (SELECT id FROM _new_pes WHERE label = 'append')) = 5,
    'A3: legacy NULL-anchor call inserts at 0 and shifts every row down'
  )
));

-- A4: after an in-group anchor whose row-below shares the group → inherits.
-- (pe0 now at sort 1, pe1 at sort 2 — both still g1.)
INSERT INTO _new_pes
  SELECT 'mid_group', public.insert_program_exercise_at(
    (SELECT day_1 FROM _ids), (SELECT ex_b FROM _ids),
    (SELECT pe0 FROM _ids), 'after'
  );

INSERT INTO _tap (n, line) VALUES (4, (
  SELECT ok(
    EXISTS (SELECT 1 FROM program_exercises
      WHERE id = (SELECT id FROM _new_pes WHERE label = 'mid_group')
        AND superset_group_id = (SELECT g1 FROM _ids)
        AND sort_order = 2),
    'A4: insert between two same-group members inherits the group (Q3)'
  )
));

-- A5: after the group's LAST member (row below is solo) → stays solo.
INSERT INTO _new_pes
  SELECT 'boundary', public.insert_program_exercise_at(
    (SELECT day_1 FROM _ids), (SELECT ex_b FROM _ids),
    (SELECT pe1 FROM _ids), 'after'
  );

INSERT INTO _tap (n, line) VALUES (5, (
  SELECT ok(
    EXISTS (SELECT 1 FROM program_exercises
      WHERE id = (SELECT id FROM _new_pes WHERE label = 'boundary')
        AND superset_group_id IS NULL),
    'A5: insert at a group boundary stays solo (Q3)'
  )
));

-- A6/A7: slot validation.
INSERT INTO _tap (n, line) VALUES (6, (
  SELECT throws_ok(
    format(
      'SELECT public.insert_program_exercise_at(%L::uuid, %L::uuid, NULL, %L)',
      (SELECT day_1 FROM _ids), (SELECT ex_a FROM _ids), 'after'
    ),
    '22023',
    NULL,
    'A6: p_slot=after without an anchor raises invalid_parameter_value'
  )
));

INSERT INTO _tap (n, line) VALUES (7, (
  SELECT throws_ok(
    format(
      'SELECT public.insert_program_exercise_at(%L::uuid, %L::uuid, %L::uuid, %L)',
      (SELECT day_1 FROM _ids), (SELECT ex_a FROM _ids),
      (SELECT pe0 FROM _ids), 'append'
    ),
    '22023',
    NULL,
    'A7: p_slot=append with an anchor raises invalid_parameter_value (caller-bug guard)'
  )
));


-- ----------------------------------------------------------------------------
-- §B. reorder_program_exercises — rewrite, group re-derivation, cleanup.
-- ----------------------------------------------------------------------------

-- B1: full rewrite follows the array (no moved card → no group changes).
SELECT public.reorder_program_exercises(
  (SELECT day_2 FROM _ids),
  ARRAY[
    (SELECT q1 FROM _ids), (SELECT q0 FROM _ids),
    (SELECT q3 FROM _ids), (SELECT q2 FROM _ids)
  ],
  NULL
);

INSERT INTO _tap (n, line) VALUES (8, (
  SELECT is(
    (SELECT array_agg(id ORDER BY sort_order) FROM program_exercises
      WHERE program_day_id = (SELECT day_2 FROM _ids) AND deleted_at IS NULL),
    ARRAY[
      (SELECT q1 FROM _ids), (SELECT q0 FROM _ids),
      (SELECT q3 FROM _ids), (SELECT q2 FROM _ids)
    ],
    'B1: sort_orders follow the ordered-ids array exactly'
  )
));

-- Restore canonical order for the group scenarios.
SELECT public.reorder_program_exercises(
  (SELECT day_2 FROM _ids),
  ARRAY[
    (SELECT q0 FROM _ids), (SELECT q1 FROM _ids),
    (SELECT q2 FROM _ids), (SELECT q3 FROM _ids)
  ],
  NULL
);

-- B2: drag q2 between the two g2 members → joins g2.
SELECT public.reorder_program_exercises(
  (SELECT day_2 FROM _ids),
  ARRAY[
    (SELECT q0 FROM _ids), (SELECT q2 FROM _ids),
    (SELECT q1 FROM _ids), (SELECT q3 FROM _ids)
  ],
  (SELECT q2 FROM _ids)
);

INSERT INTO _tap (n, line) VALUES (9, (
  SELECT is(
    (SELECT superset_group_id FROM program_exercises
      WHERE id = (SELECT q2 FROM _ids)),
    (SELECT g2 FROM _ids),
    'B2: card dragged between two group members joins the group (Q3)'
  )
));

-- B3: drag q2 back out (→ leaves group), then q1 out (→ q0 singleton
-- cleanup). Asserts all three end NULL except… q0 also nulls.
SELECT public.reorder_program_exercises(
  (SELECT day_2 FROM _ids),
  ARRAY[
    (SELECT q0 FROM _ids), (SELECT q1 FROM _ids),
    (SELECT q3 FROM _ids), (SELECT q2 FROM _ids)
  ],
  (SELECT q2 FROM _ids)
);
SELECT public.reorder_program_exercises(
  (SELECT day_2 FROM _ids),
  ARRAY[
    (SELECT q0 FROM _ids), (SELECT q3 FROM _ids),
    (SELECT q2 FROM _ids), (SELECT q1 FROM _ids)
  ],
  (SELECT q1 FROM _ids)
);

INSERT INTO _tap (n, line) VALUES (10, (
  SELECT ok(
    (SELECT superset_group_id FROM program_exercises WHERE id = (SELECT q2 FROM _ids)) IS NULL
    AND (SELECT superset_group_id FROM program_exercises WHERE id = (SELECT q1 FROM _ids)) IS NULL
    AND (SELECT superset_group_id FROM program_exercises WHERE id = (SELECT q0 FROM _ids)) IS NULL,
    'B3: dragged-out cards leave the group; the abandoned last member is singleton-cleaned'
  )
));

-- B4: array-count mismatch (subset) raises.
INSERT INTO _tap (n, line) VALUES (11, (
  SELECT throws_ok(
    format(
      'SELECT public.reorder_program_exercises(%L::uuid, ARRAY[%L::uuid, %L::uuid], NULL)',
      (SELECT day_2 FROM _ids), (SELECT q0 FROM _ids), (SELECT q1 FROM _ids)
    ),
    '22023',
    NULL,
    'B4: ordered-ids array that does not cover the day raises invalid_parameter_value'
  )
));


-- ----------------------------------------------------------------------------
-- §C. swap_program_exercise — soft-delete + replacement at the same slot
-- (Q1/Q2 sign-offs 2026-05-07), fresh fan-out from the new defaults.
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE _swap_slot ON COMMIT DROP AS
  SELECT sort_order FROM program_exercises
   WHERE id = (SELECT pe3 FROM _ids);
GRANT SELECT ON _swap_slot TO authenticated;

CREATE TEMP TABLE _swap_new (id uuid) ON COMMIT DROP;
GRANT INSERT, SELECT ON _swap_new TO authenticated;

INSERT INTO _swap_new
  SELECT public.swap_program_exercise(
    (SELECT pe3 FROM _ids),
    (SELECT ex_b FROM _ids)
  );

INSERT INTO _tap (n, line) VALUES (12, (
  SELECT ok(
    -- Old row is soft-deleted: invisible through the staff SELECT policy
    -- (which filters deleted_at IS NULL) — the same invisibility shape
    -- tests 05/06/20 use, since RLS hides the tombstone itself.
    NOT EXISTS (
      SELECT 1 FROM program_exercises
       WHERE id = (SELECT pe3 FROM _ids)
    )
    -- Replacement carries ex_b at pe3's exact slot, still solo.
    AND EXISTS (
      SELECT 1 FROM program_exercises
       WHERE id = (SELECT id FROM _swap_new)
         AND program_day_id = (SELECT day_1 FROM _ids)
         AND exercise_id = (SELECT ex_b FROM _ids)
         AND sort_order = (SELECT sort_order FROM _swap_slot)
         AND superset_group_id IS NULL
         AND deleted_at IS NULL
    )
    -- Fresh fan-out from ex_b's defaults (2 × reps 10), nothing else.
    AND (
      SELECT count(*) FROM program_exercise_sets
       WHERE program_exercise_id = (SELECT id FROM _swap_new)
         AND deleted_at IS NULL
    ) = 2
    AND (
      SELECT count(*) FROM program_exercise_sets
       WHERE program_exercise_id = (SELECT id FROM _swap_new)
         AND reps = '10'
         AND deleted_at IS NULL
    ) = 2,
    'C1: swap soft-deletes the old row, lands the replacement at the same slot, fans out the new defaults'
  )
));


-- ----------------------------------------------------------------------------
-- §F. Security.
-- ----------------------------------------------------------------------------
SELECT public._test_set_jwt(
  (SELECT staff_b FROM _ids), (SELECT org_b FROM _ids), 'staff'
);

INSERT INTO _tap (n, line) VALUES (13, (
  SELECT throws_ok(
    format(
      'SELECT public.insert_program_exercise_at(%L::uuid, %L::uuid, NULL, %L)',
      (SELECT day_1 FROM _ids), (SELECT ex_a FROM _ids), 'append'
    ),
    'P0002',
    NULL,
    'F1: cross-org staff cannot insert into another org''s day (not-in-your-org raise)'
  )
));

SELECT public._test_set_jwt(
  (SELECT client_user FROM _ids), (SELECT org_a FROM _ids), 'client'
);

INSERT INTO _tap (n, line) VALUES (14, (
  SELECT throws_ok(
    format(
      'SELECT public.reorder_program_exercises(%L::uuid, ARRAY[%L::uuid], NULL)',
      (SELECT day_2 FROM _ids), (SELECT q0 FROM _ids)
    ),
    '42501',
    'Unauthorized',
    'F2: client role cannot reorder'
  )
));


-- ----------------------------------------------------------------------------
-- Hand back to the test owner before final SELECT + ROLLBACK.
-- ----------------------------------------------------------------------------
RESET ROLE;

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
