-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), is(), throws_ok() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 16_password_recovery_ticket_consume
-- ============================================================================
-- Adversarial proofs for migration 20260527140000_password_recovery_tickets.
-- The single atomic UPDATE inside consume_recovery_ticket() is the heart of
-- the recovery-session-conflation fix (Shape B). Five properties, six
-- assertions (the RLS-denial property splits into a SELECT-denial and an
-- INSERT-denial check).
--
-- Ordered most-critical-first so a failing run surfaces the security
-- regression at the top:
--
--   1. (b) Cross-email block — THE attack the fix exists to close: a
--          ticket minted for user A CANNOT be consumed from user B's
--          session.
--   2. (a) Happy path — user A consumes user A's ticket and the RPC
--          returns the ticket id. Critically, this must still succeed
--          after test 1's failed cross-email attempt, proving test 1
--          did NOT silently consume the row.
--   3. (c) Replay block — a second consume of the now-consumed ticket
--          returns NULL.
--   4. (d) Expiry block — a ticket past expires_at is not consumable
--          even by the rightful owner.
--   5. (e1) RLS SELECT denial — direct SELECT FROM the table as
--          authenticated returns zero rows (no permissive SELECT
--          policy), even though fixture rows exist.
--   6. (e2) RLS INSERT denial — direct INSERT INTO the table as
--          authenticated raises (no permissive INSERT policy and no
--          table-level grant beyond Supabase defaults).
--
-- Run discipline: BEGIN/ROLLBACK so fixtures never leak. The _tap temp
-- table surfaces all six TAP lines in one editor grid because the
-- Supabase SQL editor only shows the last statement's result (same
-- mechanism as 15_g13_pending_round_trip.sql). Run the ENTIRE file as a
-- single batch.
--
-- Cross-user simulation: two distinct auth.users created via
-- _test_make_user, and _test_set_jwt switches the spoofed identity
-- between assertions — the same multi-user pattern
-- 06_soft_delete_rpcs_clients_and_program_exercises.sql uses for
-- cross-org tests.
-- ============================================================================

BEGIN;

SELECT plan(6);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated;


-- ----------------------------------------------------------------------------
-- Fixture: two distinct authenticated users (no org membership needed —
-- recovery is pre-org), plus two tickets, both minted for user_a's email:
--
--   ticket_a_valid   — future expiry, unconsumed. Test 1 fails on
--                      cross-email, then test 2 consumes it, then test
--                      3 finds it consumed.
--   ticket_a_expired — past expires_at. Test 4 confirms expiry block.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  user_a            uuid;
  user_b            uuid;
  ticket_a_valid    uuid := gen_random_uuid();
  ticket_a_expired  uuid := gen_random_uuid();
BEGIN
  user_a := public._test_make_user('recovery-consume-a@test.local');
  user_b := public._test_make_user('recovery-consume-b@test.local');

  INSERT INTO password_recovery_tickets (id, email, expires_at) VALUES
    (ticket_a_valid,   'recovery-consume-a@test.local', now() + interval '1 hour'),
    (ticket_a_expired, 'recovery-consume-a@test.local', now() - interval '1 minute');

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    user_a            AS user_a,
    user_b            AS user_b,
    ticket_a_valid    AS ticket_a_valid,
    ticket_a_expired  AS ticket_a_expired;
  GRANT SELECT ON _ids TO authenticated;
END $$;


-- ============================================================================
-- Test 1 (b — cross-email block, THE attack the fix exists to close):
-- user_b's session attempts to consume user_a's ticket; consume_recovery_
-- ticket returns NULL because the WHERE-clause email-match resolves to
-- user_b's email, which does not equal the ticket's email.
-- ============================================================================
SELECT public._test_set_jwt(
  (SELECT user_b FROM _ids), NULL::uuid, NULL::text
);
SET LOCAL ROLE authenticated;

INSERT INTO _tap (n, line) VALUES (1, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT public.consume_recovery_ticket((SELECT ticket_a_valid FROM _ids))),
    NULL::uuid,
    'cross-email block: user_b cannot consume user_a''s ticket'
  ) AS l
));


-- ============================================================================
-- Test 2 (a — happy path): switch context to user_a. consume_recovery_
-- ticket on the SAME ticket_a_valid succeeds and returns the ticket id.
-- Re-using the same row is deliberate: test 1 must not have silently
-- consumed it.
-- ============================================================================
SELECT public._test_set_jwt(
  (SELECT user_a FROM _ids), NULL::uuid, NULL::text
);
SET LOCAL ROLE authenticated;

INSERT INTO _tap (n, line) VALUES (2, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT public.consume_recovery_ticket((SELECT ticket_a_valid FROM _ids))),
    (SELECT ticket_a_valid FROM _ids),
    'happy path: user_a consumes own ticket and the RPC returns the ticket id'
  ) AS l
));


-- ============================================================================
-- Test 3 (c — replay block): consuming the same ticket again returns NULL
-- because consumed_at IS NOT NULL excludes it from the WHERE.
-- ============================================================================
INSERT INTO _tap (n, line) VALUES (3, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT public.consume_recovery_ticket((SELECT ticket_a_valid FROM _ids))),
    NULL::uuid,
    'replay block: a second consume of a consumed ticket returns NULL'
  ) AS l
));


-- ============================================================================
-- Test 4 (d — expiry block): a ticket past expires_at is not consumable
-- even by the rightful owner. Still under user_a's session context.
-- ============================================================================
INSERT INTO _tap (n, line) VALUES (4, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT public.consume_recovery_ticket((SELECT ticket_a_expired FROM _ids))),
    NULL::uuid,
    'expiry block: a ticket past expires_at returns NULL even for the rightful owner'
  ) AS l
));


-- ============================================================================
-- Test 5 (e1 — RLS SELECT denial): direct SELECT FROM password_recovery_
-- tickets as authenticated returns zero rows. No permissive SELECT policy
-- means RLS shows no rows to authenticated regardless of which rows
-- exist. Fixture inserted two rows above; the authenticated SELECT sees
-- none.
-- ============================================================================
INSERT INTO _tap (n, line) VALUES (5, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM password_recovery_tickets),
    0,
    'RLS denial: direct SELECT FROM password_recovery_tickets as authenticated returns no rows'
  ) AS l
));


-- ============================================================================
-- Test 6 (e2 — RLS INSERT denial): direct INSERT INTO password_recovery_
-- tickets as authenticated raises SQLSTATE 42501 ("new row violates
-- row-level security policy"). Uses the 4-arg throws_ok signature
-- (query, errcode, errmsg, description) mirroring
-- 06_soft_delete_rpcs_clients_and_program_exercises.sql:158-166 — pin
-- the SQLSTATE (a different code here would mean the RLS posture has
-- silently changed), skip the errmsg substring check with NULL::text
-- (Postgres-controlled wording, may shift across PG versions), and put
-- the test description in the 4th argument. The 2-arg
-- (query, errmsg) variant from a prior revision misfired: it read the
-- description as an expected-errmsg substring and failed the assertion
-- even though the underlying RLS denial fired correctly.
-- ============================================================================
INSERT INTO _tap (n, line) VALUES (6, (
  SELECT string_agg(l, E'\n') FROM throws_ok(
    $q$INSERT INTO password_recovery_tickets (email, expires_at)
       VALUES ('attacker@test.local', now() + interval '1 hour')$q$,
    '42501',
    NULL::text,
    'RLS denial: direct INSERT INTO password_recovery_tickets as authenticated raises'
  ) AS l
));


-- ----------------------------------------------------------------------------
-- Final SELECT — surface all six captured TAP lines in one grid. finish()
-- is intentionally dropped (same pattern as 15); the six-row count is the
-- plan check.
-- ----------------------------------------------------------------------------
SELECT line FROM _tap ORDER BY n;

ROLLBACK;
