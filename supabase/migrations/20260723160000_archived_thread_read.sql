-- ============================================================================
-- 20260723160000_archived_thread_read.sql
-- ============================================================================
-- FM-8 — message history on the archived client profile (the CN-7 residual
-- re-labelled to the compliance boundary: AHPRA/APP record production before
-- any paying clinical client; go-live-checklist §8 / polish/
-- archived-client-access.md Sign-off item 4). Closed by the 2026-07-23
-- parity pass.
--
-- Mechanics: archiving a client cascades deleted_at onto their message
-- thread (client_cascade_thread_archive, 20260426110000), and the staff
-- SELECT policy on message_threads is live-only — so the in-app message
-- record became UNREACHABLE the moment a client was archived. The child
-- messages rows stay deleted_at IS NULL (visible under the existing staff
-- messages policy) but are only addressable through the thread.
--
-- Fix: the additive archived-arm SELECT policy below — the EXACT pattern of
-- "staff select archived clients in own org" (20260702190000). Staff-only,
-- own-org, archived threads only. The staff inbox keeps its explicit
-- .is('deleted_at', null) app filter, so nothing changes there; the new
-- consumer is the archived client profile's read-only Messages history.
--
-- NOT changed: client-role policies (an archived client cannot read their
-- own thread — the portal is a closed door, see P2-3), INSERT/UPDATE
-- policies (an archived thread stays frozen — message_enforce_immutability
-- and the send RPC's live-thread pin are untouched).
--
-- pgTAP 63_archived_thread_read.sql locks this in. rls-policies.md §4.27
-- updated in the same commit.
-- ============================================================================

CREATE POLICY "staff select archived threads in own org"
  ON public.message_threads FOR SELECT TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND deleted_at IS NOT NULL
    AND public.user_role() IN ('owner', 'staff')
  );

COMMENT ON POLICY "staff select archived threads in own org" ON public.message_threads IS
  'FM-8 (2026-07-23): archived-client message history must remain producible in-app (AHPRA/APP record production). Additive archived-arm read for staff, mirroring the clients-table pattern (20260702190000). Client role deliberately has no archived arm.';
