-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), is(), finish() etc. resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 03_baseline_immutability
-- ============================================================================
-- Maps to brief §8 Test 5 — baseline immutability.
--
-- The first non-deleted session for a (client_id, test_id) combo is
-- baseline. Soft-deleting the baseline session promotes the next
-- chronological session. Restoring the soft-deleted row re-claims
-- baseline. The view test_results_with_baseline derives this on the
-- fly via a window function over non-deleted rows.
--
-- This test exercises three sessions across three months, all for the
-- same client + same test, and walks through the soft-delete /
-- restore cycle.
-- ============================================================================

BEGIN;

SELECT plan(8);

-- ----------------------------------------------------------------------------
-- Fixture setup
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  org_id        uuid := '00000000-0000-0000-0000-0000000000c1'::uuid;
  staff_uid     uuid;
  client_row_id uuid := '00000000-0000-0000-0000-0000000000c2'::uuid;
  session_a     uuid := '00000000-0000-0000-0000-0000000000ca'::uuid;
  session_b     uuid := '00000000-0000-0000-0000-0000000000cb'::uuid;
  session_c     uuid := '00000000-0000-0000-0000-0000000000cc'::uuid;
BEGIN
  INSERT INTO organizations (id, name, slug)
  VALUES (org_id, 'Test Org — Baseline', 'test-org-baseline');

  staff_uid := public._test_make_user('staff-baseline@test.local');
  PERFORM public._test_grant_membership(staff_uid, org_id, 'staff'::user_role);

  INSERT INTO clients (
    id, organization_id, first_name, last_name, email
  ) VALUES (
    client_row_id, org_id, 'Bob', 'Baseline', 'bob@test.local'
  );

  -- Three sessions, three months apart, same client + same test (CMJ
  -- bilateral jump_height — auto visibility, decimal value).
  INSERT INTO test_sessions (id, organization_id, client_id, conducted_by, conducted_at) VALUES
    (session_a, org_id, client_row_id, staff_uid, '2026-01-15 09:00:00+11'::timestamptz),
    (session_b, org_id, client_row_id, staff_uid, '2026-02-15 09:00:00+11'::timestamptz),
    (session_c, org_id, client_row_id, staff_uid, '2026-03-15 09:00:00+11'::timestamptz);

  INSERT INTO test_results (organization_id, test_session_id, test_id, metric_id, side, value, unit) VALUES
    (org_id, session_a, 'fp_cmj_bilateral', 'jump_height', NULL, 32.4, 'cm'),
    (org_id, session_b, 'fp_cmj_bilateral', 'jump_height', NULL, 34.1, 'cm'),
    (org_id, session_c, 'fp_cmj_bilateral', 'jump_height', NULL, 36.8, 'cm');

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_id    AS org_id,
    staff_uid AS staff_uid,
    session_a AS session_a,
    session_b AS session_b,
    session_c AS session_c;
END $$;


-- ----------------------------------------------------------------------------
-- Spoof the staff JWT so the view (which uses security_invoker = on)
-- evaluates RLS as the staff user. Without this the view returns zero
-- rows because authenticated role + no JWT claims = no RLS match.
-- The view's output is the same for any staff user in the org.
-- ----------------------------------------------------------------------------
SELECT public._test_set_jwt(
  (SELECT staff_uid FROM _ids),
  (SELECT org_id    FROM _ids),
  'staff'
);
SET LOCAL ROLE authenticated;


-- ----------------------------------------------------------------------------
-- Initial state: session_a is baseline; b and c are not.
-- ----------------------------------------------------------------------------
SELECT is(
  (SELECT is_baseline FROM test_results_with_baseline
    WHERE test_session_id = (SELECT session_a FROM _ids)
      AND test_id = 'fp_cmj_bilateral'),
  TRUE,
  'Initial: session_a (Jan) is baseline'
);

SELECT is(
  (SELECT is_baseline FROM test_results_with_baseline
    WHERE test_session_id = (SELECT session_b FROM _ids)
      AND test_id = 'fp_cmj_bilateral'),
  FALSE,
  'Initial: session_b (Feb) is NOT baseline'
);

SELECT is(
  (SELECT is_baseline FROM test_results_with_baseline
    WHERE test_session_id = (SELECT session_c FROM _ids)
      AND test_id = 'fp_cmj_bilateral'),
  FALSE,
  'Initial: session_c (Mar) is NOT baseline'
);

-- Function check matches the view.
SELECT is(
  public.test_session_is_baseline((SELECT session_a FROM _ids), 'fp_cmj_bilateral'),
  TRUE,
  'Function: session_a is baseline'
);


-- ----------------------------------------------------------------------------
-- Soft-delete session_a → session_b should now be baseline.
-- ----------------------------------------------------------------------------
UPDATE test_sessions SET deleted_at = now()
 WHERE id = (SELECT session_a FROM _ids);

SELECT is(
  (SELECT is_baseline FROM test_results_with_baseline
    WHERE test_session_id = (SELECT session_b FROM _ids)
      AND test_id = 'fp_cmj_bilateral'),
  TRUE,
  'After soft-deleting session_a: session_b is baseline'
);

-- session_a no longer appears in the view at all (filtered by
-- deleted_at IS NULL in the view definition).
SELECT is(
  (SELECT count(*)::int FROM test_results_with_baseline
    WHERE test_session_id = (SELECT session_a FROM _ids)),
  0,
  'Soft-deleted session_a vanishes from the view'
);


-- ----------------------------------------------------------------------------
-- Restore session_a → session_a re-claims baseline; session_b loses it.
-- ----------------------------------------------------------------------------
UPDATE test_sessions SET deleted_at = NULL
 WHERE id = (SELECT session_a FROM _ids);

SELECT is(
  (SELECT is_baseline FROM test_results_with_baseline
    WHERE test_session_id = (SELECT session_a FROM _ids)
      AND test_id = 'fp_cmj_bilateral'),
  TRUE,
  'After restoring session_a: session_a is baseline again'
);

SELECT is(
  (SELECT is_baseline FROM test_results_with_baseline
    WHERE test_session_id = (SELECT session_b FROM _ids)
      AND test_id = 'fp_cmj_bilateral'),
  FALSE,
  'After restoring session_a: session_b is NOT baseline anymore'
);


SELECT * FROM finish();

ROLLBACK;
