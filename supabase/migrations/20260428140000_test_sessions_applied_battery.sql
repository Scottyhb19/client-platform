-- ============================================================================
-- 20260428140000_test_sessions_applied_battery
-- ============================================================================
-- Why: The capture modal needs to know "what battery was used last for
-- this client" so it can offer a one-click reapply. The simplest way
-- to answer that is to track which battery (if any) was applied at
-- capture time on test_sessions itself.
--
-- This isn't a security boundary — it's a UX hint. ON DELETE SET NULL
-- so deleting a battery from settings doesn't erase the historical link.
-- Nullable because most captures (free-form, VALD imports) won't apply
-- a battery.
--
-- Also updates create_test_session to accept the optional battery id.
-- The function is DROP + CREATE rather than CREATE OR REPLACE because
-- the parameter list is changing — plpgsql function overloading is by
-- signature.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Add the column.
-- ----------------------------------------------------------------------------
ALTER TABLE test_sessions
  ADD COLUMN applied_battery_id uuid REFERENCES test_batteries(id) ON DELETE SET NULL;


-- "Last used battery for this client" lookup — used by the capture
-- modal to populate the recents hint above the battery dropdown.
CREATE INDEX test_sessions_client_battery_recent_idx
  ON test_sessions (client_id, conducted_at DESC)
  WHERE applied_battery_id IS NOT NULL
    AND deleted_at IS NULL;


-- Cross-org guard: a session's battery must belong to the same org.
CREATE TRIGGER test_sessions_enforce_battery_org
  BEFORE INSERT OR UPDATE ON test_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_same_org_fk('test_batteries', 'applied_battery_id', 'organization_id');


COMMENT ON COLUMN test_sessions.applied_battery_id IS
  'Optional reference to the test_batteries row that produced this session''s metric set. UX-only — not a security boundary. Powers the "last used battery for this client" hint in the capture modal.';


-- ----------------------------------------------------------------------------
-- 2. Replace create_test_session to accept the optional battery id.
--
-- DROP + CREATE because the argument list is changing. Migrations apply
-- in transaction; the drop and create land atomically.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_test_session(uuid, timestamptz, test_source_t, uuid, text, jsonb);

CREATE OR REPLACE FUNCTION public.create_test_session(
  p_client_id          uuid,
  p_conducted_at       timestamptz,
  p_source             test_source_t,
  p_appointment_id     uuid,
  p_notes              text,
  p_applied_battery_id uuid,
  p_results            jsonb
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

  INSERT INTO test_sessions (
    organization_id, client_id, conducted_by, conducted_at,
    appointment_id, source, notes, applied_battery_id
  ) VALUES (
    org_id, p_client_id, caller_uid, p_conducted_at,
    p_appointment_id, p_source, p_notes, p_applied_battery_id
  )
  RETURNING id INTO session_id;

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

COMMENT ON FUNCTION public.create_test_session(uuid, timestamptz, test_source_t, uuid, text, uuid, jsonb) IS
  'Atomic capture: insert one test_session + N test_results in a single transaction. SECURITY INVOKER — the caller''s RLS governs. Optional applied_battery_id powers the per-client last-used-battery hint. Returns the new session_id.';

REVOKE EXECUTE ON FUNCTION public.create_test_session(uuid, timestamptz, test_source_t, uuid, text, uuid, jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_test_session(uuid, timestamptz, test_source_t, uuid, text, uuid, jsonb) TO authenticated;
