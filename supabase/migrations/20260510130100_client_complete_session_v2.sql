-- ============================================================================
-- 20260510130100_client_complete_session_v2
-- ============================================================================
-- Why: The Phase C portal completion UI accepts blank RPE by design — the
-- client can finish a session without rating perceived exertion. The
-- existing client_complete_session in 20260420102500_client_portal_functions.sql
-- contradicts that contract:
--
--   IF p_session_rpe IS NULL OR p_session_rpe NOT BETWEEN 1 AND 10 THEN
--     RAISE EXCEPTION 'session_rpe must be between 1 and 10';
--   END IF;
--
-- This rejects every NULL rpe outright, even though sessions.session_rpe
-- is itself nullable in the schema. The fix is to apply the range check
-- only when a value is supplied:
--
--   IF p_session_rpe IS NOT NULL AND p_session_rpe NOT BETWEEN 1 AND 10 THEN
--     RAISE EXCEPTION ...
--   END IF;
--
-- Name + arity + return type unchanged → CREATE OR REPLACE only, no DROP.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.client_complete_session(
  p_session_id  uuid,
  p_session_rpe smallint,
  p_feedback    text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_id   uuid := auth.uid();
  row_count   int;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Permissive: only validate the range when an RPE value was supplied.
  -- Blank-RPE completions are allowed per the Phase C UI contract.
  IF p_session_rpe IS NOT NULL AND p_session_rpe NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'session_rpe must be between 1 and 10';
  END IF;

  UPDATE sessions s
     SET completed_at = now(),
         session_rpe  = p_session_rpe,
         feedback     = p_feedback
    FROM clients c
   WHERE s.id          = p_session_id
     AND s.client_id   = c.id
     AND c.user_id     = caller_id
     AND c.deleted_at  IS NULL
     AND s.completed_at IS NULL
     AND s.deleted_at  IS NULL;

  GET DIAGNOSTICS row_count = ROW_COUNT;
  IF row_count = 0 THEN
    RAISE EXCEPTION 'Session not found, not owned by caller, or already completed';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.client_complete_session(uuid, smallint, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.client_complete_session(uuid, smallint, text) TO authenticated;

COMMENT ON FUNCTION public.client_complete_session(uuid, smallint, text) IS
  'Marks the caller''s own in-progress session as complete with optional overall RPE and optional feedback. Both fields may be NULL — the UI permits a client to finish without rating or commenting.';
