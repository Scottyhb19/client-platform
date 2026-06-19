-- ============================================================================
-- 20260620120000_messages_read_at_recipient_only   (§10 review follow-up)
-- ============================================================================
-- Why: a reviewer follow-up to §10 P0-2. The immutability trigger froze every
-- column except read_at, but left read_at writable by ANY party in the
-- thread/org — so a SENDER could stamp read_at on their OWN message and forge
-- a read receipt (or suppress their own message from the recipient's unread
-- count / the P1-1c notification debounce). Probed live 2026-06-20: a client
-- stamping read_at on its own client→staff message, AND staff on their own
-- staff→client message, both succeeded. read_at is a read RECEIPT; only the
-- RECIPIENT of a message should be able to set it.
--
-- Fix: tighten the two UPDATE policies so each role may UPDATE only the
-- messages it RECEIVES — a client may stamp read_at only on staff-sender rows,
-- staff only on client-sender rows. Combined with the immutability trigger
-- (read_at is the only mutable column), read_at becomes writable by the
-- recipient alone.
--
-- Backward-compatible: the app already marks read by exactly this split —
-- markClientThreadReadAction filters sender_role='staff', markThreadReadAction
-- filters sender_role='client' — so no send/read path changes behaviour. The
-- sender_role predicate in WITH CHECK is belt-and-braces (the immutability
-- trigger already freezes sender_role). Locked by pgTAP 34 (#15-17).
-- ============================================================================

-- Client: may stamp read_at ONLY on the messages it receives (sender_role='staff').
DROP POLICY "client updates messages in own thread" ON messages;
CREATE POLICY "client updates messages in own thread"
  ON messages FOR UPDATE TO authenticated
  USING (public.user_role() = 'client'
         AND sender_role = 'staff'
         AND thread_id IN (
           SELECT mt.id FROM message_threads mt
            JOIN clients c ON c.id = mt.client_id
            WHERE c.user_id = auth.uid()
         ))
  WITH CHECK (public.user_role() = 'client'
              AND sender_role = 'staff');

-- Staff: may stamp read_at ONLY on the messages it receives (sender_role='client').
DROP POLICY "staff update messages in own org" ON messages;
CREATE POLICY "staff update messages in own org"
  ON messages FOR UPDATE TO authenticated
  USING (organization_id = public.user_organization_id()
         AND public.user_role() IN ('owner','staff')
         AND sender_role = 'client')
  WITH CHECK (organization_id = public.user_organization_id()
              AND sender_role = 'client');
