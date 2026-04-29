-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), is(), finish() etc. resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 07_phase_c_settings_round_trip
-- ============================================================================
-- Closes the data-layer halves of brief §8 Tests 6 and 7 — the parts
-- that the Settings → Tests UI in Phase C is responsible for.
--
-- Test 1 (schema-driven rendering, override → resolver → reset) is
-- already covered by 01_visibility_override.sql. The chart-paint-colour
-- half of Test 1 is gated on Phase D's reports rendering and lives in
-- the manual UI checklist (docs/polish/testing-module.md §8).
--
-- Section A — Custom test (Test 6 data half)
--   Asserts INSERT into practice_custom_tests round-trips through the
--   metrics jsonb intact, and that soft_delete_practice_custom_test
--   removes the row from the active (deleted_at IS NULL) view.
--
-- Section B — Disable schema test + past-results-queryable (Test 6 data half)
--   Asserts INSERT into practice_disabled_tests, that disabling does NOT
--   affect existing test_results rows referencing the disabled test_id
--   ("past results remain queryable" per brief §3.3), and that DELETE
--   re-enables.
--
-- Section C — Battery round-trip (Test 7 data half)
--   Asserts INSERT of a test_batteries row whose metric_keys array spans
--   8 metrics across 3 distinct test_ids (cross-category, per Q3 sign-
--   off) round-trips intact, and that soft_delete_test_battery removes
--   the row from the active view.
--
-- All sections run as the staff user via the spoofed-JWT pattern from
-- test 04 (the canonical reference for SECURITY INVOKER + RLS-respecting
-- inserts in pgTAP).
-- ============================================================================

BEGIN;

SELECT plan(14);


-- ----------------------------------------------------------------------------
-- Fixture
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  org_id        uuid := '00000000-0000-0000-0000-0000000000e1'::uuid;
  staff_uid     uuid;
  client_row_id uuid := '00000000-0000-0000-0000-0000000000e2'::uuid;
  custom_id     uuid;
  battery_id    uuid;
  session_id    uuid;
  result_id     uuid;
BEGIN
  INSERT INTO organizations (id, name, slug)
  VALUES (org_id, 'Test Org — Phase C round trip', 'test-org-phase-c-round-trip');

  staff_uid := public._test_make_user('staff-phase-c@test.local');
  PERFORM public._test_grant_membership(staff_uid, org_id, 'staff'::user_role);

  INSERT INTO clients (
    id, organization_id, first_name, last_name, email
  ) VALUES (
    client_row_id, org_id, 'Carla', 'Custom', 'carla@test.local'
  );

  -- Spoof the staff JWT so subsequent INSERTs against RLS-protected
  -- tables go through as authenticated staff (same posture as 04).
  PERFORM public._test_set_jwt(staff_uid, org_id, 'staff');
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- ------------------------------------------------------------------------
  -- Section A fixture: insert a custom test
  -- ------------------------------------------------------------------------
  INSERT INTO practice_custom_tests (
    organization_id, category_id, subcategory_id, test_id, name,
    display_order, metrics
  ) VALUES (
    org_id,
    'custom_isokinetic',
    'custom_isok_knee',
    'custom_my_isokinetic',
    'My isokinetic',
    0,
    jsonb_build_array(
      jsonb_build_object(
        'id', 'peak_torque',
        'label', 'Peak torque',
        'unit', 'Nm',
        'input_type', 'decimal',
        'side', jsonb_build_array('left', 'right'),
        'direction_of_good', 'higher',
        'default_chart', 'asymmetry_bar',
        'comparison_mode', 'bilateral_lsi',
        'client_portal_visibility', 'on_publish',
        'client_view_chart', 'milestone'
      ),
      jsonb_build_object(
        'id', 'h_q_ratio',
        'label', 'H/Q ratio',
        'unit', 'ratio',
        'input_type', 'decimal',
        'side', NULL,
        'direction_of_good', 'higher',
        'default_chart', 'line',
        'comparison_mode', 'vs_baseline',
        'client_portal_visibility', 'never',
        'client_view_chart', 'hidden'
      )
    )
  ) RETURNING id INTO custom_id;

  -- ------------------------------------------------------------------------
  -- Section B fixture: a session + result against a schema test, then
  -- disable that test. Past-results-queryable is asserted later.
  -- ------------------------------------------------------------------------
  session_id := public.create_test_session(
    client_row_id,
    now() - interval '1 hour',
    'manual'::test_source_t,
    NULL::uuid, NULL::text, NULL::uuid,
    jsonb_build_array(jsonb_build_object(
      'test_id',   'rom_hip_flexion',
      'metric_id', 'passive',
      'side',      'left',
      'value',     108,
      'unit',      'deg'
    ))
  );

  SELECT id INTO result_id
    FROM test_results
   WHERE test_session_id = session_id
   LIMIT 1;

  INSERT INTO practice_disabled_tests (organization_id, test_id)
  VALUES (org_id, 'rom_hip_flexion');

  -- ------------------------------------------------------------------------
  -- Section C fixture: battery with 8 metrics across 3 test_ids
  -- (cross-category mix: ROM hip flexion, ROM hip IR/ER, KOOS).
  -- ------------------------------------------------------------------------
  INSERT INTO test_batteries (
    organization_id, name, description, is_active, metric_keys
  ) VALUES (
    org_id,
    'Phase C round-trip battery',
    'Cross-category 8-metric battery for the Test 7 data round-trip',
    true,
    jsonb_build_array(
      jsonb_build_object('test_id', 'rom_hip_flexion', 'metric_id', 'passive',    'side', NULL),
      jsonb_build_object('test_id', 'rom_hip_flexion', 'metric_id', 'active',     'side', NULL),
      jsonb_build_object('test_id', 'rom_hip_ir_er',   'metric_id', 'ir_supine',  'side', NULL),
      jsonb_build_object('test_id', 'rom_hip_ir_er',   'metric_id', 'er_supine',  'side', NULL),
      jsonb_build_object('test_id', 'rom_hip_ir_er',   'metric_id', 'ir_prone',   'side', NULL),
      jsonb_build_object('test_id', 'rom_hip_ir_er',   'metric_id', 'er_prone',   'side', NULL),
      jsonb_build_object('test_id', 'pts_koos',        'metric_id', 'pain',       'side', NULL),
      jsonb_build_object('test_id', 'pts_koos',        'metric_id', 'symptoms',   'side', NULL)
    )
  ) RETURNING id INTO battery_id;

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_id        AS org_id,
    staff_uid     AS staff_uid,
    client_row_id AS client_row_id,
    custom_id     AS custom_id,
    battery_id    AS battery_id,
    session_id    AS session_id,
    result_id     AS result_id;
  GRANT SELECT ON _ids TO authenticated;
END $$;


-- Re-spoof the staff JWT for the assertion phase (the DO block's
-- SET LOCAL ROLE doesn't carry across — same dance as test 03/04).
SELECT public._test_set_jwt(
  (SELECT staff_uid FROM _ids),
  (SELECT org_id    FROM _ids),
  'staff'
);
SET LOCAL ROLE authenticated;


-- ============================================================================
-- Section A — Custom test round trip
-- ============================================================================

-- A.1: Custom test row exists with the inserted shape.
SELECT is(
  (SELECT name FROM practice_custom_tests
    WHERE id = (SELECT custom_id FROM _ids)),
  'My isokinetic',
  'A.1: practice_custom_tests row round-trips name'
);

-- A.2: metrics jsonb preserves the metric count and core ids.
SELECT is(
  (SELECT jsonb_array_length(metrics) FROM practice_custom_tests
    WHERE id = (SELECT custom_id FROM _ids)),
  2,
  'A.2: metrics jsonb preserves the 2-metric array length'
);

SELECT is(
  (SELECT (metrics -> 0 ->> 'id') FROM practice_custom_tests
    WHERE id = (SELECT custom_id FROM _ids)),
  'peak_torque',
  'A.2.b: first metric id round-trips through jsonb'
);

SELECT is(
  (SELECT (metrics -> 0 ->> 'direction_of_good') FROM practice_custom_tests
    WHERE id = (SELECT custom_id FROM _ids)),
  'higher',
  'A.2.c: rendering-hint values round-trip through jsonb'
);

-- A.3: After soft_delete_practice_custom_test RPC, the row no longer
-- appears in the active view (deleted_at IS NULL).
SELECT public.soft_delete_practice_custom_test((SELECT custom_id FROM _ids));

SELECT is(
  (SELECT count(*)::int FROM practice_custom_tests
    WHERE id = (SELECT custom_id FROM _ids)
      AND deleted_at IS NULL),
  0,
  'A.3: soft_delete_practice_custom_test removes the row from the active view'
);


-- ============================================================================
-- Section B — Disable test + past-results-queryable
-- ============================================================================

-- B.1: practice_disabled_tests row exists for the schema test.
SELECT is(
  (SELECT count(*)::int FROM practice_disabled_tests
    WHERE organization_id = (SELECT org_id FROM _ids)
      AND test_id = 'rom_hip_flexion'),
  1,
  'B.1: practice_disabled_tests row exists after disable'
);

-- B.2: The pre-disable test_result is still SELECTable. This is the
-- "past results remain queryable" half of brief §3.3.
SELECT is(
  (SELECT count(*)::int FROM test_results
    WHERE id = (SELECT result_id FROM _ids)
      AND deleted_at IS NULL),
  1,
  'B.2: pre-existing test_result for the disabled test stays queryable'
);

-- B.3: The session's value is unchanged.
SELECT is(
  (SELECT value FROM test_results
    WHERE id = (SELECT result_id FROM _ids)),
  108::numeric,
  'B.3: pre-existing test_result value is unchanged after disable'
);

-- B.4: DELETE the practice_disabled_tests row to re-enable.
DELETE FROM practice_disabled_tests
 WHERE organization_id = (SELECT org_id FROM _ids)
   AND test_id = 'rom_hip_flexion';

SELECT is(
  (SELECT count(*)::int FROM practice_disabled_tests
    WHERE organization_id = (SELECT org_id FROM _ids)
      AND test_id = 'rom_hip_flexion'),
  0,
  'B.4: practice_disabled_tests row removed → test re-enabled'
);


-- ============================================================================
-- Section C — Battery round trip
-- ============================================================================

-- C.1: Battery row exists with the right name.
SELECT is(
  (SELECT name FROM test_batteries
    WHERE id = (SELECT battery_id FROM _ids)),
  'Phase C round-trip battery',
  'C.1: test_batteries row round-trips name'
);

-- C.2: metric_keys array length is 8 (cross-category, 3 test_ids).
SELECT is(
  (SELECT jsonb_array_length(metric_keys) FROM test_batteries
    WHERE id = (SELECT battery_id FROM _ids)),
  8,
  'C.2: metric_keys preserves the 8-metric array length'
);

-- C.3: Distinct test_ids inside metric_keys = 3 (rom_hip_flexion,
-- rom_hip_ir_er, pts_koos). Confirms cross-category structure.
SELECT is(
  (SELECT count(DISTINCT (k ->> 'test_id'))::int
     FROM test_batteries tb,
          jsonb_array_elements(tb.metric_keys) k
    WHERE tb.id = (SELECT battery_id FROM _ids)),
  3,
  'C.3: metric_keys spans 3 distinct test_ids (cross-category)'
);

-- C.4: A specific metric_id round-trips through jsonb intact.
SELECT is(
  (SELECT count(*)::int
     FROM test_batteries tb,
          jsonb_array_elements(tb.metric_keys) k
    WHERE tb.id = (SELECT battery_id FROM _ids)
      AND k ->> 'test_id'   = 'pts_koos'
      AND k ->> 'metric_id' = 'pain'),
  1,
  'C.4: a specific metric_key (pts_koos.pain) is preserved'
);

-- C.5: After soft_delete_test_battery, the row no longer appears in the
-- active (deleted_at IS NULL) view.
SELECT public.soft_delete_test_battery((SELECT battery_id FROM _ids));

SELECT is(
  (SELECT count(*)::int FROM test_batteries
    WHERE id = (SELECT battery_id FROM _ids)
      AND deleted_at IS NULL),
  0,
  'C.5: soft_delete_test_battery removes the battery from the active view'
);


SELECT * FROM finish();

ROLLBACK;
