-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), is(), finish() etc. resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 01_visibility_resolver
-- ============================================================================
-- Originally the data-layer half of brief §8 Test 1 — proving that a
-- per-EP override of client_portal_visibility could change resolver
-- output without a code deploy.
--
-- D.6 redesigned the visibility model. The per-EP visibility override
-- column on practice_test_settings was dropped (see migration
-- 20260501130000_d6_visibility_simplify, docs/decisions.md D-006). The
-- only configurable visibility surface is now the schema seed itself.
--
-- This test is rewritten to assert the new resolver semantics:
--   1. Schema-seeded visibility is the answer for schema test_ids.
--   2. Custom-test visibility is read from the metrics jsonb for
--      custom_-prefixed test_ids.
--   3. Unknown (test_id, metric_id) tuples fail closed → 'never'.
--
-- The override path no longer exists; the test no longer asserts it.
-- ============================================================================

BEGIN;

SELECT plan(5);

-- ----------------------------------------------------------------------------
-- Fixture: a fresh org. The resolver function takes organization_id as a
-- parameter and does not read the JWT.
-- ----------------------------------------------------------------------------
INSERT INTO organizations (id, name, slug)
VALUES (
  '00000000-0000-0000-0000-0000000000a1'::uuid,
  'Test Org — Visibility Resolver',
  'test-org-visibility-resolver'
);

-- ----------------------------------------------------------------------------
-- 1. Schema seed is the source of truth for schema test_ids.
-- ----------------------------------------------------------------------------
SELECT is(
  (SELECT client_portal_visibility::text
     FROM physical_markers_schema_seed
    WHERE test_id = 'pts_koos' AND metric_id = 'pain'),
  'on_publish',
  'Pre-condition: seeded schema default for pts_koos.pain is on_publish'
);

SELECT is(
  public.test_metric_visibility(
    '00000000-0000-0000-0000-0000000000a1'::uuid,
    'pts_koos',
    'pain'
  )::text,
  'on_publish',
  'Resolver returns the schema-seed value for a schema metric'
);

-- ----------------------------------------------------------------------------
-- 2. Tampa Scale is the only `never` left after D.6 — the hard wall stays.
-- ----------------------------------------------------------------------------
SELECT is(
  public.test_metric_visibility(
    '00000000-0000-0000-0000-0000000000a1'::uuid,
    'pts_tampa',
    'total_score'
  )::text,
  'never',
  'Resolver preserves the Tampa Scale never wall after D.6'
);

-- ----------------------------------------------------------------------------
-- 3. Custom test: visibility comes from the metrics jsonb, NOT from the
--    schema seed. The custom-test builder hardcodes 'on_publish' for new
--    metrics post-D.6, but the data layer still honours whatever value
--    is in the jsonb.
-- ----------------------------------------------------------------------------
INSERT INTO practice_custom_tests (
  organization_id,
  category_id,
  subcategory_id,
  test_id,
  name,
  metrics
) VALUES (
  '00000000-0000-0000-0000-0000000000a1'::uuid,
  'custom_isokinetic',
  'custom_isok_knee',
  'custom_d6_resolver_probe',
  'D.6 resolver probe',
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
    )
  )
);

SELECT is(
  public.test_metric_visibility(
    '00000000-0000-0000-0000-0000000000a1'::uuid,
    'custom_d6_resolver_probe',
    'peak_torque'
  )::text,
  'on_publish',
  'Resolver reads visibility from custom test metrics jsonb'
);

-- ----------------------------------------------------------------------------
-- 4. Fail-closed: unknown (test, metric) → 'never'.
-- ----------------------------------------------------------------------------
SELECT is(
  public.test_metric_visibility(
    '00000000-0000-0000-0000-0000000000a1'::uuid,
    'rom_does_not_exist',
    'imaginary_metric'
  )::text,
  'never',
  'Resolver fails closed (returns never) for unknown test+metric tuples'
);

SELECT * FROM finish();

ROLLBACK;
