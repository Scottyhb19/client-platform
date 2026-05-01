-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), is(), finish() etc. resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 02_never_hard_wall
-- ============================================================================
-- Maps to brief §8 Test 4 — the LOAD-BEARING security control.
--
-- A Tampa Scale (kinesiophobia) result has client_portal_visibility =
-- 'never' in the seeded schema. Even when the test session is otherwise
-- published, a forged client API request must not return that row.
-- The pgTAP test for this is the canonical proof that RLS, not the UI
-- layer, enforces the hard wall.
--
-- The test also exercises the positive path: a KOOS pain result on the
-- same session IS visible to the client once published. Without this,
-- a passing test could silently mean "RLS hides everything" rather than
-- "RLS hides only the never metrics."
--
-- Soft-deleting the publication then re-checks the on_publish gate: the
-- KOOS row disappears from the client view too.
-- ============================================================================

BEGIN;

SELECT plan(7);

-- ----------------------------------------------------------------------------
-- Fixture setup
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  org_id        uuid := '00000000-0000-0000-0000-0000000000b1'::uuid;
  staff_uid     uuid;
  client_uid    uuid;
  client_row_id uuid := '00000000-0000-0000-0000-0000000000b2'::uuid;
  session_id    uuid := '00000000-0000-0000-0000-0000000000b3'::uuid;
BEGIN
  -- Org
  INSERT INTO organizations (id, name, slug)
  VALUES (org_id, 'Test Org — Never Wall', 'test-org-never-wall');

  -- Staff + client users
  staff_uid  := public._test_make_user('staff-never@test.local');
  client_uid := public._test_make_user('client-never@test.local');

  -- Memberships
  PERFORM public._test_grant_membership(staff_uid,  org_id, 'staff'::user_role);
  PERFORM public._test_grant_membership(client_uid, org_id, 'client'::user_role);

  -- Clients row linking the client user to the org
  INSERT INTO clients (
    id, organization_id, user_id, first_name, last_name, email
  ) VALUES (
    client_row_id, org_id, client_uid, 'Pat', 'Patient', 'pat@test.local'
  );

  -- Spoof the staff JWT for any later RLS-evaluated queries.
  PERFORM public._test_set_jwt(staff_uid, org_id, 'staff');

  -- One session containing two results: a Tampa Scale (never) AND a KOOS
  -- pain subscale (on_publish). Both belong to the same session so a
  -- "publish the session" action affects them differently.
  -- Use the SECURITY DEFINER helpers to dodge SQL-Editor RLS quirks.
  PERFORM public._test_insert_test_session(
    session_id, org_id, client_row_id, staff_uid,
    now() - interval '1 day'
  );

  PERFORM public._test_insert_test_result(
    org_id, session_id, 'pts_tampa', 'total_score', NULL, 38, '17–68'
  );
  PERFORM public._test_insert_test_result(
    org_id, session_id, 'pts_koos', 'pain', NULL, 72, '0–100'
  );

  -- Publish KOOS for this session (per-test granularity, Phase D.5).
  -- Tampa is intentionally NOT published — even if it were, the never
  -- hard wall would still hide it.
  PERFORM public._test_insert_client_publication(
    org_id, session_id, staff_uid,
    'pts_koos',
    'Initial baseline — your starting point.'
  );

  -- Stash IDs in a session-local table so the assertions below can
  -- reach them. GRANT SELECT to authenticated because later assertions
  -- SET LOCAL ROLE authenticated to test RLS — without the grant the
  -- temp table (owned by postgres) is invisible to authenticated.
  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_id        AS org_id,
    staff_uid     AS staff_uid,
    client_uid    AS client_uid,
    client_row_id AS client_row_id,
    session_id    AS session_id;
  GRANT SELECT ON _ids TO authenticated;
END $$;


-- ----------------------------------------------------------------------------
-- Sanity check (1): from the postgres role with no JWT spoof, both rows
-- are visible. Confirms the fixtures are wired before any RLS work.
-- ----------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM test_results
    WHERE test_session_id = (SELECT session_id FROM _ids)),
  2,
  'Sanity: postgres can see both fixture rows on the session'
);


-- ----------------------------------------------------------------------------
-- AS STAFF: both rows visible.
-- ----------------------------------------------------------------------------
SELECT public._test_set_jwt(
  (SELECT staff_uid     FROM _ids),
  (SELECT org_id        FROM _ids),
  'staff'
);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM test_results
    WHERE test_session_id = (SELECT session_id FROM _ids)),
  2,
  'Staff sees both Tampa Scale and KOOS rows'
);

SELECT is(
  (SELECT count(*)::int FROM test_results
    WHERE test_session_id = (SELECT session_id FROM _ids)
      AND test_id = 'pts_tampa'),
  1,
  'Staff sees the Tampa Scale row directly'
);

RESET ROLE;


-- ----------------------------------------------------------------------------
-- AS CLIENT (with publication): KOOS visible, Tampa NOT visible.
-- This is the load-bearing assertion.
-- ----------------------------------------------------------------------------
SELECT public._test_set_jwt(
  (SELECT client_uid    FROM _ids),
  (SELECT org_id        FROM _ids),
  'client'
);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM test_results
    WHERE test_session_id = (SELECT session_id FROM _ids)
      AND test_id = 'pts_tampa'),
  0,
  'LOAD-BEARING: client cannot see Tampa Scale even with session published'
);

SELECT is(
  (SELECT count(*)::int FROM test_results
    WHERE test_session_id = (SELECT session_id FROM _ids)
      AND test_id = 'pts_koos'),
  1,
  'Client CAN see KOOS pain (on_publish + publication exists)'
);

RESET ROLE;


-- ----------------------------------------------------------------------------
-- Soft-delete the publication. Re-test as client: KOOS now hidden
-- (publication gate closed). Tampa stays hidden (it never opened).
-- ----------------------------------------------------------------------------
UPDATE client_publications
   SET deleted_at = now()
 WHERE test_session_id = (SELECT session_id FROM _ids);

SELECT public._test_set_jwt(
  (SELECT client_uid    FROM _ids),
  (SELECT org_id        FROM _ids),
  'client'
);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM test_results
    WHERE test_session_id = (SELECT session_id FROM _ids)
      AND test_id = 'pts_koos'),
  0,
  'Client loses KOOS visibility once publication is soft-deleted'
);

SELECT is(
  (SELECT count(*)::int FROM test_results
    WHERE test_session_id = (SELECT session_id FROM _ids)
      AND test_id = 'pts_tampa'),
  0,
  'Tampa stays hidden after publication soft-delete (never always wins)'
);

RESET ROLE;


SELECT * FROM finish();

ROLLBACK;
