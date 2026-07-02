-- ============================================================================
-- 20260702140000_message_notification_queue
-- ============================================================================
-- Why: messaging P1-1(c) deferred item, re-trigger "before identifiable
-- client health data enters" (docs/polish/messaging.md §5/§6;
-- docs/go-live-checklist.md §8). The client→EP new-message email was a
-- best-effort post-response `after()` send: no retry, no persisted outcome,
-- failures visible only in an unwatched console stub. This migration moves
-- it onto the §9 reminder posture — a durable queue drained by a cron-driven
-- Edge Function (send-message-notifications) that records
-- sent/failed/retried per row and supports a `succeeded≥1` synthetic check.
--
-- Shape notes (mirroring appointment_reminders / appointment_manage_reminder):
--   * Enqueue is a DB trigger on messages, not app code — atomic with the
--     message INSERT (the `after()` block could be lost if the serverless
--     instance died post-response) and it covers every future client-send
--     path. This restores the §10 gap-doc's original DB-trigger
--     recommendation, now that the queue makes it observable.
--   * Debounce semantics are UNCHANGED from the P1-1(c) ship: enqueue only
--     when the just-inserted message is the ONLY unread client message in
--     the thread (read_at is the debounce; a burst enqueues once, and
--     nothing more sends until the EP reads and the cycle resets). A partial
--     unique index backstops it per (thread, recipient).
--   * The email still carries NO message body — the worker renders the same
--     first-name-only template; health-adjacent content stays inside the
--     RLS/audit perimeter.
--   * RLS mirrors appointment_reminders: staff-only SELECT in own org
--     (future EP-facing failure surfacing can read it), all API writes
--     denied — only the trigger (definer) and the worker (service key)
--     touch it. No audit trigger, same as appointment_reminders (ops queue,
--     not clinical record).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Queue table
-- ----------------------------------------------------------------------------
CREATE TABLE message_notifications (
  id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid         NOT NULL REFERENCES organizations(id)      ON DELETE RESTRICT,
  thread_id            uuid         NOT NULL REFERENCES message_threads(id)    ON DELETE CASCADE,
  message_id           uuid         NOT NULL REFERENCES messages(id)           ON DELETE CASCADE,
  recipient_user_id    uuid         NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  status               text         NOT NULL DEFAULT 'scheduled'
                                    CHECK (status IN ('scheduled','sent','failed','cancelled')),
  provider             text         NOT NULL DEFAULT 'resend' CHECK (provider IN ('resend')),
  provider_message_id  text,
  scheduled_for        timestamptz  NOT NULL DEFAULT now(),
  sent_at              timestamptz,
  failed_at            timestamptz,
  failure_reason       text,
  retry_count          smallint     NOT NULL DEFAULT 0 CHECK (retry_count BETWEEN 0 AND 5),
  created_at           timestamptz  NOT NULL DEFAULT now(),
  updated_at           timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE message_notifications IS
  'Queue for client→EP new-message notification emails (messaging P1-1c queue+cron upgrade). One row per (first-unread client message, owner recipient); drained by the send-message-notifications Edge Function on the 5-minute cron. Mirrors appointment_reminders.';

-- Worker pulls due rows
CREATE INDEX message_notifications_due_idx
  ON message_notifications (scheduled_for)
  WHERE status = 'scheduled';

CREATE INDEX message_notifications_thread_idx
  ON message_notifications (thread_id);

-- Debounce backstop: at most one pending notification per (thread, recipient).
CREATE UNIQUE INDEX message_notifications_pending_uniq
  ON message_notifications (thread_id, recipient_user_id)
  WHERE status = 'scheduled';

CREATE TRIGGER message_notifications_touch_updated_at
  BEFORE UPDATE ON message_notifications
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- RLS — staff-only SELECT in own org; all API writes denied (trigger +
-- service-key worker are the only writers).
-- ----------------------------------------------------------------------------
ALTER TABLE message_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff select message_notifications in own org"
  ON message_notifications FOR SELECT TO authenticated
  USING (
    public.user_role() IN ('owner','staff')
    AND organization_id = public.user_organization_id()
  );
CREATE POLICY "deny direct insert message_notifications"
  ON message_notifications FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "deny update message_notifications"
  ON message_notifications FOR UPDATE TO authenticated USING (false);
CREATE POLICY "deny delete message_notifications"
  ON message_notifications FOR DELETE TO authenticated USING (false);

-- ----------------------------------------------------------------------------
-- Enqueue trigger — AFTER INSERT on messages. SECURITY DEFINER because the
-- inserting session is the CLIENT role, which can neither read
-- user_organization_roles for the owner list nor write the queue table.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.message_notification_enqueue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_unread integer;
BEGIN
  -- Only client-sent, live messages notify the EP.
  IF NEW.sender_role <> 'client' OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Debounce (unchanged P1-1c semantics): the row just inserted is visible
  -- in an AFTER trigger, so a count of exactly 1 means it is the only
  -- unread client message — the EP has read everything prior. A burst, or
  -- a message landing while one is already unread, enqueues nothing more
  -- until the EP reads and the cycle resets.
  SELECT count(*) INTO v_unread
  FROM messages m
  WHERE m.thread_id = NEW.thread_id
    AND m.sender_role = 'client'
    AND m.read_at IS NULL
    AND m.deleted_at IS NULL;

  IF v_unread <> 1 THEN
    RETURN NEW;
  END IF;

  -- One row per org owner (the EP). ON CONFLICT pairs with the pending
  -- partial unique index — a concurrent burst cannot double-enqueue.
  INSERT INTO message_notifications
    (organization_id, thread_id, message_id, recipient_user_id)
  SELECT NEW.organization_id, NEW.thread_id, NEW.id, r.user_id
  FROM user_organization_roles r
  WHERE r.organization_id = NEW.organization_id
    AND r.role = 'owner'
  ON CONFLICT (thread_id, recipient_user_id) WHERE status = 'scheduled'
  DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.message_notification_enqueue() IS
  'AFTER INSERT trigger on messages: enqueues a notification email to each org owner when a client message is the first unread in its thread (P1-1c queue+cron). Definer-only; the send-message-notifications Edge Function drains the queue.';

-- Definer-only posture from birth (the §4 sweep lesson — Supabase default
-- privileges grant EXECUTE to the API roles at creation; strip them now, not
-- in a later sweep). Trigger execution is unaffected: EXECUTE on a trigger
-- function is checked at CREATE TRIGGER time (as postgres), not at fire time.
REVOKE EXECUTE ON FUNCTION public.message_notification_enqueue() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER messages_enqueue_notification
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION public.message_notification_enqueue();
