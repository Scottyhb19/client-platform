-- ============================================================================
-- 20260615170000_appointment_reminder_lifecycle
-- ============================================================================
-- Section 9 (Scheduling) — P1-2 + P1-3 (FM-3, FM-4) + wires P2-3.
--
-- BEFORE. Only client_book_appointment (the portal path) enqueued a T-24h
-- reminder, inline. Staff-created appointments (createAppointmentAction — the
-- dominant booking path) enqueued nothing, so those clients were never
-- reminded → no-shows (FM-3). Reschedule left the reminder at the old time and
-- staff-cancel left it 'scheduled', relying solely on the Edge Function's
-- status re-check (FM-4). And the reminder lead was hard-coded 24h while
-- organizations.reminder_lead_hours sat ignored (FM-10 / P2-3).
--
-- AFTER. One DB-owned mechanism for every path. An AFTER INSERT OR UPDATE OF
-- start_at, status trigger on appointments:
--   • enqueues a reminder at start_at − reminder_lead_hours (default 24h) for a
--     live, future, client (kind='appointment') booking — covering the portal,
--     the staff composer, and the future Bookings tab uniformly;
--   • re-times it on reschedule (start_at change), clearing any sent/failed
--     state so the cron re-sends for the new time;
--   • cancels the queued reminder when the appointment leaves the live set
--     (cancelled / no_show / completed / soft-deleted / flipped to unavailable).
-- Unavailable-kind blocks never get a reminder (no client).
--
-- reminder_type stays 'reminder_24h_email' (the enum value); the "24h" is now
-- cosmetic since the lead is configurable (P2-3 left it as a label).
--
-- client_book_appointment is recreated to DROP its inline enqueue (the trigger
-- now owns it; keeping both would 23505 on the UNIQUE(appointment_id,
-- reminder_type)). Backward-compatible: the deployed portal still gets a
-- reminder — now via the trigger. Re-asserts the P0-1 anon revoke.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1. The reminder lifecycle trigger function. SECURITY DEFINER so it can read
-- organizations and write appointment_reminders regardless of the caller's RLS
-- (reminders are system-managed; no authenticated INSERT policy exists).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.appointment_manage_reminder()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lead int;
  v_at   timestamptz;
BEGIN
  -- Not a live, client-facing booking → cancel any queued reminder.
  IF NEW.kind <> 'appointment'
     OR NEW.status NOT IN ('pending', 'confirmed')
     OR NEW.deleted_at IS NOT NULL THEN
    UPDATE appointment_reminders
       SET status = 'cancelled'
     WHERE appointment_id = NEW.id
       AND reminder_type  = 'reminder_24h_email'
       AND status         = 'scheduled';
    RETURN NEW;
  END IF;

  SELECT COALESCE(o.reminder_lead_hours, 24)
    INTO v_lead
    FROM organizations o
   WHERE o.id = NEW.organization_id;

  v_at := NEW.start_at - (COALESCE(v_lead, 24) * interval '1 hour');

  -- Too late to remind (lead window already passed) → cancel any scheduled one.
  IF v_at <= now() THEN
    UPDATE appointment_reminders
       SET status = 'cancelled'
     WHERE appointment_id = NEW.id
       AND reminder_type  = 'reminder_24h_email'
       AND status         = 'scheduled';
    RETURN NEW;
  END IF;

  -- Enqueue (INSERT) or re-time (UPDATE) the single reminder for this booking,
  -- resetting send state so a reschedule re-sends for the new time.
  INSERT INTO appointment_reminders (
    appointment_id, reminder_type, provider, scheduled_for, status
  ) VALUES (
    NEW.id, 'reminder_24h_email', 'resend', v_at, 'scheduled'
  )
  ON CONFLICT (appointment_id, reminder_type) DO UPDATE
    SET scheduled_for  = EXCLUDED.scheduled_for,
        status         = 'scheduled',
        sent_at        = NULL,
        delivered_at   = NULL,
        failed_at      = NULL,
        failure_reason = NULL,
        retry_count    = 0;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.appointment_manage_reminder() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.appointment_manage_reminder() IS
  'Trigger: maintains the single T-(reminder_lead_hours) email reminder for a client appointment across every write path — enqueue on insert, re-time on reschedule, cancel when it leaves the live set. Unavailable-kind blocks get none. Section 9 P1-2/P1-3, wires reminder_lead_hours (P2-3).';

DROP TRIGGER IF EXISTS appointments_manage_reminder ON appointments;
CREATE TRIGGER appointments_manage_reminder
  AFTER INSERT OR UPDATE OF start_at, status ON appointments
  FOR EACH ROW EXECUTE FUNCTION public.appointment_manage_reminder();


-- ----------------------------------------------------------------------------
-- §2. client_book_appointment — drop the inline reminder enqueue (the trigger
-- owns it now). Body reproduced from 20260615140100 minus the reminder block
-- and its reminder_at variable. Re-asserts the P0-1 anon revoke.
-- ----------------------------------------------------------------------------
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

  -- P1-6: re-check via the 3-arg per-type slot generator (the booking's own
  -- length), so a 30/45-min booking on the 15-minute grid validates.
  SELECT EXISTS (
    SELECT 1
      FROM public.client_available_slots(
             p_start_at,
             p_end_at,
             (EXTRACT(EPOCH FROM (p_end_at - p_start_at)) / 60)::int
           ) s
     WHERE s.staff_user_id = p_staff_user_id
       AND s.slot_start    = p_start_at
       AND s.slot_end      = p_end_at
  ) INTO slot_open;

  IF NOT slot_open THEN
    RAISE EXCEPTION 'slot no longer available'
      USING ERRCODE = 'check_violation';
  END IF;

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

  -- Reminder is enqueued by the appointments_manage_reminder trigger (P1-2),
  -- not here, so every booking path shares one mechanism.

  RETURN new_appointment_id;

EXCEPTION
  -- P1-4: a concurrent transaction won the same staff slot between the
  -- re-check and this INSERT (exclusion_violation). Surface the same error.
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'slot no longer available'
      USING ERRCODE = 'check_violation';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.client_book_appointment(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.client_book_appointment(uuid, uuid, timestamptz, timestamptz) FROM anon;
GRANT  EXECUTE ON FUNCTION public.client_book_appointment(uuid, uuid, timestamptz, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.client_book_appointment(uuid, uuid, timestamptz, timestamptz) IS
  'Atomically books an appointment for the calling client. Re-checks availability via the 3-arg per-type client_available_slots (P1-6), backstopped by the appointments_no_staff_overlap EXCLUDE constraint (P1-4). The T-lead reminder is enqueued by the appointments_manage_reminder trigger (P1-2), not inline. anon EXECUTE revoked (P0-1).';
