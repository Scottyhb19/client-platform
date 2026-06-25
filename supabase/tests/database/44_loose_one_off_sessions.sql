-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), is(), ok() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 44_loose_one_off_sessions
-- ============================================================================
-- Why: item 3 (2026-06-25, docs/polish/one-off-sessions.md). create_program_day
-- must let an EP add a session on a date NO dated block covers, by attaching it
-- to a per-client get-or-created "loose" container (programs.is_loose), without
-- minting a second container and without stealing dates a real block covers.
--
--   A1 one-off on a block-less date returns status='created'.
--   A2 exactly one loose container exists for the client afterwards.
--   A3 that one-off day attaches to the loose container.
--   A4 a second block-less one-off reuses the SAME container (no duplicate).
--   A5 a date INSIDE a dated block attaches to the block (block wins, not loose).
--
-- Dates are CURRENT_DATE-relative so the run is date-robust.
--
-- Test count: 5
-- ============================================================================

BEGIN;

SELECT plan(5);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated;

CREATE TEMP TABLE _calls (k text PRIMARY KEY, result jsonb) ON COMMIT DROP;
GRANT INSERT, SELECT ON _calls TO authenticated;


-- ----------------------------------------------------------------------------
-- §1. Fixture (test owner / BYPASSRLS): an org, an OWNER user, a client, and a
-- dated active block covering [CURRENT_DATE, CURRENT_DATE + 14). No program_days
-- yet — _program_for_date resolves the block purely from its date range.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  org_a       uuid := '00000000-0000-0000-0000-0000000a4401'::uuid;
  owner_user  uuid;
  client_a    uuid := '00000000-0000-0000-0000-0000000a4402'::uuid;
  block_a     uuid := '00000000-0000-0000-0000-0000000a4403'::uuid;
BEGIN
  INSERT INTO organizations (id, name, slug)
  VALUES (org_a, 'Test Org A — Loose 44', 'test-org-a-loose-44');

  owner_user := public._test_make_user('owner-loose44@test.local');
  PERFORM public._test_grant_membership(owner_user, org_a, 'owner'::user_role);

  INSERT INTO clients (id, organization_id, user_id, first_name, last_name, email)
  VALUES (client_a, org_a, NULL, 'Lou', 'Loose', 'loose44@test.local');

  INSERT INTO programs (
    id, organization_id, client_id, name, status, start_date, duration_weeks
  ) VALUES (
    block_a, org_a, client_a, 'Loose44 Block', 'active', CURRENT_DATE, 2
  );

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_a AS org_a, owner_user AS owner_user, client_a AS client_a,
    block_a AS block_a;
  GRANT SELECT ON _ids TO authenticated;
END $$;


-- ----------------------------------------------------------------------------
-- §2. Act as the owner; create three days: two on block-less dates, one inside
-- the block. Separate statements so side effects (the container) accumulate in
-- order.
-- ----------------------------------------------------------------------------
SELECT public._test_set_jwt(
  (SELECT owner_user FROM _ids), (SELECT org_a FROM _ids), 'owner'
);
SET LOCAL ROLE authenticated;

INSERT INTO _calls VALUES ('bare1',
  public.create_program_day((SELECT client_a FROM _ids), CURRENT_DATE + 60));
INSERT INTO _calls VALUES ('bare2',
  public.create_program_day((SELECT client_a FROM _ids), CURRENT_DATE + 67));
INSERT INTO _calls VALUES ('covered',
  public.create_program_day((SELECT client_a FROM _ids), CURRENT_DATE + 3));

RESET ROLE;  -- assertions read as BYPASSRLS owner so RLS never filters them.


-- ----------------------------------------------------------------------------
-- §3. Assertions.
-- ----------------------------------------------------------------------------
INSERT INTO _tap (n, line) VALUES (1, (
  SELECT is(
    (SELECT result->>'status' FROM _calls WHERE k = 'bare1'),
    'created',
    'A1: a one-off on a date with no block returns status=created'
  )
));

INSERT INTO _tap (n, line) VALUES (2, (
  SELECT is(
    (SELECT count(*)::int FROM programs
      WHERE client_id = (SELECT client_a FROM _ids)
        AND is_loose AND deleted_at IS NULL),
    1,
    'A2: exactly one loose container exists for the client'
  )
));

INSERT INTO _tap (n, line) VALUES (3, (
  SELECT is(
    (SELECT pd.program_id FROM program_days pd
      WHERE pd.id = ((SELECT result->>'new_day_id' FROM _calls WHERE k = 'bare1'))::uuid),
    (SELECT id FROM programs
      WHERE client_id = (SELECT client_a FROM _ids)
        AND is_loose AND deleted_at IS NULL),
    'A3: the one-off day attaches to the loose container'
  )
));

INSERT INTO _tap (n, line) VALUES (4, (
  SELECT is(
    (SELECT pd.program_id FROM program_days pd
      WHERE pd.id = ((SELECT result->>'new_day_id' FROM _calls WHERE k = 'bare2'))::uuid),
    (SELECT id FROM programs
      WHERE client_id = (SELECT client_a FROM _ids)
        AND is_loose AND deleted_at IS NULL),
    'A4: a second one-off reuses the same loose container (no duplicate)'
  )
));

INSERT INTO _tap (n, line) VALUES (5, (
  SELECT is(
    (SELECT pd.program_id FROM program_days pd
      WHERE pd.id = ((SELECT result->>'new_day_id' FROM _calls WHERE k = 'covered'))::uuid),
    (SELECT block_a FROM _ids),
    'A5: a date inside a dated block attaches to the block (block wins)'
  )
));

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
