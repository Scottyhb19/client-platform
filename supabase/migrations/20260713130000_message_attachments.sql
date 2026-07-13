-- ============================================================================
-- 20260713130000_message_attachments
-- ============================================================================
-- Why: photo/file attachments on in-app messages. This is the documented
-- re-trigger in docs/polish/messaging.md §5 firing ("a beta tester needs to
-- send a photo"). Contract: docs/polish/messaging-attachments.md (approved
-- 2026-07-13 — staff any-file, client photos-only, photo-only messages
-- allowed, attachments immutable like messages, 10 MB client cap, ≤4 per
-- message).
--
-- Shape:
--   message_attachments   INSERT-only child of messages. No UPDATE/DELETE
--                         policies and NO direct INSERT policy either — the
--                         only write path is the SECURITY DEFINER RPC below,
--                         per the messaging immutability posture ("any new
--                         mutable path gets its own definer RPC", stated in
--                         20260618120100). Composite FK (message_id,
--                         thread_id) makes a thread mismatch impossible.
--   messages              gains has_attachments (set at INSERT, then frozen
--                         by the immutability trigger — never a post-insert
--                         UPDATE, which that trigger rejects P0001). The body
--                         CHECK relaxes to allow an empty body when
--                         has_attachments; direct INSERT policies pin
--                         has_attachments = false so only the RPC can set it.
--   storage               new private bucket 'message-attachments', path
--                         {organization_id}/{thread_id}/{attachment_id}.{ext}.
--                         First client-role WRITE access to storage in the
--                         platform: client policies key on thread ownership,
--                         client INSERT additionally requires an image
--                         extension. DELETE is uploader-and-orphan-only (the
--                         rollback path when the send RPC fails); once a
--                         message_attachments row references a blob it is
--                         undeletable by any authenticated role.
--
-- Client image-mime enforcement is layered: the storage INSERT policy checks
-- the path extension (storage.objects.metadata is populated by the storage
-- service AFTER row insert, so `metadata->>'mimetype'` is NOT reliable in a
-- WITH CHECK); the RPC then reads the uploaded blob's authoritative mimetype
-- from storage.objects and rejects non-images for the client role before any
-- message row references it. A lying blob never becomes an attachment — it
-- stays an orphan, deletable only by its uploader and swept per the runbook.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- message_attachments
-- ----------------------------------------------------------------------------
-- (id, thread_id) uniqueness on messages so the composite FK below can pin
-- attachment.thread_id to the parent message's actual thread.
CREATE UNIQUE INDEX messages_id_thread_uidx ON messages (id, thread_id);

CREATE TABLE message_attachments (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id       uuid         NOT NULL,
  thread_id        uuid         NOT NULL REFERENCES message_threads(id) ON DELETE RESTRICT,
  -- Denormalized for RLS without a join (mirrors messages.organization_id)
  organization_id  uuid         NOT NULL REFERENCES organizations(id)   ON DELETE RESTRICT,
  storage_path     text         NOT NULL UNIQUE,
  file_name        text         NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
  mime_type        text         NOT NULL,
  byte_size        bigint       NOT NULL CHECK (byte_size > 0 AND byte_size <= 26214400),
  -- 'image' renders inline as an <img>; 'file' renders as a download chip.
  -- Derived server-side from the blob's mimetype, never caller-supplied.
  kind             text         NOT NULL CHECK (kind IN ('image','file')),
  created_at       timestamptz  NOT NULL DEFAULT now(),
  -- Thread consistency enforced by the DB: the attachment's thread_id must be
  -- the parent message's thread_id.
  CONSTRAINT message_attachments_message_thread_fk
    FOREIGN KEY (message_id, thread_id)
    REFERENCES messages (id, thread_id) ON DELETE RESTRICT
);

CREATE INDEX message_attachments_message_idx ON message_attachments (message_id);
CREATE INDEX message_attachments_thread_idx  ON message_attachments (thread_id);

CREATE TRIGGER message_attachments_enforce_thread_org
  BEFORE INSERT OR UPDATE ON message_attachments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_same_org_fk('message_threads', 'thread_id', 'organization_id');

COMMENT ON TABLE message_attachments IS
  'Immutable attachment metadata for messages. INSERT-only via send_message_with_attachments(); no direct write policies. Blob lives in the message-attachments bucket at storage_path ({org}/{thread}/{id}.{ext}).';

-- Immutability, belt-and-braces beyond "no UPDATE policy" (mirrors the
-- messages posture — defends against a future definer function bug).
CREATE OR REPLACE FUNCTION public.message_attachment_enforce_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'message attachments are immutable'
    USING ERRCODE = 'P0001';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.message_attachment_enforce_immutability() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER message_attachments_enforce_immutability
  BEFORE UPDATE ON message_attachments
  FOR EACH ROW EXECUTE FUNCTION public.message_attachment_enforce_immutability();


-- ----------------------------------------------------------------------------
-- RLS — message_attachments (read-only surface; writes only via the RPC)
-- ----------------------------------------------------------------------------
ALTER TABLE message_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff select message attachments in own org"
  ON message_attachments FOR SELECT TO authenticated
  USING (organization_id = public.user_organization_id()
         AND public.user_role() IN ('owner','staff'));

CREATE POLICY "client selects attachments in own thread"
  ON message_attachments FOR SELECT TO authenticated
  USING (public.user_role() = 'client'
         AND thread_id IN (
           SELECT mt.id FROM message_threads mt
            JOIN clients c ON c.id = mt.client_id
            WHERE c.user_id = auth.uid()
              AND c.deleted_at IS NULL
              AND mt.deleted_at IS NULL
         ));

-- No INSERT policy: direct PostgREST inserts are denied for every role; the
-- SECURITY DEFINER RPC is the only write path (it re-implements the checks).
-- No UPDATE policy: immutable (plus the trigger above).
CREATE POLICY "deny delete message attachments"
  ON message_attachments FOR DELETE TO authenticated USING (false);


-- ----------------------------------------------------------------------------
-- messages: has_attachments + relaxed body CHECK + INSERT-policy pin
-- ----------------------------------------------------------------------------
ALTER TABLE messages ADD COLUMN has_attachments boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN messages.has_attachments IS
  'True when the message carries message_attachments rows. Set only at INSERT (frozen by message_enforce_immutability) and only by send_message_with_attachments() — both direct INSERT policies pin it false.';

-- Relax the body CHECK: photo-only messages have an empty (trimmed) body.
DO $$
DECLARE
  v_name text;
BEGIN
  SELECT conname INTO v_name
    FROM pg_constraint
   WHERE conrelid = 'public.messages'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%body%';
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'messages body CHECK constraint not found — inspect before applying';
  END IF;
  EXECUTE format('ALTER TABLE public.messages DROP CONSTRAINT %I', v_name);
END $$;

ALTER TABLE messages ADD CONSTRAINT messages_body_check CHECK (
  (length(trim(body)) BETWEEN 1 AND 1000)
  OR (has_attachments AND length(trim(body)) <= 1000)
);

-- Freeze has_attachments post-insert. Full replacement of the 20260618120100
-- body (latest version of this function) + the one new column. Without this,
-- the recipient's read_at UPDATE policy row-scope would let them flip the
-- flag on messages they receive.
CREATE OR REPLACE FUNCTION public.message_enforce_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.id              IS DISTINCT FROM OLD.id
     OR NEW.thread_id       IS DISTINCT FROM OLD.thread_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.sender_user_id  IS DISTINCT FROM OLD.sender_user_id
     OR NEW.sender_role     IS DISTINCT FROM OLD.sender_role
     OR NEW.body            IS DISTINCT FROM OLD.body
     OR NEW.has_attachments IS DISTINCT FROM OLD.has_attachments
     OR NEW.created_at      IS DISTINCT FROM OLD.created_at
     OR NEW.deleted_at      IS DISTINCT FROM OLD.deleted_at
  THEN
    RAISE EXCEPTION 'messages are immutable; only read_at may change'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

-- Pin has_attachments = false on the direct INSERT paths (both roles). The
-- policy bodies are otherwise verbatim from 20260425100000.
DROP POLICY "staff insert own messages in own org" ON messages;
CREATE POLICY "staff insert own messages in own org"
  ON messages FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.user_organization_id()
              AND public.user_role() IN ('owner','staff')
              AND sender_role = 'staff'
              AND sender_user_id = auth.uid()
              AND has_attachments = false);

DROP POLICY "client inserts own messages in own thread" ON messages;
CREATE POLICY "client inserts own messages in own thread"
  ON messages FOR INSERT TO authenticated
  WITH CHECK (public.user_role() = 'client'
              AND sender_role = 'client'
              AND sender_user_id = auth.uid()
              AND has_attachments = false
              AND thread_id IN (
                SELECT mt.id FROM message_threads mt
                 JOIN clients c ON c.id = mt.client_id
                 WHERE c.user_id = auth.uid()
                   AND c.deleted_at IS NULL
              ));


-- ----------------------------------------------------------------------------
-- Thread preview: photo-only messages must not leave an empty inbox preview.
-- Full replacement of the 20260425100000 body (latest version); only the
-- preview expression changes. ACLs (anon EXECUTE revoked in 20260618120000)
-- survive CREATE OR REPLACE.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.message_update_thread_last()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE message_threads
     SET last_message_at = NEW.created_at,
         last_message_preview = CASE
           WHEN length(trim(NEW.body)) = 0 THEN '[Attachment]'
           ELSE left(NEW.body, 140)
         END,
         last_message_sender_role = NEW.sender_role,
         updated_at = now()
   WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$;


-- ----------------------------------------------------------------------------
-- The write path: send_message_with_attachments (SECURITY DEFINER + guards)
-- ----------------------------------------------------------------------------
-- Definer because the direct INSERT policies deliberately pin
-- has_attachments = false and message_attachments has no INSERT policy at
-- all — this function IS the attachment write path, so its in-body guards
-- are load-bearing (pgTAP 59 covers them). Blob facts (existence, uploader,
-- mimetype, size) are read from storage.objects — never trusted from the
-- caller.
CREATE OR REPLACE FUNCTION public.send_message_with_attachments(
  p_thread_id   uuid,
  p_body        text,
  p_attachments jsonb  -- array of {"storage_path": text, "file_name": text}
)
RETURNS messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_role         text := public.user_role();
  v_sender_role  text;
  v_thread       message_threads%ROWTYPE;
  v_body         text := coalesce(trim(p_body), '');
  v_count        int;
  v_elem         jsonb;
  v_path         text;
  v_file_name    text;
  v_prefix       text;
  v_mime         text;
  v_size         bigint;
  v_owner_ok     boolean;
  v_kind         text;
  v_message      messages%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF v_role NOT IN ('owner','staff','client') THEN
    RAISE EXCEPTION 'role not permitted' USING ERRCODE = '42501';
  END IF;
  v_sender_role := CASE WHEN v_role = 'client' THEN 'client' ELSE 'staff' END;

  SELECT * INTO v_thread
    FROM message_threads
   WHERE id = p_thread_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'thread not found' USING ERRCODE = 'P0001';
  END IF;

  -- Caller must own the thread (client) or belong to its org (staff).
  IF v_sender_role = 'client' THEN
    IF NOT EXISTS (
      SELECT 1 FROM clients c
       WHERE c.id = v_thread.client_id
         AND c.user_id = v_uid
         AND c.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'not your thread' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF v_thread.organization_id IS DISTINCT FROM public.user_organization_id() THEN
      RAISE EXCEPTION 'thread outside your organization' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_attachments IS NULL OR jsonb_typeof(p_attachments) <> 'array' THEN
    RAISE EXCEPTION 'p_attachments must be a json array' USING ERRCODE = 'P0001';
  END IF;
  v_count := jsonb_array_length(p_attachments);
  IF v_count < 1 OR v_count > 4 THEN
    -- 0 attachments has no business here — the plain INSERT path handles it.
    RAISE EXCEPTION 'between 1 and 4 attachments per message' USING ERRCODE = 'P0001';
  END IF;

  IF length(v_body) > 1000 THEN
    RAISE EXCEPTION 'message body over 1000 characters' USING ERRCODE = 'P0001';
  END IF;

  v_prefix := v_thread.organization_id::text || '/' || p_thread_id::text || '/';

  -- Validate every blob BEFORE inserting anything.
  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_attachments) LOOP
    v_path      := v_elem ->> 'storage_path';
    v_file_name := left(coalesce(nullif(trim(v_elem ->> 'file_name'), ''), 'attachment'), 255);

    IF v_path IS NULL OR position(v_prefix IN v_path) <> 1 THEN
      RAISE EXCEPTION 'attachment path outside this thread' USING ERRCODE = '42501';
    END IF;

    SELECT o.metadata ->> 'mimetype',
           (o.metadata ->> 'size')::bigint,
           (o.owner = v_uid OR o.owner_id = v_uid::text)
      INTO v_mime, v_size, v_owner_ok
      FROM storage.objects o
     WHERE o.bucket_id = 'message-attachments' AND o.name = v_path;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'attachment blob not found: %', v_path USING ERRCODE = 'P0001';
    END IF;
    IF NOT coalesce(v_owner_ok, false) THEN
      RAISE EXCEPTION 'attachment blob was not uploaded by you' USING ERRCODE = '42501';
    END IF;
    IF v_mime IS NULL OR v_size IS NULL OR v_size <= 0 THEN
      RAISE EXCEPTION 'attachment blob metadata incomplete: %', v_path USING ERRCODE = 'P0001';
    END IF;

    IF v_sender_role = 'client' THEN
      -- Clients send photos only (contract §1): image mimes, never SVG
      -- (script-bearing), 10 MB cap.
      IF v_mime NOT IN ('image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif') THEN
        RAISE EXCEPTION 'clients can attach photos only' USING ERRCODE = 'P0001';
      END IF;
      IF v_size > 10485760 THEN
        RAISE EXCEPTION 'photos are capped at 10 MB' USING ERRCODE = 'P0001';
      END IF;
    ELSE
      -- Staff: any file except executables (client-files blocklist), 25 MB
      -- (also enforced by the bucket's file_size_limit).
      IF lower(v_path) ~ '\.(exe|msi|bat|cmd|com|scr|ps1|sh|jar|js|jse|vbs|vbe|wsf|wsh|hta|cpl|php|phtml|jsp|asp|aspx)$' THEN
        RAISE EXCEPTION 'executable file types are not supported' USING ERRCODE = 'P0001';
      END IF;
      IF v_size > 26214400 THEN
        RAISE EXCEPTION 'attachments are capped at 25 MB' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END LOOP;

  INSERT INTO messages (thread_id, organization_id, sender_user_id, sender_role, body, has_attachments)
  VALUES (p_thread_id, v_thread.organization_id, v_uid, v_sender_role, v_body, true)
  RETURNING * INTO v_message;

  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_attachments) LOOP
    v_path      := v_elem ->> 'storage_path';
    v_file_name := left(coalesce(nullif(trim(v_elem ->> 'file_name'), ''), 'attachment'), 255);

    SELECT o.metadata ->> 'mimetype', (o.metadata ->> 'size')::bigint
      INTO v_mime, v_size
      FROM storage.objects o
     WHERE o.bucket_id = 'message-attachments' AND o.name = v_path;

    v_kind := CASE
      WHEN v_mime LIKE 'image/%' AND v_mime <> 'image/svg+xml' THEN 'image'
      ELSE 'file'
    END;

    INSERT INTO message_attachments
      (message_id, thread_id, organization_id, storage_path, file_name, mime_type, byte_size, kind)
    VALUES
      (v_message.id, p_thread_id, v_thread.organization_id, v_path, v_file_name, v_mime, v_size, v_kind);
  END LOOP;

  RETURN v_message;
END;
$$;

COMMENT ON FUNCTION public.send_message_with_attachments(uuid, text, jsonb) IS
  'The only write path for message attachments. SECURITY DEFINER with in-body auth/ownership/mime/size guards (pgTAP 59); reads blob facts from storage.objects rather than trusting the caller. Direct INSERTs pin messages.has_attachments = false and message_attachments has no INSERT policy.';

REVOKE EXECUTE ON FUNCTION public.send_message_with_attachments(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.send_message_with_attachments(uuid, text, jsonb) TO authenticated;


-- ----------------------------------------------------------------------------
-- Audit — trigger + resolver registration (mandatory for org-scoped tables)
-- ----------------------------------------------------------------------------
CREATE TRIGGER audit_message_attachments
  AFTER INSERT OR UPDATE OR DELETE ON message_attachments
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

-- Full replacement of audit_resolve_org_id — based on the LATEST body
-- (20260629140000_client_medications.sql), adding only 'message_attachments'
-- to the direct-org branch. (Function-rewrite rule: never base on an older
-- creating file.)
CREATE OR REPLACE FUNCTION public.audit_resolve_org_id(p_table text, p_row jsonb)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  org_id uuid;
BEGIN
  IF p_row IS NULL THEN
    RETURN NULL;
  END IF;

  CASE p_table
    -- ------------------------------------------------------------------
    -- Direct: row carries organization_id.
    -- ------------------------------------------------------------------
    WHEN 'organizations' THEN
      org_id := NULLIF(p_row ->> 'id', '')::uuid;

    WHEN 'user_organization_roles', 'invitations', 'clients',
         'client_medical_history',
         'client_medications',
         'communications',
         'client_categories', 'client_tags', 'client_tag_assignments',
         'exercises', 'program_templates', 'template_weeks',
         'template_days', 'template_exercises', 'programs', 'sessions',
         'appointments', 'reports',
         'vald_raw_uploads', 'vald_device_types',
         'clinical_notes', 'assessment_templates', 'assessments',
         'session_types', 'note_templates', 'client_files',
         'test_sessions', 'test_results', 'practice_test_settings',
         'practice_custom_tests', 'practice_disabled_tests',
         'test_batteries', 'client_publications',
         'movement_patterns', 'exercise_tags', 'exercise_metric_units',
         'availability_rules',
         -- Messaging (added 2026-06-18, §10 P0-3). Both carry organization_id.
         'messages', 'message_threads',
         -- Attachments (added 2026-07-13). Carries organization_id.
         'message_attachments'
         THEN
      org_id := NULLIF(p_row ->> 'organization_id', '')::uuid;

    -- ------------------------------------------------------------------
    -- Nested via programs.
    -- ------------------------------------------------------------------
    WHEN 'program_weeks' THEN
      SELECT p.organization_id INTO org_id
        FROM programs p
       WHERE p.id = NULLIF(p_row ->> 'program_id', '')::uuid;

    WHEN 'program_days' THEN
      SELECT p.organization_id INTO org_id
        FROM programs p
       WHERE p.id = NULLIF(p_row ->> 'program_id', '')::uuid;

    WHEN 'program_exercises' THEN
      SELECT p.organization_id INTO org_id
        FROM program_days pd
        JOIN programs p ON p.id = pd.program_id
       WHERE pd.id = NULLIF(p_row ->> 'program_day_id', '')::uuid;

    WHEN 'program_exercise_sets' THEN
      SELECT p.organization_id INTO org_id
        FROM program_exercises pe
        JOIN program_days       pd ON pd.id = pe.program_day_id
        JOIN programs           p  ON p.id  = pd.program_id
       WHERE pe.id = NULLIF(p_row ->> 'program_exercise_id', '')::uuid;

    -- ------------------------------------------------------------------
    -- Nested via sessions.
    -- ------------------------------------------------------------------
    WHEN 'exercise_logs' THEN
      SELECT s.organization_id INTO org_id
        FROM sessions s
       WHERE s.id = NULLIF(p_row ->> 'session_id', '')::uuid;

    WHEN 'set_logs' THEN
      SELECT s.organization_id INTO org_id
        FROM exercise_logs el
        JOIN sessions s ON s.id = el.session_id
       WHERE el.id = NULLIF(p_row ->> 'exercise_log_id', '')::uuid;

    -- ------------------------------------------------------------------
    -- Nested via appointments.
    -- ------------------------------------------------------------------
    WHEN 'appointment_reminders' THEN
      SELECT a.organization_id INTO org_id
        FROM appointments a
       WHERE a.id = NULLIF(p_row ->> 'appointment_id', '')::uuid;

    -- ------------------------------------------------------------------
    -- Nested via reports.
    -- ------------------------------------------------------------------
    WHEN 'report_versions' THEN
      SELECT r.organization_id INTO org_id
        FROM reports r
       WHERE r.id = NULLIF(p_row ->> 'report_id', '')::uuid;

    -- ------------------------------------------------------------------
    -- Nested via exercises (composite PK; defensive registration only).
    -- ------------------------------------------------------------------
    WHEN 'exercise_tag_assignments' THEN
      SELECT e.organization_id INTO org_id
        FROM exercises e
       WHERE e.id = NULLIF(p_row ->> 'exercise_id', '')::uuid;

    ELSE
      RAISE EXCEPTION 'audit_resolve_org_id: unknown audited table %', p_table;
  END CASE;

  RETURN org_id;
END;
$$;

SELECT public.assert_audit_resolver_coverage();


-- ============================================================================
-- Storage bucket: message-attachments (private, 25 MB cap)
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'message-attachments',
  'message-attachments',
  false,
  26214400,  -- 25 MB (staff cap; the RPC enforces the 10 MB client-photo cap)
  null       -- staff may send any file; per-role rules live in policy + RPC
)
ON CONFLICT (id) DO NOTHING;


-- ============================================================================
-- Storage RLS — message-attachments
-- ============================================================================
-- Path convention {organization_id}/{thread_id}/{attachment_id}.{ext}:
-- foldername[1] = org, foldername[2] = thread. Staff scope to their org;
-- clients scope to their OWN thread — the first client-write storage policy
-- in the platform.

CREATE POLICY "staff read message-attachments in own org"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'message-attachments'
    AND (storage.foldername(name))[1] = public.user_organization_id()::text
    AND public.user_role() IN ('owner', 'staff')
  );

CREATE POLICY "staff upload message-attachments in own org"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'message-attachments'
    AND (storage.foldername(name))[1] = public.user_organization_id()::text
    AND public.user_role() IN ('owner', 'staff')
  );

CREATE POLICY "client read message-attachments in own thread"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'message-attachments'
    AND public.user_role() = 'client'
    AND EXISTS (
      SELECT 1 FROM public.message_threads mt
       JOIN public.clients c ON c.id = mt.client_id
      WHERE c.user_id = auth.uid()
        AND c.deleted_at IS NULL
        AND mt.deleted_at IS NULL
        AND mt.id::text = (storage.foldername(name))[2]
        AND mt.organization_id::text = (storage.foldername(name))[1]
    )
  );

-- Client uploads: own thread only, image extensions only. The extension
-- check (not metadata->>'mimetype') is deliberate — storage populates
-- metadata after the row insert, so mimetype is not evaluable here. The
-- authoritative mime check happens in send_message_with_attachments before
-- the blob can ever be referenced by a message.
CREATE POLICY "client upload photos to own thread"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'message-attachments'
    AND public.user_role() = 'client'
    AND lower(name) ~ '\.(jpe?g|png|webp|gif|heic|heif)$'
    AND EXISTS (
      SELECT 1 FROM public.message_threads mt
       JOIN public.clients c ON c.id = mt.client_id
      WHERE c.user_id = auth.uid()
        AND c.deleted_at IS NULL
        AND mt.deleted_at IS NULL
        AND mt.id::text = (storage.foldername(name))[2]
        AND mt.organization_id::text = (storage.foldername(name))[1]
    )
  );

-- Rollback path only: the uploader may delete their OWN blob while no
-- message_attachments row references it (send failed / abandoned). Once
-- referenced, the blob is as immutable as the message. No UPDATE policies.
CREATE POLICY "uploader delete orphan message-attachment blobs"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'message-attachments'
    AND (owner = auth.uid() OR owner_id = auth.uid()::text)
    AND NOT EXISTS (
      SELECT 1 FROM public.message_attachments ma
      WHERE ma.storage_path = name
    )
  );
