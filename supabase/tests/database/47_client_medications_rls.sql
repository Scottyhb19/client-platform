-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), is(), ok() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 47_client_medications_rls
-- ============================================================================
-- RLS coverage for client_medications (migration 20260629140000), mirroring
-- 19_cmh_client_select_denied.sql — the client_medical_history RLS suite — with
-- the same assertions retargeted at client_medications. client_medications was
-- created Pattern A (staff-only SELECT) from the start, the same posture CN-2
-- gave client_medical_history: a medication and its context_note are
-- clinical-adjacent and walled from clients (operator rule 2026-06-11). This
-- file proves a client cannot read a medication row even for its OWN client_id.
--
-- This is WITHIN-org role gating, distinct from 17_cross_tenant_isolation
-- (which proves org A cannot read org B). 17 cannot catch a regression here:
-- its property is cross-org, this one's is same-org-client-denied.
--
-- §A — RLS isolation (3 assertions, the mirror of test 19), most-critical first:
--   1. LOAD-BEARING — a client session sees ZERO of its own org's
--      client_medications rows, even for its own client_id.
--   2. positive control — a staff session in the SAME org sees that row
--      (count 1). Proves assertion 1's zero is role-gating, not an absent or
--      broken fixture.
--   3. anti-trivial control — the same client session CAN see its own clients
--      row (count 1). Proves the client JWT context is live, not a blind
--      session that sees nothing.
--
-- §B — RPC grant tripwire (4 assertions) for the soft-delete / restore pair
-- introduced by the same migration. The Supabase auto-grant trap means
-- REVOKE FROM PUBLIC + GRANT authenticated leaves anon a direct EXECUTE; the
-- migration REVOKEs FROM anon explicitly, and these assertions catch a future
-- CREATE OR REPLACE silently re-granting anon. Mirrors 38_soft_delete_restore_grants.
--
-- Style mirrors 19/15/16/17: buffered into _tap so all TAP lines surface in one
-- Supabase SQL-Editor grid (no non-prod test target — no Docker); the
-- BEGIN/ROLLBACK makes the in-editor batch safe. finish() is intentionally
-- dropped; the plan count is the check. The §A ok N prefixes print out of
-- numeric sequence in the grid (load-bearing runs first, the staff control runs
-- last after RESET ROLE, but the final SELECT sorts by _tap.n) — all ok, the
-- out-of-order numbering is expected, exactly as documented in test 19.
-- ============================================================================

BEGIN;

SELECT plan(7);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated;


-- ----------------------------------------------------------------------------
-- Fixture (fully privileged — client_medications carries RLS but NOT FORCE ROW
-- LEVEL SECURITY, so the editor's table-owner role bypasses RLS for these
-- inserts; the same property test 17/19 rely on).
--
--   org_m — staff_m (staff), client_m (client) linked via clients.user_id,
--           one client_medications row owned by client_m's clients row.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  org_m         uuid := '00000000-0000-0000-0000-0000000eed01'::uuid;
  staff_m       uuid;
  client_m      uuid;
  client_row_id uuid := '00000000-0000-0000-0000-0000000eed02'::uuid;
  med_id        uuid := '00000000-0000-0000-0000-0000000eed03'::uuid;
BEGIN
  INSERT INTO organizations (id, name, slug)
  VALUES (org_m, 'Test Org M — medications client-deny 47', 'test-org-m-meds-deny-47');

  staff_m  := public._test_make_user('staff-meds-deny47@test.local');
  client_m := public._test_make_user('client-meds-deny47@test.local');

  PERFORM public._test_grant_membership(staff_m,  org_m, 'staff'::user_role);
  PERFORM public._test_grant_membership(client_m, org_m, 'client'::user_role);

  -- clients.user_id = client_m is exactly what a Pattern-B SELECT subquery
  -- would have matched on; under Pattern A (staff-only) the client sees zero.
  INSERT INTO clients (id, organization_id, user_id, first_name, last_name, email)
  VALUES (client_row_id, org_m, client_m, 'Morgan', 'Patient', 'morgan-meds47@test.local');

  -- The medication the client must NOT be able to read. context_note carries
  -- the practitioner context this table walls off, exactly like
  -- client_medical_history.notes.
  INSERT INTO client_medications
    (id, organization_id, client_id, name, context_note, is_active)
  VALUES (
    med_id, org_m, client_row_id,
    'Canary medication 47',
    'Practitioner context that must never reach the client.', true
  );

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_m AS org_m, staff_m AS staff_m, client_m AS client_m,
    client_row_id AS client_row_id, med_id AS med_id;
  GRANT SELECT ON _ids TO authenticated;
END $$;


-- ============================================================================
-- §A tests 1 and 3 run under the client session (org_m) — the denial target.
-- ============================================================================
SELECT public._test_set_jwt(
  (SELECT client_m FROM _ids), (SELECT org_m FROM _ids), 'client'
);
SET LOCAL ROLE authenticated;

-- Test 1 (LOAD-BEARING): client session sees ZERO of its own medication rows.
INSERT INTO _tap (n, line) VALUES (1, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM client_medications
      WHERE client_id = (SELECT client_row_id FROM _ids)),
    0,
    'LOAD-BEARING: client sees zero of its own client_medications rows'
  ) AS l
));

-- Test 3 (anti-trivial control): still under the client session, the client
-- CAN read its own clients row, proving the session is live, not blind.
INSERT INTO _tap (n, line) VALUES (3, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM clients
      WHERE id = (SELECT client_row_id FROM _ids)),
    1,
    'control: client CAN see its own clients row (session is live, not blind)'
  ) AS l
));


-- ============================================================================
-- §A test 2 (positive control): staff session in the SAME org sees the row.
-- Reset to the owner role first, then spoof the staff JWT and drop back to
-- authenticated — the between-block reset idiom from test 19 / 02.
-- ============================================================================
RESET ROLE;

SELECT public._test_set_jwt(
  (SELECT staff_m FROM _ids), (SELECT org_m FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;

INSERT INTO _tap (n, line) VALUES (2, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM client_medications
      WHERE id = (SELECT med_id FROM _ids)),
    1,
    'control: staff in same org sees the medication row (test 1 zero is role-gating, not absent fixture)'
  ) AS l
));


-- ============================================================================
-- §B RPC grant tripwire (4) — catalog checks; reset to the test-owner role so
-- has_function_privilege reads the true grants, not a spoofed session.
-- ============================================================================
RESET ROLE;

-- 4: anon cannot execute soft_delete_client_medications.
INSERT INTO _tap (n, line) VALUES (4, (
  SELECT string_agg(l, E'\n') FROM ok(
    NOT has_function_privilege('anon', 'public.soft_delete_client_medications(uuid)', 'EXECUTE'),
    'B1: anon cannot execute soft_delete_client_medications'
  ) AS l
));

-- 5: anon cannot execute restore_client_medications.
INSERT INTO _tap (n, line) VALUES (5, (
  SELECT string_agg(l, E'\n') FROM ok(
    NOT has_function_privilege('anon', 'public.restore_client_medications(uuid)', 'EXECUTE'),
    'B2: anon cannot execute restore_client_medications'
  ) AS l
));

-- 6: authenticated KEEPS EXECUTE on soft_delete_client_medications (staff app path).
INSERT INTO _tap (n, line) VALUES (6, (
  SELECT string_agg(l, E'\n') FROM ok(
    has_function_privilege('authenticated', 'public.soft_delete_client_medications(uuid)', 'EXECUTE'),
    'B3: authenticated keeps EXECUTE on soft_delete_client_medications'
  ) AS l
));

-- 7: authenticated KEEPS EXECUTE on restore_client_medications.
INSERT INTO _tap (n, line) VALUES (7, (
  SELECT string_agg(l, E'\n') FROM ok(
    has_function_privilege('authenticated', 'public.restore_client_medications(uuid)', 'EXECUTE'),
    'B4: authenticated keeps EXECUTE on restore_client_medications'
  ) AS l
));


-- ----------------------------------------------------------------------------
-- Surface all captured TAP lines in one editor grid.
-- ----------------------------------------------------------------------------
SELECT line FROM _tap ORDER BY n;

ROLLBACK;
