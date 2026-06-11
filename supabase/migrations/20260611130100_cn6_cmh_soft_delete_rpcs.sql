-- ============================================================================
-- 20260611130100_cn6_cmh_soft_delete_rpcs
-- ============================================================================
-- CN-6 (docs/polish/client-profile-clinical-notes.md): medical-history CRUD
-- gives the Details tab a true-archive verb for conditions entered by
-- mistake. client_medical_history was flagged in 20260429120000's
-- out-of-scope note as lacking its soft-delete RPC pair; a bare UPDATE
-- setting deleted_at fails 42501 because the SELECT policy filters
-- deleted_at IS NULL (the platform's known soft-delete trap).
--
-- Approved at the section's gap-list sign-off: build the pair now ("small
-- and formulaic, and it closes the table's known trap exposure").
--
-- Shape follows the 20260429120000/20260429130000 family exactly: narrow
-- function, fixed table, fixed columns, no SQL composition; auth check is
-- the FIRST statement; SECURITY DEFINER bypasses RLS for the UPDATE and
-- the body replicates the table's UPDATE-policy USING clause (org + role —
-- no author lock; medical history is practice-maintained, not authored).
--
-- Deactivation (is_active = false) is the primary "remove" verb in the UI
-- and needs no RPC — it is an ordinary RLS-scoped UPDATE. This pair exists
-- only for the entered-by-mistake path. No unique-active index on the
-- table, so restore has no conflict path (same as program_exercises).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.soft_delete_client_medical_history(p_id uuid)
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

  UPDATE client_medical_history
     SET deleted_at = now()
   WHERE id = p_id
     AND organization_id = caller_org
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'client_medical_history % not found in your organization, or already archived', p_id
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.soft_delete_client_medical_history(uuid) IS
  'CN-6: archive a medical-history condition entered by mistake. Deactivation (is_active = false) is the primary remove verb and goes through RLS directly; this RPC exists because a bare UPDATE setting deleted_at trips the SELECT-policy trap (42501).';

REVOKE EXECUTE ON FUNCTION public.soft_delete_client_medical_history(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.soft_delete_client_medical_history(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.restore_client_medical_history(p_id uuid)
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

  UPDATE client_medical_history
     SET deleted_at = NULL
   WHERE id = p_id
     AND organization_id = caller_org
     AND deleted_at IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'client_medical_history % not found in your organization, or not archived', p_id
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.restore_client_medical_history(uuid) IS
  'CN-6: un-archive a medical-history condition. No unique-active index on the table, so no conflict path; the org check is the only gate beyond the auth check.';

REVOKE EXECUTE ON FUNCTION public.restore_client_medical_history(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.restore_client_medical_history(uuid) TO authenticated;
