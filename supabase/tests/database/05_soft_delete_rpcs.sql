-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), is(), throws_ok(), lives_ok() resolve
-- unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 05_soft_delete_rpcs
-- ============================================================================
-- Why: Coverage for migration 20260429120000_soft_delete_rpcs.sql — the
-- SECURITY DEFINER soft-delete + restore RPC pairs that close the
-- production half of the soft-delete-via-UPDATE bug (see
-- memory/project_postgrest_soft_delete_rls.md).
--
-- Per the spec on the brief that landed the migration: each new RPC
-- gets at least three tests — same-org staff can; cross-org staff
-- cannot; client cannot. Plus four extras:
--   - clinical_notes author-lock (non-author staff in same org cannot
--     soft-delete) — owner has no override, mirroring the policy.
--   - client_publications restore-conflict (different live publication
--     for same session blocks restore).
--   - practice_custom_tests restore-conflict (same test_id taken).
--   - test_batteries restore-conflict (same name taken).
--
-- Pattern (same as test 04):
--   - Spoof staff JWT, SET LOCAL ROLE authenticated, build fixture.
--   - Switch JWT between staff_a / staff_b / client between assertions
--     using _test_set_jwt; role stays authenticated throughout.
--   - SECURITY DEFINER RPC bypasses RLS for the UPDATE; assertions
--     query through the staff RLS to verify visibility.
--
-- Test count: 41
-- ============================================================================

BEGIN;

SELECT plan(41);


-- ----------------------------------------------------------------------------
-- §1. Fixture
--
-- Two organizations:
--   org_a — has staff_a (note author), staff_a2 (non-author staff in
--           same org, used for clinical_notes author-lock test),
--           client_user, client_row, and one of every soft-deletable row.
--   org_b — has staff_b (used for cross-org-deny tests).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  org_a            uuid := '00000000-0000-0000-0000-0000000000e1'::uuid;
  org_b            uuid := '00000000-0000-0000-0000-0000000000e2'::uuid;
  staff_a          uuid;
  staff_a2         uuid;
  staff_b          uuid;
  client_user      uuid;
  client_row       uuid := '00000000-0000-0000-0000-0000000000e3'::uuid;
  sess_id          uuid := '00000000-0000-0000-0000-0000000000ea'::uuid;
  result_id        uuid;
  pub_id           uuid := '00000000-0000-0000-0000-0000000000eb'::uuid;
  template_id      uuid := '00000000-0000-0000-0000-0000000000ec'::uuid;
  note_id          uuid := '00000000-0000-0000-0000-0000000000ed'::uuid;
  custom_test_id   uuid := '00000000-0000-0000-0000-0000000000ee'::uuid;
  battery_id       uuid := '00000000-0000-0000-0000-0000000000ef'::uuid;
BEGIN
  -- Two orgs.
  INSERT INTO organizations (id, name, slug) VALUES
    (org_a, 'Test Org A — Soft-Delete RPCs', 'test-org-a-soft-delete'),
    (org_b, 'Test Org B — Soft-Delete RPCs', 'test-org-b-soft-delete');

  -- Three staff users + one client user.
  staff_a     := public._test_make_user('staff-a-sdr@test.local');
  staff_a2    := public._test_make_user('staff-a2-sdr@test.local');
  staff_b     := public._test_make_user('staff-b-sdr@test.local');
  client_user := public._test_make_user('client-sdr@test.local');

  PERFORM public._test_grant_membership(staff_a,     org_a, 'staff'::user_role);
  PERFORM public._test_grant_membership(staff_a2,    org_a, 'staff'::user_role);
  PERFORM public._test_grant_membership(staff_b,     org_b, 'staff'::user_role);
  PERFORM public._test_grant_membership(client_user, org_a, 'client'::user_role);

  -- Client row in org_a, linked to client_user via clients.user_id.
  INSERT INTO clients (
    id, organization_id, user_id, first_name, last_name, email
  ) VALUES (
    client_row, org_a, client_user, 'Sam', 'Subject', 'sam@test.local'
  );

  -- Spoof staff_a's JWT and switch role to authenticated so the RLS
  -- INSERT policies (which target authenticated) actually apply and pass.
  PERFORM public._test_set_jwt(staff_a, org_a, 'staff');
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- One test_session in org_a.
  INSERT INTO test_sessions (
    id, organization_id, client_id, conducted_by, conducted_at
  ) VALUES (
    sess_id, org_a, client_row, staff_a, now() - interval '1 day'
  );

  -- One test_result on the session.
  INSERT INTO test_results (
    organization_id, test_session_id, test_id, metric_id, side, value, unit
  ) VALUES (
    org_a, sess_id, 'fp_cmj_bilateral', 'jump_height', NULL, 32.4, 'cm'
  ) RETURNING id INTO result_id;

  -- One client_publication for the session.
  INSERT INTO client_publications (
    id, organization_id, test_session_id, published_by
  ) VALUES (
    pub_id, org_a, sess_id, staff_a
  );

  -- A note template + clinical_note authored by staff_a.
  INSERT INTO note_templates (id, organization_id, name, sort_order)
  VALUES (template_id, org_a, 'Soft-Delete RPC Test Template', 0);

  INSERT INTO clinical_notes (
    id, organization_id, client_id, author_user_id, template_id,
    note_type, note_date, content_json
  ) VALUES (
    note_id, org_a, client_row, staff_a, template_id,
    'progress_note'::note_type, CURRENT_DATE,
    jsonb_build_object('fields', jsonb_build_array(
      jsonb_build_object('label', 'Note', 'type', 'long_text', 'value', 'fixture')
    ))
  );

  -- Settings rows in org_a.
  INSERT INTO practice_custom_tests (
    id, organization_id, category_id, subcategory_id, test_id, name, metrics
  ) VALUES (
    custom_test_id, org_a, 'jumps', 'cmj', 'custom_sdr_test', 'SDR Custom Test',
    jsonb_build_array(jsonb_build_object(
      'id', 'peak_force', 'label', 'Peak force', 'unit', 'N',
      'input_type', 'decimal'
    ))
  );

  INSERT INTO test_batteries (
    id, organization_id, name, metric_keys
  ) VALUES (
    battery_id, org_a, 'SDR Test Battery',
    jsonb_build_array(jsonb_build_object(
      'test_id', 'fp_cmj_bilateral', 'metric_id', 'jump_height'
    ))
  );

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_a          AS org_a,
    org_b          AS org_b,
    staff_a        AS staff_a,
    staff_a2       AS staff_a2,
    staff_b        AS staff_b,
    client_user    AS client_user,
    sess_id        AS sess_id,
    result_id      AS result_id,
    pub_id         AS pub_id,
    note_id        AS note_id,
    custom_test_id AS custom_test_id,
    battery_id     AS battery_id;
  GRANT SELECT ON _ids TO authenticated;
END $$;


-- ============================================================================
-- §2. test_sessions
-- ============================================================================
SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  format(
    $q$SELECT public.soft_delete_test_session(%L::uuid)$q$,
    (SELECT sess_id FROM _ids)
  ),
  'staff_a soft_delete_test_session in own org succeeds'
);

-- staff_b cannot restore — it's in another org, looks empty.
SELECT public._test_set_jwt(
  (SELECT staff_b FROM _ids), (SELECT org_b FROM _ids), 'staff'
);
SELECT throws_ok(
  format(
    $q$SELECT public.restore_test_session(%L::uuid)$q$,
    (SELECT sess_id FROM _ids)
  ),
  'P0002',
  NULL::text,
  'staff_b cannot restore a test_session in another org'
);

-- client cannot restore — auth check fires before the lookup.
SELECT public._test_set_jwt(
  (SELECT client_user FROM _ids), (SELECT org_a FROM _ids), 'client'
);
SELECT throws_ok(
  format(
    $q$SELECT public.restore_test_session(%L::uuid)$q$,
    (SELECT sess_id FROM _ids)
  ),
  '42501',
  'Unauthorized',
  'client cannot restore a test_session'
);

-- staff_a restores successfully (cleans up state for the next denial cases).
SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);
SELECT lives_ok(
  format(
    $q$SELECT public.restore_test_session(%L::uuid)$q$,
    (SELECT sess_id FROM _ids)
  ),
  'staff_a restore_test_session in own org succeeds'
);

-- staff_b cannot soft-delete — wrong org.
SELECT public._test_set_jwt(
  (SELECT staff_b FROM _ids), (SELECT org_b FROM _ids), 'staff'
);
SELECT throws_ok(
  format(
    $q$SELECT public.soft_delete_test_session(%L::uuid)$q$,
    (SELECT sess_id FROM _ids)
  ),
  'P0002',
  NULL::text,
  'staff_b cannot soft_delete a test_session in another org'
);

-- client cannot soft-delete.
SELECT public._test_set_jwt(
  (SELECT client_user FROM _ids), (SELECT org_a FROM _ids), 'client'
);
SELECT throws_ok(
  format(
    $q$SELECT public.soft_delete_test_session(%L::uuid)$q$,
    (SELECT sess_id FROM _ids)
  ),
  '42501',
  'Unauthorized',
  'client cannot soft_delete a test_session'
);


-- ============================================================================
-- §3. test_results
-- ============================================================================
SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);

SELECT lives_ok(
  format(
    $q$SELECT public.soft_delete_test_result(%L::uuid)$q$,
    (SELECT result_id FROM _ids)
  ),
  'staff_a soft_delete_test_result in own org succeeds'
);

SELECT public._test_set_jwt(
  (SELECT staff_b FROM _ids), (SELECT org_b FROM _ids), 'staff'
);
SELECT throws_ok(
  format(
    $q$SELECT public.restore_test_result(%L::uuid)$q$,
    (SELECT result_id FROM _ids)
  ),
  'P0002',
  NULL::text,
  'staff_b cannot restore a test_result in another org'
);

SELECT public._test_set_jwt(
  (SELECT client_user FROM _ids), (SELECT org_a FROM _ids), 'client'
);
SELECT throws_ok(
  format(
    $q$SELECT public.restore_test_result(%L::uuid)$q$,
    (SELECT result_id FROM _ids)
  ),
  '42501',
  'Unauthorized',
  'client cannot restore a test_result'
);

SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);
SELECT lives_ok(
  format(
    $q$SELECT public.restore_test_result(%L::uuid)$q$,
    (SELECT result_id FROM _ids)
  ),
  'staff_a restore_test_result in own org succeeds'
);

SELECT public._test_set_jwt(
  (SELECT staff_b FROM _ids), (SELECT org_b FROM _ids), 'staff'
);
SELECT throws_ok(
  format(
    $q$SELECT public.soft_delete_test_result(%L::uuid)$q$,
    (SELECT result_id FROM _ids)
  ),
  'P0002',
  NULL::text,
  'staff_b cannot soft_delete a test_result in another org'
);

SELECT public._test_set_jwt(
  (SELECT client_user FROM _ids), (SELECT org_a FROM _ids), 'client'
);
SELECT throws_ok(
  format(
    $q$SELECT public.soft_delete_test_result(%L::uuid)$q$,
    (SELECT result_id FROM _ids)
  ),
  '42501',
  'Unauthorized',
  'client cannot soft_delete a test_result'
);


-- ============================================================================
-- §4. client_publications
-- ============================================================================
SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);

SELECT lives_ok(
  format(
    $q$SELECT public.soft_delete_client_publication(%L::uuid)$q$,
    (SELECT pub_id FROM _ids)
  ),
  'staff_a soft_delete_client_publication (unpublish) in own org succeeds'
);

SELECT public._test_set_jwt(
  (SELECT staff_b FROM _ids), (SELECT org_b FROM _ids), 'staff'
);
SELECT throws_ok(
  format(
    $q$SELECT public.restore_client_publication(%L::uuid)$q$,
    (SELECT pub_id FROM _ids)
  ),
  'P0002',
  NULL::text,
  'staff_b cannot restore a client_publication in another org'
);

SELECT public._test_set_jwt(
  (SELECT client_user FROM _ids), (SELECT org_a FROM _ids), 'client'
);
SELECT throws_ok(
  format(
    $q$SELECT public.restore_client_publication(%L::uuid)$q$,
    (SELECT pub_id FROM _ids)
  ),
  '42501',
  'Unauthorized',
  'client cannot restore a client_publication'
);

SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);
SELECT lives_ok(
  format(
    $q$SELECT public.restore_client_publication(%L::uuid)$q$,
    (SELECT pub_id FROM _ids)
  ),
  'staff_a restore_client_publication in own org succeeds'
);

SELECT public._test_set_jwt(
  (SELECT staff_b FROM _ids), (SELECT org_b FROM _ids), 'staff'
);
SELECT throws_ok(
  format(
    $q$SELECT public.soft_delete_client_publication(%L::uuid)$q$,
    (SELECT pub_id FROM _ids)
  ),
  'P0002',
  NULL::text,
  'staff_b cannot soft_delete a client_publication in another org'
);

SELECT public._test_set_jwt(
  (SELECT client_user FROM _ids), (SELECT org_a FROM _ids), 'client'
);
SELECT throws_ok(
  format(
    $q$SELECT public.soft_delete_client_publication(%L::uuid)$q$,
    (SELECT pub_id FROM _ids)
  ),
  '42501',
  'Unauthorized',
  'client cannot soft_delete a client_publication'
);

-- Conflict case: a different live publication for the same session
-- blocks restoring the original.
--   1. staff_a soft-deletes the original
--   2. INSERT a new live publication for the same session
--   3. Try to restore the original → unique_violation with our message
SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);
SELECT public.soft_delete_client_publication((SELECT pub_id FROM _ids));

INSERT INTO client_publications (
  organization_id, test_session_id, published_by
) VALUES (
  (SELECT org_a FROM _ids),
  (SELECT sess_id FROM _ids),
  (SELECT staff_a FROM _ids)
);

SELECT throws_ok(
  format(
    $q$SELECT public.restore_client_publication(%L::uuid)$q$,
    (SELECT pub_id FROM _ids)
  ),
  '23505',
  'cannot restore: a different live publication already exists for that session — unpublish it first or leave the new one in place',
  'restore_client_publication refuses when a live duplicate exists for the same session'
);


-- ============================================================================
-- §5. clinical_notes  (author-locked)
-- ============================================================================
SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);

SELECT lives_ok(
  format(
    $q$SELECT public.soft_delete_clinical_note(%L::uuid)$q$,
    (SELECT note_id FROM _ids)
  ),
  'author (staff_a) soft_delete_clinical_note succeeds'
);

SELECT public._test_set_jwt(
  (SELECT staff_b FROM _ids), (SELECT org_b FROM _ids), 'staff'
);
SELECT throws_ok(
  format(
    $q$SELECT public.restore_clinical_note(%L::uuid)$q$,
    (SELECT note_id FROM _ids)
  ),
  'P0002',
  NULL::text,
  'staff_b cannot restore a clinical_note in another org'
);

SELECT public._test_set_jwt(
  (SELECT client_user FROM _ids), (SELECT org_a FROM _ids), 'client'
);
SELECT throws_ok(
  format(
    $q$SELECT public.restore_clinical_note(%L::uuid)$q$,
    (SELECT note_id FROM _ids)
  ),
  '42501',
  'Unauthorized',
  'client cannot restore a clinical_note'
);

-- Author-lock on restore: same-org non-author staff is blocked at the
-- author check (42501 'Only the practitioner who wrote this note...').
SELECT public._test_set_jwt(
  (SELECT staff_a2 FROM _ids), (SELECT org_a FROM _ids), 'staff'
);
SELECT throws_ok(
  format(
    $q$SELECT public.restore_clinical_note(%L::uuid)$q$,
    (SELECT note_id FROM _ids)
  ),
  '42501',
  'Only the practitioner who wrote this note can restore it',
  'staff_a2 (same org, non-author) cannot restore a clinical_note authored by staff_a'
);

-- Author can restore.
SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);
SELECT lives_ok(
  format(
    $q$SELECT public.restore_clinical_note(%L::uuid)$q$,
    (SELECT note_id FROM _ids)
  ),
  'author (staff_a) restore_clinical_note succeeds'
);

-- Cross-org staff cannot soft-delete.
SELECT public._test_set_jwt(
  (SELECT staff_b FROM _ids), (SELECT org_b FROM _ids), 'staff'
);
SELECT throws_ok(
  format(
    $q$SELECT public.soft_delete_clinical_note(%L::uuid)$q$,
    (SELECT note_id FROM _ids)
  ),
  'P0002',
  NULL::text,
  'staff_b cannot soft_delete a clinical_note in another org'
);

-- Client cannot soft-delete.
SELECT public._test_set_jwt(
  (SELECT client_user FROM _ids), (SELECT org_a FROM _ids), 'client'
);
SELECT throws_ok(
  format(
    $q$SELECT public.soft_delete_clinical_note(%L::uuid)$q$,
    (SELECT note_id FROM _ids)
  ),
  '42501',
  'Unauthorized',
  'client cannot soft_delete a clinical_note'
);

-- Author-lock on soft-delete: same-org non-author staff is blocked.
SELECT public._test_set_jwt(
  (SELECT staff_a2 FROM _ids), (SELECT org_a FROM _ids), 'staff'
);
SELECT throws_ok(
  format(
    $q$SELECT public.soft_delete_clinical_note(%L::uuid)$q$,
    (SELECT note_id FROM _ids)
  ),
  '42501',
  'Only the practitioner who wrote this note can archive it',
  'staff_a2 (same org, non-author) cannot soft_delete a clinical_note authored by staff_a'
);


-- ============================================================================
-- §6. practice_custom_tests
-- ============================================================================
SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);

SELECT lives_ok(
  format(
    $q$SELECT public.soft_delete_practice_custom_test(%L::uuid)$q$,
    (SELECT custom_test_id FROM _ids)
  ),
  'staff_a soft_delete_practice_custom_test in own org succeeds'
);

SELECT public._test_set_jwt(
  (SELECT staff_b FROM _ids), (SELECT org_b FROM _ids), 'staff'
);
SELECT throws_ok(
  format(
    $q$SELECT public.restore_practice_custom_test(%L::uuid)$q$,
    (SELECT custom_test_id FROM _ids)
  ),
  'P0002',
  NULL::text,
  'staff_b cannot restore a practice_custom_test in another org'
);

SELECT public._test_set_jwt(
  (SELECT client_user FROM _ids), (SELECT org_a FROM _ids), 'client'
);
SELECT throws_ok(
  format(
    $q$SELECT public.restore_practice_custom_test(%L::uuid)$q$,
    (SELECT custom_test_id FROM _ids)
  ),
  '42501',
  'Unauthorized',
  'client cannot restore a practice_custom_test'
);

SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);
SELECT lives_ok(
  format(
    $q$SELECT public.restore_practice_custom_test(%L::uuid)$q$,
    (SELECT custom_test_id FROM _ids)
  ),
  'staff_a restore_practice_custom_test in own org succeeds'
);

SELECT public._test_set_jwt(
  (SELECT staff_b FROM _ids), (SELECT org_b FROM _ids), 'staff'
);
SELECT throws_ok(
  format(
    $q$SELECT public.soft_delete_practice_custom_test(%L::uuid)$q$,
    (SELECT custom_test_id FROM _ids)
  ),
  'P0002',
  NULL::text,
  'staff_b cannot soft_delete a practice_custom_test in another org'
);

SELECT public._test_set_jwt(
  (SELECT client_user FROM _ids), (SELECT org_a FROM _ids), 'client'
);
SELECT throws_ok(
  format(
    $q$SELECT public.soft_delete_practice_custom_test(%L::uuid)$q$,
    (SELECT custom_test_id FROM _ids)
  ),
  '42501',
  'Unauthorized',
  'client cannot soft_delete a practice_custom_test'
);

-- Conflict case: another live row claims the same test_id.
SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);
SELECT public.soft_delete_practice_custom_test((SELECT custom_test_id FROM _ids));

INSERT INTO practice_custom_tests (
  organization_id, category_id, subcategory_id, test_id, name, metrics
) VALUES (
  (SELECT org_a FROM _ids),
  'jumps', 'cmj', 'custom_sdr_test', 'SDR Custom Test (replacement)',
  jsonb_build_array(jsonb_build_object(
    'id', 'peak_force', 'label', 'Peak force', 'unit', 'N',
    'input_type', 'decimal'
  ))
);

SELECT throws_ok(
  format(
    $q$SELECT public.restore_practice_custom_test(%L::uuid)$q$,
    (SELECT custom_test_id FROM _ids)
  ),
  '23505',
  'cannot restore: another active custom test already uses test_id custom_sdr_test',
  'restore_practice_custom_test refuses when test_id is taken by a live row'
);


-- ============================================================================
-- §7. test_batteries
-- ============================================================================
SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);

SELECT lives_ok(
  format(
    $q$SELECT public.soft_delete_test_battery(%L::uuid)$q$,
    (SELECT battery_id FROM _ids)
  ),
  'staff_a soft_delete_test_battery in own org succeeds'
);

SELECT public._test_set_jwt(
  (SELECT staff_b FROM _ids), (SELECT org_b FROM _ids), 'staff'
);
SELECT throws_ok(
  format(
    $q$SELECT public.restore_test_battery(%L::uuid)$q$,
    (SELECT battery_id FROM _ids)
  ),
  'P0002',
  NULL::text,
  'staff_b cannot restore a test_battery in another org'
);

SELECT public._test_set_jwt(
  (SELECT client_user FROM _ids), (SELECT org_a FROM _ids), 'client'
);
SELECT throws_ok(
  format(
    $q$SELECT public.restore_test_battery(%L::uuid)$q$,
    (SELECT battery_id FROM _ids)
  ),
  '42501',
  'Unauthorized',
  'client cannot restore a test_battery'
);

SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);
SELECT lives_ok(
  format(
    $q$SELECT public.restore_test_battery(%L::uuid)$q$,
    (SELECT battery_id FROM _ids)
  ),
  'staff_a restore_test_battery in own org succeeds'
);

SELECT public._test_set_jwt(
  (SELECT staff_b FROM _ids), (SELECT org_b FROM _ids), 'staff'
);
SELECT throws_ok(
  format(
    $q$SELECT public.soft_delete_test_battery(%L::uuid)$q$,
    (SELECT battery_id FROM _ids)
  ),
  'P0002',
  NULL::text,
  'staff_b cannot soft_delete a test_battery in another org'
);

SELECT public._test_set_jwt(
  (SELECT client_user FROM _ids), (SELECT org_a FROM _ids), 'client'
);
SELECT throws_ok(
  format(
    $q$SELECT public.soft_delete_test_battery(%L::uuid)$q$,
    (SELECT battery_id FROM _ids)
  ),
  '42501',
  'Unauthorized',
  'client cannot soft_delete a test_battery'
);

-- Conflict case: another live row claims the same name (case-insensitive).
SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);
SELECT public.soft_delete_test_battery((SELECT battery_id FROM _ids));

INSERT INTO test_batteries (
  organization_id, name, metric_keys
) VALUES (
  (SELECT org_a FROM _ids),
  'sdr test battery',  -- different case, same lower(name)
  jsonb_build_array(jsonb_build_object(
    'test_id', 'fp_cmj_bilateral', 'metric_id', 'jump_height'
  ))
);

SELECT throws_ok(
  format(
    $q$SELECT public.restore_test_battery(%L::uuid)$q$,
    (SELECT battery_id FROM _ids)
  ),
  '23505',
  'cannot restore: another active battery already uses the name SDR Test Battery',
  'restore_test_battery refuses when name (case-insensitive) is taken by a live row'
);


SELECT * FROM finish();

ROLLBACK;
