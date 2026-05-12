-- ============================================================================
-- 20260513130000_appointment_actor_columns
-- ============================================================================
-- Why: Phase F-5 (booking attribution + cancellation visual). At render time
-- on the staff schedule we need to know:
--
--   1. WHO created the appointment (staff via /schedule composer, client via
--      /portal/book/new, or a future system process). This drives the small
--      "Odyssey." brand mark on app-booked blocks so the EP can pick out
--      client-initiated bookings at a glance.
--
--   2. WHO cancelled the appointment. Same reason — cancelled appointments
--      stay on the schedule with a soft-red treatment; client-initiated
--      cancellations get a "· App Cancellation" suffix on the card body.
--
-- Phase F gap doc §5 Q7 originally deferred these columns, arguing the
-- audit_log captured the same information. That decision is reversed here:
-- the staff /schedule renders many appointments at once, and joining each
-- block to its audit_log row is wasteful when a 1-byte enum on the row is
-- enough.
--
-- Backfill posture for existing rows:
--   - created_by_role defaults to 'staff' (best-guess, pre-launch, no real
--     signal lost).
--   - cancelled_by_role stays NULL on existing cancelled rows — we cannot
--     retroactively know how they were cancelled. The renderer treats NULL
--     as "unknown actor, no suffix" which is the correct read.
--
-- Trigger hardening: appointments_client_field_lockdown gains TWO new
-- defensive checks (gap doc Q3, locked yes):
--   (a) created_by_role joins the deny-list so a client can never change
--       it via direct PATCH. The legitimate set is at INSERT time; never
--       at UPDATE.
--   (b) cancelled_by_role may only change when status is ALSO flipping
--       from non-cancelled → cancelled. Stops a "PATCH cancelled_by_role
--       without status" attack that would mislabel the row's cancellation
--       attribution.
--
-- Audit: 'appointments' is already in audit_resolve_org_id's direct-org
-- WHEN list (20260510120200_audit_resolve_org_id_restore_nested.sql:75).
-- audit_appointments trigger is already attached (20260420102300:419).
-- Column additions automatically appear in changed_fields on subsequent
-- UPDATEs — no audit-register migration needed.
--
-- RPC updates: client_book_appointment (sets created_by_role := 'client_portal'
-- on INSERT) and client_cancel_appointment (sets cancelled_by_role :=
-- 'client_portal' on UPDATE). DROP FUNCTION + CREATE OR REPLACE per the
-- established arity-evolution pattern, defensive even though arity is
-- unchanged here.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Column additions on appointments
-- ----------------------------------------------------------------------------
ALTER TABLE appointments
  ADD COLUMN created_by_role text NOT NULL DEFAULT 'staff'
    CHECK (created_by_role IN ('staff', 'client_portal', 'system'));

ALTER TABLE appointments
  ADD COLUMN cancelled_by_role text
    CHECK (cancelled_by_role IS NULL
           OR cancelled_by_role IN ('staff', 'client_portal', 'system'));

COMMENT ON COLUMN appointments.created_by_role IS
  'Actor that created the appointment row. Drives the staff-schedule "Odyssey." brand mark for client_portal-created bookings.';
COMMENT ON COLUMN appointments.cancelled_by_role IS
  'Actor that flipped status to cancelled. NULL on non-cancelled rows. Drives the staff-schedule "App Cancellation" suffix when client_portal.';


-- ----------------------------------------------------------------------------
-- 2. Trigger update — appointments_client_field_lockdown
-- ----------------------------------------------------------------------------
-- Adds (a) created_by_role to the deny-list and (b) cancelled_by_role
-- only-when-cancelling guard. Keeps the existing deny-list intact.
CREATE OR REPLACE FUNCTION public.appointments_client_field_lockdown()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF public.user_role() = 'client' THEN
    IF NEW.start_at            IS DISTINCT FROM OLD.start_at
    OR NEW.end_at              IS DISTINCT FROM OLD.end_at
    OR NEW.appointment_type    IS DISTINCT FROM OLD.appointment_type
    OR NEW.location            IS DISTINCT FROM OLD.location
    OR NEW.notes               IS DISTINCT FROM OLD.notes
    OR NEW.confirmed_at        IS DISTINCT FROM OLD.confirmed_at
    OR NEW.no_show_marked_at   IS DISTINCT FROM OLD.no_show_marked_at
    OR NEW.staff_user_id       IS DISTINCT FROM OLD.staff_user_id
    OR NEW.client_id           IS DISTINCT FROM OLD.client_id
    OR NEW.organization_id     IS DISTINCT FROM OLD.organization_id
    OR NEW.created_by_role     IS DISTINCT FROM OLD.created_by_role
    THEN
      RAISE EXCEPTION 'Clients may only cancel their own appointment — no other field changes permitted'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- cancelled_by_role may only change when the row is being cancelled
    -- in the SAME UPDATE. Stops a client from PATCHing the attribution
    -- on an appointment that's not transitioning to cancelled.
    IF NEW.cancelled_by_role IS DISTINCT FROM OLD.cancelled_by_role
       AND NOT (NEW.status = 'cancelled' AND OLD.status <> 'cancelled') THEN
      RAISE EXCEPTION 'cancelled_by_role may only be set when cancelling an appointment'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


-- ----------------------------------------------------------------------------
-- 3. client_book_appointment — INSERT now records created_by_role
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.client_book_appointment(uuid, uuid, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.client_book_appointment(
  p_session_type_id uuid,
  p_staff_user_id   uuid,
  p_start_at        timestamptz,
  p_end_at          timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_id           uuid := auth.uid();
  caller_client_id    uuid;
  caller_org_id       uuid;
  resolved_type_name  text;
  slot_open           boolean;
  new_appointment_id  uuid;
  reminder_at         timestamptz;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_session_type_id IS NULL THEN
    RAISE EXCEPTION 'session_type_id required';
  END IF;
  IF p_staff_user_id IS NULL THEN
    RAISE EXCEPTION 'staff_user_id required';
  END IF;
  IF p_start_at IS NULL OR p_end_at IS NULL THEN
    RAISE EXCEPTION 'start_at and end_at required';
  END IF;
  IF p_end_at <= p_start_at THEN
    RAISE EXCEPTION 'end_at must be after start_at';
  END IF;
  IF p_start_at < now() THEN
    RAISE EXCEPTION 'cannot book in the past';
  END IF;

  SELECT c.id, c.organization_id
    INTO caller_client_id, caller_org_id
    FROM clients c
   WHERE c.user_id    = caller_id
     AND c.deleted_at IS NULL
   LIMIT 1;

  IF caller_client_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no client record';
  END IF;

  SELECT st.name
    INTO resolved_type_name
    FROM session_types st
   WHERE st.id              = p_session_type_id
     AND st.organization_id = caller_org_id
     AND st.deleted_at      IS NULL;

  IF resolved_type_name IS NULL THEN
    RAISE EXCEPTION 'session_type not available for this organization';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM user_organization_roles uor
     WHERE uor.user_id         = p_staff_user_id
       AND uor.organization_id = caller_org_id
       AND uor.role            IN ('owner', 'staff')
  ) THEN
    RAISE EXCEPTION 'staff_user_id is not a member of this organization';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.client_available_slots(p_start_at, p_end_at) s
     WHERE s.staff_user_id = p_staff_user_id
       AND s.slot_start    = p_start_at
       AND s.slot_end      = p_end_at
  ) INTO slot_open;

  IF NOT slot_open THEN
    RAISE EXCEPTION 'slot no longer available'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Phase F-5: stamp created_by_role := 'client_portal' so the staff
  -- schedule can render the Odyssey brand mark without a join to
  -- audit_log.
  INSERT INTO appointments (
    organization_id,
    client_id,
    staff_user_id,
    start_at,
    end_at,
    appointment_type,
    status,
    confirmed_at,
    created_by_role
  )
  VALUES (
    caller_org_id,
    caller_client_id,
    p_staff_user_id,
    p_start_at,
    p_end_at,
    resolved_type_name,
    'confirmed',
    now(),
    'client_portal'
  )
  RETURNING id INTO new_appointment_id;

  reminder_at := p_start_at - interval '24 hours';
  IF reminder_at > now() THEN
    INSERT INTO appointment_reminders (
      appointment_id,
      reminder_type,
      provider,
      scheduled_for
    ) VALUES (
      new_appointment_id,
      'reminder_24h_email',
      'resend',
      reminder_at
    );
  END IF;

  RETURN new_appointment_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.client_book_appointment(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.client_book_appointment(uuid, uuid, timestamptz, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.client_book_appointment(uuid, uuid, timestamptz, timestamptz) IS
  'Atomically books an appointment for the calling client. Re-checks slot availability at insert time (race guard), validates session_type and staff are in the caller''s org, INSERTs with status=confirmed and created_by_role=client_portal, enqueues the T-24h reminder.';


-- ----------------------------------------------------------------------------
-- 4. client_cancel_appointment — UPDATE now records cancelled_by_role
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.client_cancel_appointment(uuid);

CREATE OR REPLACE FUNCTION public.client_cancel_appointment(
  p_appointment_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_id        uuid := auth.uid();
  appt_start       timestamptz;
  appt_status      text;
  appt_owner_user  uuid;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_appointment_id IS NULL THEN
    RAISE EXCEPTION 'appointment_id required';
  END IF;

  SELECT a.start_at, a.status::text, c.user_id
    INTO appt_start, appt_status, appt_owner_user
    FROM appointments a
    JOIN clients      c ON c.id = a.client_id
   WHERE a.id          = p_appointment_id
     AND a.deleted_at  IS NULL
     AND c.deleted_at  IS NULL;

  IF appt_start IS NULL THEN
    RAISE EXCEPTION 'appointment not found';
  END IF;

  IF appt_owner_user IS DISTINCT FROM caller_id THEN
    RAISE EXCEPTION 'not authorised to cancel this appointment'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF appt_status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'appointment is already % — nothing to cancel', appt_status;
  END IF;

  IF appt_start - now() < interval '24 hours' THEN
    RAISE EXCEPTION 'cannot cancel within 24 hours of the appointment'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Phase F-5: stamp cancelled_by_role := 'client_portal'. The
  -- field-lockdown trigger permits this set because status is also
  -- flipping from non-cancelled → cancelled in the SAME UPDATE.
  UPDATE appointments
     SET status              = 'cancelled',
         cancelled_at        = now(),
         cancellation_reason = 'cancelled by client',
         cancelled_by_role   = 'client_portal'
   WHERE id = p_appointment_id;

  UPDATE appointment_reminders
     SET status = 'cancelled'
   WHERE appointment_id = p_appointment_id
     AND status         = 'scheduled';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.client_cancel_appointment(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.client_cancel_appointment(uuid) TO authenticated;

COMMENT ON FUNCTION public.client_cancel_appointment(uuid) IS
  'Caller cancels their own appointment. Enforces the 24-hour cutoff at the DB layer; flips status to cancelled, stamps cancelled_by_role=client_portal, and cancels any queued reminder rows in the same transaction.';
