-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), ok() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 27_appointment_overlap
-- ============================================================================
-- Why: P1-4 of the scheduling (section 9) polish pass
-- (docs/polish/scheduling.md, FM-5). Proves the appointments_no_staff_overlap
-- EXCLUDE constraint (20260615130000) actually blocks a double-booking, and
-- proves its deliberate exemptions hold. The constraint is path-agnostic — it
-- fires whoever inserts (portal RPC or staff action) — so a behavioural
-- overlap-rejection test IS the cross-path guarantee the gap doc asks for; the
-- prior acceptance test only exercised the sequential happy path.
--
--   1. overlapping confirmed, same staff      → rejected (exclusion_violation)
--   2. back-to-back, same staff (half-open)    → allowed
--   3. overlapping but CANCELLED, same staff   → allowed (exempt — this is what
--                                                lets a replacement be booked
--                                                over a cancelled slot, P2-8)
--   4. overlapping confirmed, DIFFERENT staff  → allowed (constraint is per-staff)
--   5. catalog: the constraint exists over (staff_user_id, tstzrange) — a
--      drift tripwire (e.g. if P1-7 recreates it and drops the predicate).
--   6. an Unavailable-kind block (no client) may overlap a confirmed
--      appointment for the same staff → allowed (P1-7 exemption).
--
-- Fixtures built as the test owner inside BEGIN/ROLLBACK (appointments carries
-- RLS but not FORCE RLS, so the owner bypasses it; the EXCLUDE constraint fires
-- regardless of role). Behavioural results are captured in _r inside a DO block
-- (so each INSERT's exception can be trapped), then asserted at top level.
-- Test count: 6
-- ============================================================================

BEGIN;

SELECT plan(6);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE _r   (k text PRIMARY KEY, v boolean NOT NULL) ON COMMIT DROP;

DO $$
DECLARE
  v_org    uuid := '00000000-0000-0000-0000-0000000a9001'::uuid;
  v_client uuid := '00000000-0000-0000-0000-0000000a9002'::uuid;
  v_staff  uuid;
  v_staff2 uuid;
  caught   boolean;
BEGIN
  INSERT INTO organizations (id, name, slug)
    VALUES (v_org, 'P14 Overlap Org', 'p14-overlap-org');

  v_staff  := public._test_make_user('p14-staff@test.local');
  v_staff2 := public._test_make_user('p14-staff2@test.local');
  PERFORM public._test_grant_membership(v_staff,  v_org, 'owner'::user_role);
  PERFORM public._test_grant_membership(v_staff2, v_org, 'staff'::user_role);

  INSERT INTO clients (id, organization_id, first_name, last_name, email)
    VALUES (v_client, v_org, 'P14', 'Client', 'p14-client@test.local');

  -- Fixture appointment A: 10:00–11:00 confirmed (confirmed_at required by the
  -- appointments_confirmed_fields CHECK).
  INSERT INTO appointments
    (organization_id, client_id, staff_user_id, start_at, end_at, status, appointment_type, confirmed_at)
  VALUES
    (v_org, v_client, v_staff,
     '2026-07-06T00:00:00Z', '2026-07-06T01:00:00Z', 'confirmed', 'in_clinic', now());

  -- 1. overlapping confirmed, same staff → must raise exclusion_violation.
  caught := false;
  BEGIN
    INSERT INTO appointments
      (organization_id, client_id, staff_user_id, start_at, end_at, status, appointment_type, confirmed_at)
    VALUES
      (v_org, v_client, v_staff,
       '2026-07-06T00:30:00Z', '2026-07-06T01:30:00Z', 'confirmed', 'in_clinic', now());
  EXCEPTION WHEN exclusion_violation THEN caught := true;
  END;
  INSERT INTO _r VALUES ('overlap_rejected', caught);

  -- 2. back-to-back, same staff (11:00–12:00; half-open so 11:00 touches but
  --    does not overlap A's 10:00–11:00) → must succeed.
  caught := false;
  BEGIN
    INSERT INTO appointments
      (organization_id, client_id, staff_user_id, start_at, end_at, status, appointment_type, confirmed_at)
    VALUES
      (v_org, v_client, v_staff,
       '2026-07-06T01:00:00Z', '2026-07-06T02:00:00Z', 'confirmed', 'in_clinic', now());
  EXCEPTION WHEN exclusion_violation THEN caught := true;
  END;
  INSERT INTO _r VALUES ('adjacent_ok', NOT caught);

  -- 3. overlapping but CANCELLED, same staff → must succeed (exempt).
  --    cancelled_at required by the appointments_cancelled_fields CHECK.
  caught := false;
  BEGIN
    INSERT INTO appointments
      (organization_id, client_id, staff_user_id, start_at, end_at, status, appointment_type, cancelled_at)
    VALUES
      (v_org, v_client, v_staff,
       '2026-07-06T00:30:00Z', '2026-07-06T01:30:00Z', 'cancelled', 'in_clinic', now());
  EXCEPTION WHEN exclusion_violation THEN caught := true;
  END;
  INSERT INTO _r VALUES ('cancelled_ok', NOT caught);

  -- 4. overlapping confirmed, DIFFERENT staff → must succeed (per-staff).
  caught := false;
  BEGIN
    INSERT INTO appointments
      (organization_id, client_id, staff_user_id, start_at, end_at, status, appointment_type, confirmed_at)
    VALUES
      (v_org, v_client, v_staff2,
       '2026-07-06T00:30:00Z', '2026-07-06T01:30:00Z', 'confirmed', 'in_clinic', now());
  EXCEPTION WHEN exclusion_violation THEN caught := true;
  END;
  INSERT INTO _r VALUES ('other_staff_ok', NOT caught);

  -- 5. an UNAVAILABLE-kind block (no client) overlapping a confirmed
  --    appointment for the same staff → must succeed (exempt; P1-7).
  caught := false;
  BEGIN
    INSERT INTO appointments
      (organization_id, client_id, staff_user_id, start_at, end_at, status, appointment_type, kind, confirmed_at)
    VALUES
      (v_org, NULL, v_staff,
       '2026-07-06T00:30:00Z', '2026-07-06T01:30:00Z', 'confirmed', 'Admin/paperwork', 'unavailable', now());
  EXCEPTION WHEN exclusion_violation THEN caught := true;
  END;
  INSERT INTO _r VALUES ('unavailable_ok', NOT caught);
END $$;

-- ----------------------------------------------------------------------------
-- Assertions (top level so pgTAP's plan tracks them).
-- ----------------------------------------------------------------------------
INSERT INTO _tap (n, line)
SELECT 1, string_agg(l, E'\n') FROM ok(
  (SELECT v FROM _r WHERE k = 'overlap_rejected'),
  '1: overlapping confirmed booking for the same practitioner is rejected (exclusion_violation)'
) AS l;

INSERT INTO _tap (n, line)
SELECT 2, string_agg(l, E'\n') FROM ok(
  (SELECT v FROM _r WHERE k = 'adjacent_ok'),
  '2: back-to-back booking (half-open, no overlap) for the same practitioner is allowed'
) AS l;

INSERT INTO _tap (n, line)
SELECT 3, string_agg(l, E'\n') FROM ok(
  (SELECT v FROM _r WHERE k = 'cancelled_ok'),
  '3: a cancelled booking may overlap a confirmed one (exempt — enables the replacement / side-by-side view)'
) AS l;

INSERT INTO _tap (n, line)
SELECT 4, string_agg(l, E'\n') FROM ok(
  (SELECT v FROM _r WHERE k = 'other_staff_ok'),
  '4: an overlapping booking for a different practitioner is allowed (constraint is per-staff)'
) AS l;

INSERT INTO _tap (n, line)
SELECT 5, string_agg(l, E'\n') FROM ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'appointments_no_staff_overlap'
       AND conrelid = 'public.appointments'::regclass
  )
  AND pg_get_constraintdef(
        (SELECT oid FROM pg_constraint
          WHERE conname = 'appointments_no_staff_overlap'
            AND conrelid = 'public.appointments'::regclass)
      ) ILIKE '%staff_user_id%tstzrange%',
  '5: appointments_no_staff_overlap exists as an EXCLUDE over (staff_user_id, tstzrange)'
) AS l;

INSERT INTO _tap (n, line)
SELECT 6, string_agg(l, E'\n') FROM ok(
  (SELECT v FROM _r WHERE k = 'unavailable_ok'),
  '6: an Unavailable-kind block (no client) may overlap a confirmed appointment (P1-7 exemption)'
) AS l;

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
