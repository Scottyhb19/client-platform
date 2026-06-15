-- ============================================================================
-- 20260615130000_appointment_no_staff_overlap
-- ============================================================================
-- Section 9 (Scheduling) — P1-4 (FM-5). A DB-level double-booking backstop.
--
-- WHY. appointments had no constraint preventing two pending/confirmed bookings
-- for the same staff member from overlapping in time. client_book_appointment's
-- only guard was a SELECT EXISTS over client_available_slots at insert time —
-- under READ COMMITTED two concurrent transactions both pass that check before
-- either commits (the TOCTOU race; the comment at 20260510120000:121-122 that
-- "the second sees the just-inserted appointment" is FALSE for concurrent
-- inserts). The staff write paths (createAppointmentAction,
-- updateAppointmentTimeAction) had no overlap check at all and shared no lock
-- with the portal path, so a client-vs-staff cross-path collision was wide open.
--
-- FIX. An EXCLUDE constraint is the single authority that closes the race for
-- every path at once (mirrors programs_no_active_overlap, 20260503110000).
-- btree_gist lets us mix the equality match on staff_user_id with the
-- range-overlap match on the time interval.
--
-- DELIBERATE EXEMPTIONS baked into the WHERE:
--   - status IN ('pending','confirmed') only — a cancelled/no_show/completed
--     row never blocks a new booking, so a *replacement* can be booked over a
--     cancelled appointment (this is what enables the P2-8 side-by-side view).
--   - deleted_at IS NULL — soft-deleted rows are ignored.
--   The predicate is identical to appointments_reminder_scan_idx (20260420102000)
--   so the index already backs this access shape.
--
-- P1-7 DEPENDENCY. When the "Unavailable" appointment kind lands (P1-7), this
-- constraint must be RECREATED with an additional `AND kind = 'appointment'`
-- (or `kind <> 'unavailable'`) in the WHERE, so admin/meeting/note blocks may
-- sit beside a client appointment. The `kind` column does not exist yet, so it
-- is intentionally absent here — see docs/polish/scheduling.md P1-4/P1-7.
--
-- LIVE-DB BACKWARD COMPATIBILITY (shared dev/prod). The deployed master
-- frontend can still create overlaps only via a true race (the portal slot
-- re-check prevents the common case); after this lands such a race raises 23P01
-- instead of succeeding. The currently-deployed client_book_appointment does
-- not catch 23P01, so a racing portal booking would see a raw error until the
-- section-9 frontend deploys — harmless (no double-booking is created; that is
-- the point) and rare at friends-and-family scale. No signature change; no type
-- regen. A live probe on 2026-06-15 confirmed zero existing overlapping
-- pending/confirmed pairs, so ADD CONSTRAINT validates cleanly.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1. btree_gist — already installed for programs_no_active_overlap; idempotent.
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;


-- ----------------------------------------------------------------------------
-- §2. The non-overlap EXCLUDE constraint.
-- ----------------------------------------------------------------------------
ALTER TABLE appointments
  ADD CONSTRAINT appointments_no_staff_overlap
  EXCLUDE USING gist (
    staff_user_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  ) WHERE (
    status IN ('pending', 'confirmed')
    AND deleted_at IS NULL
  );

COMMENT ON CONSTRAINT appointments_no_staff_overlap ON appointments IS
  'Two pending/confirmed bookings for the same staff member cannot overlap in time (half-open [) so back-to-back is allowed). Cancelled/no_show/completed and soft-deleted rows are exempt (a replacement may be booked over a cancelled slot). Section 9 P1-4 / FM-5, 2026-06-15. P1-7 must recreate this with an AND kind = ''appointment'' clause once the Unavailable kind exists.';


-- ----------------------------------------------------------------------------
-- §3. client_book_appointment — catch the constraint''s exclusion_violation
-- (the genuine concurrent race) and surface the same "slot no longer available"
-- error the in-body slot re-check already raises, so the portal shows one clean
-- message either way. Body reproduced from 20260513130000 (the latest version,
-- per project memory `project_migration_function_body_parse`) with only the
-- trailing EXCEPTION block added.
--
-- CREATE OR REPLACE re-trips the Supabase anon auto-grant, so the P0-1 revoke
-- (20260615120000) is re-asserted at the bottom — without it this migration
-- would silently re-grant anon EXECUTE (pgTAP 26 would catch it, but we bake it
-- in). No signature change.
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

EXCEPTION
  -- P1-4: the appointments_no_staff_overlap EXCLUDE constraint fired — a
  -- concurrent transaction booked the same staff slot between our slot
  -- re-check and this INSERT (the genuine TOCTOU race the SELECT-EXISTS guard
  -- cannot close under READ COMMITTED). Surface the same error the re-check
  -- uses so the portal shows one consistent message.
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'slot no longer available'
      USING ERRCODE = 'check_violation';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.client_book_appointment(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.client_book_appointment(uuid, uuid, timestamptz, timestamptz) FROM anon;
GRANT  EXECUTE ON FUNCTION public.client_book_appointment(uuid, uuid, timestamptz, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.client_book_appointment(uuid, uuid, timestamptz, timestamptz) IS
  'Atomically books an appointment for the calling client. Re-checks slot availability at insert time and is backstopped by the appointments_no_staff_overlap EXCLUDE constraint (P1-4) — a concurrent race that beats the re-check raises exclusion_violation, caught here and re-surfaced as "slot no longer available". Validates session_type and staff are in the caller''s org, INSERTs status=confirmed + created_by_role=client_portal, enqueues the T-24h reminder. anon EXECUTE revoked (P0-1).';
