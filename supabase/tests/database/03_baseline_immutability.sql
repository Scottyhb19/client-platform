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
-- baseline. The view test_results_with_baseline derives this on the fly.
--
-- ----------------------------------------------------------------------------
-- The soft-delete / restore wrinkle
-- ----------------------------------------------------------------------------
-- Running `UPDATE test_sessions SET deleted_at = now()` as the staff user
-- fails with 42501. The mechanism: PostgreSQL evaluates the SELECT policy
-- on the post-UPDATE row to verify visibility, the SELECT policy requires
-- `deleted_at IS NULL`, and the just-mutated row violates that. (Same
-- class of issue documented in memory/project_postgrest_soft_delete_rls.)
--
-- The production app handles this with SECURITY DEFINER RPCs. For the
-- test we briefly toggle FORCE RLS off, do the soft-delete as the table
-- owner (postgres, which bypasses RLS without FORCE), and toggle FORCE
-- back on. All of this rolls back at end of transaction.
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
  session_a     uuid;
  session_b     uuid;
  session_c     uuid;
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

  PERFORM public._test_set_jwt(staff_uid, org_id, 'staff');
  EXECUTE 'SET LOCAL ROLE authenticated';

  session_a := public.create_test_session(
    client_row_id,
    now() - interval '90 days',
    'manual'::test_source_t,
    NULL::uuid, NULL::text, NULL::uuid,
    jsonb_build_array(jsonb_build_object(
      'test_id',   'fp_cmj_bilateral',
      'metric_id', 'jump_height',
      'side',      NULL,
      'value',     32.4,
      'unit',      'cm'
    ))
  );
  session_b := public.create_test_session(
    client_row_id,
    now() - interval '60 days',
    'manual'::test_source_t,
    NULL::uuid, NULL::text, NULL::uuid,
    jsonb_build_array(jsonb_build_object(
      'test_id',   'fp_cmj_bilateral',
      'metric_id', 'jump_height',
      'side',      NULL,
      'value',     34.1,
      'unit',      'cm'
    ))
  );
  session_c := public.create_test_session(
    client_row_id,
    now() - interval '30 days',
    'manual'::test_source_t,
    NULL::uuid, NULL::text, NULL::uuid,
    jsonb_build_array(jsonb_build_object(
      'test_id',   'fp_cmj_bilateral',
      'metric_id', 'jump_height',
      'side',      NULL,
      'value',     36.8,
      'unit',      'cm'
    ))
  );

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_id    AS org_id,
    staff_uid AS staff_uid,
    session_a AS session_a,
    session_b AS session_b,
    session_c AS session_c;
  GRANT SELECT ON _ids TO authenticated;
END $$;


-- ----------------------------------------------------------------------------
-- Re-spoof the staff JWT for the assertion phase. The view uses
-- security_invoker = on, so RLS evaluates as the staff user.
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

SELECT is(
  public.test_session_is_baseline((SELECT session_a FROM _ids), 'fp_cmj_bilateral'),
  TRUE,
  'Function: session_a is baseline'
);


-- ----------------------------------------------------------------------------
-- Soft-delete session_a. The staff-as-authenticated UPDATE would fail
-- with 42501 because of the SELECT-policy / deleted_at-IS-NULL gotcha
-- (see header). Owner-with-NO-FORCE bypass below; rolls back at the end.
-- ----------------------------------------------------------------------------
RESET ROLE;
ALTER TABLE test_sessions NO FORCE ROW LEVEL SECURITY;
UPDATE test_sessions SET deleted_at = now()
 WHERE id = (SELECT session_a FROM _ids);
ALTER TABLE test_sessions FORCE ROW LEVEL SECURITY;
SELECT public._test_set_jwt(
  (SELECT staff_uid FROM _ids),
  (SELECT org_id    FROM _ids),
  'staff'
);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT is_baseline FROM test_results_with_baseline
    WHERE test_session_id = (SELECT session_b FROM _ids)
      AND test_id = 'fp_cmj_bilateral'),
  TRUE,
  'After soft-deleting session_a: session_b is baseline'
);

SELECT is(
  (SELECT count(*)::int FROM test_results_with_baseline
    WHERE test_session_id = (SELECT session_a FROM _ids)),
  0,
  'Soft-deleted session_a vanishes from the view'
);


-- ----------------------------------------------------------------------------
-- Restore session_a. Same owner-bypass dance — see comment above.
-- ----------------------------------------------------------------------------
RESET ROLE;
ALTER TABLE test_sessions NO FORCE ROW LEVEL SECURITY;
UPDATE test_sessions SET deleted_at = NULL
 WHERE id = (SELECT session_a FROM _ids);
ALTER TABLE test_sessions FORCE ROW LEVEL SECURITY;
SELECT public._test_set_jwt(
  (SELECT staff_uid FROM _ids),
  (SELECT org_id    FROM _ids),
  'staff'
);
SET LOCAL ROLE authenticated;

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
