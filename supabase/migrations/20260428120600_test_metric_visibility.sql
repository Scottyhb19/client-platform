-- ============================================================================
-- 20260428120600_test_metric_visibility
-- ============================================================================
-- Why: The visibility resolver. This function is the load-bearing security
-- control for the brief's `never`-visibility hard wall (Test 4). It is
-- called from RLS policies on test_results to decide whether a row is
-- ever returnable to a client.
--
-- Resolution order (per /docs/testing-module-schema.md §6.2 and §14 Q5):
--   1. Override in practice_test_settings for (org, test_id, metric_id)?
--      → use override.
--   2. Custom test in practice_custom_tests?
--      → read visibility from the metrics jsonb.
--   3. Schema seed in physical_markers_schema_seed?
--      → use the schema default.
--   4. Nothing matches?
--      → return 'never' (fail-closed).
--
-- The function takes organization_id explicitly because RLS policies
-- evaluate it without an obvious tenant context — and because making
-- this depend on JWT claims would prevent the staff resolver from
-- answering "what would client X see for metric Y?" at the resolver
-- layer.
--
-- STABLE because the answer doesn't change within a transaction (settings
-- changes commit before they're visible to the next query). SECURITY
-- DEFINER so the function can read settings tables that the calling role
-- might not have direct access to (e.g. when called from a client's RLS
-- evaluation on test_results).
-- ============================================================================

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
  override_visibility client_portal_visibility_t;
  custom_visibility   client_portal_visibility_t;
  schema_visibility   client_portal_visibility_t;
  metric_obj          jsonb;
BEGIN
  -- 1. Per-EP override.
  SELECT pts.client_portal_visibility
    INTO override_visibility
    FROM practice_test_settings pts
   WHERE pts.organization_id = p_organization_id
     AND pts.test_id          = p_test_id
     AND pts.metric_id        = p_metric_id;

  IF override_visibility IS NOT NULL THEN
    RETURN override_visibility;
  END IF;

  -- 2. Custom test? Read visibility from the metrics jsonb.
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
      -- Cast jsonb string -> enum. Invalid values raise; that is correct
      -- behaviour because the custom-test builder validates at write time.
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

  -- 3. Schema default.
  SELECT pmss.client_portal_visibility
    INTO schema_visibility
    FROM physical_markers_schema_seed pmss
   WHERE pmss.test_id   = p_test_id
     AND pmss.metric_id = p_metric_id;

  IF schema_visibility IS NOT NULL THEN
    RETURN schema_visibility;
  END IF;

  -- 4. Fail closed. An unknown metric is never client-visible.
  RETURN 'never'::client_portal_visibility_t;
END;
$$;

COMMENT ON FUNCTION public.test_metric_visibility(uuid, text, text) IS
  'Resolves client_portal_visibility for an (org, test, metric) tuple via override → custom → schema → never. Used by test_results RLS to enforce the brief''s never-hard-wall. Fails closed on unknown metrics.';

-- Lock down: callers are RLS policies and the application resolver. Not
-- a public RPC.
REVOKE EXECUTE ON FUNCTION public.test_metric_visibility(uuid, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.test_metric_visibility(uuid, text, text) TO authenticated;
