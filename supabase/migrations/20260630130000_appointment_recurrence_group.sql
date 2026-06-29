-- ============================================================================
-- 20260630130000_appointment_recurrence_group
-- ============================================================================
-- Schedule round-two — link the rows of a recurring series so the EP can end a
-- series from a given occurrence forward.
--
-- BEFORE. Booking a recurring series (createRecurringAppointmentsAction) wrote
-- CONCRETE, UNLINKED rows — one per occurrence, with no shared identifier. That
-- was a deliberate choice (cancel/move a single session without an abstract
-- rule), but it left no way to act on "this session and every later one in the
-- same series" — the operator's request when archiving a repeat.
--
-- AFTER. A nullable recurrence_group_id stamps every row of a series with one
-- shared UUID (the action mints it once per series). A single (non-repeat)
-- booking leaves it NULL, unchanged. Existing rows already in the table stay
-- NULL — there is no backfill, so "archive this & future" applies only to
-- series booked from this migration forward (owner decision: clean link, no
-- fragile heuristic re-grouping of historical rows).
--
-- The new RPC archive_appointment_and_future soft-deletes the anchor occurrence
-- and every later occurrence sharing its group — never the earlier ones. It
-- mirrors archive_appointment (20260629120000): SECURITY DEFINER + in-body auth
-- guard (the deleted_at-IS-NULL SELECT-policy trap), scoped to kind=appointment
-- and the caller's org, and it cancels the queued reminders for the rows it
-- archives (the reminder trigger does not fire on deleted_at).
--
-- Additive + backward-compatible with deployed master: the column is nullable
-- with no default, and master never references it or the new RPC. anon EXECUTE
-- is revoked (every CREATE auto-grants it); the in-body guard fails closed
-- regardless.
-- ============================================================================

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS recurrence_group_id uuid;

COMMENT ON COLUMN appointments.recurrence_group_id IS
  'Shared UUID across all occurrences of one recurring series (NULL for a single booking). Stamped once per series at creation; enables "archive this occurrence and every later one in the series". No backfill of pre-existing rows.';

-- Lookup index for the "this occurrence + all later in the group" sweep. Partial
-- on the live, grouped rows only — the vast majority (single bookings) are NULL
-- and stay out of the index.
CREATE INDEX IF NOT EXISTS appointments_recurrence_group_idx
  ON appointments (recurrence_group_id, start_at)
  WHERE recurrence_group_id IS NOT NULL
    AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.archive_appointment_and_future(p_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org  uuid := public.user_organization_id();
  caller_role text := public.user_role();
  v_group     uuid;
  v_start     timestamptz;
  v_ids       uuid[];
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Resolve the anchor — a live client appointment in the caller's org.
  SELECT recurrence_group_id, start_at
    INTO v_group, v_start
    FROM appointments
   WHERE id              = p_id
     AND organization_id = caller_org
     AND kind            = 'appointment'
     AND deleted_at      IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'appointment % not found in your organization, or already removed', p_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_group IS NULL THEN
    -- Not part of a series → archive this row only (same as archive_appointment).
    UPDATE appointments SET deleted_at = now() WHERE id = p_id;
    UPDATE appointment_reminders
       SET status = 'cancelled'
     WHERE appointment_id = p_id
       AND status         = 'scheduled';
    RETURN 1;
  END IF;

  -- Archive this occurrence and every LATER one in the series (start_at >= the
  -- anchor's). The earlier, already-delivered occurrences are left intact.
  WITH archived AS (
    UPDATE appointments
       SET deleted_at = now()
     WHERE organization_id     = caller_org
       AND recurrence_group_id = v_group
       AND kind                = 'appointment'
       AND deleted_at          IS NULL
       AND start_at            >= v_start
    RETURNING id
  )
  SELECT array_agg(id) INTO v_ids FROM archived;

  -- Cancel any still-scheduled reminders for exactly the rows just archived.
  UPDATE appointment_reminders
     SET status = 'cancelled'
   WHERE appointment_id = ANY(v_ids)
     AND status         = 'scheduled';

  RETURN coalesce(array_length(v_ids, 1), 0);
END;
$$;

COMMENT ON FUNCTION public.archive_appointment_and_future(uuid) IS
  'Archive (soft-delete) a kind=appointment occurrence and every LATER occurrence in its recurrence series (never the earlier ones), returning the count archived. A non-series row archives alone. SECURITY DEFINER to bypass the deleted_at-IS-NULL SELECT-policy trap; auth (org + owner/staff) + kind=appointment checked in-body. Cancels the queued reminders for the archived rows.';

REVOKE EXECUTE ON FUNCTION public.archive_appointment_and_future(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.archive_appointment_and_future(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.archive_appointment_and_future(uuid) TO authenticated;
