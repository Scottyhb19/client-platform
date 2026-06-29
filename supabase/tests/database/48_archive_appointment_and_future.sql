-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), ok() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 48_archive_appointment_and_future
-- ============================================================================
-- Why: behavioural proof for archive_appointment_and_future (schedule round-
-- three, 20260630130000) — the "end a recurring series from this occurrence
-- forward" RPC. The grant posture is locked by 26_scheduling_rpc_grants; this
-- file proves the LOGIC: it archives the anchor and every LATER same-group
-- occurrence, never the earlier ones, never another series, and never another
-- org; returns the count; and cancels exactly the archived rows' reminders.
--
--   1. earlier occurrence in the same series        → kept (NOT archived)
--   2. anchor occurrence                            → archived
--   3. later occurrence (a)                         → archived
--   4. later occurrence (b)                         → archived
--   5. a different series (same client)             → untouched
--   6. RPC return value for the series archive      → 3 (anchor + 2 later)
--   7. a non-series (single) booking                → archives alone, returns 1
--   8. scheduled reminders for the archived rows    → cancelled
--   9. scheduled reminder for the kept earlier row  → still scheduled
--  10. a DIFFERENT org's staff calling on our row   → no_data_found (org-scoped)
--  11. a same-org STAFF-role member (not owner)      → can archive a series
--      (owner+staff is the intended granularity — identical to cancel / status
--      / single-archive; appointment management is not owner-only)
--
-- Fixtures use PAST dates so the appointment_manage_reminder trigger (future-
-- only) does not enqueue competing reminders — the scheduled reminders here are
-- inserted explicitly, making the cancellation assertion deterministic. Built
-- as the test owner inside BEGIN/ROLLBACK (appointments carries RLS but not
-- FORCE RLS, so the owner's fixture writes bypass it; the SECURITY DEFINER RPC
-- reads the spoofed JWT for its in-body org/role guard). Mirrors the fixture
-- pattern in 27_appointment_overlap.
-- Test count: 11
-- ============================================================================

BEGIN;

SELECT plan(11);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE _r   (k text PRIMARY KEY, v text NOT NULL)   ON COMMIT DROP;

DO $$
DECLARE
  v_org1   uuid := '00000000-0000-0000-0000-0000000a8001'::uuid;
  v_org2   uuid := '00000000-0000-0000-0000-0000000a8003'::uuid;
  v_client uuid := '00000000-0000-0000-0000-0000000a8002'::uuid;
  v_g1     uuid := '00000000-0000-0000-0000-0000000a8201'::uuid;  -- series A
  v_g2     uuid := '00000000-0000-0000-0000-0000000a8202'::uuid;  -- series B
  v_a1     uuid := '00000000-0000-0000-0000-0000000a8101'::uuid;  -- earliest (kept)
  v_a2     uuid := '00000000-0000-0000-0000-0000000a8102'::uuid;  -- anchor
  v_a3     uuid := '00000000-0000-0000-0000-0000000a8103'::uuid;  -- later
  v_a4     uuid := '00000000-0000-0000-0000-0000000a8104'::uuid;  -- later
  v_a5     uuid := '00000000-0000-0000-0000-0000000a8105'::uuid;  -- standalone
  v_b1     uuid := '00000000-0000-0000-0000-0000000a8106'::uuid;  -- other series
  v_g3     uuid := '00000000-0000-0000-0000-0000000a8203'::uuid;  -- series C (staff-archived)
  v_c1     uuid := '00000000-0000-0000-0000-0000000a8107'::uuid;
  v_c2     uuid := '00000000-0000-0000-0000-0000000a8108'::uuid;
  v_staff1 uuid;
  v_staff2 uuid;
  v_staff3 uuid;
  v_count  integer;
  caught   boolean;
BEGIN
  INSERT INTO organizations (id, name, slug)
    VALUES (v_org1, 'RO7 Org One', 'ro7-org-one'),
           (v_org2, 'RO7 Org Two', 'ro7-org-two');

  v_staff1 := public._test_make_user('ro7-staff1@test.local');
  v_staff2 := public._test_make_user('ro7-staff2@test.local');
  v_staff3 := public._test_make_user('ro7-staff3@test.local');
  PERFORM public._test_grant_membership(v_staff1, v_org1, 'owner'::user_role);
  PERFORM public._test_grant_membership(v_staff2, v_org2, 'owner'::user_role);
  -- A non-owner STAFF member of org-one, for the role-granularity assertion.
  PERFORM public._test_grant_membership(v_staff3, v_org1, 'staff'::user_role);

  INSERT INTO clients (id, organization_id, first_name, last_name, email)
    VALUES (v_client, v_org1, 'RO7', 'Client', 'ro7-client@test.local');

  -- Series A — four weekly past occurrences sharing v_g1.
  INSERT INTO appointments
    (id, organization_id, client_id, staff_user_id, start_at, end_at,
     status, appointment_type, confirmed_at, recurrence_group_id)
  VALUES
    (v_a1, v_org1, v_client, v_staff1, '2026-05-04T00:00:00Z', '2026-05-04T01:00:00Z', 'confirmed', 'in_clinic', now(), v_g1),
    (v_a2, v_org1, v_client, v_staff1, '2026-05-11T00:00:00Z', '2026-05-11T01:00:00Z', 'confirmed', 'in_clinic', now(), v_g1),
    (v_a3, v_org1, v_client, v_staff1, '2026-05-18T00:00:00Z', '2026-05-18T01:00:00Z', 'confirmed', 'in_clinic', now(), v_g1),
    (v_a4, v_org1, v_client, v_staff1, '2026-05-25T00:00:00Z', '2026-05-25T01:00:00Z', 'confirmed', 'in_clinic', now(), v_g1);

  -- A standalone single booking (no group) that sits between A's dates.
  INSERT INTO appointments
    (id, organization_id, client_id, staff_user_id, start_at, end_at,
     status, appointment_type, confirmed_at, recurrence_group_id)
  VALUES
    (v_a5, v_org1, v_client, v_staff1, '2026-05-12T00:00:00Z', '2026-05-12T01:00:00Z', 'confirmed', 'in_clinic', now(), NULL);

  -- A second series (different group) for the same client — must be untouched.
  INSERT INTO appointments
    (id, organization_id, client_id, staff_user_id, start_at, end_at,
     status, appointment_type, confirmed_at, recurrence_group_id)
  VALUES
    (v_b1, v_org1, v_client, v_staff1, '2026-05-13T00:00:00Z', '2026-05-13T01:00:00Z', 'confirmed', 'in_clinic', now(), v_g2);

  -- Series C (group v_g3) — archived by a STAFF-role member to prove the
  -- owner+staff permission granularity.
  INSERT INTO appointments
    (id, organization_id, client_id, staff_user_id, start_at, end_at,
     status, appointment_type, confirmed_at, recurrence_group_id)
  VALUES
    (v_c1, v_org1, v_client, v_staff1, '2026-06-01T00:00:00Z', '2026-06-01T01:00:00Z', 'confirmed', 'in_clinic', now(), v_g3),
    (v_c2, v_org1, v_client, v_staff1, '2026-06-08T00:00:00Z', '2026-06-08T01:00:00Z', 'confirmed', 'in_clinic', now(), v_g3);

  -- Explicit scheduled reminders on the anchor, the two later rows, and the
  -- kept earlier row (past dates → the trigger did not enqueue its own).
  INSERT INTO appointment_reminders
    (appointment_id, reminder_type, status, provider, scheduled_for, retry_count)
  VALUES
    (v_a1, 'reminder_24h_email', 'scheduled', 'resend', '2026-05-03T00:00:00Z', 0),
    (v_a2, 'reminder_24h_email', 'scheduled', 'resend', '2026-05-10T00:00:00Z', 0),
    (v_a3, 'reminder_24h_email', 'scheduled', 'resend', '2026-05-17T00:00:00Z', 0),
    (v_a4, 'reminder_24h_email', 'scheduled', 'resend', '2026-05-24T00:00:00Z', 0);

  -- Act as org-one's owner and archive from the anchor (a2) forward.
  PERFORM public._test_set_jwt(v_staff1, v_org1, 'owner');
  v_count := public.archive_appointment_and_future(v_a2);
  INSERT INTO _r VALUES ('series_count', v_count::text);

  -- A non-series booking archives alone and returns 1.
  v_count := public.archive_appointment_and_future(v_a5);
  INSERT INTO _r VALUES ('single_count', v_count::text);

  -- Org isolation — a different org's owner cannot reach org-one's kept row.
  PERFORM public._test_set_jwt(v_staff2, v_org2, 'owner');
  caught := false;
  BEGIN
    PERFORM public.archive_appointment_and_future(v_a1);
  EXCEPTION WHEN no_data_found THEN caught := true;
  END;
  INSERT INTO _r VALUES ('cross_org_blocked', caught::text);

  -- A non-owner STAFF member of the same org can archive a series (the intended
  -- granularity — appointment management is owner+staff, not owner-only).
  PERFORM public._test_set_jwt(v_staff3, v_org1, 'staff');
  v_count := public.archive_appointment_and_future(v_c1);
  INSERT INTO _r VALUES ('staff_count', v_count::text);

  PERFORM public._test_clear_jwt();
END $$;

-- ----------------------------------------------------------------------------
-- Assertions (top level so pgTAP's plan tracks them). Read as the owner, which
-- bypasses the deleted_at-IS-NULL SELECT policy, so archived rows are visible.
-- ----------------------------------------------------------------------------
INSERT INTO _tap (n, line)
SELECT 1, string_agg(l, E'\n') FROM ok(
  (SELECT deleted_at IS NULL FROM appointments WHERE id = '00000000-0000-0000-0000-0000000a8101'),
  '1: the earlier occurrence in the series is kept (not archived)'
) AS l;

INSERT INTO _tap (n, line)
SELECT 2, string_agg(l, E'\n') FROM ok(
  (SELECT deleted_at IS NOT NULL FROM appointments WHERE id = '00000000-0000-0000-0000-0000000a8102'),
  '2: the anchor occurrence is archived'
) AS l;

INSERT INTO _tap (n, line)
SELECT 3, string_agg(l, E'\n') FROM ok(
  (SELECT deleted_at IS NOT NULL FROM appointments WHERE id = '00000000-0000-0000-0000-0000000a8103'),
  '3: the first later occurrence is archived'
) AS l;

INSERT INTO _tap (n, line)
SELECT 4, string_agg(l, E'\n') FROM ok(
  (SELECT deleted_at IS NOT NULL FROM appointments WHERE id = '00000000-0000-0000-0000-0000000a8104'),
  '4: the second later occurrence is archived'
) AS l;

INSERT INTO _tap (n, line)
SELECT 5, string_agg(l, E'\n') FROM ok(
  (SELECT deleted_at IS NULL FROM appointments WHERE id = '00000000-0000-0000-0000-0000000a8106'),
  '5: a different series for the same client is untouched'
) AS l;

INSERT INTO _tap (n, line)
SELECT 6, string_agg(l, E'\n') FROM ok(
  (SELECT v FROM _r WHERE k = 'series_count') = '3',
  '6: the series archive returns 3 (anchor + two later occurrences)'
) AS l;

INSERT INTO _tap (n, line)
SELECT 7, string_agg(l, E'\n') FROM ok(
  (SELECT v FROM _r WHERE k = 'single_count') = '1'
  AND (SELECT deleted_at IS NOT NULL FROM appointments WHERE id = '00000000-0000-0000-0000-0000000a8105'),
  '7: a non-series booking archives alone and returns 1'
) AS l;

INSERT INTO _tap (n, line)
SELECT 8, string_agg(l, E'\n') FROM ok(
  NOT EXISTS (
    SELECT 1 FROM appointment_reminders
     WHERE status = 'scheduled'
       AND appointment_id IN (
         '00000000-0000-0000-0000-0000000a8102',
         '00000000-0000-0000-0000-0000000a8103',
         '00000000-0000-0000-0000-0000000a8104')
  ),
  '8: scheduled reminders for the archived occurrences are cancelled'
) AS l;

INSERT INTO _tap (n, line)
SELECT 9, string_agg(l, E'\n') FROM ok(
  EXISTS (
    SELECT 1 FROM appointment_reminders
     WHERE status = 'scheduled'
       AND appointment_id = '00000000-0000-0000-0000-0000000a8101'
  ),
  '9: the kept earlier occurrence keeps its scheduled reminder'
) AS l;

INSERT INTO _tap (n, line)
SELECT 10, string_agg(l, E'\n') FROM ok(
  (SELECT v FROM _r WHERE k = 'cross_org_blocked') = 'true',
  '10: a different org''s owner cannot archive our appointment (org-scoped)'
) AS l;

INSERT INTO _tap (n, line)
SELECT 11, string_agg(l, E'\n') FROM ok(
  (SELECT v FROM _r WHERE k = 'staff_count') = '2'
  AND (SELECT deleted_at IS NOT NULL FROM appointments WHERE id = '00000000-0000-0000-0000-0000000a8107')
  AND (SELECT deleted_at IS NOT NULL FROM appointments WHERE id = '00000000-0000-0000-0000-0000000a8108'),
  '11: a same-org staff-role member can archive a series (owner+staff granularity, by design)'
) AS l;

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
