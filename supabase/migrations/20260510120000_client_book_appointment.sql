-- ============================================================================
-- 20260510120000_client_book_appointment
-- ============================================================================
-- Why: Client portal booking flow (Phase F). Two RPCs:
--
--   1. client_book_appointment — atomically: re-checks the slot is still
--      open (race guard against concurrent booking), looks up the
--      session_type's display name, INSERTs the appointment with
--      status='confirmed', and enqueues an appointment_reminders row for
--      T-24h delivery.
--
--   2. client_cancel_appointment — enforces the 24-hour cutoff at the DB
--      layer, flips status to cancelled, and marks any queued reminder
--      rows as cancelled in the same transaction.
--
-- Both functions are SECURITY DEFINER pinned to auth.uid() — same posture as
-- the existing client_start_session / client_log_set / client_complete_session
-- family in 20260420102500_client_portal_functions.sql. Slot computation
-- reuses the existing client_available_slots(from, to) function rather than
-- duplicating the materialization logic.
--
-- Audit: 'appointments' and 'appointment_reminders' are already in
-- audit_resolve_org_id's CASE list (see 20260420102300 §7) and have audit
-- triggers attached (lines 419-425 of 20260420102300). No additional audit
-- registration needed.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. client_book_appointment
-- ----------------------------------------------------------------------------
-- Defensive DROP — these are new functions but we follow the established
-- arity-evolution pattern so a future signature change can use the same shape.
DROP FUNCTION IF EXISTS public.client_book_appointment(uuid, uuid, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.client_book_appointment(
  p_session_type_id uuid,
  p_staff_user_id   uuid,
  p_start_at        timestamptz,
  p_end_at          timestamptz
)
RETURNS uuid  -- the new appointments.id
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

  -- Basic shape checks.
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

  -- Resolve caller's client row + org. Pinning via auth.uid() means a
  -- compromised JWT claim (e.g. spoofed organization_id) can't redirect
  -- this booking to another tenant's calendar.
  SELECT c.id, c.organization_id
    INTO caller_client_id, caller_org_id
    FROM clients c
   WHERE c.user_id    = caller_id
     AND c.deleted_at IS NULL
   LIMIT 1;

  IF caller_client_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no client record';
  END IF;

  -- Validate session_type belongs to the caller's org. Stops a malicious
  -- caller from passing another tenant's session_type_id and mislabelling
  -- their booking.
  SELECT st.name
    INTO resolved_type_name
    FROM session_types st
   WHERE st.id              = p_session_type_id
     AND st.organization_id = caller_org_id
     AND st.deleted_at      IS NULL;

  IF resolved_type_name IS NULL THEN
    RAISE EXCEPTION 'session_type not available for this organization';
  END IF;

  -- Validate staff_user_id is a member of the caller's org. The
  -- appointments_enforce_client_org trigger covers client_id↔org but not
  -- staff_user_id↔org. A booking against a foreign-org staff would otherwise
  -- silently skew the staff schedule.
  IF NOT EXISTS (
    SELECT 1 FROM user_organization_roles uor
     WHERE uor.user_id         = p_staff_user_id
       AND uor.organization_id = caller_org_id
       AND uor.role            IN ('owner', 'staff')
  ) THEN
    RAISE EXCEPTION 'staff_user_id is not a member of this organization';
  END IF;

  -- Race-condition guard: re-run the slot availability check at insert
  -- time. Reusing client_available_slots means the validation is by
  -- definition consistent with the slots the picker showed the user.
  -- If two clients race for the same slot, only the first INSERT wins;
  -- the second sees the just-inserted appointment in the overlap check.
  SELECT EXISTS (
    SELECT 1
      FROM public.client_available_slots(p_start_at, p_end_at) s
     WHERE s.staff_user_id = p_staff_user_id
       AND s.slot_start    = p_start_at
       AND s.slot_end      = p_end_at
  ) INTO slot_open;

  IF NOT slot_open THEN
    -- Specific message + SQLSTATE so the server action can surface a
    -- "slot no longer available — pick another" inline error.
    RAISE EXCEPTION 'slot no longer available'
      USING ERRCODE = 'check_violation';
  END IF;

  -- INSERT the appointment. RLS already permits client INSERT here
  -- (rls_enable_and_policies.sql:1054), but we run as DEFINER so the
  -- earlier read of availability_rules (inside client_available_slots)
  -- doesn't need a separate path. status='confirmed' per locked decision
  -- L3 (instant confirm).
  INSERT INTO appointments (
    organization_id,
    client_id,
    staff_user_id,
    start_at,
    end_at,
    appointment_type,
    status,
    confirmed_at
  )
  VALUES (
    caller_org_id,
    caller_client_id,
    p_staff_user_id,
    p_start_at,
    p_end_at,
    resolved_type_name,
    'confirmed',
    now()
  )
  RETURNING id INTO new_appointment_id;

  -- Enqueue the T-24h reminder. If the booking is already inside the
  -- 24h window we don't enqueue (the worker would never fire it). The
  -- UNIQUE (appointment_id, reminder_type) constraint stops accidental
  -- double-enqueues if this RPC is ever retried.
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
  'Atomically books an appointment for the calling client. Re-checks slot availability at insert time (race guard), validates session_type and staff are in the caller''s org, INSERTs with status=confirmed, enqueues the T-24h reminder.';


-- ----------------------------------------------------------------------------
-- 2. client_cancel_appointment
-- ----------------------------------------------------------------------------
-- 24h cutoff is enforced here, not in RLS. The existing "client cancels own
-- appointment" UPDATE policy plus the appointments_client_field_lockdown
-- trigger prevent any field change other than status/cancelled_at/
-- cancellation_reason — so we don't need to re-enforce that. We only add
-- the time-window check.
--
-- DEFINER (rather than INVOKER) because we also UPDATE appointment_reminders,
-- which RLS denies for any authenticated user (only service-role writes).
-- The auth.uid() pin at the head replaces what RLS would have done.
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

  -- Resolve the appointment + confirm caller owns it via clients.user_id.
  -- Stops a client from cancelling someone else's appointment even if they
  -- guess the UUID.
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

  -- 24-hour cutoff. Specific SQLSTATE so the UI can branch to the
  -- "message your EP" path on this one error class.
  IF appt_start - now() < interval '24 hours' THEN
    RAISE EXCEPTION 'cannot cancel within 24 hours of the appointment'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Flip the appointment.
  UPDATE appointments
     SET status              = 'cancelled',
         cancelled_at        = now(),
         cancellation_reason = 'cancelled by client'
   WHERE id = p_appointment_id;

  -- Cancel any still-scheduled reminder rows so the worker doesn't fire
  -- them. status here is appointment_reminder_status; 'failed' would be
  -- wrong; the schema's enum covers scheduled/sent/delivered/failed/
  -- bounced/cancelled — we mark cancelled.
  UPDATE appointment_reminders
     SET status = 'cancelled'
   WHERE appointment_id = p_appointment_id
     AND status         = 'scheduled';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.client_cancel_appointment(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.client_cancel_appointment(uuid) TO authenticated;

COMMENT ON FUNCTION public.client_cancel_appointment(uuid) IS
  'Caller cancels their own appointment. Enforces the 24-hour cutoff at the DB layer; flips status to cancelled and cancels any queued reminder rows in the same transaction.';
