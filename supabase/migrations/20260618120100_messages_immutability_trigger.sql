-- ============================================================================
-- 20260618120100_messages_immutability_trigger              (Messaging P0-2)
-- ============================================================================
-- Why: the messages table header (20260425100000) claims rows are "immutable
-- except read_at and deleted_at — Enforced via update RLS". They were NOT.
-- RLS WITH CHECK cannot restrict WHICH columns change (it cannot see OLD), so
-- the UPDATE policies only scoped org/role/thread. Within a thread a client
-- could rewrite or soft-delete the EP's messages and forge sender_* via a raw
-- PostgREST PATCH (not reachable from the UI, but the REST endpoint is open to
-- the client's own JWT). This closes that hole — messaging premortem FM-1.
--
-- Decision (gap doc Q2=(a) trigger, Q3=(a) no delete): enforce immutability
-- with a BEFORE UPDATE trigger, and ship NO user delete/unsend in v1 — so
-- read_at is the ONLY column any API role may change. deleted_at is frozen
-- here too; the only writer of a thread's deleted_at stays the SECURITY
-- DEFINER archive-cascade (which writes message_threads, never messages). If
-- a message-level admin soft-delete is ever needed it gets its own definer
-- RPC + a trigger carve-out — not a broadened policy.
--
-- The trigger is column-explicit (not "only read_at changed") so it is
-- independent of BEFORE-trigger ordering: messages_touch_updated_at bumps
-- updated_at, but it runs alphabetically AFTER this trigger and updated_at is
-- not in the frozen set, so there is no interaction. It fires for every role
-- (no role guard) — the pgTAP suite drives it via SET LOCAL ROLE authenticated.
--
-- Backward-compatible: the ONLY UPDATE paths to messages in the app are the
-- two read_at mark-read calls (staff messages/actions.ts:108 + portal
-- messages/actions.ts:89); both change read_at only and pass. Verified against
-- the full src tree before this landed.
-- ============================================================================

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
     OR NEW.created_at      IS DISTINCT FROM OLD.created_at
     OR NEW.deleted_at      IS DISTINCT FROM OLD.deleted_at
  THEN
    RAISE EXCEPTION 'messages are immutable; only read_at may change'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.message_enforce_immutability() IS
  'BEFORE UPDATE trigger on messages: freezes every column except read_at (updated_at is bumped by messages_touch_updated_at, which runs later and is not in the frozen set). Enforces the immutability the table was documented to have but RLS could not provide; closes messaging premortem FM-1. v1 has no user delete, so deleted_at is frozen too.';

CREATE TRIGGER messages_enforce_immutability
  BEFORE UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION public.message_enforce_immutability();

-- Trigger functions are not PostgREST-invocable, but revoke the default grant
-- for posture consistency with P0-1 (locked by pgTAP 34).
REVOKE EXECUTE ON FUNCTION public.message_enforce_immutability() FROM PUBLIC, anon, authenticated;
