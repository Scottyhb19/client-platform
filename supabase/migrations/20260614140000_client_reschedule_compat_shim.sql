-- ============================================================================
-- 20260614140000_client_reschedule_compat_shim
-- ============================================================================
-- Section 7 / P0-1 follow-up — restore prod/DB consistency.
--
-- The v3 migration (20260614120000) changed the reschedule RPC signature
-- from (uuid) to (uuid, date) and DROPPED the old (uuid) overload. That
-- migration is already on the live DB, but the section-7 code (which calls
-- the 2-arg version) is on the branch, not yet deployed — so the deployed
-- production code still calls the now-missing (uuid) overload and errors.
-- Dropping the old signature instead of keeping it as an overload was the
-- mistake; this migration corrects it.
--
-- THE FIX: re-add the (uuid) overload as a thin backward-compat shim that
-- resolves the caller's org timezone, computes "today" there (NOT UTC — so
-- the old call path is tz-healthy too, using the org-tz fallback tier), and
-- delegates to the (uuid, date) version, which keeps every guard. After this,
-- both the deployed prod code (1-arg) and the branch code (2-arg) work, and
-- both compute a correct local "today". The arities are distinct, so
-- PostgREST resolves each call unambiguously (no overload confusion — the
-- caveat in project memory `plpgsql function arity evolution` applies to
-- same-arity ambiguity, not this).
--
-- LIFECYCLE: this 1-arg shim becomes vestigial once the section-7 branch
-- deploys (all callers use 2-arg then). Harmless to keep as a convenience
-- overload; may be dropped in a later cleanup.
--
-- auth.uid() is read inside the delegate as normal — SECURITY DEFINER does
-- not reset the JWT-claim GUC, so the caller identity flows through the
-- nested call. Grants: anon revoked (auto-grant trap), authenticated kept.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.client_reschedule_program_day_to_today(
  p_program_day_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tz    text;
  v_today date;
BEGIN
  -- Resolve the caller's org timezone; compute "today" there (org-tz is the
  -- no-device-context fallback tier — never UTC). auth.uid() pins the lookup.
  -- If it resolves nothing, the 2-arg delegate raises the real ownership
  -- refusal; the defaulted tz only affects the (clamped) date we pass.
  SELECT o.timezone
    INTO v_tz
    FROM program_days pd
    JOIN programs p      ON p.id = pd.program_id
    JOIN clients c       ON c.id = p.client_id
    JOIN organizations o ON o.id = c.organization_id
   WHERE pd.id     = p_program_day_id
     AND c.user_id = auth.uid();

  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Australia/Sydney'))::date;

  RETURN public.client_reschedule_program_day_to_today(p_program_day_id, v_today);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.client_reschedule_program_day_to_today(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.client_reschedule_program_day_to_today(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.client_reschedule_program_day_to_today(uuid) TO authenticated;

COMMENT ON FUNCTION public.client_reschedule_program_day_to_today(uuid) IS
  'Section 7 P0-1 compat shim (2026-06-14). Backward-compatible 1-arg overload for deployed prod code that predates the (uuid, date) signature: resolves the org timezone, computes today there (never UTC), and delegates to the (uuid, date) version. Vestigial once the section-7 branch deploys; harmless to keep.';
