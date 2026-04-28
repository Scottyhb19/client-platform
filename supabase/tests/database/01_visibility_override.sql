-- ============================================================================
-- 01_visibility_override
-- ============================================================================
-- Maps to brief §8 Test 1 — "Schema-driven rendering."
--
-- This is the data-layer proof that an EP can change a metric's
-- client_portal_visibility via practice_test_settings without a code
-- deploy, and reset it back to the schema default by deleting the
-- override row.
--
-- The full UI-level test (set via the settings UI, see chart paint
-- change in the staff Reports tab) is covered by a Playwright test
-- in Phase D. This pgTAP test isolates the resolver behaviour.
-- ============================================================================

BEGIN;

SELECT plan(4);

-- ----------------------------------------------------------------------------
-- Fixture: a fresh org. We don't need users for this test — the resolver
-- function takes organization_id as a parameter and does not read the JWT.
-- ----------------------------------------------------------------------------
INSERT INTO organizations (id, name, slug)
VALUES (
  '00000000-0000-0000-0000-0000000000a1'::uuid,
  'Test Org — Visibility Override',
  'test-org-visibility-override'
);

-- ----------------------------------------------------------------------------
-- Pre-condition: the seeded schema default for pts_koos.pain is
-- 'on_publish'. Sanity-check it before we override.
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
  'Resolver returns schema default when no override exists'
);

-- ----------------------------------------------------------------------------
-- Apply an override: visibility = 'auto'.
-- ----------------------------------------------------------------------------
INSERT INTO practice_test_settings (
  organization_id, test_id, metric_id, client_portal_visibility
) VALUES (
  '00000000-0000-0000-0000-0000000000a1'::uuid,
  'pts_koos',
  'pain',
  'auto'::client_portal_visibility_t
);

SELECT is(
  public.test_metric_visibility(
    '00000000-0000-0000-0000-0000000000a1'::uuid,
    'pts_koos',
    'pain'
  )::text,
  'auto',
  'Resolver returns override when one exists'
);

-- ----------------------------------------------------------------------------
-- "Reset to default": delete the override row.
-- ----------------------------------------------------------------------------
DELETE FROM practice_test_settings
 WHERE organization_id = '00000000-0000-0000-0000-0000000000a1'::uuid
   AND test_id = 'pts_koos'
   AND metric_id = 'pain';

SELECT is(
  public.test_metric_visibility(
    '00000000-0000-0000-0000-0000000000a1'::uuid,
    'pts_koos',
    'pain'
  )::text,
  'on_publish',
  'Resolver falls back to schema default after override is deleted'
);

SELECT * FROM finish();

ROLLBACK;
