-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), is(), throws_ok() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 34_message_rls
-- ============================================================================
-- The cross-tenant isolation execution gate for section 10 (Messaging), and
-- the regression tripwire for the section's P0 migrations. Until this landed,
-- messages + message_threads — a brand-new tenant surface carrying health-
-- adjacent content — had ZERO automated coverage.
--
-- Covers all four messaging P0s:
--   P0-1  anon EXECUTE revoked on the messaging definer functions   (12-14)
--   P0-2  message immutability enforced at the DB layer             (7, 9)
--   P0-3  audit trigger fires + resolves org for messages           (11)
--   P0-4  cross-tenant + within-org client RLS isolation            (1-6, 10)
--
-- Assertions (14), grouped by the session they run under (most-critical
-- isolation first), n = execution order:
--   staff_b (org_b — cross-tenant attacker):
--     1. read isolation, threads   — staff_b sees ZERO of org_a's thread.
--     2. read isolation, messages  — staff_b sees ZERO of org_a's messages.
--   client_a (org_a — the patient):
--     3. client sees its OWN thread (count 1).
--     4. client sees its own thread's messages (count 2).
--     5. within-org isolation       — client_a sees ZERO of client_a2's thread.
--     6. within-org isolation, msgs — client_a sees ZERO of client_a2's msgs.
--     7. LOAD-BEARING (FM-1) — client UPDATE of the EP's message body RAISES.
--     8. backward-compat     — client mark-read (read_at only) affects 1 row.
--   staff_a (org_a):
--     9. immutability (staff) — staff UPDATE of a message body RAISES.
--    10. control — staff_a CAN see org_a's thread (test 1 zero is isolation).
--   owner:
--    11. P0-3 — audit_log captured >=1 messages row for org_a (trigger fired
--        AND audit_resolve_org_id resolved a non-NULL org; a missing CASE
--        branch would have aborted the insert or written NULL org).
--    12. P0-1 — anon has NO EXECUTE on client_cascade_thread_archive().
--    13. P0-1 — anon has NO EXECUTE on message_update_thread_last().
--    14. P0-2 — anon has NO EXECUTE on message_enforce_immutability().
--
-- Run discipline: BEGIN/ROLLBACK so fixtures never persist; _tap buffers all
-- TAP lines into one editor grid (this project has no non-prod target — no
-- Docker — so it runs as a single batch against the live project, made safe by
-- the ROLLBACK). finish() intentionally dropped (same as 15/16/17/19); the
-- 14-row plan count is the check. Fixtures use the JWT-spoof helpers, never a
-- SECURITY DEFINER bypass, so RLS is exercised exactly as a real session sees
-- it (per the FORCE-RLS test rule).
-- ============================================================================

BEGIN;

SELECT plan(14);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated;

-- Carries data-modifying CTE row counts out (a data-modifying WITH cannot be
-- nested inside is()'s scalar-subquery arg).
CREATE TEMP TABLE _probe (k text PRIMARY KEY, v int NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _probe TO authenticated;


-- ----------------------------------------------------------------------------
-- Fixture (fully privileged — message_threads/messages carry RLS but NOT FORCE
-- ROW LEVEL SECURITY, so the owner role bypasses RLS for these inserts; same
-- property tests 17 & 19 rely on).
--
--   org_a — staff_a (staff), client_a + client_a2 (clients, linked via
--           clients.user_id), thread_a (client_a) with one staff + one client
--           message, thread_a2 (client_a2) with one message (the within-org
--           isolation target).
--   org_b — staff_b (staff). The cross-tenant attacker context.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  org_a          uuid := '00000000-0000-0000-0000-00000000ca01'::uuid;
  org_b          uuid := '00000000-0000-0000-0000-00000000ca02'::uuid;
  staff_a        uuid;
  staff_b        uuid;
  client_a_user  uuid;
  client_a2_user uuid;
  client_a_row   uuid := '00000000-0000-0000-0000-00000000ca03'::uuid;
  client_a2_row  uuid := '00000000-0000-0000-0000-00000000ca04'::uuid;
  thread_a       uuid := '00000000-0000-0000-0000-00000000ca05'::uuid;
  thread_a2      uuid := '00000000-0000-0000-0000-00000000ca06'::uuid;
  staff_msg      uuid := '00000000-0000-0000-0000-00000000ca07'::uuid;
  client_msg     uuid := '00000000-0000-0000-0000-00000000ca08'::uuid;
  msg_a2         uuid := '00000000-0000-0000-0000-00000000ca09'::uuid;
BEGIN
  INSERT INTO organizations (id, name, slug) VALUES
    (org_a, 'Test Org A — Messaging 34', 'test-org-a-messaging-34'),
    (org_b, 'Test Org B — Messaging 34', 'test-org-b-messaging-34');

  staff_a        := public._test_make_user('staff-a-msg34@test.local');
  staff_b        := public._test_make_user('staff-b-msg34@test.local');
  client_a_user  := public._test_make_user('client-a-msg34@test.local');
  client_a2_user := public._test_make_user('client-a2-msg34@test.local');

  PERFORM public._test_grant_membership(staff_a,        org_a, 'staff'::user_role);
  PERFORM public._test_grant_membership(staff_b,        org_b, 'staff'::user_role);
  PERFORM public._test_grant_membership(client_a_user,  org_a, 'client'::user_role);
  PERFORM public._test_grant_membership(client_a2_user, org_a, 'client'::user_role);

  -- clients.user_id is what the thread/message client policies key on.
  INSERT INTO clients (id, organization_id, user_id, first_name, last_name, email) VALUES
    (client_a_row,  org_a, client_a_user,  'Alpha',  'Patient', 'client-a-msg34@test.local'),
    (client_a2_row, org_a, client_a2_user, 'Second', 'Patient', 'client-a2-msg34@test.local');

  INSERT INTO message_threads (id, organization_id, client_id) VALUES
    (thread_a,  org_a, client_a_row),
    (thread_a2, org_a, client_a2_row);

  INSERT INTO messages (id, thread_id, organization_id, sender_user_id, sender_role, body) VALUES
    (staff_msg,  thread_a,  org_a, staff_a,       'staff',  'Staff message in thread A — must not be editable by the client.'),
    (client_msg, thread_a,  org_a, client_a_user, 'client', 'Client message in thread A.'),
    (msg_a2,     thread_a2, org_a, staff_a,       'staff',  'Staff message in thread A2 — invisible to client_a.');

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_a AS org_a, org_b AS org_b,
    staff_a AS staff_a, staff_b AS staff_b,
    client_a_user AS client_a_user, client_a2_user AS client_a2_user,
    client_a_row AS client_a_row, client_a2_row AS client_a2_row,
    thread_a AS thread_a, thread_a2 AS thread_a2,
    staff_msg AS staff_msg, client_msg AS client_msg, msg_a2 AS msg_a2;
  GRANT SELECT ON _ids TO authenticated;
END $$;


-- ============================================================================
-- Tests 1-2 run under staff_b (org_b) — the cross-tenant attacker.
-- ============================================================================
SELECT public._test_set_jwt(
  (SELECT staff_b FROM _ids), (SELECT org_b FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;

-- Test 1 (read isolation, threads).
INSERT INTO _tap (n, line) VALUES (1, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM message_threads WHERE id = (SELECT thread_a FROM _ids)),
    0,
    'read isolation: staff_b (org_b) sees zero of org_a''s thread'
  ) AS l
));

-- Test 2 (read isolation, messages).
INSERT INTO _tap (n, line) VALUES (2, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM messages WHERE thread_id = (SELECT thread_a FROM _ids)),
    0,
    'read isolation: staff_b (org_b) sees zero of org_a''s messages'
  ) AS l
));


-- ============================================================================
-- Tests 3-8 run under client_a (org_a) — the patient.
-- ============================================================================
RESET ROLE;
SELECT public._test_set_jwt(
  (SELECT client_a_user FROM _ids), (SELECT org_a FROM _ids), 'client'
);
SET LOCAL ROLE authenticated;

-- Test 3 (client sees its own thread).
INSERT INTO _tap (n, line) VALUES (3, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM message_threads WHERE id = (SELECT thread_a FROM _ids)),
    1,
    'client_a sees its own thread (count 1)'
  ) AS l
));

-- Test 4 (client sees its own thread's messages).
INSERT INTO _tap (n, line) VALUES (4, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM messages WHERE thread_id = (SELECT thread_a FROM _ids)),
    2,
    'client_a sees both of its own thread''s messages (count 2)'
  ) AS l
));

-- Test 5 (within-org isolation, threads): another client's thread is invisible.
INSERT INTO _tap (n, line) VALUES (5, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM message_threads WHERE id = (SELECT thread_a2 FROM _ids)),
    0,
    'within-org isolation: client_a sees zero of another client''s thread (same org)'
  ) AS l
));

-- Test 6 (within-org isolation, messages).
INSERT INTO _tap (n, line) VALUES (6, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM messages WHERE thread_id = (SELECT thread_a2 FROM _ids)),
    0,
    'within-org isolation: client_a sees zero of another client''s messages (same org)'
  ) AS l
));

-- Test 7 (LOAD-BEARING, FM-1): the client cannot rewrite the EP's message body.
-- The RLS USING admits the row (it is in the client's own thread); the
-- immutability trigger is what refuses the body change. P0001 + exact message.
INSERT INTO _tap (n, line) VALUES (7, (
  SELECT string_agg(l, E'\n') FROM throws_ok(
    format(
      $q$UPDATE messages SET body = 'HACKED BY CLIENT' WHERE id = %L::uuid$q$,
      (SELECT staff_msg FROM _ids)
    ),
    'P0001',
    'messages are immutable; only read_at may change',
    'LOAD-BEARING (FM-1): client UPDATE of the EP''s message body is rejected by the immutability trigger'
  ) AS l
));

-- Test 8 (backward-compat): a read_at-only mark-read still works (affects 1
-- row) — proves the trigger permits the one mutation the app actually makes.
WITH u AS (
  UPDATE messages SET read_at = now()
   WHERE id = (SELECT staff_msg FROM _ids)
     AND sender_role = 'staff'
  RETURNING 1
)
INSERT INTO _probe (k, v) SELECT 'markread_rows', count(*)::int FROM u;

INSERT INTO _tap (n, line) VALUES (8, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT v FROM _probe WHERE k = 'markread_rows'),
    1,
    'backward-compat: client mark-read (read_at only) succeeds, affects 1 row'
  ) AS l
));


-- ============================================================================
-- Tests 9-10 run under staff_a (org_a).
-- ============================================================================
RESET ROLE;
SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;

-- Test 9 (immutability, staff side): staff also cannot rewrite a message body.
INSERT INTO _tap (n, line) VALUES (9, (
  SELECT string_agg(l, E'\n') FROM throws_ok(
    format(
      $q$UPDATE messages SET body = 'STAFF EDIT' WHERE id = %L::uuid$q$,
      (SELECT client_msg FROM _ids)
    ),
    'P0001',
    'messages are immutable; only read_at may change',
    'immutability: staff UPDATE of a message body is rejected by the trigger'
  ) AS l
));

-- Test 10 (control): staff_a CAN see org_a's thread — proves test 1's zero is
-- isolation, not an absent fixture.
INSERT INTO _tap (n, line) VALUES (10, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM message_threads WHERE id = (SELECT thread_a FROM _ids)),
    1,
    'control: staff_a sees org_a''s thread (test 1 zero is isolation, not absent fixture)'
  ) AS l
));


-- ============================================================================
-- Tests 11-14 run as the owner (P0-3 audit read + P0-1/P0-2 grants probes).
-- ============================================================================
RESET ROLE;

-- Test 11 (P0-3): the audit trigger fired on the message inserts/update AND
-- audit_resolve_org_id resolved the org (a missing CASE branch would have
-- aborted the insert; a broken one would write NULL org). >=1 row for org_a.
INSERT INTO _tap (n, line) VALUES (11, (
  SELECT string_agg(l, E'\n') FROM ok(
    (SELECT count(*) FROM audit_log
      WHERE table_name = 'messages'
        AND organization_id = (SELECT org_a FROM _ids)) >= 1,
    'P0-3: audit_log captured >=1 messages row for org_a (trigger fired + org resolved non-NULL)'
  ) AS l
));

-- Test 12 (P0-1): anon has no EXECUTE on the archive-cascade trigger fn.
INSERT INTO _tap (n, line) VALUES (12, (
  SELECT string_agg(l, E'\n') FROM is(
    has_function_privilege('anon', 'public.client_cascade_thread_archive()', 'EXECUTE'),
    false,
    'P0-1: anon has NO EXECUTE on client_cascade_thread_archive()'
  ) AS l
));

-- Test 13 (P0-1): anon has no EXECUTE on the thread-last bump trigger fn.
INSERT INTO _tap (n, line) VALUES (13, (
  SELECT string_agg(l, E'\n') FROM is(
    has_function_privilege('anon', 'public.message_update_thread_last()', 'EXECUTE'),
    false,
    'P0-1: anon has NO EXECUTE on message_update_thread_last()'
  ) AS l
));

-- Test 14 (P0-2): anon has no EXECUTE on the immutability trigger fn.
INSERT INTO _tap (n, line) VALUES (14, (
  SELECT string_agg(l, E'\n') FROM is(
    has_function_privilege('anon', 'public.message_enforce_immutability()', 'EXECUTE'),
    false,
    'P0-2: anon has NO EXECUTE on message_enforce_immutability()'
  ) AS l
));


-- ----------------------------------------------------------------------------
-- Surface all fourteen captured TAP lines in one editor grid. finish() is
-- intentionally dropped (same pattern as 15/16/17/19); the 14-row plan count
-- is the check.
-- ----------------------------------------------------------------------------
SELECT line FROM _tap ORDER BY n;

ROLLBACK;
