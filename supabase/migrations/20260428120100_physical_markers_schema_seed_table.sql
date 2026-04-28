-- ============================================================================
-- 20260428120100_physical_markers_schema_seed_table
-- ============================================================================
-- Why: Per /docs/testing-module-schema.md §14 Q5, the visibility resolver
-- runs in Postgres (RLS context) and cannot read the schema JSON file
-- directly on Supabase managed. The seed table is the runtime artifact —
-- populated from data/physical_markers_schema_v1.1.json at migration time
-- and re-seeded on schema bumps.
--
-- The JSON file remains the editing source of truth. The seed table
-- mirrors it. The application-startup loader asserts the in-memory parse
-- of the file matches the seed table's schema_version and refuses to
-- start if they diverge.
--
-- This table is platform-wide (no organization_id) — the schema is the
-- same for every tenant. Per-EP overrides live in practice_test_settings.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- physical_markers_schema_version — single-row table tracking which
-- schema version has been seeded. Used by the app-startup consistency check.
-- ----------------------------------------------------------------------------
CREATE TABLE physical_markers_schema_version (
  id              smallint     PRIMARY KEY DEFAULT 1
                  CHECK (id = 1),                         -- enforce single row
  schema_version  text         NOT NULL CHECK (length(trim(schema_version)) BETWEEN 1 AND 30),
  seeded_at       timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE physical_markers_schema_version IS
  'Single-row table holding the schema version that has been seeded into physical_markers_schema_seed. App-startup loader compares this to the parsed JSON version and fails closed on mismatch.';


-- ----------------------------------------------------------------------------
-- physical_markers_schema_seed — flat per-metric materialisation of the
-- categories → subcategories → tests → metrics tree from the JSON.
--
-- Justified denormalisation: the resolver looks up exactly one row by
-- (test_id, metric_id) thousands of times. A relational tree with joins
-- would cost more for no gain.
-- ----------------------------------------------------------------------------
CREATE TABLE physical_markers_schema_seed (
  -- Identity (matches the JSON's nested shape)
  category_id                 text                          NOT NULL CHECK (length(trim(category_id)) BETWEEN 1 AND 80),
  category_name               text                          NOT NULL,
  category_display_order      int                           NOT NULL,

  subcategory_id              text                          NOT NULL CHECK (length(trim(subcategory_id)) BETWEEN 1 AND 80),
  subcategory_name            text                          NOT NULL,
  subcategory_display_order   int                           NOT NULL,
  subcategory_notes           text,

  test_id                     text                          NOT NULL CHECK (test_id ~ '^[a-z0-9_]{1,80}$'),
  test_name                   text                          NOT NULL,
  test_display_order          int                           NOT NULL,
  test_notes                  text,

  metric_id                   text                          NOT NULL CHECK (metric_id ~ '^[a-z0-9_]{1,80}$'),
  metric_label                text                          NOT NULL,

  -- Measurement attributes
  unit                        text                          NOT NULL,
  input_type                  text                          NOT NULL CHECK (input_type IN ('decimal','integer','text','file')),
  side_left_right             boolean                       NOT NULL,                  -- true = bilateral metric

  -- Rendering hints (factory defaults — overrides live in practice_test_settings)
  direction_of_good           direction_of_good_t           NOT NULL,
  default_chart               default_chart_t               NOT NULL,
  comparison_mode             comparison_mode_t             NOT NULL,
  client_portal_visibility    client_portal_visibility_t    NOT NULL,
  client_view_chart           client_view_chart_t           NOT NULL,

  PRIMARY KEY (test_id, metric_id)
);

-- Lookup-by-test for the capture modal accordion (category → subcategory → test).
CREATE INDEX physical_markers_schema_seed_test_idx
  ON physical_markers_schema_seed (test_id);

-- Browse by category (settings UI list view).
CREATE INDEX physical_markers_schema_seed_browse_idx
  ON physical_markers_schema_seed (
    category_display_order,
    subcategory_display_order,
    test_display_order,
    metric_id
  );

COMMENT ON TABLE physical_markers_schema_seed IS
  'Flat per-metric materialisation of data/physical_markers_schema_v1.1.json. The runtime resolver reads this; nothing else does. Re-seeded on schema version bumps.';


-- ----------------------------------------------------------------------------
-- RLS — staff-only read; deny all writes from authenticated. Service role
-- (used by the seed migration) bypasses RLS via BYPASSRLS, so the seed
-- INSERT works without an explicit policy.
-- ----------------------------------------------------------------------------
ALTER TABLE physical_markers_schema_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE physical_markers_schema_version FORCE  ROW LEVEL SECURITY;
ALTER TABLE physical_markers_schema_seed    ENABLE ROW LEVEL SECURITY;
ALTER TABLE physical_markers_schema_seed    FORCE  ROW LEVEL SECURITY;

-- Authenticated users (staff and clients) can SELECT the schema. It contains
-- no PHI — just metric metadata. The visibility for clients is enforced
-- downstream on test_results, not here.
CREATE POLICY "select physical_markers_schema_seed"
  ON physical_markers_schema_seed FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "deny insert physical_markers_schema_seed"
  ON physical_markers_schema_seed FOR INSERT TO authenticated WITH CHECK (false);

CREATE POLICY "deny update physical_markers_schema_seed"
  ON physical_markers_schema_seed FOR UPDATE TO authenticated USING (false);

CREATE POLICY "deny delete physical_markers_schema_seed"
  ON physical_markers_schema_seed FOR DELETE TO authenticated USING (false);

CREATE POLICY "select physical_markers_schema_version"
  ON physical_markers_schema_version FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "deny insert physical_markers_schema_version"
  ON physical_markers_schema_version FOR INSERT TO authenticated WITH CHECK (false);

CREATE POLICY "deny update physical_markers_schema_version"
  ON physical_markers_schema_version FOR UPDATE TO authenticated USING (false);

CREATE POLICY "deny delete physical_markers_schema_version"
  ON physical_markers_schema_version FOR DELETE TO authenticated USING (false);
