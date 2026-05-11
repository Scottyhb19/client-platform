-- ============================================================================
-- 20260511120100_soft_delete_availability_rule
-- ============================================================================
-- Why: PostgREST + soft-delete + RLS gotcha (memory note
-- project_postgrest_soft_delete_rls). Setting deleted_at = now() via a
-- direct UPDATE returns 42501 because the SELECT policy filters
-- deleted_at IS NULL — PostgREST's return=representation re-SELECTs the
-- row after the UPDATE and the now-soft-deleted row trips the filter.
--
-- Fix: SECURITY DEFINER RPC mirroring soft_delete_test_session
-- (20260429120000 §1). Auth check inside the function — SECURITY DEFINER
-- bypasses RLS, so we re-enforce org match + role + per-staff ownership
-- in plpgsql.
--
-- The per-staff ownership clause matches the new RLS policies in
-- 20260511120000: owners can soft-delete any rule in their org;
-- non-owners can only soft-delete their own rules.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.soft_delete_availability_rule(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_id   uuid := auth.uid();
  caller_org  uuid := public.user_organization_id();
  caller_role text := public.user_role();
BEGIN
  IF caller_id IS NULL
     OR caller_org IS NULL
     OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  UPDATE availability_rules
     SET deleted_at = now()
   WHERE id = p_id
     AND organization_id = caller_org
     AND deleted_at IS NULL
     AND (caller_role = 'owner' OR staff_user_id = caller_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'availability_rule % not found in your organization, or already deleted', p_id
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.soft_delete_availability_rule(uuid) IS
  'Set deleted_at = now() on an availability_rule. SECURITY DEFINER bypasses the soft-delete-via-RLS trap. Auth: caller_org match + role IN (owner,staff) + per-staff ownership for non-owners (mirrors the RLS policies in 20260511120000).';

REVOKE EXECUTE ON FUNCTION public.soft_delete_availability_rule(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.soft_delete_availability_rule(uuid) TO authenticated;
