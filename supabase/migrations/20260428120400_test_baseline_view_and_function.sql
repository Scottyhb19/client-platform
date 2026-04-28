-- ============================================================================
-- 20260428120400_test_baseline_view_and_function
-- ============================================================================
-- Why: Per /docs/testing-module-schema.md §7 and brief §1.3, is_baseline
-- is computed, never stored. The brief explicitly forbids application
-- code from writing it directly: "Write a database function and a view.
-- Do not allow application code to write `is_baseline` directly."
--
-- This migration adds:
--   1. A regular VIEW joining test_results × test_sessions with an
--      is_baseline column derived via window function.
--   2. A SQL function `test_session_is_baseline(session_id, test_id)`
--      that answers the same question for a single session/test pair.
--
-- A regular view (not materialised) is the v1 choice. Window function
-- over a few hundred rows is well under the perf budget. The upgrade
-- path is documented in /docs/testing-module-schema.md §7.1.
--
-- Soft-delete cascading — if the baseline session is soft-deleted, the
-- next chronological session inherits the baseline flag automatically
-- (the WHERE deleted_at IS NULL excludes deleted rows from the
-- partition). Brief Test 5 covers this.
--
-- Tie-breaking — when two sessions share the same conducted_at
-- (rare but possible during a paste/import), the secondary ORDER BY id
-- ASC produces a stable winner. The id is a v4 UUID so the ordering is
-- deterministic but not clinically meaningful — document elsewhere.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- View: test_results_with_baseline
--
-- WITH (security_invoker = on) is non-negotiable here. Without it, the
-- view runs as its owner (postgres) and bypasses the underlying tables'
-- RLS — every caller would see every row. With it, the view respects
-- the test_sessions and test_results SELECT policies as the calling
-- role. See https://supabase.com/docs/guides/database/postgres/views
--
-- Per /docs/testing-module-schema.md §14 Q3 sign-off: the client API
-- does NOT return the is_baseline column — that exposure is staff-only.
-- The portal renders milestone charts client-side from only the rows
-- it can see.
-- ----------------------------------------------------------------------------
CREATE VIEW test_results_with_baseline
WITH (security_invoker = on)
AS
SELECT
  tr.id,
  tr.organization_id,
  tr.test_session_id,
  ts.client_id,
  tr.test_id,
  tr.metric_id,
  tr.side,
  tr.value,
  tr.unit,
  tr.created_at,
  ts.conducted_at,
  ts.id = FIRST_VALUE(ts.id) OVER (
    PARTITION BY ts.client_id, tr.test_id
    ORDER BY ts.conducted_at ASC, ts.id ASC
  ) AS is_baseline
FROM test_results tr
JOIN test_sessions ts ON ts.id = tr.test_session_id
WHERE tr.deleted_at IS NULL
  AND ts.deleted_at IS NULL;

COMMENT ON VIEW test_results_with_baseline IS
  'Test results with a derived is_baseline boolean. Baseline is the earliest non-deleted session per (client_id, test_id). Soft-delete cascades naturally — the next earliest session inherits baseline. Staff-only column exposure: the portal API does not return is_baseline.';


-- ----------------------------------------------------------------------------
-- Function: test_session_is_baseline(session_id, test_id) → boolean
-- For inline queries that just need a yes/no for one session+test pair.
-- STABLE because the answer doesn't change within a transaction.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.test_session_is_baseline(
  p_session_id uuid,
  p_test_id    text
) RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT NOT EXISTS (
    SELECT 1
      FROM test_sessions ts_self
      JOIN test_sessions ts_other ON ts_other.client_id = ts_self.client_id
      JOIN test_results tr_other  ON tr_other.test_session_id = ts_other.id
     WHERE ts_self.id        = p_session_id
       AND ts_self.deleted_at IS NULL
       AND ts_other.deleted_at IS NULL
       AND tr_other.deleted_at IS NULL
       AND tr_other.test_id  = p_test_id
       AND ts_other.id      <> p_session_id
       AND (
         ts_other.conducted_at <  ts_self.conducted_at
         OR (ts_other.conducted_at = ts_self.conducted_at AND ts_other.id < ts_self.id)
       )
  );
$$;

COMMENT ON FUNCTION public.test_session_is_baseline(uuid, text) IS
  'Returns true if the given test_session is the earliest non-deleted session for its client+test combination. STABLE within a transaction. Soft-delete cascades.';

-- Lock down: PostgREST should not expose this as a public RPC. Staff use
-- the view; the function is for internal use.
REVOKE EXECUTE ON FUNCTION public.test_session_is_baseline(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.test_session_is_baseline(uuid, text) TO authenticated;
