-- ============================================================================
-- 20260612140000_restore_client_publication_per_test
-- ============================================================================
-- Why: restore_client_publication (20260429120000_soft_delete_rpcs.sql §3)
-- predates the per-test publication model. Its conflict guard refused
-- restore when ANY live publication existed for the same test_session_id
-- — correct under the original one-publication-per-session unique-active
-- index, stale since 20260501120000 (Phase D.5) replaced that index with
-- (test_session_id, test_id). A session now legitimately hosts multiple
-- live publications, one per test, so restoring test X's unpublished
-- publication while test Y's publication for the same session is live
-- violates nothing — but the old guard refused it with a spurious 23505.
--
-- Fix: the guard now also reads the soft-deleted row's test_id and only
-- treats a live publication for the SAME (test_session_id, test_id) pair
-- as a conflict — mirroring the unique-active index it exists to pre-empt.
--
-- The error message text is unchanged on purpose: pgTAP 05 §4 asserts it
-- verbatim, and it remains truthful — the conflicting live publication is
-- for that session (and now, necessarily, for the same test).
--
-- Signature is unchanged (uuid → void): CREATE OR REPLACE is safe, no
-- DROP needed (no overload risk), no type regen needed.
--
-- Locals are v_-prefixed: the function body references the test_id and
-- test_session_id columns, and an unprefixed local of either name would
-- raise "column reference ... is ambiguous" at runtime (see
-- memory/project_plpgsql_variable_column_shadow.md).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.restore_client_publication(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_org  uuid := public.user_organization_id();
  v_caller_role text := public.user_role();
  v_session     uuid;
  v_test_id     text;
BEGIN
  IF v_caller_org IS NULL OR v_caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Look up the row first so we can give a clear "already a live pub"
  -- error before the unique-active index would raise an opaque 23505.
  -- Since 20260501120000 that index is (test_session_id, test_id), so
  -- only a live publication for the SAME test in the same session
  -- conflicts.
  SELECT test_session_id, test_id
    INTO v_session, v_test_id
    FROM client_publications
   WHERE id = p_id
     AND organization_id = v_caller_org
     AND deleted_at IS NOT NULL;

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'client_publication % not found in your organization, or not unpublished', p_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM client_publications
     WHERE test_session_id = v_session
       AND test_id = v_test_id
       AND organization_id = v_caller_org
       AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION
      'cannot restore: a different live publication already exists for that session — unpublish it first or leave the new one in place'
      USING ERRCODE = 'unique_violation';
  END IF;

  UPDATE client_publications
     SET deleted_at = NULL
   WHERE id = p_id
     AND organization_id = v_caller_org;
END;
$$;

COMMENT ON FUNCTION public.restore_client_publication(uuid) IS
  'Re-activate a previously unpublished client_publication. Refuses only if another live publication exists for the same (test_session_id, test_id) pair — explicit error rather than an opaque 23505 from the per-test unique-active index (20260501120000).';

-- Re-assert grants. REVOKE FROM PUBLIC alone does not strip the EXECUTE
-- that Supabase auto-grants to anon on every new public function (see
-- memory/project_supabase_default_execute_grants.md) — revoke it
-- explicitly. The in-body guard already 42501s anon (no org), but the
-- go-live posture is that anon should not be able to reach the body at
-- all.
REVOKE EXECUTE ON FUNCTION public.restore_client_publication(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.restore_client_publication(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.restore_client_publication(uuid) TO authenticated;
