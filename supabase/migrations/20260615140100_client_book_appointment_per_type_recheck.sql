-- ============================================================================
-- 20260615140100_client_book_appointment_per_type_recheck
-- ============================================================================
-- Section 9 (Scheduling) — P1-6 companion to 20260615140000.
--
-- WHY. client_book_appointment's in-body availability re-check called the
-- welded 2-arg client_available_slots(p_start_at, p_end_at), which only ever
-- yields slot-rule-length slots stepping by that same length. Once the picker
-- offers per-type durations on a 15-minute grid (20260615140000), a 30- or
-- 45-minute booking would never match a 2-arg slot row, so the re-check would
-- wrongly reject every non-welded booking with "slot no longer available".
--
-- FIX. Re-check via the 3-arg overload, passing the booking's OWN length as
-- p_slot_minutes — the generator then regenerates exactly this one candidate
-- slot [p_start_at, p_end_at] and validates it against availability + existing
-- appointments. This also validates the legacy deployed 60-minute portal
-- correctly (a 60-min booking → p_slot_minutes = 60), so it is backward
-- compatible with the currently-deployed frontend.
--
-- Body otherwise reproduced verbatim from 20260615130000 (P1-4): the
-- exclusion_violation EXCEPTION handler and all validations are unchanged. The
-- CREATE OR REPLACE re-trips the anon auto-grant, so the P0-1 revoke is
-- re-asserted at the bottom. No signature change; no type regen.
-- ============================================================================

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

  -- P1-6: re-check against the per-type slot generator. Pass the booking's own
  -- length as p_slot_minutes so the 3-arg overload regenerates exactly this
  -- candidate slot; the welded 2-arg form could not validate a 30/45-min
  -- booking on the 15-minute grid.
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

EXCEPTION
  -- P1-4: the appointments_no_staff_overlap EXCLUDE constraint fired — a
  -- concurrent transaction booked the same staff slot between our slot
  -- re-check and this INSERT. Surface the same error the re-check uses.
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'slot no longer available'
      USING ERRCODE = 'check_violation';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.client_book_appointment(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.client_book_appointment(uuid, uuid, timestamptz, timestamptz) FROM anon;
GRANT  EXECUTE ON FUNCTION public.client_book_appointment(uuid, uuid, timestamptz, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.client_book_appointment(uuid, uuid, timestamptz, timestamptz) IS
  'Atomically books an appointment for the calling client. Re-checks availability via the 3-arg per-type client_available_slots (P1-6) and is backstopped by the appointments_no_staff_overlap EXCLUDE constraint (P1-4, exclusion_violation re-surfaced as "slot no longer available"). Validates session_type and staff are in the caller''s org, INSERTs status=confirmed + created_by_role=client_portal, enqueues the T-24h reminder. anon EXECUTE revoked (P0-1).';
