-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), ok(), is() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 32_calendar_feed
-- ============================================================================
-- Section 9 (Scheduling) — P2-15 (B). Locks the security posture of the
-- de-identified .ics calendar feed (migration 20260616140000):
--
--   §A grants — calendar_feed_events is anon-EXECUTE BY DESIGN (the token is
--      the credential; a calendar app cannot authenticate). The token-
--      management RPCs (regenerate/revoke) are authenticated-only — anon must
--      NOT reach them. This is the one deliberate anon grant in the scheduling
--      family; the assertion pins it so it stays a conscious decision.
--   §B de-identification — calendar_feed_events RETURNS only type/kind/time/
--      location. It must be STRUCTURALLY incapable of returning client_id,
--      notes, or a name. Asserted against the function's declared result type.
--   §C fail-closed — an unknown or NULL token yields zero rows, never an error
--      and never another practitioner's data (a token matching no row returns
--      empty regardless of what data exists, so no fixture is needed).
--
-- No fixtures, no JWT spoof — catalog + pure-function checks as the test owner.
-- Buffered into _tap so the `supabase db query --linked -f` runner returns all
-- lines in one result set (mirrors 26_scheduling_rpc_grants).
-- Test count: 8
-- ============================================================================

BEGIN;

SELECT plan(8);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;

-- §A — grant posture.
INSERT INTO _tap VALUES (1, ok(
  has_function_privilege('anon', 'public.calendar_feed_events(text)', 'EXECUTE'),
  'A1: anon CAN execute calendar_feed_events (token-authenticated public feed, by design)'
));
INSERT INTO _tap VALUES (2, ok(
  has_function_privilege('authenticated', 'public.calendar_feed_events(text)', 'EXECUTE'),
  'A2: authenticated CAN execute calendar_feed_events'
));
INSERT INTO _tap VALUES (3, ok(
  NOT has_function_privilege('anon', 'public.regenerate_calendar_feed_token()', 'EXECUTE'),
  'A3: anon CANNOT execute regenerate_calendar_feed_token'
));
INSERT INTO _tap VALUES (4, ok(
  NOT has_function_privilege('anon', 'public.revoke_calendar_feed_token()', 'EXECUTE'),
  'A4: anon CANNOT execute revoke_calendar_feed_token'
));

-- §B — de-identified return shape (the structural PHI guarantee).
INSERT INTO _tap VALUES (5, ok(
  (SELECT pg_get_function_result(p.oid)
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'calendar_feed_events')
    NOT LIKE '%client%',
  'B1: feed result type exposes no client column'
));
INSERT INTO _tap VALUES (6, ok(
  (SELECT pg_get_function_result(p.oid)
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'calendar_feed_events')
    NOT LIKE '%notes%',
  'B2: feed result type exposes no notes column'
));

-- §C — fail-closed on bad tokens.
INSERT INTO _tap VALUES (7, is(
  (SELECT count(*)::int FROM calendar_feed_events('definitely-not-a-real-token-000000000000')),
  0,
  'C1: an unknown token yields zero rows'
));
INSERT INTO _tap VALUES (8, is(
  (SELECT count(*)::int FROM calendar_feed_events(NULL)),
  0,
  'C2: a NULL token yields zero rows'
));

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
