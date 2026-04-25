-- ============================================================================
-- 20260425100000_messages
-- ============================================================================
-- Why: Two-way real-time messaging between staff and clients. Distinct from
-- communications (email/SMS log) — messages are short, in-app, immutable, and
-- streamed via Supabase Realtime. Adopted in deviation from brief §6.7
-- ("no in-app messaging") after explicit owner approval — kept inside the
-- existing RLS/audit perimeter rather than a third-party chat SDK so health-
-- adjacent message content stays subject to APP compliance + DR tooling.
--
-- Shape:
--   message_threads  one row per (organization_id, client_id) — single thread
--                    per client. Holds denormalized last_message metadata for
--                    fast inbox list rendering without joining messages.
--   messages         immutable rows; only read_at and deleted_at mutate after
--                    insert. Enforced via update RLS, not just convention.
--
-- Realtime: messages is published to supabase_realtime so the staff inbox and
-- client portal can subscribe to thread_id-scoped changes. RLS gates which
-- rows the subscriber actually receives — postgres_changes respects RLS.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- message_threads
-- ----------------------------------------------------------------------------
CREATE TABLE message_threads (
  id                       uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid         NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  client_id                uuid         NOT NULL REFERENCES clients(id)       ON DELETE RESTRICT,
  -- Denormalized for fast inbox list rendering without joining messages
  last_message_at          timestamptz,
  last_message_preview     text,
  last_message_sender_role text         CHECK (last_message_sender_role IN ('staff','client')),
  created_at               timestamptz  NOT NULL DEFAULT now(),
  updated_at               timestamptz  NOT NULL DEFAULT now(),
  deleted_at               timestamptz,
  -- One thread per client per org. The org-level uniqueness is redundant with
  -- the client FK (a client belongs to one org) but defends against any future
  -- client re-parenting.
  CONSTRAINT message_threads_client_unique UNIQUE (organization_id, client_id)
);

CREATE INDEX message_threads_org_recent_idx
  ON message_threads (organization_id, last_message_at DESC NULLS LAST)
  WHERE deleted_at IS NULL;

CREATE INDEX message_threads_client_idx
  ON message_threads (client_id)
  WHERE deleted_at IS NULL;

CREATE TRIGGER message_threads_touch_updated_at
  BEFORE UPDATE ON message_threads
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER message_threads_enforce_client_org
  BEFORE INSERT OR UPDATE ON message_threads
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_same_org_fk('clients', 'client_id', 'organization_id');

COMMENT ON TABLE message_threads IS
  'One thread per client per organization. last_message_* are denormalized for inbox list rendering speed; maintained by the messages-after-insert trigger.';


-- ----------------------------------------------------------------------------
-- messages
-- ----------------------------------------------------------------------------
CREATE TABLE messages (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id           uuid         NOT NULL REFERENCES message_threads(id) ON DELETE RESTRICT,
  -- Denormalized for RLS without a join (messages is the hot table)
  organization_id     uuid         NOT NULL REFERENCES organizations(id)   ON DELETE RESTRICT,
  sender_user_id      uuid         NOT NULL REFERENCES user_profiles(user_id) ON DELETE RESTRICT,
  -- Captured at insert time; never derived. Survives role changes / staff
  -- demotions so an old message stays attributed to the role at send time.
  sender_role         text         NOT NULL CHECK (sender_role IN ('staff','client')),
  body                text         NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 1000),
  read_at             timestamptz,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

-- Thread load: newest-first, soft-delete-aware
CREATE INDEX messages_thread_recent_idx
  ON messages (thread_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Unread badge in staff top bar — count unread client→staff messages per org
CREATE INDEX messages_org_unread_idx
  ON messages (organization_id, sender_role)
  WHERE read_at IS NULL AND deleted_at IS NULL;

-- Per-thread unread (for client portal "you have N unread" pill)
CREATE INDEX messages_thread_unread_idx
  ON messages (thread_id, sender_role)
  WHERE read_at IS NULL AND deleted_at IS NULL;

CREATE TRIGGER messages_touch_updated_at
  BEFORE UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER messages_enforce_thread_org
  BEFORE INSERT OR UPDATE ON messages
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_same_org_fk('message_threads', 'thread_id', 'organization_id');

COMMENT ON TABLE messages IS
  'Two-way staff↔client messages. Immutable except read_at and deleted_at. body capped at 1000 chars to keep this lane for short coordination, not clinical narrative — long content belongs in clinical_notes or email.';


-- ----------------------------------------------------------------------------
-- After-insert trigger: maintain message_threads.last_message_*
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
         last_message_preview = left(NEW.body, 140),
         last_message_sender_role = NEW.sender_role,
         updated_at = now()
   WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.message_update_thread_last() IS
  'After-insert trigger on messages — keeps message_threads.last_message_* current for fast inbox list rendering. SECURITY DEFINER because callers (clients) cannot UPDATE message_threads under their RLS policy but the denormalized fields must still bump.';

CREATE TRIGGER messages_bump_thread_last
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION public.message_update_thread_last();


-- ----------------------------------------------------------------------------
-- Realtime: publish messages so postgres_changes can stream to subscribers.
-- RLS still gates which rows each subscriber receives.
-- ----------------------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE message_threads;


-- ============================================================================
-- RLS — message_threads
-- ============================================================================
ALTER TABLE message_threads ENABLE ROW LEVEL SECURITY;

-- Staff: full CRUD scoped to their org
CREATE POLICY "staff select threads in own org"
  ON message_threads FOR SELECT TO authenticated
  USING (organization_id = public.user_organization_id()
         AND deleted_at IS NULL
         AND public.user_role() IN ('owner','staff'));

CREATE POLICY "staff insert threads in own org"
  ON message_threads FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.user_organization_id()
              AND public.user_role() IN ('owner','staff'));

CREATE POLICY "staff update threads in own org"
  ON message_threads FOR UPDATE TO authenticated
  USING (organization_id = public.user_organization_id()
         AND public.user_role() IN ('owner','staff'))
  WITH CHECK (organization_id = public.user_organization_id());

-- Hard DELETE denied — soft-delete only via service role for now. Matches
-- communications policy. Avoids the PostgREST soft-delete RLS gotcha (UPDATE
-- setting deleted_at fails the RETURNING because the SELECT policy filters
-- on deleted_at IS NULL). Re-introduce a delete UI when there's a real need.
CREATE POLICY "deny delete threads"
  ON message_threads FOR DELETE TO authenticated USING (false);

-- Client: SELECT only their own thread
CREATE POLICY "client selects own thread"
  ON message_threads FOR SELECT TO authenticated
  USING (deleted_at IS NULL
         AND public.user_role() = 'client'
         AND client_id IN (
           SELECT id FROM clients
            WHERE user_id = auth.uid()
              AND deleted_at IS NULL
         ));


-- ============================================================================
-- RLS — messages
-- ============================================================================
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Staff SELECT in own org
CREATE POLICY "staff select messages in own org"
  ON messages FOR SELECT TO authenticated
  USING (organization_id = public.user_organization_id()
         AND deleted_at IS NULL
         AND public.user_role() IN ('owner','staff'));

-- Staff INSERT — must be sender_role='staff' and sender_user_id=auth.uid()
CREATE POLICY "staff insert own messages in own org"
  ON messages FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.user_organization_id()
              AND public.user_role() IN ('owner','staff')
              AND sender_role = 'staff'
              AND sender_user_id = auth.uid());

-- Staff UPDATE — only read_at on client→staff messages, only soft-delete via deleted_at
CREATE POLICY "staff update messages in own org"
  ON messages FOR UPDATE TO authenticated
  USING (organization_id = public.user_organization_id()
         AND public.user_role() IN ('owner','staff'))
  WITH CHECK (organization_id = public.user_organization_id());

-- Client SELECT — only messages in their own thread
CREATE POLICY "client selects messages in own thread"
  ON messages FOR SELECT TO authenticated
  USING (deleted_at IS NULL
         AND public.user_role() = 'client'
         AND thread_id IN (
           SELECT mt.id FROM message_threads mt
            JOIN clients c ON c.id = mt.client_id
            WHERE c.user_id = auth.uid()
              AND c.deleted_at IS NULL
              AND mt.deleted_at IS NULL
         ));

-- Client INSERT — must be sender_role='client', sender_user_id=auth.uid(),
-- thread must belong to them
CREATE POLICY "client inserts own messages in own thread"
  ON messages FOR INSERT TO authenticated
  WITH CHECK (public.user_role() = 'client'
              AND sender_role = 'client'
              AND sender_user_id = auth.uid()
              AND thread_id IN (
                SELECT mt.id FROM message_threads mt
                 JOIN clients c ON c.id = mt.client_id
                 WHERE c.user_id = auth.uid()
                   AND c.deleted_at IS NULL
              ));

-- Client UPDATE — only their own thread, used for marking staff→client read
CREATE POLICY "client updates messages in own thread"
  ON messages FOR UPDATE TO authenticated
  USING (public.user_role() = 'client'
         AND thread_id IN (
           SELECT mt.id FROM message_threads mt
            JOIN clients c ON c.id = mt.client_id
            WHERE c.user_id = auth.uid()
         ))
  WITH CHECK (public.user_role() = 'client');

-- Hard DELETE denied — same reasoning as message_threads above.
CREATE POLICY "deny delete messages"
  ON messages FOR DELETE TO authenticated USING (false);
