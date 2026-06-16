-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), ok() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 28_slot_granularity
-- ============================================================================
-- Why: P1-6 of the scheduling (section 9) polish pass
-- (docs/polish/scheduling.md, FM-18). Proves the 3-arg client_available_slots
-- (20260615140000) decouples the slot STEP (15 min) from the slot LENGTH (the
-- type's duration), so the part-hour after a shorter session is bookable —
-- the gap doc's "a 30-min type offers 11:30 after an 11:00 booking".
--
-- Fixture (built as the test owner inside BEGIN/ROLLBACK): an org in
-- Australia/Sydney, a staff member, a client (with user_id so the RPC can
-- resolve the caller's org), a ONE-OFF availability window 2026-07-06
-- 09:00–12:00 (one-off sidesteps weekday math), and an existing 11:00–11:30
-- booking. July is AEST (UTC+10, no DST), so 11:00→01:00Z, 11:30→01:30Z,
-- 12:00→02:00Z. The client's JWT is spoofed (auth.uid()) so the SECURITY
-- DEFINER RPC resolves the caller via its clients row.
--
--   1. a 30-min type offers 11:30 (start = 01:30Z) — the freed part-hour.
--   2. 11:00 (start = 01:00Z) is NOT offered — it overlaps the booking.
--   3. the offered slot is 30 minutes long (11:30 → 12:00 = 01:30Z → 02:00Z).
--
-- Test count: 3
-- ============================================================================

BEGIN;

SELECT plan(3);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;

DO $$
DECLARE
  v_org        uuid := '00000000-0000-0000-0000-0000000a9101'::uuid;
  v_staff      uuid;
  v_client     uuid := '00000000-0000-0000-0000-0000000a9102'::uuid;
  v_client_uid uuid;
BEGIN
  INSERT INTO organizations (id, name, slug, timezone)
    VALUES (v_org, 'P16 Slot Org', 'p16-slot-org', 'Australia/Sydney');

  v_staff      := public._test_make_user('p16-staff@test.local');
  v_client_uid := public._test_make_user('p16-client@test.local');

  -- The client is resolved by client_available_slots via clients.user_id =
  -- auth.uid(); no org-role membership is required for the client.
  INSERT INTO clients (id, organization_id, first_name, last_name, email, user_id)
    VALUES (v_client, v_org, 'P16', 'Client', 'p16-client-row@test.local', v_client_uid);

  -- P2-11: the staff member must be an org member for the availability_rules
  -- same-org guard (enforce_availability_rule_staff_in_org).
  PERFORM public._test_grant_membership(v_staff, v_org, 'staff');

  -- One-off availability 2026-07-06 09:00–12:00 for the staff member.
  INSERT INTO availability_rules
    (organization_id, staff_user_id, recurrence, specific_date, start_time, end_time, slot_duration_minutes, effective_from)
  VALUES
    (v_org, v_staff, 'one_off', '2026-07-06', '09:00', '12:00', 60, '2026-06-01');

  -- Existing 11:00–11:30 Sydney booking (AEST UTC+10) = 01:00–01:30 UTC.
  INSERT INTO appointments
    (organization_id, client_id, staff_user_id, start_at, end_at, status, appointment_type, confirmed_at)
  VALUES
    (v_org, v_client, v_staff,
     '2026-07-06T01:00:00Z', '2026-07-06T01:30:00Z', 'confirmed', 'in_clinic', now());

  CREATE TEMP TABLE _ids ON COMMIT DROP AS
    SELECT v_staff AS staff, v_client_uid AS client_uid, v_org AS org;
END $$;

-- Spoof the client's JWT so auth.uid() inside the RPC is this client.
SELECT public._test_set_jwt(
  (SELECT client_uid FROM _ids), (SELECT org FROM _ids), 'client'
);

INSERT INTO _tap (n, line)
SELECT 1, string_agg(l, E'\n') FROM ok(
  EXISTS (
    SELECT 1 FROM public.client_available_slots(
      '2026-07-05T00:00:00Z'::timestamptz, '2026-07-07T00:00:00Z'::timestamptz, 30
    ) s
     WHERE s.staff_user_id = (SELECT staff FROM _ids)
       AND s.slot_start = '2026-07-06T01:30:00Z'::timestamptz
  ),
  '1: a 30-min type offers 11:30 after an 11:00 booking (the part-hour is bookable)'
) AS l;

INSERT INTO _tap (n, line)
SELECT 2, string_agg(l, E'\n') FROM ok(
  NOT EXISTS (
    SELECT 1 FROM public.client_available_slots(
      '2026-07-05T00:00:00Z'::timestamptz, '2026-07-07T00:00:00Z'::timestamptz, 30
    ) s
     WHERE s.staff_user_id = (SELECT staff FROM _ids)
       AND s.slot_start = '2026-07-06T01:00:00Z'::timestamptz
  ),
  '2: 11:00 is not offered — it overlaps the existing booking'
) AS l;

INSERT INTO _tap (n, line)
SELECT 3, string_agg(l, E'\n') FROM ok(
  EXISTS (
    SELECT 1 FROM public.client_available_slots(
      '2026-07-05T00:00:00Z'::timestamptz, '2026-07-07T00:00:00Z'::timestamptz, 30
    ) s
     WHERE s.staff_user_id = (SELECT staff FROM _ids)
       AND s.slot_start = '2026-07-06T01:30:00Z'::timestamptz
       AND s.slot_end   = '2026-07-06T02:00:00Z'::timestamptz
  ),
  '3: the offered slot is the type''s 30-minute length (11:30 to 12:00)'
) AS l;

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
