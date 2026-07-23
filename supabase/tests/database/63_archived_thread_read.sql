-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), ok(), is() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 63_archived_thread_read
-- ============================================================================
-- Locks in migration 20260723160000 — FM-8: the staff archived-arm SELECT
-- policy on message_threads, so an archived client's in-app message history
-- stays producible (AHPRA/APP record production; CN-7 residual closed by the
-- 2026-07-23 parity pass).
--
-- Assertions (9):
--   1. staff sees the ARCHIVED client's thread (the new policy arm)
--   2. staff sees that archived thread's messages (child rows were always
--      policy-visible; the thread was the missing link)
--   3. control: staff still sees a live thread
--   4. cross-org staff sees ZERO of it (tenant isolation on the new arm)
--   5. the archived client's own session sees ZERO threads (no client arm —
--      the portal stays a closed door)
--   6. anon SELECT on message_threads raises 42501
--   7. staff reads the archived thread's ATTACHMENT metadata (reviewer
--      blocking item 1, 2026-07-23: the staff message_attachments SELECT
--      policy carries no thread-liveness predicate, so attachment rows stay
--      producible post-archive — record production is not just the bodies).
--      Byte-level retrieval (storage policy + signed URL) is verified by the
--      staging probe scripts/verify-archived-attachment-retrieval.mjs.
--   8. cross-org staff sees ZERO of those attachment rows
--   9. the archived client's own session sees ZERO attachment rows (its
--      policy DOES predicate on liveness — the closed door holds)
--
-- Fixture: client archived via the real clients UPDATE so the REAL cascade
-- (client_cascade_thread_archive) sets the thread's deleted_at — the test
-- exercises the production archive path, not a hand-set column. One message
-- carries a message_attachments row (metadata only; no blob needed at this
-- layer).
-- Style: _tap buffer; BEGIN/ROLLBACK.
-- ============================================================================

BEGIN;

SELECT plan(9);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated, anon;

DO $$
DECLARE
  org_a    uuid := '00000000-0000-0000-0000-0000000063a1'::uuid;
  org_b    uuid := '00000000-0000-0000-0000-0000000063a2'::uuid;
  staff_a  uuid;
  staff_b  uuid;
  client_u uuid;
  cl_arch  uuid := '00000000-0000-0000-0000-0000000063b1'::uuid;
  cl_live  uuid := '00000000-0000-0000-0000-0000000063b2'::uuid;
  thr_arch uuid := '00000000-0000-0000-0000-0000000063c1'::uuid;
  thr_live uuid := '00000000-0000-0000-0000-0000000063c2'::uuid;
  msg_att  uuid := '00000000-0000-0000-0000-0000000063d1'::uuid;
  att_a    uuid := '00000000-0000-0000-0000-0000000063e1'::uuid;
BEGIN
  INSERT INTO organizations (id, name, slug) VALUES
    (org_a, 'Test Org X — archived thread 63', 'test-org-x-thr63'),
    (org_b, 'Test Org Y — archived thread 63', 'test-org-y-thr63');

  staff_a  := public._test_make_user('staff-x-thr63@test.local');
  staff_b  := public._test_make_user('staff-y-thr63@test.local');
  client_u := public._test_make_user('client-x-thr63@test.local');
  PERFORM public._test_grant_membership(staff_a, org_a, 'staff'::user_role);
  PERFORM public._test_grant_membership(staff_b, org_b, 'staff'::user_role);
  PERFORM public._test_grant_membership(client_u, org_a, 'client'::user_role);

  INSERT INTO clients (id, organization_id, user_id, first_name, last_name, email)
  VALUES (cl_arch, org_a, client_u, 'Arch', 'Threaded', 'arch-thr63@test.local'),
         (cl_live, org_a, NULL,     'Liv',  'Threaded', 'live-thr63@test.local');

  INSERT INTO message_threads (id, organization_id, client_id)
  VALUES (thr_arch, org_a, cl_arch), (thr_live, org_a, cl_live);

  INSERT INTO messages (thread_id, organization_id, sender_user_id, sender_role, body)
  VALUES (thr_arch, org_a, staff_a,  'staff',  'How did the knee pull up after Tuesday?'),
         (thr_arch, org_a, client_u, 'client', 'A bit tight but no sharp pain.');

  -- An attachment-bearing message + its metadata row (assertions 7–9).
  -- Fixture inserts run as the table owner (RLS not FORCEd on messaging
  -- tables), matching how the definer RPC writes these rows in production.
  INSERT INTO messages (id, thread_id, organization_id, sender_user_id, sender_role, body, has_attachments)
  VALUES (msg_att, thr_arch, org_a, client_u, 'client', 'Photo of the swelling attached.', true);

  INSERT INTO message_attachments
    (id, message_id, thread_id, organization_id, storage_path, file_name, mime_type, byte_size, kind)
  VALUES
    (att_a, msg_att, thr_arch, org_a,
     org_a::text || '/' || thr_arch::text || '/' || att_a::text || '.jpg',
     'swelling.jpg', 'image/jpeg', 204800, 'image');

  -- Archive through the REAL path: the clients UPDATE fires
  -- client_cascade_thread_archive, which stamps the thread''s deleted_at.
  UPDATE clients SET deleted_at = now(), archived_at = now()
   WHERE id = cl_arch;

  IF NOT EXISTS (SELECT 1 FROM message_threads
                  WHERE id = thr_arch AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'fixture: archive cascade did not stamp the thread';
  END IF;

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_a, org_b, staff_a, staff_b, client_u, cl_arch, cl_live, thr_arch, thr_live,
    msg_att, att_a;
  GRANT SELECT ON _ids TO authenticated;
END $$;

-- 1–3. Staff in org A.
SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;

INSERT INTO _tap (n, line) VALUES (1, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM message_threads
      WHERE client_id = (SELECT cl_arch FROM _ids) AND deleted_at IS NOT NULL),
    1,
    'staff reads the archived client''s thread (FM-8 archived arm)'
  ) AS l
));

INSERT INTO _tap (n, line) VALUES (2, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM messages
      WHERE thread_id = (SELECT thr_arch FROM _ids)),
    3,
    'staff reads the archived thread''s messages (the record is producible)'
  ) AS l
));

INSERT INTO _tap (n, line) VALUES (7, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM message_attachments
      WHERE thread_id = (SELECT thr_arch FROM _ids)),
    1,
    'staff reads the archived thread''s attachment metadata (no liveness predicate on the staff arm)'
  ) AS l
));

INSERT INTO _tap (n, line) VALUES (3, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM message_threads
      WHERE client_id = (SELECT cl_live FROM _ids)),
    1,
    'control: staff still reads a live thread'
  ) AS l
));
RESET ROLE;

-- 4. Cross-org staff.
SELECT public._test_set_jwt(
  (SELECT staff_b FROM _ids), (SELECT org_b FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;
INSERT INTO _tap (n, line) VALUES (4, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM message_threads
      WHERE client_id = (SELECT cl_arch FROM _ids)),
    0,
    'cross-org staff sees ZERO archived threads (tenant isolation holds)'
  ) AS l
));

INSERT INTO _tap (n, line) VALUES (8, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM message_attachments
      WHERE thread_id = (SELECT thr_arch FROM _ids)),
    0,
    'cross-org staff sees ZERO of the archived thread''s attachment rows'
  ) AS l
));
RESET ROLE;

-- 5. The archived client's own session.
SELECT public._test_set_jwt(
  (SELECT client_u FROM _ids), (SELECT org_a FROM _ids), 'client'
);
SET LOCAL ROLE authenticated;
INSERT INTO _tap (n, line) VALUES (5, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM message_threads),
    0,
    'the archived client''s own session sees ZERO threads (no client arm)'
  ) AS l
));

INSERT INTO _tap (n, line) VALUES (9, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM message_attachments),
    0,
    'the archived client''s own session sees ZERO attachment rows (client arm predicates on liveness)'
  ) AS l
));
RESET ROLE;

-- 6. anon at the grant layer.
SET LOCAL ROLE anon;
INSERT INTO _tap (n, line) VALUES (6, (
  SELECT string_agg(l, E'\n') FROM throws_ok(
    'SELECT count(*) FROM public.message_threads',
    '42501', NULL,
    'anon SELECT on message_threads raises 42501'
  ) AS l
));
RESET ROLE;

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
