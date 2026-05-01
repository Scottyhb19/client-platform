-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), is(), finish() etc. resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 08_publish_gate
-- ============================================================================
-- Maps to brief §8 Test 3 — the publish-gate end-to-end, plus the Phase
-- D.5 per-test isolation guarantee that the redesign added.
--
-- 02_never_hard_wall covers the "never always wins" rule. This test
-- focuses on the on_publish lifecycle and the per-test-id discriminator
-- introduced in migration 20260501120000_per_test_publications.
--
-- Three scenarios in one transaction:
--
--   Scenario A — single-test publish lifecycle
--     A1. captured but no publication       → client sees 0 rows
--     A2. publication for (sessionA, KOOS)  → client sees 1 row + framing
--     A3. soft-delete via the RPC           → client sees 0 rows again
--     A4. NEW publication, new framing      → client sees 1 row, NEW framing
--
--   Scenario B — per-test isolation (LOAD-BEARING for D.5)
--     One session captures KOOS + Tampa Scale. Publishing KOOS must NOT
--     leak Tampa (Tampa is `never`, plus there's no Tampa publication
--     anyway — both filters must hold). Then publish a SECOND session
--     where ONLY KOOS is captured; the client sees both KOOS sessions
--     in their portal time series ("progression on the same tab over
--     each testing session" per Q2 sign-off).
--
--   Scenario C — re-publish after unpublish
--     Same (session, test) pair, sequential publish/unpublish/republish.
--     Verifies the unique-active partial index allows fresh inserts after
--     soft-delete and the audit trail keeps both rows.
-- ============================================================================

BEGIN;

SELECT plan(14);

-- ----------------------------------------------------------------------------
-- Fixture setup
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  org_id        uuid := '00000000-0000-0000-0000-0000000000c1'::uuid;
  staff_uid     uuid;
  client_uid    uuid;
  client_row_id uuid := '00000000-0000-0000-0000-0000000000c2'::uuid;
  session_a     uuid := '00000000-0000-0000-0000-0000000000c3'::uuid;
  session_b     uuid := '00000000-0000-0000-0000-0000000000c4'::uuid;
BEGIN
  INSERT INTO organizations (id, name, slug)
  VALUES (org_id, 'Test Org — Publish Gate D.5', 'test-org-publish-gate-d5');

  staff_uid  := public._test_make_user('staff-publish@test.local');
  client_uid := public._test_make_user('client-publish@test.local');

  PERFORM public._test_grant_membership(staff_uid,  org_id, 'staff'::user_role);
  PERFORM public._test_grant_membership(client_uid, org_id, 'client'::user_role);

  INSERT INTO clients (
    id, organization_id, user_id, first_name, last_name, email
  ) VALUES (
    client_row_id, org_id, client_uid, 'Sam', 'Sample', 'sam@test.local'
  );

  PERFORM public._test_set_jwt(staff_uid, org_id, 'staff');

  -- Session A: KOOS pain (on_publish) + Tampa total (never).
  PERFORM public._test_insert_test_session(
    session_a, org_id, client_row_id, staff_uid,
    now() - interval '14 days'
  );
  PERFORM public._test_insert_test_result(
    org_id, session_a, 'pts_koos', 'pain', NULL, 64, '0–100'
  );
  PERFORM public._test_insert_test_result(
    org_id, session_a, 'pts_tampa', 'total_score', NULL, 38, '17–68'
  );

  -- Session B (later): KOOS pain only.
  PERFORM public._test_insert_test_session(
    session_b, org_id, client_row_id, staff_uid,
    now() - interval '1 day'
  );
  PERFORM public._test_insert_test_result(
    org_id, session_b, 'pts_koos', 'pain', NULL, 78, '0–100'
  );

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_id        AS org_id,
    staff_uid     AS staff_uid,
    client_uid    AS client_uid,
    client_row_id AS client_row_id,
    session_a     AS session_a,
    session_b     AS session_b;
  GRANT SELECT ON _ids TO authenticated;
END $$;


-- ============================================================================
-- SCENARIO A — single-test publish lifecycle
-- ============================================================================

-- A1: nothing published yet, client sees 0 KOOS rows on session A.
SELECT public._test_set_jwt(
  (SELECT client_uid FROM _ids),
  (SELECT org_id     FROM _ids),
  'client'
);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM test_results
    WHERE test_session_id = (SELECT session_a FROM _ids)
      AND test_id = 'pts_koos'),
  0,
  'A1: client sees 0 KOOS rows on session A without a publication'
);

RESET ROLE;

-- A2: publish KOOS on session A with framing.
DO $$
DECLARE
  pub_id uuid;
BEGIN
  pub_id := public._test_insert_client_publication(
    (SELECT org_id     FROM _ids),
    (SELECT session_a  FROM _ids),
    (SELECT staff_uid  FROM _ids),
    'pts_koos',
    'Pain has eased — keep the morning mobility going.'
  );
  CREATE TEMP TABLE _pub_a1 ON COMMIT DROP AS SELECT pub_id AS id;
  GRANT SELECT ON _pub_a1 TO authenticated;
END $$;

SELECT public._test_set_jwt(
  (SELECT client_uid FROM _ids),
  (SELECT org_id     FROM _ids),
  'client'
);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM test_results
    WHERE test_session_id = (SELECT session_a FROM _ids)
      AND test_id = 'pts_koos'),
  1,
  'A2: client sees the KOOS row once (sessionA, pts_koos) is published'
);

SELECT is(
  (SELECT framing_text FROM client_publications
    WHERE id = (SELECT id FROM _pub_a1)),
  'Pain has eased — keep the morning mobility going.',
  'A2: framing_text round-trip intact via client read'
);

RESET ROLE;

-- A3: unpublish via the production RPC.
SELECT public._test_set_jwt(
  (SELECT staff_uid FROM _ids),
  (SELECT org_id    FROM _ids),
  'staff'
);
SET LOCAL ROLE authenticated;

SELECT public.soft_delete_client_publication((SELECT id FROM _pub_a1));

RESET ROLE;

SELECT public._test_set_jwt(
  (SELECT client_uid FROM _ids),
  (SELECT org_id     FROM _ids),
  'client'
);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM test_results
    WHERE test_session_id = (SELECT session_a FROM _ids)
      AND test_id = 'pts_koos'),
  0,
  'A3: client loses KOOS visibility once the publication is unpublished'
);

RESET ROLE;


-- ============================================================================
-- SCENARIO B — per-test isolation + progression across sessions
-- ============================================================================

-- B1: Re-publish KOOS on session A (this is the LOAD-BEARING isolation
-- test — a KOOS publication must NOT make Tampa visible on the same
-- session).
DO $$
DECLARE
  pub_id uuid;
BEGIN
  pub_id := public._test_insert_client_publication(
    (SELECT org_id     FROM _ids),
    (SELECT session_a  FROM _ids),
    (SELECT staff_uid  FROM _ids),
    'pts_koos',
    'Initial baseline.'
  );
  CREATE TEMP TABLE _pub_b1 ON COMMIT DROP AS SELECT pub_id AS id;
  GRANT SELECT ON _pub_b1 TO authenticated;
END $$;

SELECT public._test_set_jwt(
  (SELECT client_uid FROM _ids),
  (SELECT org_id     FROM _ids),
  'client'
);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM test_results
    WHERE test_session_id = (SELECT session_a FROM _ids)
      AND test_id = 'pts_koos'),
  1,
  'B1: client sees KOOS on session A (publication exists)'
);

SELECT is(
  (SELECT count(*)::int FROM test_results
    WHERE test_session_id = (SELECT session_a FROM _ids)
      AND test_id = 'pts_tampa'),
  0,
  'B1 LOAD-BEARING: client does NOT see Tampa on session A — KOOS publication does not leak Tampa visibility (per-test isolation)'
);

RESET ROLE;

-- B2: Publish KOOS on session B too. Client now sees BOTH KOOS sessions
-- (the progression-over-time the user requires for the client portal).
DO $$
DECLARE
  pub_id uuid;
BEGIN
  pub_id := public._test_insert_client_publication(
    (SELECT org_id     FROM _ids),
    (SELECT session_b  FROM _ids),
    (SELECT staff_uid  FROM _ids),
    'pts_koos',
    'Two weeks in — the trend is right.'
  );
  CREATE TEMP TABLE _pub_b2 ON COMMIT DROP AS SELECT pub_id AS id;
  GRANT SELECT ON _pub_b2 TO authenticated;
END $$;

SELECT public._test_set_jwt(
  (SELECT client_uid FROM _ids),
  (SELECT org_id     FROM _ids),
  'client'
);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM test_results
    WHERE test_id = 'pts_koos'
      AND metric_id = 'pain'),
  2,
  'B2: client sees KOOS pain across BOTH sessions (progression in client portal)'
);

SELECT is(
  (SELECT count(*)::int FROM client_publications
    WHERE deleted_at IS NULL AND test_id = 'pts_koos'),
  2,
  'B2: two live KOOS publications (one per session, per-test schema)'
);

-- Tampa stays hidden — never always wins, and there's no Tampa publication
-- anyway.
SELECT is(
  (SELECT count(*)::int FROM test_results
    WHERE test_id = 'pts_tampa'),
  0,
  'B2: Tampa stays hidden across all sessions (never wall + no publication)'
);

RESET ROLE;


-- ============================================================================
-- SCENARIO C — re-publish after unpublish (audit trail intact)
-- ============================================================================

-- Unpublish session B, then re-publish with new framing. The unique-active
-- partial index allows the new insert because the previous row has
-- deleted_at set.
SELECT public._test_set_jwt(
  (SELECT staff_uid FROM _ids),
  (SELECT org_id    FROM _ids),
  'staff'
);
SET LOCAL ROLE authenticated;

SELECT public.soft_delete_client_publication((SELECT id FROM _pub_b2));

RESET ROLE;

DO $$
DECLARE
  pub_id uuid;
BEGIN
  pub_id := public._test_insert_client_publication(
    (SELECT org_id     FROM _ids),
    (SELECT session_b  FROM _ids),
    (SELECT staff_uid  FROM _ids),
    'pts_koos',
    'Updated framing — second pass.'
  );
  CREATE TEMP TABLE _pub_c1 ON COMMIT DROP AS SELECT pub_id AS id;
  GRANT SELECT ON _pub_c1 TO authenticated;
END $$;

SELECT public._test_set_jwt(
  (SELECT client_uid FROM _ids),
  (SELECT org_id     FROM _ids),
  'client'
);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM test_results
    WHERE test_session_id = (SELECT session_b FROM _ids)
      AND test_id = 'pts_koos'),
  1,
  'C1: client sees KOOS on session B again after re-publish'
);

SELECT is(
  (SELECT framing_text FROM client_publications
    WHERE id = (SELECT id FROM _pub_c1)),
  'Updated framing — second pass.',
  'C1: NEW framing applies (the soft-deleted row preserves the old; clients only see live)'
);

SELECT is(
  (SELECT count(*)::int FROM client_publications
    WHERE test_session_id = (SELECT session_b FROM _ids)
      AND test_id = 'pts_koos'
      AND deleted_at IS NULL),
  1,
  'C1: exactly one LIVE publication for (session_b, pts_koos)'
);

RESET ROLE;

-- Audit-trail spot check: walk the table from postgres role, verify
-- every publish/unpublish event is preserved. Across both sessions:
--   session_a: 1 soft-deleted (A2 → A3) + 1 live (B1)
--   session_b: 1 soft-deleted (B2 → C unpublish) + 1 live (C1)
SELECT is(
  (SELECT count(*)::int FROM client_publications
    WHERE test_id = 'pts_koos'),
  4,
  'Audit: four publication events preserved (2 soft-deleted + 2 live)'
);

SELECT is(
  (SELECT count(*)::int FROM client_publications
    WHERE test_id = 'pts_koos' AND deleted_at IS NULL),
  2,
  'Audit: exactly two live KOOS publications (one per session)'
);


SELECT * FROM finish();

ROLLBACK;
