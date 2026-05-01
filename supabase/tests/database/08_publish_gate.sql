-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), is(), finish() etc. resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 08_publish_gate
-- ============================================================================
-- Maps to brief §8 Test 3 — the publish-gate end-to-end.
--
-- 02_never_hard_wall covers the "never always wins" rule and includes the
-- happy path of "publication exists → client sees the on_publish row." It
-- does NOT exercise the BEFORE-publication state explicitly, nor does it
-- verify the framing_text round-trip, nor does it test the re-publish-with-
-- new-framing flow that the Phase D.4 UI uses.
--
-- This test walks the full lifecycle for a single on_publish metric:
--   A. captured but NOT published       → client sees 0 rows
--   B. publication with framing_text    → client sees 1 row + can read framing
--   C. publication soft-deleted         → client sees 0 rows again
--   D. NEW publication with new framing → client sees 1 row + new framing
--
-- The unique-active partial index on client_publications (test_session_id)
-- WHERE deleted_at IS NULL guarantees state D is allowed: the soft-deleted
-- row from state C is excluded, so an INSERT for a fresh publication on
-- the same session succeeds.
-- ============================================================================

BEGIN;

SELECT plan(11);

-- ----------------------------------------------------------------------------
-- Fixture setup
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  org_id        uuid := '00000000-0000-0000-0000-0000000000c1'::uuid;
  staff_uid     uuid;
  client_uid    uuid;
  client_row_id uuid := '00000000-0000-0000-0000-0000000000c2'::uuid;
  session_id    uuid := '00000000-0000-0000-0000-0000000000c3'::uuid;
BEGIN
  -- Org
  INSERT INTO organizations (id, name, slug)
  VALUES (org_id, 'Test Org — Publish Gate', 'test-org-publish-gate');

  -- Staff + client users
  staff_uid  := public._test_make_user('staff-publish@test.local');
  client_uid := public._test_make_user('client-publish@test.local');

  -- Memberships
  PERFORM public._test_grant_membership(staff_uid,  org_id, 'staff'::user_role);
  PERFORM public._test_grant_membership(client_uid, org_id, 'client'::user_role);

  -- Clients row linking the client user to the org
  INSERT INTO clients (
    id, organization_id, user_id, first_name, last_name, email
  ) VALUES (
    client_row_id, org_id, client_uid, 'Sam', 'Sample', 'sam@test.local'
  );

  -- Session with a single on_publish metric (KOOS pain). No publication
  -- inserted at this stage — that's the state-A check below.
  PERFORM public._test_set_jwt(staff_uid, org_id, 'staff');
  PERFORM public._test_insert_test_session(
    session_id, org_id, client_row_id, staff_uid,
    now() - interval '1 day'
  );
  PERFORM public._test_insert_test_result(
    org_id, session_id, 'pts_koos', 'pain', NULL, 64, '0–100'
  );

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_id        AS org_id,
    staff_uid     AS staff_uid,
    client_uid    AS client_uid,
    client_row_id AS client_row_id,
    session_id    AS session_id;
  GRANT SELECT ON _ids TO authenticated;
END $$;


-- ----------------------------------------------------------------------------
-- Sanity: postgres role sees the result regardless of RLS.
-- ----------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM test_results
    WHERE test_session_id = (SELECT session_id FROM _ids)
      AND test_id = 'pts_koos'),
  1,
  'Sanity: KOOS row exists for the test session'
);


-- ----------------------------------------------------------------------------
-- STATE A — no publication yet. Client must see zero rows on the session.
-- This is the "captured, not published" state that lands in the publish
-- tab's "Needs review" section.
-- ----------------------------------------------------------------------------
SELECT public._test_set_jwt(
  (SELECT client_uid FROM _ids),
  (SELECT org_id     FROM _ids),
  'client'
);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM test_results
    WHERE test_session_id = (SELECT session_id FROM _ids)),
  0,
  'STATE A: client sees 0 rows for an on_publish metric without a live publication'
);

SELECT is(
  (SELECT count(*)::int FROM client_publications
    WHERE test_session_id = (SELECT session_id FROM _ids)),
  0,
  'STATE A: client sees 0 publications for the session'
);

RESET ROLE;


-- ----------------------------------------------------------------------------
-- STATE B — publish with framing_text. Client should now see the result
-- AND be able to read the framing on the publication row.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  pub_id uuid;
BEGIN
  pub_id := public._test_insert_client_publication(
    (SELECT org_id     FROM _ids),
    (SELECT session_id FROM _ids),
    (SELECT staff_uid  FROM _ids),
    'Pain has eased — keep the morning mobility going.'
  );
  -- Stash the publication id for later assertions.
  CREATE TEMP TABLE _pub_a ON COMMIT DROP AS SELECT pub_id AS id;
  GRANT SELECT ON _pub_a TO authenticated;
END $$;

SELECT public._test_set_jwt(
  (SELECT client_uid FROM _ids),
  (SELECT org_id     FROM _ids),
  'client'
);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM test_results
    WHERE test_session_id = (SELECT session_id FROM _ids)),
  1,
  'STATE B: client sees the KOOS row once the publication is live'
);

SELECT is(
  (SELECT count(*)::int FROM client_publications
    WHERE test_session_id = (SELECT session_id FROM _ids)
      AND deleted_at IS NULL),
  1,
  'STATE B: client sees the live publication row'
);

SELECT is(
  (SELECT framing_text FROM client_publications
    WHERE id = (SELECT id FROM _pub_a)),
  'Pain has eased — keep the morning mobility going.',
  'STATE B: framing_text is readable by the client (round-trip intact)'
);

RESET ROLE;


-- ----------------------------------------------------------------------------
-- STATE C — soft-delete the publication via the production RPC. Client
-- should lose visibility on both the result and the publication row.
-- Routing through soft_delete_client_publication (rather than a raw
-- UPDATE) covers the path the staff Unpublish action actually uses.
-- ----------------------------------------------------------------------------
SELECT public._test_set_jwt(
  (SELECT staff_uid FROM _ids),
  (SELECT org_id    FROM _ids),
  'staff'
);
SET LOCAL ROLE authenticated;

SELECT public.soft_delete_client_publication((SELECT id FROM _pub_a));

RESET ROLE;

SELECT public._test_set_jwt(
  (SELECT client_uid FROM _ids),
  (SELECT org_id     FROM _ids),
  'client'
);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM test_results
    WHERE test_session_id = (SELECT session_id FROM _ids)),
  0,
  'STATE C: client loses KOOS visibility once the publication is unpublished'
);

SELECT is(
  (SELECT count(*)::int FROM client_publications
    WHERE test_session_id = (SELECT session_id FROM _ids)
      AND deleted_at IS NULL),
  0,
  'STATE C: client sees 0 LIVE publications for the session'
);

RESET ROLE;


-- ----------------------------------------------------------------------------
-- STATE D — re-publish with NEW framing_text. The unique-active partial
-- index allows this insert because the previous row is soft-deleted.
-- Client sees the result again, plus the NEW framing (not the old one).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  pub_id uuid;
BEGIN
  pub_id := public._test_insert_client_publication(
    (SELECT org_id     FROM _ids),
    (SELECT session_id FROM _ids),
    (SELECT staff_uid  FROM _ids),
    'Updated framing — second pass.'
  );
  CREATE TEMP TABLE _pub_b ON COMMIT DROP AS SELECT pub_id AS id;
  GRANT SELECT ON _pub_b TO authenticated;
END $$;

SELECT public._test_set_jwt(
  (SELECT client_uid FROM _ids),
  (SELECT org_id     FROM _ids),
  'client'
);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM test_results
    WHERE test_session_id = (SELECT session_id FROM _ids)),
  1,
  'STATE D: client sees the KOOS row again after re-publish'
);

SELECT is(
  (SELECT count(*)::int FROM client_publications
    WHERE test_session_id = (SELECT session_id FROM _ids)
      AND deleted_at IS NULL),
  1,
  'STATE D: client sees one (and only one) live publication after re-publish'
);

SELECT is(
  (SELECT framing_text FROM client_publications
    WHERE id = (SELECT id FROM _pub_b)),
  'Updated framing — second pass.',
  'STATE D: NEW framing replaces the old (audit trail preserves both rows in the table)'
);

RESET ROLE;


-- ----------------------------------------------------------------------------
-- Audit-trail spot check (back to postgres role): both publications still
-- exist on the table (one soft-deleted, one live). The history is intact.
-- ----------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM client_publications
    WHERE test_session_id = (SELECT session_id FROM _ids)),
  2,
  'Audit: both publish events preserved (1 soft-deleted + 1 live)'
);


SELECT * FROM finish();

ROLLBACK;
