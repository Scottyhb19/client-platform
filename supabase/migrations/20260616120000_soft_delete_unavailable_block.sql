-- ============================================================================
-- 20260616120000_soft_delete_unavailable_block
-- ============================================================================
-- Section 9 (Scheduling) — P2-8 review fix.
--
-- BEFORE. Removing an "Unavailable" block (admin / meeting / note / break /
-- travel … kind = 'unavailable', P1-7) from the schedule popover called
-- cancelAppointmentAction → status='cancelled'. That left the block alive as a
-- cancelled row: it re-surfaced under the "Show cancellations" toggle (P2-8b)
-- and laned beside real appointments. A cancelled *client* appointment is
-- meaningful history (attribution — the client cancelled); an unavailable block
-- the EP removes is just their own time-blocking and should simply disappear.
--
-- AFTER. Removing an unavailable block soft-deletes it (deleted_at = now()).
-- Every schedule/booking query already filters deleted_at IS NULL, so the row
-- vanishes from the grid while the audit trail (the AFTER-UPDATE audit trigger
-- on appointments) still records the removal.
--
-- WHY AN RPC. A direct UPDATE deleted_at trips the deleted_at-IS-NULL SELECT-
-- policy trap (PostgREST's RETURNING re-select can no longer see the row →
-- 42501; memory/project_postgrest_soft_delete_rls.md). This mirrors the
-- soft_delete_<table>() family (20260429120000): SECURITY DEFINER + an in-body
-- auth guard, so the elevated context performs the write without the re-select.
--
-- SCOPED to kind='unavailable' on purpose — a client appointment must never be
-- silently soft-deleted here; those go through cancellation, which preserves
-- the cancelled record + actor attribution. The guard makes that a hard rule,
-- not a UI convention.
--
-- Additive + backward-compatible with deployed master (which never calls it).
-- anon EXECUTE is revoked (P0-1 discipline: every CREATE auto-grants it, and
-- REVOKE FROM PUBLIC does not strip the role-specific anon grant); the in-body
-- auth.uid()/role guard fails closed for anon regardless. Tripwire: pgTAP 26.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.soft_delete_unavailable_block(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org  uuid := public.user_organization_id();
  caller_role text := public.user_role();
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  UPDATE appointments
     SET deleted_at = now()
   WHERE id              = p_id
     AND organization_id = caller_org
     AND kind            = 'unavailable'
     AND deleted_at      IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'unavailable block % not found in your organization, or already removed', p_id
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.soft_delete_unavailable_block(uuid) IS
  'Soft-delete a kind=unavailable block (admin/meeting/note) in the caller''s org so it disappears from the schedule rather than lingering as a cancelled row (Section 9 P2-8). SECURITY DEFINER to bypass the deleted_at-IS-NULL SELECT-policy trap; auth (org + owner/staff) + kind=unavailable checked in-body. Client appointments are out of scope — they cancel, not delete.';

REVOKE EXECUTE ON FUNCTION public.soft_delete_unavailable_block(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.soft_delete_unavailable_block(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.soft_delete_unavailable_block(uuid) TO authenticated;
