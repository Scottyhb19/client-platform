-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), ok(), is() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 25_portal_rpc_grants
-- ============================================================================
-- Why: P0-2 of the client-portal-pwa polish pass
-- (docs/polish/client-portal-pwa.md, FM-2). Locks in the EXECUTE-grant posture
-- for the section-7 client-portal RPC family after the revoke migrations
-- (20260614120000 reschedule v3 + 20260614130000). The Supabase auto-grant
-- trap means any future CREATE OR REPLACE on these functions can silently
-- re-grant anon — this test is the tripwire.
--
--   §A anon holds EXECUTE on NOTHING in the section-7 family (9 functions).
--   §B caller-facing functions keep their authenticated grant — the portal
--      calls them as a logged-in client; a blanket revoke that stripped
--      authenticated would pass §A while breaking the portal, not securing it.
--
-- Scope note: the booking (§9), messaging (§10), and onboarding (§2) client_*
-- functions are deliberately NOT covered here — they are owned by other
-- sections and tracked in docs/go-live-checklist.md (see 20260614130000).
--
-- No fixtures, no JWT spoof — pure catalog checks as the test owner.
-- Test count: 20
-- ============================================================================

BEGIN;

SELECT plan(20);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;

-- ----------------------------------------------------------------------------
-- §A — anon must hold EXECUTE on nothing in the section-7 family.
-- ----------------------------------------------------------------------------
WITH family(ord, sig) AS (
  VALUES
    (1, 'public.client_start_session(uuid)'),
    -- 11-arg since 2026-06-23 (VU-2): trailing p_rep_metric (volume unit).
    (2, 'public.client_log_set(uuid, uuid, smallint, numeric, text, smallint, text, text, smallint, text, text)'),
    (3, 'public.client_complete_session(uuid, smallint, text)'),
    (4, 'public.client_get_week_overview(date)'),
    (5, 'public.client_get_program_day_exercises(uuid)'),
    (6, 'public.client_get_published_reports()'),
    (7, 'public.client_owns_test_session(uuid)'),
    (8, 'public.client_list_program_days(uuid)'),
    (9, 'public.client_reschedule_program_day_to_today(uuid, date)')
)
INSERT INTO _tap (n, line)
SELECT ord, ok(
  NOT has_function_privilege('anon', sig, 'EXECUTE'),
  format('A%s: anon cannot execute %s', ord, sig)
)
FROM family;

-- ----------------------------------------------------------------------------
-- §B — caller-facing grants survive: the portal still works as a logged-in
-- client. Same family; authenticated must KEEP EXECUTE on every one.
-- ----------------------------------------------------------------------------
WITH family(ord, sig) AS (
  VALUES
    (10, 'public.client_start_session(uuid)'),
    (11, 'public.client_log_set(uuid, uuid, smallint, numeric, text, smallint, text, text, smallint, text, text)'),
    (12, 'public.client_complete_session(uuid, smallint, text)'),
    (13, 'public.client_get_week_overview(date)'),
    (14, 'public.client_get_program_day_exercises(uuid)'),
    (15, 'public.client_get_published_reports()'),
    (16, 'public.client_owns_test_session(uuid)'),
    (17, 'public.client_list_program_days(uuid)'),
    (18, 'public.client_reschedule_program_day_to_today(uuid, date)')
)
INSERT INTO _tap (n, line)
SELECT ord, ok(
  has_function_privilege('authenticated', sig, 'EXECUTE'),
  format('B%s: authenticated keeps EXECUTE on %s', ord - 9, sig)
)
FROM family;

-- ----------------------------------------------------------------------------
-- §C — REMOVED. The 1-arg backward-compat shim (20260614140000) was dropped by
-- migration 20260614160000 once the section-7 branch deployed and every caller
-- moved to the 2-arg (uuid, date) device-tz path (go-live-checklist.md §8 /
-- client-portal-pwa.md §8.6). Its two grant assertions went with it; plan 22→20.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- §D — the per-group notes RPC (20260614150000, P1-4): same posture.
-- ----------------------------------------------------------------------------
INSERT INTO _tap (n, line) VALUES (19, (
  SELECT ok(
    NOT has_function_privilege('anon', 'public.client_log_exercise_note(uuid, uuid, text)', 'EXECUTE'),
    'D1: anon cannot execute client_log_exercise_note'
  )
));
INSERT INTO _tap (n, line) VALUES (20, (
  SELECT ok(
    has_function_privilege('authenticated', 'public.client_log_exercise_note(uuid, uuid, text)', 'EXECUTE'),
    'D2: authenticated keeps EXECUTE on client_log_exercise_note'
  )
));

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
