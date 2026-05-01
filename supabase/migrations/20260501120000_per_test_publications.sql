-- ============================================================================
-- 20260501120000_per_test_publications
-- ============================================================================
-- Why: Phase D.5 moves publish granularity from per-session to per-(session,
-- test). The original D.4 schema had one client_publications row per
-- test_session — publishing that session made every on_publish metric in
-- it visible to the client at once. The polish-pass review concluded
-- that a CMJ session that also captured KOOS shouldn't share its publish
-- decision (or its framing text) with KOOS — each test gets its own
-- publication and its own framing.
--
-- See docs/polish/testing-module.md §7 D.5 entry and the Q1/Q2/Q3 sign-off
-- conversation that drove this redesign.
--
-- Changes
-- -------
-- 1. ADD COLUMN client_publications.test_id text NOT NULL
--    Discriminates which test inside a session this publication targets.
--    No FK — test_id may point to physical_markers_schema_seed (for
--    schema tests) OR practice_custom_tests (for org-level custom tests).
--    Application-layer validation suffices; the catalog loader rejects
--    unknown test_ids before they reach the publish action.
-- 2. Replace unique-active partial index with (test_session_id, test_id).
--    A session may now host multiple live publications — one per test —
--    but no two live publications for the same (session, test) pair.
-- 3. Update test_results visibility RLS to filter publication-existence
--    on test_results.test_id = cp.test_id. Without this change, a CMJ
--    publication would still leak KOOS results in the same session.
--    LOAD-BEARING; pgTAP 08 verifies the per-test isolation explicitly.
--
-- Pre-launch advantage: client_publications has no real client data, so
-- the migration begins with DELETE FROM client_publications. Once a real
-- client logs in and is assigned a publication, this kind of structural
-- change requires explicit data backfill — not relevant today.
-- ============================================================================

-- 1. Pre-launch flush. Per-session rows can't be expanded automatically
-- to per-test (one row spans many test_ids; we'd have to disambiguate
-- the framing text per test, which is the human decision the new flow
-- is designed for). No live client data exists; the flush is safe.
DELETE FROM client_publications;

-- 2. New column. NOT NULL is enforceable now because the table is empty.
ALTER TABLE client_publications
  ADD COLUMN test_id text NOT NULL;

-- 3. Replace the unique-active index. The partial-index pattern is the
-- same; only the keys change.
DROP INDEX IF EXISTS client_publications_session_unique_active;

CREATE UNIQUE INDEX client_publications_session_test_unique_active
  ON client_publications (test_session_id, test_id)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN client_publications.test_id IS
  'Per-test publication granularity (Phase D.5). test_id matches a row in physical_markers_schema_seed (schema test) or practice_custom_tests (org-level custom). RLS visibility on test_results filters by this column so publishing one test in a session does not make other on_publish tests in the same session visible.';

-- 4. Replace the test_results visibility policy. The only delta from the
-- original 20260428120800 policy is the AND cp.test_id = test_results.test_id
-- inside the publication-existence check. Everything else (the never
-- hard wall, auto auto-visibility, client client_id ownership) is
-- preserved verbatim.
DROP POLICY IF EXISTS "select test_results via session and visibility"
  ON test_results;

CREATE POLICY "select test_results via session and visibility"
  ON test_results FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND organization_id = public.user_organization_id()
    AND EXISTS (
      SELECT 1 FROM test_sessions ts
       WHERE ts.id = test_results.test_session_id
         AND ts.organization_id = public.user_organization_id()
         AND ts.deleted_at IS NULL
         AND (
           public.user_role() IN ('owner','staff')
           OR (
             public.user_role() = 'client'
             AND ts.client_id IN (
               SELECT id FROM clients
                WHERE user_id = auth.uid() AND deleted_at IS NULL
             )
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
               OR EXISTS (
                 SELECT 1 FROM client_publications cp
                  WHERE cp.test_session_id = ts.id
                    AND cp.test_id = test_results.test_id
                    AND cp.deleted_at IS NULL
               )
             )
           )
         )
    )
  );

-- 5. The session-level visibility policy on test_sessions stays as-is.
-- A client should still be able to SELECT a session if ANY of its tests
-- has a live publication (or any auto metric exists). The per-test
-- granularity is enforced one level down, on test_results.
