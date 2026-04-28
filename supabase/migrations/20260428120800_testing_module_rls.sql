-- ============================================================================
-- 20260428120800_testing_module_rls
-- ============================================================================
-- Why: RLS policies for every testing-module table. This is the security
-- boundary — the application code does not enforce visibility, this file
-- does.
--
-- Patterns (per /docs/rls-policies.md §3):
--   A  Staff-org-scoped CRUD, no client access
--   B  Staff CRUD + client SELECT of own
--   C  Nested child via parent join (with visibility filter for clients)
--
-- The load-bearing security control in this file is the test_results
-- SELECT policy. It calls public.test_metric_visibility() to decide
-- whether a row is ever returnable to a client. The Tampa Scale `never`
-- pgTAP test (brief §8 Test 4) is the canonical proof that this works.
--
-- Per /docs/testing-module-schema.md §14 Q4 sign-off: a session with
-- only auto-visibility metrics IS visible to the client without an
-- explicit publication. The session SELECT policy reflects that —
-- "publication exists OR at least one auto-visibility metric exists."
--
-- See /docs/testing-module-schema.md §6 for per-table rationale.
-- ============================================================================


-- ============================================================================
-- §1. Settings tables — Pattern A (staff-only CRUD, no client access)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- practice_test_settings
-- ----------------------------------------------------------------------------
ALTER TABLE practice_test_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_test_settings FORCE  ROW LEVEL SECURITY;

CREATE POLICY "staff select practice_test_settings in own org"
  ON practice_test_settings FOR SELECT TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner','staff')
  );

CREATE POLICY "staff insert practice_test_settings in own org"
  ON practice_test_settings FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner','staff')
  );

CREATE POLICY "staff update practice_test_settings in own org"
  ON practice_test_settings FOR UPDATE TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner','staff')
  )
  WITH CHECK (organization_id = public.user_organization_id());

-- Hard delete IS allowed: "Reset to default" deletes the row entirely so
-- the resolver falls through to the schema default.
CREATE POLICY "staff delete practice_test_settings in own org"
  ON practice_test_settings FOR DELETE TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner','staff')
  );


-- ----------------------------------------------------------------------------
-- practice_disabled_tests — Pattern A; hard delete IS the re-enable path.
-- ----------------------------------------------------------------------------
ALTER TABLE practice_disabled_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_disabled_tests FORCE  ROW LEVEL SECURITY;

CREATE POLICY "staff select practice_disabled_tests in own org"
  ON practice_disabled_tests FOR SELECT TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner','staff')
  );

CREATE POLICY "staff insert practice_disabled_tests in own org"
  ON practice_disabled_tests FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner','staff')
  );

CREATE POLICY "deny update practice_disabled_tests"
  ON practice_disabled_tests FOR UPDATE TO authenticated USING (false);

CREATE POLICY "staff delete practice_disabled_tests in own org"
  ON practice_disabled_tests FOR DELETE TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner','staff')
  );


-- ----------------------------------------------------------------------------
-- practice_custom_tests — Pattern A with soft-delete.
-- ----------------------------------------------------------------------------
ALTER TABLE practice_custom_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_custom_tests FORCE  ROW LEVEL SECURITY;

CREATE POLICY "staff select practice_custom_tests in own org"
  ON practice_custom_tests FOR SELECT TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND deleted_at IS NULL
    AND public.user_role() IN ('owner','staff')
  );

CREATE POLICY "staff insert practice_custom_tests in own org"
  ON practice_custom_tests FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner','staff')
  );

CREATE POLICY "staff update practice_custom_tests in own org"
  ON practice_custom_tests FOR UPDATE TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner','staff')
  )
  WITH CHECK (organization_id = public.user_organization_id());

CREATE POLICY "deny delete practice_custom_tests"
  ON practice_custom_tests FOR DELETE TO authenticated USING (false);


-- ----------------------------------------------------------------------------
-- test_batteries — Pattern A with soft-delete.
-- ----------------------------------------------------------------------------
ALTER TABLE test_batteries ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_batteries FORCE  ROW LEVEL SECURITY;

CREATE POLICY "staff select test_batteries in own org"
  ON test_batteries FOR SELECT TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND deleted_at IS NULL
    AND public.user_role() IN ('owner','staff')
  );

CREATE POLICY "staff insert test_batteries in own org"
  ON test_batteries FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner','staff')
  );

CREATE POLICY "staff update test_batteries in own org"
  ON test_batteries FOR UPDATE TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner','staff')
  )
  WITH CHECK (organization_id = public.user_organization_id());

CREATE POLICY "deny delete test_batteries"
  ON test_batteries FOR DELETE TO authenticated USING (false);


-- ============================================================================
-- §2. test_sessions — Pattern B with auto-visibility OR publication gate.
--
-- Staff: read/write everything within own org.
-- Clients: read sessions for their own client row IF
--   (a) a live client_publication exists for the session, OR
--   (b) at least one non-deleted result in the session has 'auto' visibility.
--
-- Per /docs/testing-module-schema.md §14 Q4 sign-off. Auto means auto:
-- the publish gate is for on_publish metrics; auto sessions don't need
-- explicit publication.
-- ============================================================================
ALTER TABLE test_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_sessions FORCE  ROW LEVEL SECURITY;

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
          EXISTS (
            SELECT 1 FROM client_publications cp
             WHERE cp.test_session_id = test_sessions.id
               AND cp.deleted_at IS NULL
          )
          OR EXISTS (
            SELECT 1 FROM test_results tr
             WHERE tr.test_session_id = test_sessions.id
               AND tr.deleted_at IS NULL
               AND public.test_metric_visibility(
                     test_sessions.organization_id,
                     tr.test_id,
                     tr.metric_id
                   ) = 'auto'
          )
        )
      )
    )
  );

CREATE POLICY "staff insert test_sessions in own org"
  ON test_sessions FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner','staff')
    AND conducted_by = auth.uid()
  );

CREATE POLICY "staff update test_sessions in own org"
  ON test_sessions FOR UPDATE TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner','staff')
  )
  WITH CHECK (organization_id = public.user_organization_id());

CREATE POLICY "deny delete test_sessions"
  ON test_sessions FOR DELETE TO authenticated USING (false);


-- ============================================================================
-- §3. test_results — Pattern C with visibility filter (LOAD-BEARING).
--
-- Staff: read/write everything via the parent session.
-- Clients: a row is visible IF AND ONLY IF
--   1. The parent session is owned by their client row,
--   2. test_metric_visibility(...) returns ANYTHING OTHER THAN 'never',
--   3. AND EITHER visibility = 'auto' OR a live client_publication exists.
--
-- The 'never' hard wall is enforced HERE. Brief §8 Test 4 is the
-- canonical proof.
-- ============================================================================
ALTER TABLE test_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_results FORCE  ROW LEVEL SECURITY;

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
                    AND cp.deleted_at IS NULL
               )
             )
           )
         )
    )
  );

CREATE POLICY "staff insert test_results via parent session"
  ON test_results FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner','staff')
    AND EXISTS (
      SELECT 1 FROM test_sessions ts
       WHERE ts.id = test_results.test_session_id
         AND ts.organization_id = public.user_organization_id()
         AND ts.deleted_at IS NULL
    )
  );

-- UPDATE allowed only via the field-lockdown trigger (which permits only
-- deleted_at to change). Staff INSERT/soft-delete is the only mutation
-- path. Clients have no write path at all.
CREATE POLICY "staff update test_results via parent session"
  ON test_results FOR UPDATE TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner','staff')
    AND EXISTS (
      SELECT 1 FROM test_sessions ts
       WHERE ts.id = test_results.test_session_id
         AND ts.organization_id = public.user_organization_id()
    )
  )
  WITH CHECK (organization_id = public.user_organization_id());

CREATE POLICY "deny delete test_results"
  ON test_results FOR DELETE TO authenticated USING (false);


-- ============================================================================
-- §4. client_publications — Pattern B (staff CRUD + client SELECT of own).
--
-- Clients need to know "is this session published" so the portal can
-- render framing text and show the publication state. They can read
-- publications for their own client's sessions only.
-- ============================================================================
ALTER TABLE client_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_publications FORCE  ROW LEVEL SECURITY;

CREATE POLICY "select client_publications in own org"
  ON client_publications FOR SELECT TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND deleted_at IS NULL
    AND (
      public.user_role() IN ('owner','staff')
      OR (
        public.user_role() = 'client'
        AND EXISTS (
          SELECT 1 FROM test_sessions ts
           WHERE ts.id = client_publications.test_session_id
             AND ts.client_id IN (
               SELECT id FROM clients
                WHERE user_id = auth.uid() AND deleted_at IS NULL
             )
             AND ts.deleted_at IS NULL
        )
      )
    )
  );

CREATE POLICY "staff insert client_publications in own org"
  ON client_publications FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner','staff')
    AND published_by = auth.uid()
  );

-- Soft-delete is the unpublish path. UPDATE permitted for setting
-- deleted_at; the lockdown for other fields lives in the data layer
-- (no field-lockdown trigger here — application is the only writer).
CREATE POLICY "staff update client_publications in own org"
  ON client_publications FOR UPDATE TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner','staff')
  )
  WITH CHECK (organization_id = public.user_organization_id());

CREATE POLICY "deny delete client_publications"
  ON client_publications FOR DELETE TO authenticated USING (false);
