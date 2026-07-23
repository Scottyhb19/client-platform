-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), ok(), is() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 64_clinical_notes_client_deny
-- ============================================================================
-- Closes the go-live-checklist §8 ledger item from the 2026-07-22 drift
-- audit: "no rls_clinical_notes_select_client_denied pgTAP assertion exists;
-- rls-policies.md §4.6 must not be represented as test-verified until it
-- does" (re-trigger: before any paying clinical client — fired by the
-- 2026-07-23 parity pass).
--
-- The claim under test (rls-policies.md §4.6): clinical notes are STAFF-ONLY.
-- A client can never read their own clinical notes through the API — the
-- clinical record is the practitioner's working document, not client-facing
-- content (brief §7.2 separates the two).
--
-- Assertions (4):
--   1. control: staff reads the note (the policy's positive arm)
--   2. rls_clinical_notes_select_client_denied: the client's own session
--      sees ZERO clinical_notes rows — including notes ABOUT them
--   3. client INSERT refused (42501 — no client write arm)
--   4. anon SELECT raises 42501 (post-4b grant posture)
--
-- Style: _tap buffer; BEGIN/ROLLBACK.
-- ============================================================================

BEGIN;

SELECT plan(4);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated, anon;

DO $$
DECLARE
  org_z    uuid := '00000000-0000-0000-0000-0000000064a1'::uuid;
  staff_z  uuid;
  client_u uuid;
  cl       uuid := '00000000-0000-0000-0000-0000000064b1'::uuid;
BEGIN
  INSERT INTO organizations (id, name, slug)
  VALUES (org_z, 'Test Org Z — clinical-notes deny 64', 'test-org-z-cnd64');

  staff_z  := public._test_make_user('staff-z-cnd64@test.local');
  client_u := public._test_make_user('client-z-cnd64@test.local');
  PERFORM public._test_grant_membership(staff_z, org_z, 'staff'::user_role);
  PERFORM public._test_grant_membership(client_u, org_z, 'client'::user_role);

  INSERT INTO clients (id, organization_id, user_id, first_name, last_name, email)
  VALUES (cl, org_z, client_u, 'Cli', 'Denied', 'cli-cnd64@test.local');

  INSERT INTO clinical_notes (organization_id, client_id, author_user_id, title, plan)
  VALUES (org_z, cl, staff_z, 'Initial assessment', 'Graded exposure, review in 2 weeks.');

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT org_z, staff_z, client_u, cl;
  GRANT SELECT ON _ids TO authenticated;
END $$;

-- 1. control: staff arm works (so assertion 2's zero cannot be a dead org).
SELECT public._test_set_jwt(
  (SELECT staff_z FROM _ids), (SELECT org_z FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;
INSERT INTO _tap (n, line) VALUES (1, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM clinical_notes
      WHERE client_id = (SELECT cl FROM _ids)),
    1,
    'control: staff reads the clinical note'
  ) AS l
));
RESET ROLE;

-- 2+3. The client's own session.
SELECT public._test_set_jwt(
  (SELECT client_u FROM _ids), (SELECT org_z FROM _ids), 'client'
);
SET LOCAL ROLE authenticated;
INSERT INTO _tap (n, line) VALUES (2, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM clinical_notes),
    0,
    'rls_clinical_notes_select_client_denied: client session sees ZERO clinical notes'
  ) AS l
));

INSERT INTO _tap (n, line) VALUES (3, (
  SELECT string_agg(l, E'\n') FROM throws_ok(
    format(
      $q$INSERT INTO clinical_notes (organization_id, client_id, author_user_id, title, plan)
         VALUES (%L, %L, %L, 'Forged', 'nope')$q$,
      (SELECT org_z FROM _ids), (SELECT cl FROM _ids), (SELECT client_u FROM _ids)
    ),
    '42501', NULL,
    'client INSERT into clinical_notes refused (42501)'
  ) AS l
));
RESET ROLE;

-- 4. anon at the grant layer.
SET LOCAL ROLE anon;
INSERT INTO _tap (n, line) VALUES (4, (
  SELECT string_agg(l, E'\n') FROM throws_ok(
    'SELECT count(*) FROM public.clinical_notes',
    '42501', NULL,
    'anon SELECT on clinical_notes raises 42501'
  ) AS l
));
RESET ROLE;

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
