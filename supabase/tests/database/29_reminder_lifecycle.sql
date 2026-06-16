-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), ok() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 29_reminder_lifecycle
-- ============================================================================
-- Why: P1-2 + P1-3 of the scheduling (section 9) polish pass
-- (docs/polish/scheduling.md, FM-3/FM-4). Proves the appointments_manage_reminder
-- trigger (20260615170000) maintains the T-lead reminder across every write
-- path — so a staff-created booking (not just a portal one) is reminded, a
-- reschedule re-times it, and a cancel cancels it.
--
--   1. inserting a future confirmed appointment enqueues a scheduled reminder
--      at start_at − reminder_lead_hours (24h here).
--   2. cancelling the appointment cancels the reminder.
--   3. rescheduling (start_at change) re-times the reminder to new − 24h.
--   4. an unavailable-kind block (no client) gets no reminder.
--
-- Fixtures built as the test owner inside BEGIN/ROLLBACK; the trigger fires on
-- the inserts/updates regardless of role. Org reminder_lead_hours = 24.
-- Test count: 4
-- ============================================================================

BEGIN;

SELECT plan(4);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE _r   (k text PRIMARY KEY, v text NOT NULL) ON COMMIT DROP;

DO $$
DECLARE
  v_org      uuid := '00000000-0000-0000-0000-0000000a9201'::uuid;
  v_client   uuid := '00000000-0000-0000-0000-0000000a9202'::uuid;
  v_staff    uuid;
  v_appt     uuid;
  v_appt2    uuid;
  v_unavail  uuid;
  v_start    timestamptz := now() + interval '7 days';
  v_newstart timestamptz := now() + interval '10 days';
BEGIN
  INSERT INTO organizations (id, name, slug, timezone, reminder_lead_hours)
    VALUES (v_org, 'P12 Reminder Org', 'p12-reminder-org', 'Australia/Sydney', 24);

  v_staff := public._test_make_user('p12-staff@test.local');

  INSERT INTO clients (id, organization_id, first_name, last_name, email)
    VALUES (v_client, v_org, 'P12', 'Client', 'p12-client@test.local');

  -- 1. Future confirmed appointment → trigger enqueues a reminder at start−24h.
  INSERT INTO appointments
    (organization_id, client_id, staff_user_id, start_at, end_at, status, appointment_type, confirmed_at)
  VALUES
    (v_org, v_client, v_staff, v_start, v_start + interval '45 min', 'confirmed', 'Session', now())
  RETURNING id INTO v_appt;
  INSERT INTO _r VALUES ('enqueued', (
    SELECT count(*)::text FROM appointment_reminders
     WHERE appointment_id = v_appt
       AND reminder_type  = 'reminder_24h_email'
       AND status         = 'scheduled'
       AND scheduled_for  = v_start - interval '24 hours'));

  -- 2. Cancel → trigger cancels the reminder.
  UPDATE appointments SET status = 'cancelled', cancelled_at = now() WHERE id = v_appt;
  INSERT INTO _r VALUES ('cancelled', (
    SELECT count(*)::text FROM appointment_reminders
     WHERE appointment_id = v_appt AND status = 'cancelled'));

  -- 3. New appointment, then reschedule start_at → reminder re-timed.
  INSERT INTO appointments
    (organization_id, client_id, staff_user_id, start_at, end_at, status, appointment_type, confirmed_at)
  VALUES
    (v_org, v_client, v_staff, v_start, v_start + interval '45 min', 'confirmed', 'Session', now())
  RETURNING id INTO v_appt2;
  UPDATE appointments
     SET start_at = v_newstart, end_at = v_newstart + interval '45 min'
   WHERE id = v_appt2;
  INSERT INTO _r VALUES ('retimed', (
    SELECT count(*)::text FROM appointment_reminders
     WHERE appointment_id = v_appt2
       AND status         = 'scheduled'
       AND scheduled_for  = v_newstart - interval '24 hours'));

  -- 4. Unavailable block (no client) → no reminder.
  INSERT INTO appointments
    (organization_id, client_id, staff_user_id, start_at, end_at, status, appointment_type, kind, confirmed_at)
  VALUES
    (v_org, NULL, v_staff, v_start, v_start + interval '60 min', 'confirmed', 'Admin/paperwork', 'unavailable', now())
  RETURNING id INTO v_unavail;
  INSERT INTO _r VALUES ('unavailable_none', (
    SELECT count(*)::text FROM appointment_reminders WHERE appointment_id = v_unavail));
END $$;

INSERT INTO _tap (n, line)
SELECT 1, string_agg(l, E'\n') FROM ok(
  (SELECT v FROM _r WHERE k = 'enqueued') = '1',
  '1: inserting a future appointment enqueues a scheduled reminder at start − 24h'
) AS l;

INSERT INTO _tap (n, line)
SELECT 2, string_agg(l, E'\n') FROM ok(
  (SELECT v FROM _r WHERE k = 'cancelled') = '1',
  '2: cancelling the appointment cancels its reminder'
) AS l;

INSERT INTO _tap (n, line)
SELECT 3, string_agg(l, E'\n') FROM ok(
  (SELECT v FROM _r WHERE k = 'retimed') = '1',
  '3: rescheduling re-times the reminder to the new start − 24h'
) AS l;

INSERT INTO _tap (n, line)
SELECT 4, string_agg(l, E'\n') FROM ok(
  (SELECT v FROM _r WHERE k = 'unavailable_none') = '0',
  '4: an unavailable-kind block (no client) gets no reminder'
) AS l;

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
