-- 20260515120000_client_select_test_batteries.sql
--
-- Phase J-2-γ portal RLS gap fix.
--
-- The portal Data tab joins `test_batteries(name)` via the loader's
-- `loadTestHistoryForClient` to surface the battery name in each
-- session-group header. Pre-this-migration, clients have no SELECT
-- policy on `test_batteries` (Pattern A, staff-only — see migration
-- `20260428120800_testing_module_rls.sql` line 134). The result: the
-- PostgREST join silently resolves to null for client callers, and
-- the session-group header reads "N tests" instead of
-- "{battery_name} · N tests".
--
-- Fix: add a narrow client SELECT policy that allows reading a
-- `test_batteries` row only when that battery is applied to a test
-- session the caller owns AND a live `client_publications` row
-- exists for that session. The visibility check goes through a
-- SECURITY DEFINER helper to avoid RLS recursion across
-- `test_sessions` / `client_publications` (same pattern as
-- `client_owns_test_session` et al. from migration
-- `20260428150000_testing_module_rls_recursion_fix.sql`).
--
-- Same-org guarantee: a session.client_id implies the same org as
-- the session, and the helper joins through that session — so a
-- client only ever sees batteries applied to THEIR sessions, never
-- another client's batteries.
--
-- Staff SELECT continues via the existing
-- `staff select test_batteries in own org` policy (multiple SELECT
-- policies are OR'd; this addition is purely additive).

CREATE OR REPLACE FUNCTION public.battery_in_clients_published_session(p_battery_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM test_sessions ts
      JOIN clients c
        ON c.id = ts.client_id
       AND c.deleted_at IS NULL
      JOIN client_publications cp
        ON cp.test_session_id = ts.id
       AND cp.deleted_at IS NULL
     WHERE ts.applied_battery_id = p_battery_id
       AND ts.deleted_at IS NULL
       AND c.user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.battery_in_clients_published_session(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.battery_in_clients_published_session(uuid) TO authenticated;

CREATE POLICY "client select test_batteries via own published session"
  ON test_batteries FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.battery_in_clients_published_session(test_batteries.id)
  );
