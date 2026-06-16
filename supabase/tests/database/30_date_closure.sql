-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), ok() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 30_date_closure
-- ============================================================================
-- Why: P1-5 of the scheduling (section 9) polish pass
-- (docs/polish/scheduling.md, FM-6). Proves a closure (is_blocked one-off)
-- subtracts bookable time from client_available_slots — whole-day removes the
-- day entirely; a partial window removes only its hours.
--
-- AEST (UTC+10, no DST in July): 10:00 Sydney = 00:00Z, 11:00 = 01:00Z,
-- 14:00 = 04:00Z. Two one-off availability windows 10:00–16:00 with closures:
--   • date A (2026-07-13): whole-day closure → no slots all day.
--   • date B (2026-07-14): 10:00–13:00 closure → 14:00 offered, 11:00 not.
--
--   1. whole-day closure → zero slots on date A.
--   2. partial closure leaves the afternoon: 14:00 (04:00Z) is offered.
--   3. partial closure removes the morning: 11:00 (01:00Z) is not offered.
--
-- Test count: 3
-- ============================================================================

BEGIN;

SELECT plan(3);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;

DO $$
DECLARE
  v_org        uuid := '00000000-0000-0000-0000-0000000a9301'::uuid;
  v_client     uuid := '00000000-0000-0000-0000-0000000a9302'::uuid;
  v_staff      uuid;
  v_client_uid uuid;
BEGIN
  INSERT INTO organizations (id, name, slug, timezone)
    VALUES (v_org, 'P15 Closure Org', 'p15-closure-org', 'Australia/Sydney');

  v_staff      := public._test_make_user('p15-staff@test.local');
  v_client_uid := public._test_make_user('p15-client@test.local');

  INSERT INTO clients (id, organization_id, first_name, last_name, email, user_id)
    VALUES (v_client, v_org, 'P15', 'Client', 'p15-client-row@test.local', v_client_uid);

  -- P2-11: the staff member must be an org member for the availability_rules
  -- same-org guard (enforce_availability_rule_staff_in_org).
  PERFORM public._test_grant_membership(v_staff, v_org, 'staff');

  -- Positive availability 10:00–16:00 on both dates.
  INSERT INTO availability_rules
    (organization_id, staff_user_id, recurrence, specific_date, start_time, end_time, slot_duration_minutes, effective_from)
  VALUES
    (v_org, v_staff, 'one_off', '2026-07-13', '10:00', '16:00', 60, '2026-06-01'),
    (v_org, v_staff, 'one_off', '2026-07-14', '10:00', '16:00', 60, '2026-06-01');

  -- Date A: whole-day closure. Date B: morning-only closure.
  INSERT INTO availability_rules
    (organization_id, staff_user_id, recurrence, specific_date, start_time, end_time, slot_duration_minutes, effective_from, is_blocked)
  VALUES
    (v_org, v_staff, 'one_off', '2026-07-13', '00:00:00', '23:59:59', 60, '2026-06-01', true),
    (v_org, v_staff, 'one_off', '2026-07-14', '10:00',    '13:00',    60, '2026-06-01', true);

  CREATE TEMP TABLE _ids ON COMMIT DROP AS
    SELECT v_staff AS staff, v_client_uid AS client_uid, v_org AS org;
END $$;

SELECT public._test_set_jwt(
  (SELECT client_uid FROM _ids), (SELECT org FROM _ids), 'client'
);

INSERT INTO _tap (n, line)
SELECT 1, string_agg(l, E'\n') FROM ok(
  NOT EXISTS (
    SELECT 1 FROM public.client_available_slots(
      '2026-07-13T00:00:00Z'::timestamptz, '2026-07-15T00:00:00Z'::timestamptz, 30
    ) s
     WHERE s.staff_user_id = (SELECT staff FROM _ids)
       AND s.slot_start >= '2026-07-13T00:00:00Z'::timestamptz
       AND s.slot_start <  '2026-07-13T07:00:00Z'::timestamptz
  ),
  '1: a whole-day closure removes every slot on that date'
) AS l;

INSERT INTO _tap (n, line)
SELECT 2, string_agg(l, E'\n') FROM ok(
  EXISTS (
    SELECT 1 FROM public.client_available_slots(
      '2026-07-13T00:00:00Z'::timestamptz, '2026-07-15T00:00:00Z'::timestamptz, 30
    ) s
     WHERE s.staff_user_id = (SELECT staff FROM _ids)
       AND s.slot_start = '2026-07-14T04:00:00Z'::timestamptz
  ),
  '2: a morning-only closure still offers the afternoon (14:00)'
) AS l;

INSERT INTO _tap (n, line)
SELECT 3, string_agg(l, E'\n') FROM ok(
  NOT EXISTS (
    SELECT 1 FROM public.client_available_slots(
      '2026-07-13T00:00:00Z'::timestamptz, '2026-07-15T00:00:00Z'::timestamptz, 30
    ) s
     WHERE s.staff_user_id = (SELECT staff FROM _ids)
       AND s.slot_start = '2026-07-14T01:00:00Z'::timestamptz
  ),
  '3: the morning closure removes the morning (11:00 not offered)'
) AS l;

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
