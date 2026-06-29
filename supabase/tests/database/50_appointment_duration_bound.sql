-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), ok() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 50_appointment_duration_bound
-- ============================================================================
-- Why: RO-5 review follow-up. The booking form caps Duration at 480 and the
-- server actions reject out-of-range values, but appointments has an
-- authenticated INSERT policy, so a crafted PostgREST write bypassing the
-- form/action could otherwise create an absurd-length appointment. The
-- appointments_duration_bound CHECK (20260630140000) is the bypass-proof layer.
--
--   1. a normal-length appointment (1h) inserts                → allowed
--   2. an over-24h appointment (a crafted-style write)         → rejected
--      (check_violation), proving the ceiling fires on the raw table path
--   3. catalog: the CHECK exists on appointments               → drift tripwire
--
-- Fixtures built as the test owner inside BEGIN/ROLLBACK. The owner bypasses RLS
-- but NOT table CHECK constraints, so this exercises the exact guard a crafted
-- authenticated insert would hit. Mirrors 27/48/49.
-- Test count: 3
-- ============================================================================

BEGIN;

SELECT plan(3);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE _r   (k text PRIMARY KEY, v boolean NOT NULL) ON COMMIT DROP;

DO $$
DECLARE
  v_org    uuid := '00000000-0000-0000-0000-0000000a8501'::uuid;
  v_client uuid := '00000000-0000-0000-0000-0000000a8502'::uuid;
  v_staff  uuid;
  caught   boolean;
BEGIN
  INSERT INTO organizations (id, name, slug)
    VALUES (v_org, 'RO5 Org', 'ro5-org');
  v_staff := public._test_make_user('ro5-staff@test.local');
  PERFORM public._test_grant_membership(v_staff, v_org, 'owner'::user_role);
  INSERT INTO clients (id, organization_id, first_name, last_name, email)
    VALUES (v_client, v_org, 'RO5', 'Client', 'ro5-client@test.local');

  -- 1. Normal 1h appointment → allowed.
  caught := false;
  BEGIN
    INSERT INTO appointments
      (organization_id, client_id, staff_user_id, start_at, end_at, status, appointment_type, confirmed_at)
    VALUES
      (v_org, v_client, v_staff, '2026-07-06T00:00:00Z', '2026-07-06T01:00:00Z', 'confirmed', 'in_clinic', now());
  EXCEPTION WHEN check_violation THEN caught := true;
  END;
  INSERT INTO _r VALUES ('normal_allowed', NOT caught);

  -- 2. Over-24h appointment (start → +25h) → must be rejected by the CHECK.
  caught := false;
  BEGIN
    INSERT INTO appointments
      (organization_id, client_id, staff_user_id, start_at, end_at, status, appointment_type, confirmed_at)
    VALUES
      (v_org, v_client, v_staff, '2026-07-08T00:00:00Z', '2026-07-09T01:00:00Z', 'confirmed', 'in_clinic', now());
  EXCEPTION WHEN check_violation THEN caught := true;
  END;
  INSERT INTO _r VALUES ('overlong_rejected', caught);
END $$;

INSERT INTO _tap (n, line)
SELECT 1, string_agg(l, E'\n') FROM ok(
  (SELECT v FROM _r WHERE k = 'normal_allowed'),
  '1: a normal-length (1h) appointment is allowed'
) AS l;

INSERT INTO _tap (n, line)
SELECT 2, string_agg(l, E'\n') FROM ok(
  (SELECT v FROM _r WHERE k = 'overlong_rejected'),
  '2: an over-24h appointment is rejected by appointments_duration_bound (check_violation)'
) AS l;

INSERT INTO _tap (n, line)
SELECT 3, string_agg(l, E'\n') FROM ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'appointments_duration_bound'
       AND conrelid = 'public.appointments'::regclass
       AND contype = 'c'
  ),
  '3: appointments_duration_bound CHECK exists on appointments (drift tripwire)'
) AS l;

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
