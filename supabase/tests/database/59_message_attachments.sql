-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), is(), throws_ok() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 59_message_attachments
-- ============================================================================
-- Execution gate for the messaging-attachments build
-- (docs/polish/messaging-attachments.md, G-4) — the platform's FIRST
-- client-role WRITE access to Supabase Storage, so storage.objects policies
-- are probed directly here, both roles, both directions, alongside the
-- message_attachments table RLS and the send_message_with_attachments()
-- definer guards (the only attachment write path).
--
-- Assertions (23), grouped by session:
--   client_a (org_a — the patient; runs FIRST so its policy-gated uploads
--             are the fixture the later isolation probes fail to see):
--     1. storage upload to OWN thread path (.jpg) succeeds        (policy)
--     2. storage upload to ANOTHER client's thread path is denied (42501)
--     3. storage upload with a non-image extension is denied      (42501)
--     4. client sees own thread's fixture attachment (count 1)
--     5. within-org isolation — sees ZERO of thread_a2's attachment
--     6. direct INSERT into message_attachments is denied (no INSERT policy)
--     7. UPDATE of a visible attachment affects 0 rows (no UPDATE policy)
--     8. RPC happy path — photo-only message lands (has_attachments, empty
--        body) …
--     9. … and exactly one kind='image' attachment row references it
--    10. RPC rejects a storage_path outside the target thread     (42501)
--    11. RPC rejects a non-image blob for the client role (photos only)
--    12. direct messages INSERT with has_attachments=true is denied (the
--        policy pin — only the RPC may set it)
--   staff_b (org_b — cross-tenant attacker):
--    13. sees ZERO of org_a's message_attachments rows
--    14. sees ZERO of org_a's blobs in the message-attachments bucket
--    15. storage upload into org_a's folder is denied             (42501)
--   staff_a (org_a):
--    16. control — sees org_a's attachments (>=1; proves 13's zero is
--        isolation, not an absent fixture)
--   owner/postgres:
--    17. immutability — UPDATE on message_attachments raises P0001 even for
--        a role that bypasses RLS (trigger, not policy)
--    18. schema — empty-body message WITHOUT has_attachments still violates
--        the body CHECK (23514): the relaxation is attachment-scoped
--    19. anon has NO EXECUTE on send_message_with_attachments()
--    20. audit — audit_log captured >=1 message_attachments row for org_a
--   client_a again (finding (b), thread now archived):
--    21. archived thread hides the referencing row from the client's own RLS
--        (the inline-predicate blindspot the exploit relied on)
--    22. FIX — definer helper sees the row through that blindness → deny
--    23. control — unreferenced path resolves false → rollback stays permitted
--
-- Run discipline: BEGIN/ROLLBACK, _tap buffer, finish() dropped — same as 34.
-- Fixtures use the JWT-spoof helpers; storage fixtures are created THROUGH
-- the client upload policy (assertion 1) rather than privileged inserts, so
-- the write policy itself is load-bearing for the rest of the file.
-- ============================================================================

BEGIN;

SELECT plan(23);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated;

CREATE TEMP TABLE _probe (k text PRIMARY KEY, v int NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _probe TO authenticated;


-- ----------------------------------------------------------------------------
-- Fixture (privileged): orgs, users, clients, threads, messages, plus one
-- table-level attachment per thread (storage rows come later, via policy).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  org_a          uuid := '00000000-0000-0000-0000-00000000aa01'::uuid;
  org_b          uuid := '00000000-0000-0000-0000-00000000aa02'::uuid;
  staff_a        uuid;
  staff_b        uuid;
  client_a_user  uuid;
  client_a2_user uuid;
  client_a_row   uuid := '00000000-0000-0000-0000-00000000aa03'::uuid;
  client_a2_row  uuid := '00000000-0000-0000-0000-00000000aa04'::uuid;
  thread_a       uuid := '00000000-0000-0000-0000-00000000aa05'::uuid;
  thread_a2      uuid := '00000000-0000-0000-0000-00000000aa06'::uuid;
  staff_msg      uuid := '00000000-0000-0000-0000-00000000aa07'::uuid;
  msg_a2         uuid := '00000000-0000-0000-0000-00000000aa08'::uuid;
  attach_a       uuid := '00000000-0000-0000-0000-00000000aa09'::uuid;
  attach_a2      uuid := '00000000-0000-0000-0000-00000000aa10'::uuid;
BEGIN
  INSERT INTO organizations (id, name, slug) VALUES
    (org_a, 'Test Org A — Attachments 59', 'test-org-a-attach-59'),
    (org_b, 'Test Org B — Attachments 59', 'test-org-b-attach-59');

  staff_a        := public._test_make_user('staff-a-att59@test.local');
  staff_b        := public._test_make_user('staff-b-att59@test.local');
  client_a_user  := public._test_make_user('client-a-att59@test.local');
  client_a2_user := public._test_make_user('client-a2-att59@test.local');

  PERFORM public._test_grant_membership(staff_a,        org_a, 'staff'::user_role);
  PERFORM public._test_grant_membership(staff_b,        org_b, 'staff'::user_role);
  PERFORM public._test_grant_membership(client_a_user,  org_a, 'client'::user_role);
  PERFORM public._test_grant_membership(client_a2_user, org_a, 'client'::user_role);

  INSERT INTO clients (id, organization_id, user_id, first_name, last_name, email) VALUES
    (client_a_row,  org_a, client_a_user,  'Alpha',  'Patient', 'client-a-att59@test.local'),
    (client_a2_row, org_a, client_a2_user, 'Second', 'Patient', 'client-a2-att59@test.local');

  INSERT INTO message_threads (id, organization_id, client_id) VALUES
    (thread_a,  org_a, client_a_row),
    (thread_a2, org_a, client_a2_row);

  INSERT INTO messages (id, thread_id, organization_id, sender_user_id, sender_role, body, has_attachments) VALUES
    (staff_msg, thread_a,  org_a, staff_a, 'staff', 'Here is the form-check breakdown.', true),
    (msg_a2,    thread_a2, org_a, staff_a, 'staff', 'Thread A2 message.',                true);

  -- Table-level fixture attachments (metadata rows only — the RPC is the only
  -- path that requires a real blob, and it is tested separately below).
  INSERT INTO message_attachments
    (id, message_id, thread_id, organization_id, storage_path, file_name, mime_type, byte_size, kind)
  VALUES
    (attach_a,  staff_msg, thread_a,  org_a,
     org_a::text || '/' || thread_a::text  || '/' || attach_a::text  || '.png',
     'annotated-frame.png', 'image/png', 204800, 'image'),
    (attach_a2, msg_a2,    thread_a2, org_a,
     org_a::text || '/' || thread_a2::text || '/' || attach_a2::text || '.png',
     'a2-only.png', 'image/png', 102400, 'image');

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_a AS org_a, org_b AS org_b,
    staff_a AS staff_a, staff_b AS staff_b,
    client_a_user AS client_a_user, client_a2_user AS client_a2_user,
    client_a_row AS client_a_row, client_a2_row AS client_a2_row,
    thread_a AS thread_a, thread_a2 AS thread_a2,
    staff_msg AS staff_msg, msg_a2 AS msg_a2,
    attach_a AS attach_a, attach_a2 AS attach_a2,
    (org_a::text || '/' || thread_a::text)  AS prefix_a,
    (org_a::text || '/' || thread_a2::text) AS prefix_a2;
  GRANT SELECT ON _ids TO authenticated;
END $$;


-- ============================================================================
-- Tests 1-12 run under client_a (org_a) — the patient.
-- ============================================================================
SELECT public._test_set_jwt(
  (SELECT client_a_user FROM _ids), (SELECT org_a FROM _ids), 'client'
);
SET LOCAL ROLE authenticated;

-- Test 1 (client-write storage policy, happy path): upload a .jpg into the
-- client's OWN thread folder. This row is also the blob the RPC happy path
-- (test 8) references — the upload policy is load-bearing for this file.
WITH ins AS (
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
  SELECT 'message-attachments',
         prefix_a || '/photo-upload-59.jpg',
         client_a_user, client_a_user::text,
         jsonb_build_object('mimetype', 'image/jpeg', 'size', 123456)
    FROM _ids
  RETURNING 1
)
INSERT INTO _probe (k, v) SELECT 'upload_own', count(*)::int FROM ins;

INSERT INTO _tap (n, line) VALUES (1, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT v FROM _probe WHERE k = 'upload_own'),
    1,
    'client can upload a .jpg blob into their OWN thread folder (1 row)'
  ) AS l
));

-- Test 2: upload into ANOTHER client's thread folder (same org) is denied.
INSERT INTO _tap (n, line) VALUES (2, (
  SELECT string_agg(l, E'\n') FROM throws_ok(
    format(
      $q$INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
         VALUES ('message-attachments', %L, %L::uuid, %L,
                 jsonb_build_object('mimetype','image/jpeg','size',1000))$q$,
      (SELECT prefix_a2 FROM _ids) || '/intruder.jpg',
      (SELECT client_a_user FROM _ids), (SELECT client_a_user FROM _ids)::text
    ),
    '42501',
    NULL,
    'client upload into another client''s thread folder is denied (42501)'
  ) AS l
));

-- Test 3: non-image extension is denied by the client upload policy.
INSERT INTO _tap (n, line) VALUES (3, (
  SELECT string_agg(l, E'\n') FROM throws_ok(
    format(
      $q$INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
         VALUES ('message-attachments', %L, %L::uuid, %L,
                 jsonb_build_object('mimetype','application/pdf','size',1000))$q$,
      (SELECT prefix_a FROM _ids) || '/report.pdf',
      (SELECT client_a_user FROM _ids), (SELECT client_a_user FROM _ids)::text
    ),
    '42501',
    NULL,
    'client upload with a non-image extension is denied (42501)'
  ) AS l
));

-- Test 4: client sees its own thread's fixture attachment.
INSERT INTO _tap (n, line) VALUES (4, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM message_attachments WHERE id = (SELECT attach_a FROM _ids)),
    1,
    'client_a sees its own thread''s attachment (count 1)'
  ) AS l
));

-- Test 5 (within-org isolation): another client's attachment is invisible.
INSERT INTO _tap (n, line) VALUES (5, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM message_attachments WHERE id = (SELECT attach_a2 FROM _ids)),
    0,
    'within-org isolation: client_a sees zero of another client''s attachments'
  ) AS l
));

-- Test 6: direct INSERT into message_attachments is denied — there is NO
-- INSERT policy for any role; the definer RPC is the only write path.
INSERT INTO _tap (n, line) VALUES (6, (
  SELECT string_agg(l, E'\n') FROM throws_ok(
    format(
      $q$INSERT INTO message_attachments
           (message_id, thread_id, organization_id, storage_path, file_name, mime_type, byte_size, kind)
         VALUES (%L::uuid, %L::uuid, %L::uuid, %L, 'x.jpg', 'image/jpeg', 1000, 'image')$q$,
      (SELECT staff_msg FROM _ids), (SELECT thread_a FROM _ids),
      (SELECT org_a FROM _ids),
      (SELECT prefix_a FROM _ids) || '/direct-insert.jpg'
    ),
    '42501',
    NULL,
    'direct INSERT into message_attachments is denied (no INSERT policy — RPC only)'
  ) AS l
));

-- Test 7: UPDATE of a visible attachment affects 0 rows (no UPDATE policy).
WITH u AS (
  UPDATE message_attachments SET file_name = 'renamed.png'
   WHERE id = (SELECT attach_a FROM _ids)
  RETURNING 1
)
INSERT INTO _probe (k, v) SELECT 'attach_update_rows', count(*)::int FROM u;

INSERT INTO _tap (n, line) VALUES (7, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT v FROM _probe WHERE k = 'attach_update_rows'),
    0,
    'client UPDATE of an attachment affects 0 rows (no UPDATE policy)'
  ) AS l
));

-- Test 8 (RPC happy path): photo-only message — empty body, one attachment
-- referencing the blob uploaded in test 1.
WITH r AS (
  SELECT * FROM public.send_message_with_attachments(
    (SELECT thread_a FROM _ids),
    '',
    jsonb_build_array(jsonb_build_object(
      'storage_path', (SELECT prefix_a FROM _ids) || '/photo-upload-59.jpg',
      'file_name',    'form-check.jpg'
    ))
  )
)
INSERT INTO _probe (k, v)
SELECT 'rpc_ok', count(*)::int FROM r
 WHERE r.has_attachments AND trim(r.body) = '' AND r.sender_role = 'client';

INSERT INTO _tap (n, line) VALUES (8, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT v FROM _probe WHERE k = 'rpc_ok'),
    1,
    'RPC happy path: photo-only message lands (has_attachments, empty body, client sender)'
  ) AS l
));

-- Test 9: exactly one kind='image' attachment row references the RPC message.
INSERT INTO _tap (n, line) VALUES (9, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int
       FROM message_attachments ma
       JOIN messages m ON m.id = ma.message_id
      WHERE m.thread_id = (SELECT thread_a FROM _ids)
        AND m.sender_role = 'client'
        AND trim(m.body) = ''
        AND ma.kind = 'image'
        AND ma.mime_type = 'image/jpeg'),
    1,
    'RPC created exactly one image attachment row for the photo-only message'
  ) AS l
));

-- Test 10: RPC rejects a storage_path outside the target thread (the prefix
-- guard fires before any storage lookup — no blob needs to exist).
INSERT INTO _tap (n, line) VALUES (10, (
  SELECT string_agg(l, E'\n') FROM throws_ok(
    format(
      $q$SELECT public.send_message_with_attachments(
           %L::uuid, 'sneaky',
           jsonb_build_array(jsonb_build_object('storage_path', %L, 'file_name', 'x.jpg')))$q$,
      (SELECT thread_a FROM _ids),
      (SELECT prefix_a2 FROM _ids) || '/other-thread.jpg'
    ),
    '42501',
    'attachment path outside this thread',
    'RPC rejects a storage_path outside the target thread (42501)'
  ) AS l
));

-- Test 11: RPC rejects a non-image blob for the client role. The blob is
-- uploaded via the policy (extension .jpg passes) but carries a PDF mimetype
-- — proving the RPC's authoritative metadata check is a second, independent
-- layer over the extension-only storage policy.
INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
SELECT 'message-attachments',
       prefix_a || '/disguised-pdf.jpg',
       client_a_user, client_a_user::text,
       jsonb_build_object('mimetype', 'application/pdf', 'size', 2048)
  FROM _ids;

INSERT INTO _tap (n, line) VALUES (11, (
  SELECT string_agg(l, E'\n') FROM throws_ok(
    format(
      $q$SELECT public.send_message_with_attachments(
           %L::uuid, '',
           jsonb_build_array(jsonb_build_object('storage_path', %L, 'file_name', 'disguised.jpg')))$q$,
      (SELECT thread_a FROM _ids),
      (SELECT prefix_a FROM _ids) || '/disguised-pdf.jpg'
    ),
    'P0001',
    'clients can attach photos only',
    'RPC rejects a non-image blob for the client role (photos only)'
  ) AS l
));

-- Test 12: direct messages INSERT with has_attachments=true is denied — the
-- INSERT-policy pin; only the definer RPC may set the flag.
INSERT INTO _tap (n, line) VALUES (12, (
  SELECT string_agg(l, E'\n') FROM throws_ok(
    format(
      $q$INSERT INTO messages (thread_id, organization_id, sender_user_id, sender_role, body, has_attachments)
         VALUES (%L::uuid, %L::uuid, %L::uuid, 'client', 'forged flag', true)$q$,
      (SELECT thread_a FROM _ids), (SELECT org_a FROM _ids),
      (SELECT client_a_user FROM _ids)
    ),
    '42501',
    NULL,
    'direct INSERT with has_attachments=true is denied (policy pin — RPC only)'
  ) AS l
));


-- ============================================================================
-- Tests 13-15 run under staff_b (org_b) — the cross-tenant attacker.
-- ============================================================================
RESET ROLE;
SELECT public._test_set_jwt(
  (SELECT staff_b FROM _ids), (SELECT org_b FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;

-- Test 13: org_a's attachment rows are invisible cross-tenant.
INSERT INTO _tap (n, line) VALUES (13, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM message_attachments
      WHERE organization_id = (SELECT org_a FROM _ids)),
    0,
    'cross-tenant: staff_b sees zero of org_a''s message_attachments rows'
  ) AS l
));

-- Test 14: org_a's blobs in the bucket are invisible cross-tenant.
INSERT INTO _tap (n, line) VALUES (14, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM storage.objects
      WHERE bucket_id = 'message-attachments'
        AND name LIKE (SELECT org_a FROM _ids)::text || '/%'),
    0,
    'cross-tenant: staff_b sees zero of org_a''s blobs in message-attachments'
  ) AS l
));

-- Test 15: staff_b cannot upload into org_a's folder.
INSERT INTO _tap (n, line) VALUES (15, (
  SELECT string_agg(l, E'\n') FROM throws_ok(
    format(
      $q$INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
         VALUES ('message-attachments', %L, %L::uuid, %L,
                 jsonb_build_object('mimetype','image/jpeg','size',1000))$q$,
      (SELECT prefix_a FROM _ids) || '/cross-tenant.jpg',
      (SELECT staff_b FROM _ids), (SELECT staff_b FROM _ids)::text
    ),
    '42501',
    NULL,
    'cross-tenant: staff_b upload into org_a''s folder is denied (42501)'
  ) AS l
));


-- ============================================================================
-- Test 16 runs under staff_a (org_a) — the control.
-- ============================================================================
RESET ROLE;
SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;

INSERT INTO _tap (n, line) VALUES (16, (
  SELECT string_agg(l, E'\n') FROM ok(
    (SELECT count(*) FROM message_attachments
      WHERE organization_id = (SELECT org_a FROM _ids)) >= 1,
    'control: staff_a sees org_a''s attachments (test 13''s zero is isolation, not absent fixture)'
  ) AS l
));


-- ============================================================================
-- Tests 17-20 run as the owner/postgres role.
-- ============================================================================
RESET ROLE;

-- Test 17: attachments are immutable by trigger, not just by policy — an
-- UPDATE raises even for a role that bypasses RLS.
INSERT INTO _tap (n, line) VALUES (17, (
  SELECT string_agg(l, E'\n') FROM throws_ok(
    format(
      $q$UPDATE message_attachments SET file_name = 'rewritten.png' WHERE id = %L::uuid$q$,
      (SELECT attach_a FROM _ids)
    ),
    'P0001',
    'message attachments are immutable',
    'immutability: UPDATE on message_attachments raises P0001 (trigger, not policy)'
  ) AS l
));

-- Test 18: the body-CHECK relaxation is attachment-scoped — an empty body
-- WITHOUT has_attachments still violates the table CHECK (even bypassing RLS).
INSERT INTO _tap (n, line) VALUES (18, (
  SELECT string_agg(l, E'\n') FROM throws_ok(
    format(
      $q$INSERT INTO messages (thread_id, organization_id, sender_user_id, sender_role, body, has_attachments)
         VALUES (%L::uuid, %L::uuid, %L::uuid, 'staff', '   ', false)$q$,
      (SELECT thread_a FROM _ids), (SELECT org_a FROM _ids),
      (SELECT staff_a FROM _ids)
    ),
    '23514',
    NULL,
    'schema: empty body without has_attachments still violates the body CHECK'
  ) AS l
));

-- Test 19: anon has no EXECUTE on the attachment send RPC.
INSERT INTO _tap (n, line) VALUES (19, (
  SELECT string_agg(l, E'\n') FROM is(
    has_function_privilege('anon', 'public.send_message_with_attachments(uuid, text, jsonb)', 'EXECUTE'),
    false,
    'anon has NO EXECUTE on send_message_with_attachments()'
  ) AS l
));

-- Test 20: the audit trigger fired for message_attachments AND the resolver
-- resolved a non-NULL org (a missing CASE branch would have aborted inserts).
INSERT INTO _tap (n, line) VALUES (20, (
  SELECT string_agg(l, E'\n') FROM ok(
    (SELECT count(*) FROM audit_log
      WHERE table_name = 'message_attachments'
        AND organization_id = (SELECT org_a FROM _ids)) >= 1,
    'audit: audit_log captured >=1 message_attachments row for org_a'
  ) AS l
));


-- ============================================================================
-- Tests 21-23 (reviewer finding (b), 2026-07-13): the storage DELETE-orphan
-- policy must protect a REFERENCED blob even when its thread is ARCHIVED. We
-- assert the policy's DECISIVE PREDICATE rather than a real DELETE: hosted
-- Supabase's storage.protect_delete() trigger blocks ALL raw SQL deletes from
-- storage.objects (the DELETE policy is only ever evaluated on the Storage API
-- path the browser rollback uses), so a SQL `DELETE ... RETURNING` can't reach
-- the policy. The policy is `... AND NOT public.message_attachment_path_referenced(name)`,
-- so the fix reduces to: does that helper still see the referencing row when
-- the caller's own RLS cannot? Tests 21 (the RLS blindspot is real) + 22 (the
-- definer helper sees through it) together prove the hole is closed; test 23
-- proves the rollback path (unreferenced → deletable) stays open.
--
-- Setup (owner): archive thread_a so client_a loses SELECT on its attachments.
-- ============================================================================
UPDATE message_threads SET deleted_at = now() WHERE id = (SELECT thread_a FROM _ids);

SELECT public._test_set_jwt(
  (SELECT client_a_user FROM _ids), (SELECT org_a FROM _ids), 'client'
);
SET LOCAL ROLE authenticated;

-- Test 21: the RLS blindspot is real — with thread_a archived, client_a's own
-- RLS-scoped SELECT of the still-existing referencing row returns 0. This is
-- exactly what an INLINE `NOT EXISTS (SELECT ... FROM message_attachments)`
-- would have seen, flipping the guard to "orphan" and allowing the delete.
INSERT INTO _tap (n, line) VALUES (21, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM message_attachments WHERE id = (SELECT attach_a FROM _ids)),
    0,
    'finding (b): archived thread hides the referencing row from the client''s own RLS (the inline-predicate blindspot)'
  ) AS l
));

-- Test 22 (THE fix): the SECURITY DEFINER helper still reports the path as
-- referenced despite that blindness, so the DELETE policy computes
-- NOT true = false and denies. Called in the client's own session.
INSERT INTO _tap (n, line) VALUES (22, (
  SELECT string_agg(l, E'\n') FROM is(
    public.message_attachment_path_referenced(
      (SELECT org_a FROM _ids)::text || '/' || (SELECT thread_a FROM _ids)::text || '/' || (SELECT attach_a FROM _ids)::text || '.png'
    ),
    true,
    'finding (b) FIX: definer helper sees the referencing row through archived-thread RLS → DELETE policy denies'
  ) AS l
));

-- Test 23 (control — rollback path stays open): an unreferenced path resolves
-- false, so the policy computes NOT false = true and a genuine orphan is
-- deletable by its uploader.
INSERT INTO _tap (n, line) VALUES (23, (
  SELECT string_agg(l, E'\n') FROM is(
    public.message_attachment_path_referenced(
      (SELECT org_a FROM _ids)::text || '/' || (SELECT thread_a FROM _ids)::text || '/never-referenced-59.jpg'
    ),
    false,
    'control: unreferenced path resolves false → uploader-orphan rollback still permitted'
  ) AS l
));

RESET ROLE;


-- ----------------------------------------------------------------------------
-- Surface all captured TAP lines in one grid. finish() intentionally dropped
-- (same pattern as 34); the 23-row plan count is the check.
-- ----------------------------------------------------------------------------
SELECT line FROM _tap ORDER BY n;

ROLLBACK;
