-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), is(), throws_ok() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 17_cross_tenant_isolation
-- ============================================================================
-- Closes premortem R-4 (diagnostic CRITICAL #5): the automated cross-tenant
-- regression test that proves one organization cannot read, update, or insert
-- into another organization's rows. Until this landed, the multi-tenant
-- boundary had no automated net — only the manual runbook
-- `docs/runbooks/verify-cross-tenant-isolation.md`, exercised by hand
-- 2026-06-07. This test makes that check repeatable on every migration.
--
-- Division of labour (mirrors the runbook header):
--   - `verify-auth-config.mjs` G-1 proves the JWT hook INJECTS organization_id.
--   - THIS test proves the RLS policies ISOLATE given that organization_id.
-- Both are needed; neither substitutes for the other.
--
-- The deferral assumed a second human practitioner was required. It is not:
-- the test simulates two orgs and two staff via _test_set_jwt JWT-spoofing
-- (same mechanism as 06 and 16), so no second real account is needed.
--
-- Assertions (8), ordered most-critical-first so a failing run surfaces the
-- isolation regression at the top:
--
--   1. read isolation, clients         — staff_b sees ZERO of org_a's client.
--   2. read isolation, clinical_notes  — staff_b sees ZERO of org_a's note.
--   3. read isolation, programs        — staff_b sees ZERO of org_a's program.
--   4. write isolation, UPDATE clients — staff_b UPDATE of org_a's client
--                                        affects 0 rows (RLS USING hides it).
--   5. write isolation, INSERT clients — staff_b INSERT carrying org_a's
--                                        organization_id raises 42501
--                                        (RLS WITH CHECK refuses it).
--   6. anti-trivial control            — staff_b CAN see its OWN client
--                                        (count 1). Proves 1-4 are isolation,
--                                        not a session that sees nothing.
--   7. anti-trivial control            — staff_a CAN see org_a's client
--                                        (count 1). Proves test 1's zero is
--                                        true isolation, not a missing fixture.
--   8. anti-trivial control            — staff_a CAN see org_a's program
--                                        (count 1). Same, for the programs row.
--
-- Coverage note: read isolation is checked on all three core client-scoped
-- tables; write isolation (UPDATE-USING + INSERT-WITH-CHECK) is checked on
-- clients as representative — clinical_notes and programs carry the identical
-- `organization_id = user_organization_id()` policy shape, so clients
-- exercises both write-policy families. The 2026-06-07 manual run covered all
-- eight core tenant tables for read+write; this automated test covers the
-- regression-prone core and runs on every migration.
--
-- Run discipline: BEGIN/ROLLBACK so fixtures never persist. The _tap temp
-- table surfaces all eight TAP lines in one editor grid because the Supabase
-- SQL editor only shows the last statement's result (same mechanism as
-- 15_g13_pending_round_trip.sql and 16_password_recovery_ticket_consume.sql).
-- This project has no non-prod test target (no local Docker), so the file is
-- run as a single batch in the SQL editor against the live project; the
-- BEGIN/ROLLBACK is what makes that safe. finish() is intentionally dropped
-- (same as 15/16) — the eight-row plan count is the check.
-- ============================================================================

BEGIN;

SELECT plan(8);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated;

-- _probe carries the UPDATE row-count out of a data-modifying CTE (a
-- data-modifying WITH cannot be nested inside is()'s scalar-subquery arg,
-- so test 4 writes the count here first, then asserts on it).
CREATE TEMP TABLE _probe (k text PRIMARY KEY, v int NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _probe TO authenticated;


-- ----------------------------------------------------------------------------
-- Fixture (fully privileged — organizations/clients/clinical_notes/programs
-- carry RLS but NOT FORCE ROW LEVEL SECURITY, so the editor's table-owner
-- role bypasses RLS here; only `contacts` and `client_files` force it).
--
--   org_a — staff_a (staff), client_a, one clinical_note, one program.
--   org_b — staff_b (staff), client_b. The cross-tenant attacker context.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  org_a      uuid := '00000000-0000-0000-0000-00000000c701'::uuid;
  org_b      uuid := '00000000-0000-0000-0000-00000000c702'::uuid;
  staff_a    uuid;
  staff_b    uuid;
  client_a   uuid := '00000000-0000-0000-0000-00000000c703'::uuid;
  client_b   uuid := '00000000-0000-0000-0000-00000000c704'::uuid;
  note_a     uuid := '00000000-0000-0000-0000-00000000c705'::uuid;
  program_a  uuid := '00000000-0000-0000-0000-00000000c706'::uuid;
BEGIN
  INSERT INTO organizations (id, name, slug) VALUES
    (org_a, 'Test Org A — XTenant 17', 'test-org-a-xtenant-17'),
    (org_b, 'Test Org B — XTenant 17', 'test-org-b-xtenant-17');

  staff_a := public._test_make_user('staff-a-xtenant17@test.local');
  staff_b := public._test_make_user('staff-b-xtenant17@test.local');

  PERFORM public._test_grant_membership(staff_a, org_a, 'staff'::user_role);
  PERFORM public._test_grant_membership(staff_b, org_b, 'staff'::user_role);

  -- client_a is the isolation target; client_b is staff_b's own-org baseline.
  INSERT INTO clients (id, organization_id, first_name, last_name, email) VALUES
    (client_a, org_a, 'Alpha', 'OrgA', 'client-a-xtenant17@test.local'),
    (client_b, org_b, 'Bravo', 'OrgB', 'client-b-xtenant17@test.local');

  -- body_rich satisfies clinical_notes_content_present; default note_type
  -- 'progress_note' satisfies the injury-flag CHECK (flag fields stay NULL).
  INSERT INTO clinical_notes (id, organization_id, client_id, author_user_id, body_rich) VALUES
    (note_a, org_a, client_a, staff_a, 'xtenant17 org_a clinical note — isolation canary');

  -- start_date + duration_weeks required post-D-PROG-001 (non-overlap EXCLUDE).
  INSERT INTO programs (id, organization_id, client_id, name, start_date, duration_weeks) VALUES
    (program_a, org_a, client_a, 'XTenant17 Org A Program', '2026-04-27'::date, 4);

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_a AS org_a, org_b AS org_b,
    staff_a AS staff_a, staff_b AS staff_b,
    client_a AS client_a, client_b AS client_b,
    note_a AS note_a, program_a AS program_a;
  GRANT SELECT ON _ids TO authenticated;
END $$;


-- ============================================================================
-- Tests 1-6 run under staff_b's session (org_b) — the cross-tenant attacker.
-- ============================================================================
SELECT public._test_set_jwt(
  (SELECT staff_b FROM _ids), (SELECT org_b FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;

-- Test 1 (read isolation, clients): org_a's client is invisible to staff_b.
INSERT INTO _tap (n, line) VALUES (1, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM clients WHERE id = (SELECT client_a FROM _ids)),
    0,
    'read isolation: staff_b (org_b) sees zero of org_a''s client'
  ) AS l
));

-- Test 2 (read isolation, clinical_notes).
INSERT INTO _tap (n, line) VALUES (2, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM clinical_notes WHERE id = (SELECT note_a FROM _ids)),
    0,
    'read isolation: staff_b (org_b) sees zero of org_a''s clinical_note'
  ) AS l
));

-- Test 3 (read isolation, programs).
INSERT INTO _tap (n, line) VALUES (3, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM programs WHERE id = (SELECT program_a FROM _ids)),
    0,
    'read isolation: staff_b (org_b) sees zero of org_a''s program'
  ) AS l
));

-- Test 4 (write isolation, UPDATE): the RLS USING clause hides org_a's client
-- from staff_b, so the UPDATE matches and affects 0 rows. The data-modifying
-- CTE writes its row count to _probe (it cannot be nested in is()).
WITH u AS (
  UPDATE clients SET first_name = 'TAMPERED'
  WHERE id = (SELECT client_a FROM _ids)
  RETURNING 1
)
INSERT INTO _probe (k, v) SELECT 'update_rows_orgA_client', count(*)::int FROM u;

INSERT INTO _tap (n, line) VALUES (4, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT v FROM _probe WHERE k = 'update_rows_orgA_client'),
    0,
    'write isolation: staff_b UPDATE of org_a''s client affects 0 rows'
  ) AS l
));

-- Test 5 (write isolation, INSERT): an INSERT carrying org_a's organization_id
-- fails the RLS WITH CHECK (organization_id must equal user_organization_id()
-- = org_b) and raises 42501. Pin the SQLSTATE; skip the Postgres-controlled
-- errmsg with NULL::text (mirrors 06 and 16's throws_ok discipline).
INSERT INTO _tap (n, line) VALUES (5, (
  SELECT string_agg(l, E'\n') FROM throws_ok(
    format(
      $q$INSERT INTO clients (organization_id, first_name, last_name, email)
         VALUES (%L::uuid, 'Mallory', 'Tamper', 'xtenant17-insert@test.local')$q$,
      (SELECT org_a FROM _ids)
    ),
    '42501',
    NULL::text,
    'write isolation: staff_b INSERT carrying org_a''s organization_id raises 42501'
  ) AS l
));

-- Test 6 (anti-trivial control): staff_b CAN see its own org's client. If this
-- failed, tests 1-4 would be passing only because the session sees nothing.
INSERT INTO _tap (n, line) VALUES (6, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM clients WHERE id = (SELECT client_b FROM _ids)),
    1,
    'control: staff_b sees its own org_b client (proves isolation, not a blind session)'
  ) AS l
));


-- ============================================================================
-- Tests 7-8 run under staff_a's session (org_a) — proves the org_a fixtures
-- exist and are readable by their own org, so tests 1 & 3's zeros are true
-- isolation rather than absent fixtures.
-- ============================================================================
SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;

-- Test 7 (anti-trivial control): client_a exists and staff_a can read it.
INSERT INTO _tap (n, line) VALUES (7, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM clients WHERE id = (SELECT client_a FROM _ids)),
    1,
    'control: staff_a sees org_a''s own client (fixture exists; test 1 zero is isolation)'
  ) AS l
));

-- Test 8 (anti-trivial control): program_a exists and staff_a can read it.
INSERT INTO _tap (n, line) VALUES (8, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM programs WHERE id = (SELECT program_a FROM _ids)),
    1,
    'control: staff_a sees org_a''s own program (fixture exists; test 3 zero is isolation)'
  ) AS l
));


-- ----------------------------------------------------------------------------
-- Surface all eight captured TAP lines in one editor grid. finish() is
-- intentionally dropped (same pattern as 15/16); the eight-row count is the
-- plan check.
-- ----------------------------------------------------------------------------
SELECT line FROM _tap ORDER BY n;

ROLLBACK;
