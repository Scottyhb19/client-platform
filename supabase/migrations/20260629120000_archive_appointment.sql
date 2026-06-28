-- ============================================================================
-- 20260629120000_archive_appointment
-- ============================================================================
-- Schedule round-two — "Archive" a mistakenly-created client appointment.
--
-- BEFORE. The only way to remove a client appointment from the grid was to
-- cancel it (status='cancelled'). But cancellation is meaningful history: it
-- counts toward the cancellation-rate KPI in Analytics and carries actor
-- attribution. An appointment booked *by accident* is not a cancellation —
-- counting it as one gives false KPI data (the operator's stated concern).
--
-- AFTER. Archiving soft-deletes the row (deleted_at = now()). Every schedule /
-- dashboard / analytics query already filters deleted_at IS NULL, so the row
-- vanishes everywhere and counts as NEITHER attended NOR cancelled — as if it
-- never existed, which is exactly right for a mis-booking. The AFTER-UPDATE
-- audit trigger on appointments still records the removal.
--
-- WHY AN RPC. A direct UPDATE deleted_at trips the deleted_at-IS-NULL SELECT-
-- policy trap (PostgREST's RETURNING re-select can no longer see the row →
-- 42501; memory/project_postgrest_soft_delete_rls.md). This mirrors
-- soft_delete_unavailable_block (20260616120000) and the soft_delete_<table>()
-- family (20260429120000): SECURITY DEFINER + an in-body auth guard, so the
-- elevated context performs the write without the re-select.
--
-- REMINDER CLEANUP. appointment_manage_reminder (20260615170000) fires only on
-- UPDATE OF start_at, status — NOT deleted_at — so soft-deleting alone would
-- leave a queued reminder live and the archived client would still get emailed.
-- This RPC cancels the scheduled reminder in the same transaction, matching what
-- the trigger does when an appointment otherwise leaves the live set.
--
-- SCOPED to kind='appointment' — the unavailable-block path has its own RPC.
--
-- Additive + backward-compatible with deployed master (which never calls it).
-- anon EXECUTE is revoked (every CREATE auto-grants it, and REVOKE FROM PUBLIC
-- does not strip the role-specific anon grant); the in-body auth.uid()/role
-- guard fails closed for anon regardless.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.archive_appointment(p_id uuid)
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
     AND kind            = 'appointment'
     AND deleted_at      IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'appointment % not found in your organization, or already removed', p_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Cancel any still-scheduled reminder so an archived booking never sends.
  UPDATE appointment_reminders
     SET status = 'cancelled'
   WHERE appointment_id = p_id
     AND status         = 'scheduled';
END;
$$;

COMMENT ON FUNCTION public.archive_appointment(uuid) IS
  'Archive (soft-delete) a kind=appointment client booking created by mistake, so it disappears from the schedule and counts as neither attended nor cancelled in KPIs (unlike cancellation, which is meaningful history). SECURITY DEFINER to bypass the deleted_at-IS-NULL SELECT-policy trap; auth (org + owner/staff) + kind=appointment checked in-body. Also cancels any queued reminder (the reminder trigger does not fire on deleted_at).';

REVOKE EXECUTE ON FUNCTION public.archive_appointment(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.archive_appointment(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.archive_appointment(uuid) TO authenticated;
