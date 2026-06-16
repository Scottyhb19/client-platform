-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), ok(), is() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 26_scheduling_rpc_grants
-- ============================================================================
-- Why: P0-1 of the scheduling (section 9) polish pass
-- (docs/polish/scheduling.md, FM-1). Locks in the EXECUTE-grant posture for the
-- scheduling RPC family. The Supabase auto-grant trap means any future
-- CREATE OR REPLACE on these functions can silently re-grant anon — this test
-- is the tripwire.
--
--   §A anon holds EXECUTE on NOTHING in the scheduling family (5 functions).
--   §B caller-facing functions keep their authenticated grant — the portal
--      books / reads slots as a logged-in client and the EP soft-deletes a
--      rule / unavailable block as a logged-in staff member; a blanket revoke
--      that stripped authenticated would pass §A while breaking the surface,
--      not securing it.
--
-- client_available_slots is the 3-arg per-type signature (P1-6); the welded
-- 2-arg overload was dropped post-deploy-#1 (20260615190000).
-- soft_delete_unavailable_block (P2-8 review fix, 20260616120000) joins the
-- family, so this is now a flat 5-function family (plan 10). Companion to
-- 25_portal_rpc_grants (section 7).
--
-- No fixtures, no JWT spoof — pure catalog checks as the test owner.
-- Test count: 10
-- ============================================================================

BEGIN;

SELECT plan(10);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;

-- ----------------------------------------------------------------------------
-- §A — anon must hold EXECUTE on nothing in the scheduling family.
-- ----------------------------------------------------------------------------
WITH family(ord, sig) AS (
  VALUES
    (1, 'public.client_available_slots(timestamptz, timestamptz, integer)'),
    (2, 'public.client_book_appointment(uuid, uuid, timestamptz, timestamptz)'),
    (3, 'public.client_cancel_appointment(uuid)'),
    (4, 'public.soft_delete_availability_rule(uuid)'),
    (5, 'public.soft_delete_unavailable_block(uuid)')
)
INSERT INTO _tap (n, line)
SELECT ord, ok(
  NOT has_function_privilege('anon', sig, 'EXECUTE'),
  format('A%s: anon cannot execute %s', ord, sig)
)
FROM family;

-- ----------------------------------------------------------------------------
-- §B — caller-facing grants survive: authenticated must KEEP EXECUTE on each.
-- ----------------------------------------------------------------------------
WITH family(ord, sig) AS (
  VALUES
    (6,  'public.client_available_slots(timestamptz, timestamptz, integer)'),
    (7,  'public.client_book_appointment(uuid, uuid, timestamptz, timestamptz)'),
    (8,  'public.client_cancel_appointment(uuid)'),
    (9,  'public.soft_delete_availability_rule(uuid)'),
    (10, 'public.soft_delete_unavailable_block(uuid)')
)
INSERT INTO _tap (n, line)
SELECT ord, ok(
  has_function_privilege('authenticated', sig, 'EXECUTE'),
  format('B%s: authenticated keeps EXECUTE on %s', ord - 5, sig)
)
FROM family;

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
