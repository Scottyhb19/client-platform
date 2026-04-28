-- ============================================================================
-- 20260428130100_create_test_session_function
-- ============================================================================
-- Why: Capturing a test session means INSERTing one test_sessions row and
-- N test_results rows. supabase-js cannot do cross-table transactions
-- from the client, so a partial failure (session inserted, results
-- failed) would leave an empty session in the audit log and need a
-- compensating soft-delete. Wrapping the whole thing in a SECURITY
-- INVOKER RPC keeps it atomic AND under the caller's RLS — staff
-- writes succeed, client writes fail, exactly as the policies say.
--
-- The function is SECURITY INVOKER (default), not SECURITY DEFINER:
-- the RLS policies on test_sessions / test_results govern. The Tampa
-- Scale never-wall and the rest of the security model are unchanged.
--
-- p_results is a jsonb array of:
--   [{ "test_id": "fp_cmj_bilateral",
--      "metric_id": "jump_height",
--      "side": null,                      -- or "left" / "right"
--      "value": 32.4,
--      "unit": "cm" }, ...]
--
-- The callsite (createTestSessionAction in src/app/(staff)/...) runs
-- application-layer validation (resolver + validation_bounds) before
-- invoking this RPC; the function does only the integrity work the DB
-- can enforce on its own (RLS, FK guards, lockdown trigger).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_test_session(
  p_client_id      uuid,
  p_conducted_at   timestamptz,
  p_source         test_source_t,
  p_appointment_id uuid,
  p_notes          text,
  p_results        jsonb
) RETURNS uuid
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  org_id      uuid := public.user_organization_id();
  caller_uid  uuid := auth.uid();
  session_id  uuid;
  r           jsonb;
BEGIN
  IF org_id IS NULL OR caller_uid IS NULL THEN
    RAISE EXCEPTION 'No active session — JWT claims missing';
  END IF;

  IF p_results IS NULL OR jsonb_typeof(p_results) <> 'array' OR jsonb_array_length(p_results) = 0 THEN
    RAISE EXCEPTION 'p_results must be a non-empty JSON array';
  END IF;

  -- Insert the session. RLS will reject if the caller is not staff or
  -- if conducted_by != auth.uid() (per the test_sessions INSERT policy).
  INSERT INTO test_sessions (
    organization_id, client_id, conducted_by, conducted_at,
    appointment_id, source, notes
  ) VALUES (
    org_id, p_client_id, caller_uid, p_conducted_at,
    p_appointment_id, p_source, p_notes
  )
  RETURNING id INTO session_id;

  -- Insert each result. The cross-org guard on test_results.test_session_id
  -- + the field-lockdown trigger + the parent-session RLS check all fire
  -- as the caller. A bad row aborts the whole transaction.
  FOR r IN SELECT * FROM jsonb_array_elements(p_results)
  LOOP
    INSERT INTO test_results (
      organization_id, test_session_id, test_id, metric_id, side, value, unit
    ) VALUES (
      org_id,
      session_id,
      r ->> 'test_id',
      r ->> 'metric_id',
      NULLIF(r ->> 'side', '')::test_side_t,
      (r ->> 'value')::numeric,
      r ->> 'unit'
    );
  END LOOP;

  RETURN session_id;
END;
$$;

COMMENT ON FUNCTION public.create_test_session(uuid, timestamptz, test_source_t, uuid, text, jsonb) IS
  'Atomic capture: insert one test_session + N test_results in a single transaction. SECURITY INVOKER — the caller''s RLS governs. Returns the new session_id.';

REVOKE EXECUTE ON FUNCTION public.create_test_session(uuid, timestamptz, test_source_t, uuid, text, jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_test_session(uuid, timestamptz, test_source_t, uuid, text, jsonb) TO authenticated;
