-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), ok() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 31_client_unavailable_types_hidden
-- ============================================================================
-- Why: P1-7 (FM-19) of the scheduling (section 9) polish pass
-- (docs/polish/scheduling.md). Proves the tightened client SELECT policy on
-- session_types (20260615160000_client_session_types_appointment_only) hides
-- Unavailable-kind types from clients at the RLS layer — so the portal booking
-- picker can never offer the EP's admin / meeting / break time as bookable.
-- That migration added `AND kind = 'appointment'` to the client SELECT USING
-- clause; this file is the regression tripwire for that predicate (drop it and
-- assertion 1 flips to count 1).
--
-- ROLE SWITCH — read this, it differs from 27/29. The sibling tests
-- 27_appointment_overlap and 29_reminder_lifecycle do NOT switch role at all:
-- their properties are an EXCLUDE constraint and a trigger, which fire whoever
-- inserts, so they run wholly as the test owner. THIS property is RLS-governed,
-- so it is only observable from inside a client session. The pattern is
-- therefore the one from 19_cmh_client_select_denied:
--   1. public._test_set_jwt(uid, org, 'client') — user_organization_id() and
--      user_role() read straight from request.jwt.claims (20260420100300), so
--      spoofing the claims is what makes RLS treat the session as the client.
--   2. SET LOCAL ROLE authenticated — session_types has RLS but NOT FORCE ROW
--      LEVEL SECURITY, so the owner role would bypass RLS and see the canary;
--      dropping to authenticated is what makes the policy actually apply.
--
-- Fixture (built as the owner inside BEGIN/ROLLBACK, bypassing RLS): an org, a
-- client member, and TWO session_types canary rows in that org — one
-- Unavailable-kind (the denial target, assertion 1) and one Appointment-kind
-- (the liveness control's entitled row, assertion 2). seed_organization_defaults
-- does NOT fire on a bare organizations INSERT (it is called only by the
-- bootstrap RPC), so the org starts empty: without the Unavailable canary
-- assertion 1 would pass vacuously, and without the Appointment canary
-- assertion 2 (count 1) could not hold — the canaries are what give both teeth.
-- The owner inserting them sees both (RLS bypassed); the SET LOCAL ROLE
-- authenticated below is what walls the client off from the Unavailable one.
--
--   1. a client-role SELECT on session_types returns zero Unavailable-kind rows
--      in the client's own org (the denial).
--   2. anti-trivial liveness control (modelled on 19_cmh_client_select_denied
--      19:131-138): the SAME client session DOES see the org's one
--      Appointment-kind row (count 1) — proving the JWT spoof is live and RLS is
--      actually applying, so assertion 1's zero is a real denial and not a
--      NULL-org vacuous pass (claims unset → user_organization_id() NULL →
--      every policy matches zero rows).
--
-- Note: no INSERT-refusal assertion — clients have no INSERT policy on
-- session_types (20260423100000 grants INSERT to staff only), so that vector is
-- structurally absent, not testable here.
-- Test count: 2
-- ============================================================================

BEGIN;

SELECT plan(2);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated;

-- ----------------------------------------------------------------------------
-- Fixture (fully privileged — session_types carries RLS but NOT FORCE ROW
-- LEVEL SECURITY, so the owner role bypasses RLS for these inserts; the same
-- property 19_cmh_client_select_denied relies on).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_org        uuid := '00000000-0000-0000-0000-0000000a9301'::uuid;
  v_client_uid uuid;
BEGIN
  INSERT INTO organizations (id, name, slug)
    VALUES (v_org, 'P17 Client Type Visibility Org', 'p17-client-type-visibility-org');

  v_client_uid := public._test_make_user('p17-client@test.local');
  PERFORM public._test_grant_membership(v_client_uid, v_org, 'client'::user_role);

  -- Canary A — the denial target: an Unavailable-kind type in the client's OWN
  -- org. Under the tightened policy the client must NOT see it; under the OLD
  -- policy (20260510120100, no kind predicate) the client WOULD have.
  INSERT INTO session_types (organization_id, name, color, sort_order, kind)
    VALUES (v_org, 'Admin/paperwork', '#78716c', 110, 'unavailable');

  -- Canary B — the liveness control's entitled row: one Appointment-kind type
  -- the client IS allowed to see. Assertion 2 reads this (count 1), proving the
  -- session is a live client, so assertion 1's zero is a real denial.
  INSERT INTO session_types (organization_id, name, color, sort_order, kind)
    VALUES (v_org, 'Session', '#1E1A18', 10, 'appointment');

  CREATE TEMP TABLE _ids ON COMMIT DROP AS
    SELECT v_client_uid AS client_uid, v_org AS org;
  GRANT SELECT ON _ids TO authenticated;
END $$;

-- ----------------------------------------------------------------------------
-- Switch into the client session: spoof the JWT claims, then drop from the
-- owner role to authenticated so RLS is enforced (owner has BYPASSRLS). Same
-- two-step as 19_cmh_client_select_denied (lines 114-117).
-- ----------------------------------------------------------------------------
SELECT public._test_set_jwt(
  (SELECT client_uid FROM _ids), (SELECT org FROM _ids), 'client'
);
SET LOCAL ROLE authenticated;

-- Test 1 (LOAD-BEARING): the client session sees ZERO Unavailable-kind rows.
INSERT INTO _tap (n, line)
SELECT 1, string_agg(l, E'\n') FROM ok(
  (SELECT count(*) FROM session_types
    WHERE organization_id = (SELECT org FROM _ids)
      AND kind = 'unavailable') = 0,
  '1: a client-role SELECT on session_types returns zero Unavailable-kind rows (P1-7, RLS-enforced)'
) AS l;

-- Test 2 (anti-trivial liveness control, modelled on 19_cmh_client_select_denied
-- 19:131-138): the SAME client session DOES see the org's one Appointment-kind
-- row. If the JWT spoof were dead, user_organization_id() would be NULL, the
-- policy would match zero rows, and this count would be 0 — so this is what
-- proves assertion 1's zero is a genuine denial, not a vacuous NULL-org pass.
INSERT INTO _tap (n, line)
SELECT 2, string_agg(l, E'\n') FROM ok(
  (SELECT count(*) FROM session_types
    WHERE organization_id = (SELECT org FROM _ids)
      AND kind = 'appointment') = 1,
  '2: control — the same client session DOES see the org''s appointment-kind type (count 1; session is live, not blind)'
) AS l;

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
