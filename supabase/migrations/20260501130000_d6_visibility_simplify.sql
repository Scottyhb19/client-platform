-- ============================================================================
-- 20260501130000_d6_visibility_simplify
-- ============================================================================
-- Why: D.6 visibility-model simplification (see docs/decisions.md D-006).
--
-- The brief originally exposed three values for client_portal_visibility:
--   auto       — client always sees it (no publication needed)
--   on_publish — client only sees it when an EP publishes
--   never      — client never sees it
--
-- D.6 collapses the user-facing model. Every test card on the staff Reports
-- tab gets a Publish button so the EP curates exactly what reaches the
-- client. The `auto` value is no longer used by any seeded metric, and
-- per-EP overrides for visibility are gone — the schema default is the
-- only source of truth.
--
-- The `never` value remains for a single clinical-safety case (Tampa Scale
-- kinesiophobia score). Two metrics that were `never` for "no client view"
-- reasons (NordBord force_angle_curve, body composition height) flip to
-- `on_publish` with `client_view_chart = narrative_only` so the EP's
-- framing reaches the client.
--
-- This migration:
--   1. Re-seeds physical_markers_schema_seed to match the new JSON.
--      (For an existing DB; for a fresh setup the regenerated seed
--      migration 20260428121000 already carries the new values.)
--   2. Drops practice_test_settings.client_portal_visibility — the
--      override path is gone; the resolver reads schema or custom only.
--   3. Recreates test_metric_visibility() without the override step.
--      Resolution is now: custom (for custom_ test_ids) → schema → never.
--
-- Pre-launch advantage applies — no production overrides on the dropped
-- column, so DROP COLUMN is safe.
--
-- The enum value `auto` is intentionally left in client_portal_visibility_t.
-- Postgres does not support ALTER TYPE … DROP VALUE; recreating the enum
-- is high-risk for a cosmetic gain. No metric uses `auto` post-D.6, so the
-- value is dead but harmless.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Re-seed: bring the schema_seed table in line with the updated JSON.
--    These UPDATEs are no-ops on a fresh DB (where the regenerated
--    20260428121000 already wrote the new values), but they're required
--    for an existing DB whose seed table was populated before D.6.
-- ----------------------------------------------------------------------------
UPDATE physical_markers_schema_seed
   SET client_portal_visibility = 'on_publish'::client_portal_visibility_t
 WHERE client_portal_visibility = 'auto'::client_portal_visibility_t;

UPDATE physical_markers_schema_seed
   SET client_portal_visibility = 'on_publish'::client_portal_visibility_t,
       client_view_chart        = 'narrative_only'::client_view_chart_t
 WHERE test_id   = 'dyn_nordic'
   AND metric_id = 'force_angle_curve';

UPDATE physical_markers_schema_seed
   SET client_portal_visibility = 'on_publish'::client_portal_visibility_t,
       client_view_chart        = 'narrative_only'::client_view_chart_t
 WHERE test_id   = 'bc_anthro'
   AND metric_id = 'height';


-- ----------------------------------------------------------------------------
-- 2. Drop the per-EP visibility override. The Settings → Tests override
--    editor no longer surfaces this field; the column has no callers
--    after the resolver rewrite below.
-- ----------------------------------------------------------------------------
ALTER TABLE practice_test_settings
  DROP COLUMN client_portal_visibility;


-- ----------------------------------------------------------------------------
-- 3. Recreate test_metric_visibility() without the override step.
--
--    Resolution order (post-D.6):
--      1. Custom test in practice_custom_tests?
--         → read visibility from the metrics jsonb.
--      2. Schema seed in physical_markers_schema_seed?
--         → use the schema default.
--      3. Nothing matches?
--         → return 'never' (fail-closed).
--
--    STABLE / SECURITY DEFINER preserved from the original.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.test_metric_visibility(uuid, text, text);

CREATE OR REPLACE FUNCTION public.test_metric_visibility(
  p_organization_id uuid,
  p_test_id         text,
  p_metric_id       text
) RETURNS client_portal_visibility_t
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  custom_visibility   client_portal_visibility_t;
  schema_visibility   client_portal_visibility_t;
  metric_obj          jsonb;
BEGIN
  -- 1. Custom test? Read visibility from the metrics jsonb.
  IF p_test_id LIKE 'custom_%' THEN
    SELECT m
      INTO metric_obj
      FROM practice_custom_tests pct,
           jsonb_array_elements(pct.metrics) AS m
     WHERE pct.organization_id = p_organization_id
       AND pct.test_id          = p_test_id
       AND pct.deleted_at       IS NULL
       AND (m ->> 'id')         = p_metric_id
     LIMIT 1;

    IF metric_obj IS NOT NULL THEN
      BEGIN
        custom_visibility := (metric_obj ->> 'client_portal_visibility')::client_portal_visibility_t;
      EXCEPTION WHEN invalid_text_representation THEN
        custom_visibility := NULL;
      END;
      IF custom_visibility IS NOT NULL THEN
        RETURN custom_visibility;
      END IF;
    END IF;
  END IF;

  -- 2. Schema default.
  SELECT pmss.client_portal_visibility
    INTO schema_visibility
    FROM physical_markers_schema_seed pmss
   WHERE pmss.test_id   = p_test_id
     AND pmss.metric_id = p_metric_id;

  IF schema_visibility IS NOT NULL THEN
    RETURN schema_visibility;
  END IF;

  -- 3. Fail closed. An unknown metric is never client-visible.
  RETURN 'never'::client_portal_visibility_t;
END;
$$;

COMMENT ON FUNCTION public.test_metric_visibility(uuid, text, text) IS
  'Resolves client_portal_visibility for an (org, test, metric) tuple via custom → schema → never. Used by test_results RLS to enforce the never hard wall. Per-EP override path was removed in D.6 — the schema seed is the only configurable source.';

REVOKE EXECUTE ON FUNCTION public.test_metric_visibility(uuid, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.test_metric_visibility(uuid, text, text) TO authenticated;
