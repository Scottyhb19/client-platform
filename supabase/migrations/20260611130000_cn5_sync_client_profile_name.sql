-- ============================================================================
-- 20260611130000_cn5_sync_client_profile_name
-- ============================================================================
-- CN-5 (docs/polish/client-profile-clinical-notes.md): the client details
-- edit flow lets staff correct first/last name on the clients row. When the
-- client has onboarded (clients.user_id IS NOT NULL), the 1:1 auth-side
-- user_profiles row must follow — C-12 (20260611090000) set it from the
-- clients row at accept time, and a later staff rename would silently
-- desync the portal greeting from the clinical record.
--
-- Why an RPC and not "one extra UPDATE in the action" (the gap text's
-- working assumption): the user_profiles UPDATE policy is self-only
-- ("update own profile", USING user_id = auth.uid()). A staff-session
-- UPDATE against the client's profile row is silently filtered to zero
-- rows — the same trap class as the soft-delete family. SECURITY DEFINER
-- with the org+role check in the body is the established answer
-- (20260429120000 / 20260429130000 / client_accept_invite).
--
-- The sync is read-from-clients, not parameter-passed: the RPC re-reads
-- the canonical clients row inside the function, so a caller cannot use it
-- to write arbitrary names to a profile — it can only re-assert what the
-- clinical record already says. Length safety: clients.first_name/last_name
-- carry the IDENTICAL length(trim(...)) BETWEEN 1 AND 100 CHECKs as
-- user_profiles (see 20260611090000 header), so the UPDATE cannot violate
-- the profile constraints.
--
-- C-12's CONSTRAINT TO REMEMBER applies here equally: if client profile
-- self-editing ever ships (Phase 2), this overwrite must gain a guard in
-- the same change.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_client_profile_name(p_client_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org   uuid := public.user_organization_id();
  caller_role  text := public.user_role();
  v_user_id    uuid;
  v_first_name text;
  v_last_name  text;
BEGIN
  -- Auth check FIRST — replicates the clients UPDATE-policy USING clause.
  IF caller_org IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT user_id, first_name, last_name
    INTO v_user_id, v_first_name, v_last_name
    FROM clients
   WHERE id = p_client_id
     AND organization_id = caller_org
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'client % not found in your organization', p_client_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Pre-onboarding client (no portal login yet): nothing to sync. Not an
  -- error — the action calls this unconditionally-on-rename and the
  -- accept-time C-12 sync will pick up the current name later anyway.
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE user_profiles
     SET first_name = v_first_name,
         last_name  = v_last_name
   WHERE user_id = v_user_id;
END;
$$;

COMMENT ON FUNCTION public.sync_client_profile_name(uuid) IS
  'CN-5: re-assert the canonical clients-row name onto the linked user_profiles row after a staff rename. SECURITY DEFINER because the user_profiles UPDATE policy is self-only. Reads the name from the clients row inside the function — callers cannot write arbitrary values. No-op for pre-onboarding clients.';

REVOKE EXECUTE ON FUNCTION public.sync_client_profile_name(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.sync_client_profile_name(uuid) TO authenticated;
