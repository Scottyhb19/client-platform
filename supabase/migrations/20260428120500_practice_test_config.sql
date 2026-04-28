-- ============================================================================
-- 20260428120500_practice_test_config
-- ============================================================================
-- Why: Four tables that together hold every per-EP customisation of the
-- testing module — overrides, disable flags, custom tests, and saved
-- batteries. None of these are clinical data; all are settings. Per the
-- existing convention (schema.md §11.2) settings tables are NOT audited
-- via triggers — application logs cover.
--
-- Per /docs/testing-module-schema.md §14 Q1 (signed off): we use TWO
-- tables for overrides + disable, not one with `enabled` lumped onto the
-- per-metric override row. Cleaner schema, cleaner UI.
--
-- See /docs/testing-module-schema.md §4.3 – §4.6 for per-table rationale.
-- ============================================================================


-- ============================================================================
-- §1. practice_test_settings — per-(org, test, metric) rendering overrides
--
-- All five override columns are nullable. NULL = use the schema default.
-- A row exists when ANY field has been overridden; the resolver falls
-- through to the schema for the rest.
--
-- No soft-delete — clicking "Reset to default" deletes the row.
-- No version column — concurrent edits unlikely; last-write-wins is fine.
-- ============================================================================
CREATE TABLE practice_test_settings (
  id                          uuid                         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid                         NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  test_id                     text                         NOT NULL CHECK (test_id ~ '^[a-z0-9_]{1,80}$'),
  metric_id                   text                         NOT NULL CHECK (metric_id ~ '^[a-z0-9_]{1,80}$'),
  direction_of_good           direction_of_good_t,
  default_chart               default_chart_t,
  comparison_mode             comparison_mode_t,
  client_portal_visibility    client_portal_visibility_t,
  client_view_chart           client_view_chart_t,
  created_at                  timestamptz                  NOT NULL DEFAULT now(),
  updated_at                  timestamptz                  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX practice_test_settings_org_test_metric_unique
  ON practice_test_settings (organization_id, test_id, metric_id);

CREATE TRIGGER practice_test_settings_touch_updated_at
  BEFORE UPDATE ON practice_test_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE practice_test_settings IS
  'Per-(org, test, metric) override of rendering hints. NULL fields fall through to the schema default. The resolver test_metric_visibility() and the app-side resolveMetricSettings() read this for overrides.';


-- ============================================================================
-- §2. practice_disabled_tests — per-(org, test) hide flag
--
-- Existence row = test is disabled in this org's capture flows. Re-enable
-- by deleting the row. Past results for disabled tests remain queryable
-- (this table only affects what shows up in capture/template UIs).
-- ============================================================================
CREATE TABLE practice_disabled_tests (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid          NOT NULL REFERENCES organizations(id)        ON DELETE RESTRICT,
  test_id           text          NOT NULL CHECK (test_id ~ '^[a-z0-9_]{1,80}$'),
  disabled_by       uuid          REFERENCES user_profiles(user_id)            ON DELETE SET NULL,
  disabled_at       timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX practice_disabled_tests_org_test_unique
  ON practice_disabled_tests (organization_id, test_id);

COMMENT ON TABLE practice_disabled_tests IS
  'Existence row = the test is disabled in this org. Past results remain queryable; only forward capture is hidden. Per brief §3.3.';


-- ============================================================================
-- §3. practice_custom_tests — tests added by the EP, not in the schema
--
-- The metrics jsonb column matches the schema JSON's per-metric shape:
--   [{ "id": "peak_force",
--      "label": "Peak force",
--      "unit": "N",
--      "input_type": "decimal",
--      "side": ["left","right"]    -- or null
--      "direction_of_good": "higher",
--      "default_chart": "asymmetry_bar",
--      "comparison_mode": "bilateral_lsi",
--      "client_portal_visibility": "auto",
--      "client_view_chart": "milestone" }, ...]
-- App-layer validation against the shape; not enforced in DB.
-- Justified jsonb (see /docs/testing-module-schema.md §10).
--
-- The custom_ prefix on test_id is enforced by CHECK so custom IDs are
-- disjoint from schema IDs at the data layer.
-- ============================================================================
CREATE TABLE practice_custom_tests (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid          NOT NULL REFERENCES organizations(id)        ON DELETE RESTRICT,
  category_id       text          NOT NULL CHECK (length(trim(category_id)) BETWEEN 1 AND 80),
  subcategory_id    text          NOT NULL CHECK (length(trim(subcategory_id)) BETWEEN 1 AND 80),
  test_id           text          NOT NULL CHECK (test_id ~ '^custom_[a-z0-9_]{1,73}$'),
  name              text          NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  metrics           jsonb         NOT NULL,
  display_order     int           NOT NULL DEFAULT 0,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CONSTRAINT practice_custom_tests_metrics_shape CHECK (
    jsonb_typeof(metrics) = 'array'
    AND jsonb_array_length(metrics) BETWEEN 1 AND 30
  )
);

CREATE UNIQUE INDEX practice_custom_tests_org_test_unique
  ON practice_custom_tests (organization_id, test_id)
  WHERE deleted_at IS NULL;

CREATE INDEX practice_custom_tests_org_browse_idx
  ON practice_custom_tests (organization_id, category_id, subcategory_id, display_order)
  WHERE deleted_at IS NULL;

CREATE TRIGGER practice_custom_tests_touch_updated_at
  BEFORE UPDATE ON practice_custom_tests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE practice_custom_tests IS
  'EP-added tests not in data/physical_markers_schema_v1.1.json. test_id is enforced to start with "custom_" so IDs are disjoint from schema IDs.';
COMMENT ON COLUMN practice_custom_tests.metrics IS
  'Array of metric objects matching the schema''s per-metric shape. App-layer validated. See /docs/testing-module-schema.md §10 for jsonb justification.';


-- ============================================================================
-- §4. test_batteries — saved one-click sets of metric keys
--
-- metric_keys jsonb holds an array of { test_id, metric_id, side? } —
-- read/written whole, never queried per-element. Justified jsonb.
--
-- is_active is distinct from deleted_at: pause a battery without losing
-- it. Both flags filter it out of capture-modal pickers.
-- ============================================================================
CREATE TABLE test_batteries (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid          NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name              text          NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  description       text,
  is_active         boolean       NOT NULL DEFAULT true,
  metric_keys       jsonb         NOT NULL,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CONSTRAINT test_batteries_metric_keys_shape CHECK (
    jsonb_typeof(metric_keys) = 'array'
    AND jsonb_array_length(metric_keys) BETWEEN 1 AND 100
  )
);

CREATE UNIQUE INDEX test_batteries_org_name_unique
  ON test_batteries (organization_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE INDEX test_batteries_org_active_idx
  ON test_batteries (organization_id)
  WHERE deleted_at IS NULL
    AND is_active = true;

CREATE TRIGGER test_batteries_touch_updated_at
  BEFORE UPDATE ON test_batteries
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE test_batteries IS
  'Named one-click sets of (test_id, metric_id, side?) keys. Applied in note templates and the capture modal. is_active is a soft toggle distinct from deleted_at — pause without losing.';
COMMENT ON COLUMN test_batteries.metric_keys IS
  'Array of {test_id, metric_id, side?} objects. Read/written whole. See /docs/testing-module-schema.md §10 for jsonb justification.';
