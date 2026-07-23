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
-- Extended 2026-07-23 (migration 20260723130000 — unbounded-resend fix):
--   7. NON-FATAL: a reminder status flip whose derived-log INSERT fails
--      (sms type, phoneless client → recipient constraint violation) still
--      COMMITS — the write lives; the log row is skipped with a WARNING.
--      This is the exact statement that previously aborted and produced the
--      unbounded resend loop.
--   8. …and the row really is 'sent' with zero comms rows derived for it
--   9. SMS branch constraint-valid: an sms reminder for a client WITH a
--      phone derives a communication_type='sms' row carrying recipient_phone
--
-- Fixture note: the appointment INSERT auto-enqueues its reminder via
-- appointment_manage_reminder (§9) — the fixture flips those rows the way
-- the Edge Function does. Style: _tap buffer; BEGIN/ROLLBACK.
-- ============================================================================

BEGIN;

SELECT plan(9);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated, anon;

DO $$
DECLARE
  org_v    uuid := '00000000-0000-0000-0000-0000000062a1'::uuid;
  staff_v  uuid;
  client_u uuid;
  cl       uuid := '00000000-0000-0000-0000-0000000062a2'::uuid;
  cl2      uuid := '00000000-0000-0000-0000-0000000062a3'::uuid;
  appt1    uuid := '00000000-0000-0000-0000-0000000062b1'::uuid;
  appt2    uuid := '00000000-0000-0000-0000-0000000062b2'::uuid;
  appt3    uuid := '00000000-0000-0000-0000-0000000062b3'::uuid;
  appt4    uuid := '00000000-0000-0000-0000-0000000062b4'::uuid;
  v_start  timestamptz := date_trunc('hour', now() + interval '7 days');
BEGIN
  INSERT INTO organizations (id, name, slug)
  VALUES (org_v, 'Test Org V — comms log 62', 'test-org-v-comms-62');

  staff_v  := public._test_make_user('staff-v-comms62@test.local');
  client_u := public._test_make_user('client-v-comms62@test.local');
  PERFORM public._test_grant_membership(staff_v, org_v, 'staff'::user_role);
  PERFORM public._test_grant_membership(client_u, org_v, 'client'::user_role);

  -- cl has NO phone (the sms-branch failure case); cl2 has one (the valid case).
  INSERT INTO clients (id, organization_id, user_id, first_name, last_name, email)
  VALUES (cl, org_v, client_u, 'Remy', 'Minder', 'remy-comms62@test.local');
  INSERT INTO clients (id, organization_id, first_name, last_name, email, phone)
  VALUES (cl2, org_v, 'Sam', 'Signal', 'sam-comms62@test.local', '+61400000062');

  INSERT INTO appointments (id, organization_id, client_id, staff_user_id,
                            start_at, end_at, status, confirmed_at,
                            appointment_type, kind)
  VALUES
    (appt1, org_v, cl, staff_v, v_start, v_start + interval '45 minutes',
     'confirmed', now(), 'Session', 'appointment'),
    (appt2, org_v, cl, staff_v, v_start + interval '1 day',
     v_start + interval '1 day' + interval '45 minutes',
     'confirmed', now(), 'Review', 'appointment'),
    (appt3, org_v, cl, staff_v, v_start + interval '2 days',
     v_start + interval '2 days' + interval '45 minutes',
     'confirmed', now(), 'Session', 'appointment'),
    (appt4, org_v, cl2, staff_v, v_start + interval '3 days',
     v_start + interval '3 days' + interval '45 minutes',
     'confirmed', now(), 'Session', 'appointment');

  -- Convert appt3/appt4's auto-enqueued reminders to the SMS type: appt3's
  -- client has no phone (the derived-log INSERT must fail NON-fatally);
  -- appt4's has one (the row must be a valid sms communications row).
  UPDATE appointment_reminders SET reminder_type = 'reminder_24h_sms'
   WHERE appointment_id IN (appt3, appt4);

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
    org_v, staff_v, client_u, cl, cl2, appt1, appt2, appt3, appt4;
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

-- 7. NON-FATAL (20260723130000): the sms-type reminder for the PHONELESS
-- client — the derived communications row violates
-- communications_recipient_matches_type, which previously aborted this very
-- statement (the unbounded-resend root cause). It must now commit.
INSERT INTO _tap (n, line) VALUES (7, (
  SELECT string_agg(l, E'\n') FROM lives_ok(
    $q$UPDATE appointment_reminders
          SET status = 'sent', provider = 'resend',
              provider_message_id = 'twilio-msg-62-phoneless', sent_at = now()
        WHERE appointment_id = (SELECT appt3 FROM _ids)$q$,
    'a reminder status flip survives a failing derived-log INSERT (non-fatal trigger)'
  ) AS l
));

-- 8. …the terminal write really landed, and no comms row was derived for it.
INSERT INTO _tap (n, line) VALUES (8, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT (SELECT status::text FROM appointment_reminders
              WHERE appointment_id = (SELECT appt3 FROM _ids))
         || '/' ||
         (SELECT count(*)::text FROM communications
           WHERE provider_message_id = 'twilio-msg-62-phoneless')),
    'sent/0',
    'the flip persisted as sent; the invalid derived row was skipped, not fatal'
  ) AS l
));

-- 9. SMS branch, valid case: client WITH a phone derives a constraint-valid
-- sms communications row carrying recipient_phone.
UPDATE appointment_reminders
   SET status = 'sent', provider = 'resend',
       provider_message_id = 'twilio-msg-62-ok', sent_at = now()
 WHERE appointment_id = (SELECT appt4 FROM _ids);

INSERT INTO _tap (n, line) VALUES (9, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM communications
      WHERE client_id = (SELECT cl2 FROM _ids)
        AND communication_type = 'sms'
        AND recipient_phone = '+61400000062'
        AND sender_user_id IS NULL
        AND status = 'sent'),
    1,
    'sms reminder for a phone-carrying client derives a valid sms row with recipient_phone'
  ) AS l
));

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
