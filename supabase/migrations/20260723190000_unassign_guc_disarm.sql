-- ============================================================================
-- 20260723190000_unassign_guc_disarm.sql
-- ============================================================================
-- Sign-off reviewer blocker B1 (2026-07-23, completed-lock HARD GATE package):
-- unassign_program_day() armed the transaction-local odyssey.day_unassign GUC
-- and never disarmed it, so for the remainder of the calling transaction ANY
-- raw published_at -> NULL on a locked day would sail past guard branch (c) —
-- and because the RPC is idempotent, a no-op call on any own-org day was a
-- free arming primitive. Through PostgREST each request is its own
-- transaction, so the practical window today is nil; the fix is
-- defence-in-depth so the property does not depend on that deployment detail
-- (e.g. a future multi-statement definer function calling the RPC mid-flow).
--
-- v2 change: set_config('odyssey.day_unassign', '', true) immediately after
-- the guarded UPDATE, restoring the disarmed state before the RPC returns.
-- Everything else (org/role guard, own-org check, idempotence, grants) is
-- unchanged. Body based on the LATEST definition (20260723140000) per the
-- function-rewrite rule. Signature unchanged -> no DROP, no type change.
--
-- Tripwired by pgTAP 60 #23: after a successful RPC call, a raw unassign of a
-- SECOND locked day in the same transaction is still refused.
--
-- Deploy-ordering constraint (reviewer minor, recorded once here): DB first,
-- always. New-frontend/old-DB would 42883 on unassign_program_day; old-
-- frontend/new-DB degrades to a clear guard refusal on locked days only.
-- This migration is body-only so it carries no skew of its own.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.unassign_program_day(p_day_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org  uuid := public.user_organization_id();
  caller_role text := public.user_role();
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
    FROM program_days pd
    JOIN programs p ON p.id = pd.program_id
   WHERE pd.id = p_day_id
     AND p.organization_id = caller_org
     AND pd.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'program day % not found in your organization', p_day_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- The one sanctioned path past guard branch (c). Transaction-local, and
  -- disarmed again immediately after the UPDATE (B1): the GUC must never
  -- outlive the single statement it exists to authorise.
  PERFORM set_config('odyssey.day_unassign', '1', true);

  -- Idempotent: unassigning an already-unassigned day matches 0 rows.
  -- The archived-client branch (a) still applies inside this RPC — an
  -- archived client's day cannot be unassigned without restoring first.
  UPDATE program_days
     SET published_at = NULL
   WHERE id = p_day_id;

  PERFORM set_config('odyssey.day_unassign', '', true);
END;
$$;

COMMENT ON FUNCTION public.unassign_program_day(uuid) IS
  'The sanctioned unassign (published_at → NULL) for program days. Sets — and disarms before returning — the transaction-local odyssey.day_unassign GUC that program_write_guard branch (c) requires when the day has a completed live session; raw API unassign of a completed session is refused (RPC-only hard gate, 2026-07-23). Org/role-guarded in-body; archived-client immutability still applies.';

REVOKE EXECUTE ON FUNCTION public.unassign_program_day(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unassign_program_day(uuid) TO authenticated;
