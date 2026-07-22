-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), ok(), is() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 62_comms_system_send_log
-- ============================================================================
-- Locks in migration 20260721160000 — §12 Part B (logging half):
-- reminder outcomes become communications rows, sender_user_id is nullable
-- for system sends, and the Comms-tab read path stays staff-only.
--
-- Assertions (6):
--   1. reminder → 'sent' inserts a communications row: right client/org,
--      system sender (NULL), type email, status sent, provider id carried
--   2. that row's recipient is the client's email and the subject is the
--      reminder subject
--   3. reminder → 'failed' inserts a FAILED row carrying failure_reason
--      (the EP-facing surfacing §12 Part A deliberately left to this tab)
--   4. staff session sees both rows (the Comms tab read)
--   5. a client-role session sees ZERO communications rows
--   6. anon SELECT raises 42501 (post-4b grant posture)
--
-- Fixture note: the appointment INSERT auto-enqueues its reminder via
-- appointment_manage_reminder (§9) — the fixture flips those rows the way
-- the Edge Function does. Style: _tap buffer; BEGIN/ROLLBACK.
-- ============================================================================

BEGIN;

SELECT plan(6);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated, anon;

DO $$
DECLARE
  org_v    uuid := '00000000-0000-0000-0000-0000000062a1'::uuid;
  staff_v  uuid;
  client_u uuid;
  cl       uuid := '00000000-0000-0000-0000-0000000062a2'::uuid;
  appt1    uuid := '00000000-0000-0000-0000-0000000062b1'::uuid;
  appt2    uuid := '00000000-0000-0000-0000-0000000062b2'::uuid;
  v_start  timestamptz := date_trunc('hour', now() + interval '7 days');
BEGIN
  INSERT INTO organizations (id, name, slug)
  VALUES (org_v, 'Test Org V — comms log 62', 'test-org-v-comms-62');

  staff_v  := public._test_make_user('staff-v-comms62@test.local');
  client_u := public._test_make_user('client-v-comms62@test.local');
  PERFORM public._test_grant_membership(staff_v, org_v, 'staff'::user_role);
  PERFORM public._test_grant_membership(client_u, org_v, 'client'::user_role);

  INSERT INTO clients (id, organization_id, user_id, first_name, last_name, email)
  VALUES (cl, org_v, client_u, 'Remy', 'Minder', 'remy-comms62@test.local');

  INSERT INTO appointments (id, organization_id, client_id, staff_user_id,
                            start_at, end_at, status, confirmed_at,
                            appointment_type, kind)
  VALUES
    (appt1, org_v, cl, staff_v, v_start, v_start + interval '45 minutes',
     'confirmed', now(), 'Session', 'appointment'),
    (appt2, org_v, cl, staff_v, v_start + interval '1 day',
     v_start + interval '1 day' + interval '45 minutes',
     'confirmed', now(), 'Review', 'appointment');

  -- The EF's writes, replayed: one send success, one failure.
  UPDATE appointment_reminders
     SET status = 'sent', provider = 'resend',
         provider_message_id = 'resend-msg-62-ok', sent_at = now()
   WHERE appointment_id = appt1;

  UPDATE appointment_reminders
     SET status = 'failed', failed_at = now(),
         failure_reason = 'resend 401 validation_error (fixture)'
   WHERE appointment_id = appt2;

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_v, staff_v, client_u, cl, appt1, appt2;
  GRANT SELECT ON _ids TO authenticated;
END $$;

INSERT INTO _tap (n, line) VALUES (1, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM communications
      WHERE organization_id = (SELECT org_v FROM _ids)
        AND client_id = (SELECT cl FROM _ids)
        AND sender_user_id IS NULL
        AND communication_type = 'email'
        AND status = 'sent'
        AND provider_message_id = 'resend-msg-62-ok'),
    1,
    'reminder send logged: system-sender email row with the provider id'
  ) AS l
));

INSERT INTO _tap (n, line) VALUES (2, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT recipient_email || ' / ' || subject FROM communications
      WHERE client_id = (SELECT cl FROM _ids) AND status = 'sent' LIMIT 1),
    'remy-comms62@test.local / Appointment reminder',
    'the sent row carries the client''s email and the reminder subject'
  ) AS l
));

INSERT INTO _tap (n, line) VALUES (3, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM communications
      WHERE client_id = (SELECT cl FROM _ids)
        AND status = 'failed'
        AND failure_reason = 'resend 401 validation_error (fixture)'),
    1,
    'reminder FAILURE logged with its failure_reason (EP-facing surfacing)'
  ) AS l
));

-- 4. the Comms tab read, as the staff session
SELECT public._test_set_jwt(
  (SELECT staff_v FROM _ids), (SELECT org_v FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;
INSERT INTO _tap (n, line) VALUES (4, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM communications
      WHERE client_id = (SELECT cl FROM _ids)),
    2,
    'staff session reads both logged communications (the Comms tab query)'
  ) AS l
));
RESET ROLE;

-- 5. client role sees nothing
SELECT public._test_set_jwt(
  (SELECT client_u FROM _ids), (SELECT org_v FROM _ids), 'client'
);
SET LOCAL ROLE authenticated;
INSERT INTO _tap (n, line) VALUES (5, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM communications),
    0,
    'client-role session sees ZERO communications rows'
  ) AS l
));
RESET ROLE;

-- 6. anon denied at the grant layer
SET LOCAL ROLE anon;
INSERT INTO _tap (n, line) VALUES (6, (
  SELECT string_agg(l, E'\n') FROM throws_ok(
    'SELECT count(*) FROM public.communications',
    '42501', NULL,
    'anon SELECT on communications raises 42501'
  ) AS l
));
RESET ROLE;

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
