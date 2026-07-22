-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), ok(), is() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 56_archived_client_access
-- ============================================================================
-- Locks in migration 20260702180000 — CN-7 P0-1 (the additive staff-only
-- archived-read policy) and P1-5 (soft_delete_client v2 cancels the client's
-- future appointments, whose reminders cascade-cancel via the lifecycle
-- trigger). docs/polish/archived-client-access.md; master brief §7.2.
--
-- Assertions (8), most-critical-first:
--   1. LOAD-BEARING (new capability) — staff in the org CAN read an
--      archived client row. If a future policy rewrite re-seals archived
--      rows, the §7.2 requirement silently regresses — this catches it.
--   2. LOAD-BEARING (portal lockout preserved) — the client-role session
--      LINKED to that archived row sees ZERO rows. The new policy must
--      never leak archived visibility to the client role.
--   3. LOAD-BEARING (tenant boundary) — staff in a FOREIGN org see zero of
--      the archived row. The new policy carries its own org predicate.
--   4. control — the same staff session still reads a LIVE client (the
--      original policy is intact; 1 and 4 together prove the two policies
--      OR correctly).
--   5. anon — SELECT on clients still raises 42501 (the post-4b grant-layer
--      denial is untouched by adding a policy).
--   6. P1-5 — soft_delete_client flips the client's FUTURE confirmed
--      appointment to cancelled with cancelled_by_role='staff'.
--   7. P1-5 cascade — that appointment's queued reminder flipped to
--      cancelled (appointment_manage_reminder fired on the status change).
--   8. round trip — restore_client clears deleted_at/archived_at and the
--      row is readable again under the LIVE policy (and the cancelled
--      appointment deliberately STAYS cancelled — restore does not
--      resurrect bookings).
--
-- Assertions 9-18 (added 2026-07-22, reviewer verdict on the section close of
-- docs/polish/auth-onboarding-client.md): the C-3 archived-client tripwire.
-- C-3 was dismissed as a false premise on the reading-only universal claim
-- "every client-readable RLS policy gates through clients.deleted_at IS NULL,
-- so data denial is immediate at archive commit — no token-TTL window." These
-- assertions convert that claim into a regression test, using the REAL archive
-- mechanism (soft_delete_client on cancel_client, already exercised at test 6)
-- rather than a seeded-archived row — a direct INSERT of archived state would
-- bypass the client_cascade_thread_archive trigger and mis-test the thread
-- surface. Same login, same five surfaces, before and after; the only variable
-- between the two blocks is the archive RPC:
--
--   9-13. pre-archive controls — cancel_client's OWN client-role login sees
--         its clients row, active program, session, appointment, and message
--         thread (each count 1). Anti-trivial half: proves the client-read
--         path lives on every table asserted zero below.
--  14-18. post-archive zeros — the same login sees ZERO rows on all five
--         surfaces immediately after soft_delete_client, inside the same
--         transaction. Zero at commit, not at token expiry.
--
-- clinical_notes is deliberately absent from 9-18: the client role is
-- blanket-denied there (rls_clinical_notes_select_client_denied, §4.6), so
-- archived-gating is moot on that table.
--
-- Style: buffered into _tap (mirrors 19/51/53); BEGIN/ROLLBACK for live-run
-- safety; finish() intentionally dropped (same as 15/16/17).
-- ============================================================================

BEGIN;

SELECT plan(18);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
-- anon writes assertion 5's line while dropped to the anon role.
GRANT INSERT, SELECT ON _tap TO authenticated, anon;

-- ----------------------------------------------------------------------------
-- Fixture (owner-privileged):
--   org_g — staff_g; arch_client (deleted_at+archived_at set) linked to
--           arch_user (client role) for the lockout test; live_client (the
--           control); cancel_client (live, with a future confirmed
--           appointment whose INSERT trigger enqueues a reminder).
--   org_h — staff_h (the foreign-org reader).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  org_g         uuid := '00000000-0000-0000-0000-0000000055a1'::uuid;
  org_h         uuid := '00000000-0000-0000-0000-0000000055b1'::uuid;
  staff_g       uuid;
  staff_h       uuid;
  arch_user     uuid;
  cancel_user   uuid;
  arch_client   uuid := '00000000-0000-0000-0000-0000000055a2'::uuid;
  live_client   uuid := '00000000-0000-0000-0000-0000000055a3'::uuid;
  cancel_client uuid := '00000000-0000-0000-0000-0000000055a4'::uuid;
  appt          uuid := '00000000-0000-0000-0000-0000000055a5'::uuid;
  v_start       timestamptz;
BEGIN
  INSERT INTO organizations (id, name, slug) VALUES
    (org_g, 'Test Org G — archived access 55', 'test-org-g-archived-55'),
    (org_h, 'Test Org H — archived access 55', 'test-org-h-archived-55');

  staff_g     := public._test_make_user('staff-g-arch55@test.local');
  staff_h     := public._test_make_user('staff-h-arch55@test.local');
  arch_user   := public._test_make_user('client-arch55@test.local');
  cancel_user := public._test_make_user('client-cancel55@test.local');

  PERFORM public._test_grant_membership(staff_g,     org_g, 'staff'::user_role);
  PERFORM public._test_grant_membership(staff_h,     org_h, 'staff'::user_role);
  PERFORM public._test_grant_membership(arch_user,   org_g, 'client'::user_role);
  PERFORM public._test_grant_membership(cancel_user, org_g, 'client'::user_role);

  -- The archived client, linked to a real client-role login (the strongest
  -- lockout case: even their OWN archived row must be invisible to them).
  INSERT INTO clients (id, organization_id, user_id, first_name, last_name,
                       email, deleted_at, archived_at)
  VALUES (arch_client, org_g, arch_user, 'Archie', 'Gone',
          'archie-arch55@test.local', now() - interval '1 day', now() - interval '1 day');

  INSERT INTO clients (id, organization_id, first_name, last_name, email)
  VALUES (live_client, org_g, 'Liv', 'Here', 'liv-arch55@test.local');

  -- The client whose archive must cancel their future booking. Linked to a
  -- real client-role login (cancel_user) so tests 9-18 can probe the portal-
  -- readable perimeter through their own session before and after the archive.
  INSERT INTO clients (id, organization_id, user_id, first_name, last_name, email)
  VALUES (cancel_client, org_g, cancel_user, 'Cass', 'Future', 'cass-arch55@test.local');

  -- Future confirmed appointment, 15-minute-aligned, 7 days out. The
  -- appointment_manage_reminder AFTER INSERT trigger enqueues its reminder
  -- (org has no reminder_lead_hours -> COALESCE 24h; scheduled_for is
  -- comfortably in the future so it stays 'scheduled').
  v_start := date_trunc('hour', now() + interval '7 days');
  INSERT INTO appointments (id, organization_id, client_id, staff_user_id,
                            start_at, end_at, status, confirmed_at,
                            appointment_type, kind)
  VALUES (appt, org_g, cancel_client, staff_g,
          v_start, v_start + interval '60 minutes', 'confirmed', now(),
          'Initial consultation', 'appointment');

  -- Portal-readable dependents for cancel_client (tests 9-18): one client-
  -- visible program (status 'active' — the client SELECT policy only exposes
  -- active/archived), one session, one message thread. Together with the
  -- appointment above these span the client-readable RLS perimeter.
  INSERT INTO programs (organization_id, client_id, name, start_date, duration_weeks, status)
  VALUES (org_g, cancel_client, 'Cass Program 55', CURRENT_DATE, 4, 'active');
  INSERT INTO sessions (organization_id, client_id)
  VALUES (org_g, cancel_client);
  INSERT INTO message_threads (organization_id, client_id)
  VALUES (org_g, cancel_client);

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_g AS org_g, org_h AS org_h, staff_g AS staff_g, staff_h AS staff_h,
    arch_user AS arch_user, cancel_user AS cancel_user, arch_client AS arch_client,
    live_client AS live_client, cancel_client AS cancel_client, appt AS appt;
  GRANT SELECT ON _ids TO authenticated;
END $$;

-- Sanity: the fixture's reminder must exist before the cancel test means anything.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM appointment_reminders
     WHERE appointment_id = (SELECT appt FROM _ids) AND status = 'scheduled'
  ) THEN
    RAISE EXCEPTION 'fixture broken: reminder was not enqueued for the future appointment';
  END IF;
END $$;


-- ============================================================================
-- Tests 9-13 (pre-archive controls): cancel_client's OWN client-role login
-- sees every portal-readable surface BEFORE the archive. The anti-trivial
-- half of tests 14-18 — same login, same tables; the only variable between
-- the two blocks is soft_delete_client.
-- ============================================================================
SELECT public._test_set_jwt(
  (SELECT cancel_user FROM _ids), (SELECT org_g FROM _ids), 'client'
);
SET LOCAL ROLE authenticated;

INSERT INTO _tap (n, line) VALUES (9, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM clients),
    1,
    'pre-archive control: the linked client login sees its own clients row'
  ) AS l
));

INSERT INTO _tap (n, line) VALUES (10, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM programs),
    1,
    'pre-archive control: the client sees its own active program'
  ) AS l
));

INSERT INTO _tap (n, line) VALUES (11, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM sessions),
    1,
    'pre-archive control: the client sees its own session'
  ) AS l
));

INSERT INTO _tap (n, line) VALUES (12, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM appointments),
    1,
    'pre-archive control: the client sees its own future appointment'
  ) AS l
));

INSERT INTO _tap (n, line) VALUES (13, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM message_threads),
    1,
    'pre-archive control: the client sees its own message thread'
  ) AS l
));

RESET ROLE;

-- ============================================================================
-- Tests 1 & 4: staff in org_g read the archived row AND the live row.
-- ============================================================================
SELECT public._test_set_jwt(
  (SELECT staff_g FROM _ids), (SELECT org_g FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;

INSERT INTO _tap (n, line) VALUES (1, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM clients WHERE id = (SELECT arch_client FROM _ids)),
    1,
    'LOAD-BEARING (CN-7): staff CAN read an archived client in their own org'
  ) AS l
));

INSERT INTO _tap (n, line) VALUES (4, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM clients WHERE id = (SELECT live_client FROM _ids)),
    1,
    'control: staff still reads a live client (the original policy is intact)'
  ) AS l
));

-- ============================================================================
-- Test 6 & 7: archiving cancels the future appointment + its reminder.
-- Runs as the staff session — the real caller of soft_delete_client.
-- ============================================================================
SELECT public.soft_delete_client((SELECT cancel_client FROM _ids));

INSERT INTO _tap (n, line) VALUES (6, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT status || '/' || COALESCE(cancelled_by_role, 'null')
       FROM appointments WHERE id = (SELECT appt FROM _ids)),
    'cancelled/staff',
    'P1-5: archive cancels the future appointment (status=cancelled, by staff)'
  ) AS l
));

RESET ROLE;

-- Reminder read runs as owner: RLS denies authenticated SELECT on
-- appointment_reminders by design (staff read it via the parent policy, but
-- the owner read keeps this assertion independent of that policy's shape).
INSERT INTO _tap (n, line) VALUES (7, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT status FROM appointment_reminders
      WHERE appointment_id = (SELECT appt FROM _ids)
        AND reminder_type = 'reminder_24h_email'),
    'cancelled',
    'P1-5 cascade: the queued reminder flipped to cancelled (lifecycle trigger fired)'
  ) AS l
));

-- ============================================================================
-- Tests 14-18 (post-archive zeros — the C-3 tripwire): the SAME login, the
-- SAME five surfaces, immediately after soft_delete_client, inside the same
-- transaction. The reading-only claim that discharged C-3 ("every client-
-- readable policy gates through clients.deleted_at IS NULL — data denial is
-- immediate at archive commit") becomes a regression test here. Zero rows
-- means zero at COMMIT — no access-token-TTL window.
-- ============================================================================
SELECT public._test_set_jwt(
  (SELECT cancel_user FROM _ids), (SELECT org_g FROM _ids), 'client'
);
SET LOCAL ROLE authenticated;

INSERT INTO _tap (n, line) VALUES (14, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM clients),
    0,
    'C-3 tripwire: post-archive, the client''s own clients row is invisible to them'
  ) AS l
));

INSERT INTO _tap (n, line) VALUES (15, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM programs),
    0,
    'C-3 tripwire: post-archive, their active program returns zero rows'
  ) AS l
));

INSERT INTO _tap (n, line) VALUES (16, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM sessions),
    0,
    'C-3 tripwire: post-archive, their session history returns zero rows'
  ) AS l
));

INSERT INTO _tap (n, line) VALUES (17, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM appointments),
    0,
    'C-3 tripwire: post-archive, appointments return zero (clients-gate; P1-5 also cancelled it)'
  ) AS l
));

INSERT INTO _tap (n, line) VALUES (18, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM message_threads),
    0,
    'C-3 tripwire: post-archive, the thread is gone (clients-gate + archive cascade)'
  ) AS l
));

RESET ROLE;

-- ============================================================================
-- Test 2: the archived client's OWN login sees zero rows (portal lockout).
-- ============================================================================
SELECT public._test_set_jwt(
  (SELECT arch_user FROM _ids), (SELECT org_g FROM _ids), 'client'
);
SET LOCAL ROLE authenticated;

INSERT INTO _tap (n, line) VALUES (2, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM clients),
    0,
    'LOAD-BEARING (CN-7): the archived client''s own login sees ZERO clients rows (portal lockout preserved)'
  ) AS l
));

RESET ROLE;

-- ============================================================================
-- Test 3: foreign-org staff see zero of org_g's archived client.
-- ============================================================================
SELECT public._test_set_jwt(
  (SELECT staff_h FROM _ids), (SELECT org_h FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;

INSERT INTO _tap (n, line) VALUES (3, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM clients WHERE id = (SELECT arch_client FROM _ids)),
    0,
    'LOAD-BEARING (CN-7): foreign-org staff see zero archived rows (org predicate holds on the new policy)'
  ) AS l
));

RESET ROLE;

-- ============================================================================
-- Test 5: anon is still denied at the grant layer (post-4b posture).
-- ============================================================================
SELECT public._test_clear_jwt();
SET LOCAL ROLE anon;

INSERT INTO _tap (n, line) VALUES (5, (
  SELECT string_agg(l, E'\n') FROM throws_ok(
    'SELECT count(*) FROM public.clients',
    '42501',
    NULL,
    'anon SELECT on clients still raises 42501 (adding a policy does not touch the grant layer)'
  ) AS l
));

RESET ROLE;

-- ============================================================================
-- Test 8: restore round trip — the archived-then-restored client is readable
-- under the LIVE policy again, and the cancelled appointment stays cancelled.
-- ============================================================================
SELECT public._test_set_jwt(
  (SELECT staff_g FROM _ids), (SELECT org_g FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;

SELECT public.restore_client((SELECT cancel_client FROM _ids));

INSERT INTO _tap (n, line) VALUES (8, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT (count(*))::int * 10 + (
        SELECT CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END
          FROM appointments WHERE id = (SELECT appt FROM _ids))
       FROM clients
      WHERE id = (SELECT cancel_client FROM _ids) AND deleted_at IS NULL),
    11,  -- 1 live-readable row x 10 + appointment still cancelled
    'round trip: restore_client revives the row (live policy) and the cancelled booking stays cancelled'
  ) AS l
));

RESET ROLE;

-- ----------------------------------------------------------------------------
-- Surface all captured TAP lines in one grid.
-- ----------------------------------------------------------------------------
SELECT line FROM _tap ORDER BY n;

ROLLBACK;
