-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), ok(), is() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 53_message_notification_queue
-- ============================================================================
-- Locks in migration 20260702140000 — the messaging P1-1(c) queue+cron
-- upgrade (docs/polish/messaging.md; go-live-checklist §8). The client→EP
-- new-message email is now enqueued by the message_notification_enqueue
-- AFTER INSERT trigger on messages and drained by the
-- send-message-notifications Edge Function; this test proves the DB half:
-- enqueue, debounce, role-gating, RLS posture, grant posture, and the full
-- read→sent→re-enqueue cycle.
--
-- Assertions (8), most-critical-first:
--   1. LOAD-BEARING — a client's FIRST unread message enqueues exactly one
--      scheduled notification row for the org owner. (If a future migration
--      drops the trigger, this fails — the notification silently dying is
--      exactly the failure mode P1-1(c) exists to prevent.)
--   2. LOAD-BEARING — debounce: a second unread client message enqueues
--      nothing further (still one row). One email per unread cycle.
--   3. A staff-sent message never enqueues (still one row).
--   4. RLS — a client session sees ZERO message_notifications rows (the
--      queue is staff-only SELECT; ops metadata, not client-facing).
--   5. RLS positive control — the owner session sees the row (proves 4's
--      zero is role-gating, not an absent fixture).
--   6. anon holds no EXECUTE on message_notification_enqueue (definer-only
--      from birth — the §4 sweep posture).
--   7. authenticated holds no EXECUTE on message_notification_enqueue.
--   8. Full cycle — after the owner reads the thread (read_at stamped, the
--      pgTAP-34-proven recipient-only path) and the worker marks the row
--      sent, the NEXT first-unread client message enqueues a fresh
--      scheduled row (total 2, scheduled 1).
--
-- Style: buffered into _tap (mirrors 19/51); BEGIN/ROLLBACK for live-run
-- safety; finish() intentionally dropped (same as 15/16/17/19).
-- ============================================================================

BEGIN;

SELECT plan(8);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated;

-- ----------------------------------------------------------------------------
-- Fixture (owner-privileged): org_f — owner_f (owner, the notification
-- recipient), client_f_user (client role) linked via clients.user_id, one
-- message thread. No messages yet — the tests insert those under real
-- role sessions so the trigger fires on the true runtime path.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  org_f         uuid := '00000000-0000-0000-0000-00000000f101'::uuid;
  owner_f       uuid;
  client_f_user uuid;
  client_row_id uuid := '00000000-0000-0000-0000-00000000f102'::uuid;
  thread_f      uuid := '00000000-0000-0000-0000-00000000f103'::uuid;
BEGIN
  INSERT INTO organizations (id, name, slug)
  VALUES (org_f, 'Test Org F — msg queue 53', 'test-org-f-msg-queue-53');

  owner_f       := public._test_make_user('owner-msgq53@test.local');
  client_f_user := public._test_make_user('client-msgq53@test.local');

  PERFORM public._test_grant_membership(owner_f,       org_f, 'owner'::user_role);
  PERFORM public._test_grant_membership(client_f_user, org_f, 'client'::user_role);

  INSERT INTO clients (id, organization_id, user_id, first_name, last_name, email)
  VALUES (client_row_id, org_f, client_f_user, 'Queue', 'Client', 'queue-msgq53@test.local');

  INSERT INTO message_threads (id, organization_id, client_id)
  VALUES (thread_f, org_f, client_row_id);

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_f AS org_f, owner_f AS owner_f, client_f_user AS client_f_user,
    client_row_id AS client_row_id, thread_f AS thread_f;
  GRANT SELECT ON _ids TO authenticated;
END $$;


-- ============================================================================
-- Tests 1–2: client session sends messages; the trigger enqueues once.
-- ============================================================================
SELECT public._test_set_jwt(
  (SELECT client_f_user FROM _ids), (SELECT org_f FROM _ids), 'client'
);
SET LOCAL ROLE authenticated;

INSERT INTO messages (thread_id, organization_id, sender_user_id, sender_role, body)
VALUES (
  (SELECT thread_f FROM _ids), (SELECT org_f FROM _ids),
  (SELECT client_f_user FROM _ids), 'client', 'First unread client message.'
);

RESET ROLE;

-- Test 1 (LOAD-BEARING): exactly one scheduled row for the owner.
INSERT INTO _tap (n, line) VALUES (1, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM message_notifications
      WHERE thread_id = (SELECT thread_f FROM _ids)
        AND recipient_user_id = (SELECT owner_f FROM _ids)
        AND status = 'scheduled'),
    1,
    'LOAD-BEARING (P1-1c): first unread client message enqueues one scheduled notification for the owner'
  ) AS l
));

-- Second unread client message — must NOT enqueue again.
SELECT public._test_set_jwt(
  (SELECT client_f_user FROM _ids), (SELECT org_f FROM _ids), 'client'
);
SET LOCAL ROLE authenticated;

INSERT INTO messages (thread_id, organization_id, sender_user_id, sender_role, body)
VALUES (
  (SELECT thread_f FROM _ids), (SELECT org_f FROM _ids),
  (SELECT client_f_user FROM _ids), 'client', 'Second unread client message.'
);

RESET ROLE;

-- Test 2 (LOAD-BEARING): still exactly one row — debounced.
INSERT INTO _tap (n, line) VALUES (2, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM message_notifications
      WHERE thread_id = (SELECT thread_f FROM _ids)),
    1,
    'LOAD-BEARING (P1-1c): second unread client message does not enqueue again (one email per unread cycle)'
  ) AS l
));


-- ============================================================================
-- Test 3: a staff-sent message never enqueues.
-- ============================================================================
SELECT public._test_set_jwt(
  (SELECT owner_f FROM _ids), (SELECT org_f FROM _ids), 'owner'
);
SET LOCAL ROLE authenticated;

INSERT INTO messages (thread_id, organization_id, sender_user_id, sender_role, body)
VALUES (
  (SELECT thread_f FROM _ids), (SELECT org_f FROM _ids),
  (SELECT owner_f FROM _ids), 'staff', 'Staff reply — must not enqueue.'
);

RESET ROLE;

INSERT INTO _tap (n, line) VALUES (3, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM message_notifications
      WHERE thread_id = (SELECT thread_f FROM _ids)),
    1,
    'staff-sent message does not enqueue a notification'
  ) AS l
));


-- ============================================================================
-- Test 4: RLS — client session sees zero queue rows.
-- ============================================================================
SELECT public._test_set_jwt(
  (SELECT client_f_user FROM _ids), (SELECT org_f FROM _ids), 'client'
);
SET LOCAL ROLE authenticated;

INSERT INTO _tap (n, line) VALUES (4, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM message_notifications),
    0,
    'RLS: client session sees zero message_notifications rows (staff-only SELECT)'
  ) AS l
));

RESET ROLE;

-- ============================================================================
-- Test 5: RLS positive control — owner session sees the row.
-- ============================================================================
SELECT public._test_set_jwt(
  (SELECT owner_f FROM _ids), (SELECT org_f FROM _ids), 'owner'
);
SET LOCAL ROLE authenticated;

INSERT INTO _tap (n, line) VALUES (5, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM message_notifications
      WHERE thread_id = (SELECT thread_f FROM _ids)),
    1,
    'control: owner session sees the queue row (test 4 zero is role-gating, not absent fixture)'
  ) AS l
));

-- ============================================================================
-- Tests 6–7: trigger-function grant posture (definer-only from birth).
-- Still under the owner session for 7's has_function_privilege? No — check
-- as the test owner: has_function_privilege takes the role by name.
-- ============================================================================
RESET ROLE;

INSERT INTO _tap (n, line) VALUES (6, (
  SELECT string_agg(l, E'\n') FROM ok(
    NOT has_function_privilege('anon', 'public.message_notification_enqueue()', 'EXECUTE'),
    'anon cannot execute message_notification_enqueue'
  ) AS l
));

INSERT INTO _tap (n, line) VALUES (7, (
  SELECT string_agg(l, E'\n') FROM ok(
    NOT has_function_privilege('authenticated', 'public.message_notification_enqueue()', 'EXECUTE'),
    'authenticated cannot execute message_notification_enqueue'
  ) AS l
));


-- ============================================================================
-- Test 8: full cycle — owner reads the thread (recipient-only read_at path,
-- proven by pgTAP 34 #15–17), the worker marks the row sent (simulated as
-- owner-privileged UPDATE), then the next first-unread client message
-- enqueues a FRESH scheduled row.
-- ============================================================================
SELECT public._test_set_jwt(
  (SELECT owner_f FROM _ids), (SELECT org_f FROM _ids), 'owner'
);
SET LOCAL ROLE authenticated;

-- Owner stamps read_at on the client-sender rows (markThreadReadAction shape).
UPDATE messages
   SET read_at = now()
 WHERE thread_id = (SELECT thread_f FROM _ids)
   AND sender_role = 'client'
   AND read_at IS NULL;

RESET ROLE;

-- Simulate the worker having sent the pending row.
UPDATE message_notifications
   SET status = 'sent', sent_at = now()
 WHERE thread_id = (SELECT thread_f FROM _ids)
   AND status = 'scheduled';

-- New first-unread client message → fresh enqueue.
SELECT public._test_set_jwt(
  (SELECT client_f_user FROM _ids), (SELECT org_f FROM _ids), 'client'
);
SET LOCAL ROLE authenticated;

INSERT INTO messages (thread_id, organization_id, sender_user_id, sender_role, body)
VALUES (
  (SELECT thread_f FROM _ids), (SELECT org_f FROM _ids),
  (SELECT client_f_user FROM _ids), 'client', 'New cycle — first unread again.'
);

RESET ROLE;

INSERT INTO _tap (n, line) VALUES (8, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT (count(*) FILTER (WHERE status = 'scheduled'))::int * 10
          + (count(*))::int
       FROM message_notifications
      WHERE thread_id = (SELECT thread_f FROM _ids)),
    12,  -- 1 scheduled × 10 + 2 total
    'full cycle: after read + sent, the next first-unread message enqueues a fresh row (1 scheduled, 2 total)'
  ) AS l
));


-- ----------------------------------------------------------------------------
-- Surface all captured TAP lines in one grid.
-- ----------------------------------------------------------------------------
SELECT line FROM _tap ORDER BY n;

ROLLBACK;
