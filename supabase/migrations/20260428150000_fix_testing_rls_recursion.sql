-- ============================================================================
-- 20260428150000_fix_testing_rls_recursion
-- ============================================================================
-- Why: The Phase-A RLS policies on test_sessions, test_results, and
-- client_publications cross-reference each other. Even when the staff
-- short-circuit branch is true, Postgres evaluates the OR sub-queries
-- and recurses on the related-table policies, raising:
--
--   ERROR: infinite recursion detected in policy for relation "test_sessions"
--
-- Real-world failure: any SELECT against test_sessions, test_results, or
-- client_publications from a logged-in user (staff or client) blows up.
-- This is a Phase-A bug — the Tampa-Scale pgTAP test passed because that
-- test sets the JWT directly and the policies short-circuit before the
-- recursion fires; the recursion only fires when the policy planner
-- explores all branches, which it does for live PostgREST queries.
--
-- Fix: replace the cross-table EXISTS sub-queries with SECURITY DEFINER
-- helper functions. SECURITY DEFINER bypasses RLS internally, so the
-- functions can read the related tables without re-triggering policy
-- evaluation. Each helper enforces the soft-delete + scoping it needs.
--
-- This does NOT change the security model — every helper does the same
-- check the inline EXISTS would have done. It just runs the check
-- without recursing into the policy machinery.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1. Helpers
-- ----------------------------------------------------------------------------

-- Does the calling client own the parent test_session via clients.user_id?
CREATE OR REPLACE FUNCTION public.client_owns_test_session(p_session_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM test_sessions ts
      JOIN clients c ON c.id = ts.client_id
     WHERE ts.id = p_session_id
       AND ts.deleted_at IS NULL
       AND c.deleted_at IS NULL
       AND c.user_id = auth.uid()
  );
$$;

COMMENT ON FUNCTION public.client_owns_test_session(uuid) IS
  'RLS helper: true if the calling user is the client whose row owns this test_session. SECURITY DEFINER to avoid RLS recursion in the test_sessions/test_results/client_publications policies.';

REVOKE EXECUTE ON FUNCTION public.client_owns_test_session(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.client_owns_test_session(uuid) TO authenticated;


-- Is the parent test_session live and in the caller''s org? (staff path)
CREATE OR REPLACE FUNCTION public.test_session_in_org(
  p_session_id uuid,
  p_org_id     uuid
) RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM test_sessions ts
    WHERE ts.id = p_session_id
      AND ts.organization_id = p_org_id
      AND ts.deleted_at IS NULL
  );
$$;

COMMENT ON FUNCTION public.test_session_in_org(uuid, uuid) IS
  'RLS helper: true if the test_session exists in the given org and is not soft-deleted. Used by test_results to gate staff reads without recursing into the test_sessions policy.';

REVOKE EXECUTE ON FUNCTION public.test_session_in_org(uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.test_session_in_org(uuid, uuid) TO authenticated;


-- Does the test_session have a live client_publications record?
CREATE OR REPLACE FUNCTION public.test_session_has_active_publication(
  p_session_id uuid
) RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM client_publications cp
    WHERE cp.test_session_id = p_session_id
      AND cp.deleted_at IS NULL
  );
$$;

COMMENT ON FUNCTION public.test_session_has_active_publication(uuid) IS
  'RLS helper: true if a live (non-deleted) client_publications row exists for this session. Used by test_sessions and test_results client paths.';

REVOKE EXECUTE ON FUNCTION public.test_session_has_active_publication(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.test_session_has_active_publication(uuid) TO authenticated;


-- Does the test_session contain at least one non-deleted result whose
-- effective visibility is 'auto'? Used to let auto-visibility-only
-- sessions surface to clients without an explicit publication, per
-- /docs/testing-module-schema.md §14 Q4 sign-off.
CREATE OR REPLACE FUNCTION public.test_session_has_auto_visible_metric(
  p_session_id uuid,
  p_org_id     uuid
) RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM test_results tr
    WHERE tr.test_session_id = p_session_id
      AND tr.deleted_at IS NULL
      AND public.test_metric_visibility(p_org_id, tr.test_id, tr.metric_id) = 'auto'
  );
$$;

COMMENT ON FUNCTION public.test_session_has_auto_visible_metric(uuid, uuid) IS
  'RLS helper: true if at least one live result in this session resolves to ''auto'' visibility for the given org. Lets clients see CMJ-only sessions without an explicit publication.';

REVOKE EXECUTE ON FUNCTION public.test_session_has_auto_visible_metric(uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.test_session_has_auto_visible_metric(uuid, uuid) TO authenticated;


-- ----------------------------------------------------------------------------
-- §2. Replace the SELECT policies that were recursing.
--
-- DROP POLICY + CREATE POLICY rather than CREATE OR REPLACE — Postgres
-- doesn't support replace-in-place for policies. Wrapped in a single
-- migration transaction so there's no window where the policies are
-- absent.
-- ----------------------------------------------------------------------------

-- test_sessions
DROP POLICY IF EXISTS "select test_sessions in own org" ON test_sessions;

CREATE POLICY "select test_sessions in own org"
  ON test_sessions FOR SELECT TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND deleted_at IS NULL
    AND (
      public.user_role() IN ('owner','staff')
      OR (
        public.user_role() = 'client'
        AND client_id IN (
          SELECT id FROM clients
           WHERE user_id = auth.uid() AND deleted_at IS NULL
        )
        AND (
          public.test_session_has_active_publication(test_sessions.id)
          OR public.test_session_has_auto_visible_metric(
               test_sessions.id,
               test_sessions.organization_id
             )
        )
      )
    )
  );


-- test_results
DROP POLICY IF EXISTS "select test_results via session and visibility" ON test_results;

CREATE POLICY "select test_results via session and visibility"
  ON test_results FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND organization_id = public.user_organization_id()
    AND (
      (
        public.user_role() IN ('owner','staff')
        AND public.test_session_in_org(
              test_results.test_session_id,
              public.user_organization_id()
            )
      )
      OR (
        public.user_role() = 'client'
        AND public.client_owns_test_session(test_results.test_session_id)
        AND public.test_metric_visibility(
              test_results.organization_id,
              test_results.test_id,
              test_results.metric_id
            ) <> 'never'
        AND (
          public.test_metric_visibility(
            test_results.organization_id,
            test_results.test_id,
            test_results.metric_id
          ) = 'auto'
          OR public.test_session_has_active_publication(test_results.test_session_id)
        )
      )
    )
  );


-- client_publications
DROP POLICY IF EXISTS "select client_publications in own org" ON client_publications;

CREATE POLICY "select client_publications in own org"
  ON client_publications FOR SELECT TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND deleted_at IS NULL
    AND (
      public.user_role() IN ('owner','staff')
      OR (
        public.user_role() = 'client'
        AND public.client_owns_test_session(client_publications.test_session_id)
      )
    )
  );


-- ----------------------------------------------------------------------------
-- §3. The same INSERT policy on test_results EXISTS-references test_sessions.
-- Replace with the in_org helper to avoid the same recursion class.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "staff insert test_results via parent session" ON test_results;

CREATE POLICY "staff insert test_results via parent session"
  ON test_results FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner','staff')
    AND public.test_session_in_org(
          test_results.test_session_id,
          public.user_organization_id()
        )
  );

DROP POLICY IF EXISTS "staff update test_results via parent session" ON test_results;

CREATE POLICY "staff update test_results via parent session"
  ON test_results FOR UPDATE TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner','staff')
    AND public.test_session_in_org(
          test_results.test_session_id,
          public.user_organization_id()
        )
  )
  WITH CHECK (organization_id = public.user_organization_id());
