-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), is(), ok(), throws_ok() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 37_stale_session_no_block
-- ============================================================================
-- Why: regression for the 2026-06-23 portal deadlock (migration
-- 20260623140000). An in-progress session left on a PAST day used to block
-- every Begin and Move ("A session is already in progress") with no resume
-- path. The fix scopes the in-progress refusal to CURRENT sessions (live day
-- scheduled on/after the reference date); a stale past session is ignored.
--
--   A1 reschedule succeeds despite a past in-progress session.
--   A2 start succeeds despite a past in-progress session.
--   A3 start STILL refuses when a CURRENT in-progress session exists
--      (the "one live session at a time" invariant is preserved).
--
-- Dates are CURRENT_DATE-relative so the run is date-robust and the
-- reschedule's ±1-day p_today clamp is satisfied.
--
-- Test count: 3
-- ============================================================================

BEGIN;

SELECT plan(3);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated;


-- ----------------------------------------------------------------------------
-- §1. Fixture (all as the test owner / BYPASSRLS): a client with an abandoned
-- in-progress session on a day 4 days in the past, plus a future day. No day
-- on "today" yet, so the reschedule's "today already has a day" guard is clear.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  org_a       uuid := '00000000-0000-0000-0000-0000000a3701'::uuid;
  client_user uuid;
  client_a    uuid := '00000000-0000-0000-0000-0000000a3702'::uuid;
  program_a   uuid := '00000000-0000-0000-0000-0000000a3703'::uuid;
  week_a      uuid := '00000000-0000-0000-0000-0000000a3704'::uuid;
  past_day    uuid := '00000000-0000-0000-0000-0000000a3705'::uuid;
  future_day  uuid := '00000000-0000-0000-0000-0000000a3706'::uuid;
BEGIN
  INSERT INTO organizations (id, name, slug)
  VALUES (org_a, 'Test Org A — Stale Session 37', 'test-org-a-stale-37');

  client_user := public._test_make_user('client-stale37@test.local');
  PERFORM public._test_grant_membership(client_user, org_a, 'client'::user_role);

  INSERT INTO clients (id, organization_id, user_id, first_name, last_name, email)
  VALUES (client_a, org_a, client_user, 'Stan', 'Stale', 'stale37@test.local');

  INSERT INTO programs (
    id, organization_id, client_id, name, status, start_date, duration_weeks
  ) VALUES (
    program_a, org_a, client_a, 'Stale37 Block', 'active',
    CURRENT_DATE - 7, 5
  );

  INSERT INTO program_weeks (id, program_id, week_number)
  VALUES (week_a, program_a, 1);

  INSERT INTO program_days (
    id, program_id, program_week_id, day_label, scheduled_date, sort_order,
    published_at
  ) VALUES
    (past_day,   program_a, week_a, 'Past Day',   CURRENT_DATE - 4, 0, now()),
    (future_day, program_a, week_a, 'Future Day', CURRENT_DATE + 3, 1, now());

  -- The abandoned in-progress session on the past day (no completed_at).
  INSERT INTO sessions (organization_id, client_id, program_day_id, started_at)
  VALUES (org_a, client_a, past_day, now() - interval '4 days');

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_a AS org_a, client_user AS client_user, client_a AS client_a,
    past_day AS past_day, future_day AS future_day;
  GRANT SELECT ON _ids TO authenticated;
END $$;


-- ----------------------------------------------------------------------------
-- §2. Act as the client.
-- ----------------------------------------------------------------------------
SELECT public._test_set_jwt(
  (SELECT client_user FROM _ids), (SELECT org_a FROM _ids), 'client'
);
SET LOCAL ROLE authenticated;

-- A1: move the future day to today — must succeed despite the stale past
-- in-progress session. The RPC returns the program_day_id on success.
INSERT INTO _tap (n, line) VALUES (1, (
  SELECT is(
    public.client_reschedule_program_day_to_today(
      (SELECT future_day FROM _ids), CURRENT_DATE
    ),
    (SELECT future_day FROM _ids),
    'A1: reschedule to today succeeds despite an abandoned past in-progress session'
  )
));

-- A2: begin the (now-today) session — must succeed; the past session is
-- ignored, so a fresh session id comes back.
INSERT INTO _tap (n, line) VALUES (2, (
  SELECT ok(
    public.client_start_session((SELECT future_day FROM _ids)) IS NOT NULL,
    'A2: start succeeds despite an abandoned past in-progress session'
  )
));

-- A3: the invariant still holds — now that THIS day has a current in-progress
-- session, starting it again refuses.
INSERT INTO _tap (n, line) VALUES (3, (
  SELECT throws_ok(
    format(
      'SELECT public.client_start_session(%L::uuid)',
      (SELECT future_day FROM _ids)
    ),
    'P0001',
    'A session is already in progress',
    'A3: start still refuses when a CURRENT in-progress session exists'
  )
));

RESET ROLE;

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
