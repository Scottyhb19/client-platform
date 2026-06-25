-- ============================================================================
-- 20260625140000_clients_overdue_followed_up_at
-- ============================================================================
-- Why: The dashboard "Needs attention" panel surfaces a client as **Overdue**
-- when they stop logging sessions. Unlike the Ending / New triggers (which
-- clear naturally once the EP drafts a program), Overdue has no natural exit:
-- only the client logging a session removes it, which is outside the EP's
-- control. So an overdue client can linger on the panel indefinitely.
--
-- This column records an EP acknowledgement — "I have checked the program and
-- messaged the client" — set from the dashboard. The Overdue trigger treats it
-- as activity: the client stays quiet until BOTH the last completed session AND
-- this acknowledgement are older than the overdue cadence (~10 days), at which
-- point they re-surface if still silent. It resets the clock; it does not hide
-- a genuinely stalled client forever. Mirrors clinical_notes.flag_reviewed_at
-- (the flag "Mark reviewed" snooze, see notes-actions.ts).
--
-- Security: staff/owner write it through the existing "staff update clients in
-- own org" RLS UPDATE policy (role-scoped, not column-scoped); clients/portal
-- have no UPDATE policy on clients, so this is no new security surface.
-- Nullable + additive: no backfill, no constraint, safe on existing rows.
-- ============================================================================

ALTER TABLE clients
  ADD COLUMN overdue_followed_up_at timestamptz;

COMMENT ON COLUMN clients.overdue_followed_up_at IS
  'EP acknowledgement that an overdue client''s program was checked and a message sent, set from the dashboard Needs-attention panel. Resets the dashboard Overdue trigger for ~10 days. See dashboard/page.tsx buildAttentionList. Mirrors clinical_notes.flag_reviewed_at.';
