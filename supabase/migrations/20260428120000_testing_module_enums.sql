-- ============================================================================
-- 20260428120000_testing_module_enums
-- ============================================================================
-- Why: Seven enums for the structured testing module. Each mirrors the
-- legend in data/physical_markers_schema_v1.1.json's `rendering_hints`
-- section verbatim, so the database, the schema JSON, and the resolver
-- speak the same vocabulary.
--
-- Adding values via `ALTER TYPE … ADD VALUE` is cheap. Removing values
-- requires a type swap + backfill — only do that during a planned schema
-- bump. See /docs/testing-module-schema.md §11.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- direction_of_good — does a higher value mean a better outcome?
-- ----------------------------------------------------------------------------
CREATE TYPE direction_of_good_t AS ENUM (
  'higher',
  'lower',
  'target_range',
  'context_dependent'
);

COMMENT ON TYPE direction_of_good_t IS
  'Whether higher / lower / in-range is the desired outcome for a metric. context_dependent renders neutral grey until per-client context is set.';


-- ----------------------------------------------------------------------------
-- default_chart — clinician-facing chart type
-- ----------------------------------------------------------------------------
CREATE TYPE default_chart_t AS ENUM (
  'line',
  'bar',
  'radar',
  'asymmetry_bar',
  'target_zone'
);

COMMENT ON TYPE default_chart_t IS
  'Chart type used in the staff Reports tab. asymmetry_bar is the default for bilateral metrics with bilateral_lsi comparison.';


-- ----------------------------------------------------------------------------
-- comparison_mode — what the chart compares against
-- ----------------------------------------------------------------------------
CREATE TYPE comparison_mode_t AS ENUM (
  'absolute',
  'bilateral_lsi',
  'vs_baseline',
  'vs_normative'
);

COMMENT ON TYPE comparison_mode_t IS
  'Comparison context. bilateral_lsi = (involved/uninvolved) × 100. vs_baseline = first session for this client+test. vs_normative = age-matched population norms.';


-- ----------------------------------------------------------------------------
-- client_portal_visibility — three-state gate for the client portal
-- ----------------------------------------------------------------------------
CREATE TYPE client_portal_visibility_t AS ENUM (
  'auto',
  'on_publish',
  'never'
);

COMMENT ON TYPE client_portal_visibility_t IS
  'Whether and when a result becomes client-visible. never is a hard wall enforced at the RLS layer (see test_metric_visibility() and the test_results SELECT policy). The Tampa Scale total score is the canonical never metric.';


-- ----------------------------------------------------------------------------
-- client_view_chart — what the client sees, distinct from staff chart
-- ----------------------------------------------------------------------------
CREATE TYPE client_view_chart_t AS ENUM (
  'line',
  'milestone',
  'bar',
  'narrative_only',
  'hidden'
);

COMMENT ON TYPE client_view_chart_t IS
  'Client-portal chart type. milestone = baseline → latest with delta only (no noisy middle data). narrative_only = clinician framing text, no chart. hidden = never rendered (paired with client_portal_visibility=never).';


-- ----------------------------------------------------------------------------
-- test_source — where a test session originated
-- ----------------------------------------------------------------------------
CREATE TYPE test_source_t AS ENUM (
  'manual',
  'vald',
  'imported'
);

COMMENT ON TYPE test_source_t IS
  'Origin of a test session. manual = entered through capture modal. vald = future VALD CSV/XML importer (Phase 3). imported = generic bulk upload.';


-- ----------------------------------------------------------------------------
-- test_side — which side of the body a result is for
-- The column itself is nullable; NULL means a non-bilateral measurement.
-- ----------------------------------------------------------------------------
CREATE TYPE test_side_t AS ENUM (
  'left',
  'right'
);

COMMENT ON TYPE test_side_t IS
  'Side of the body for a bilateral measurement. NULL on the column means the measurement is not bilateral (e.g. bilateral CMJ jump height, body mass).';
