-- ============================================================================
-- 20260616130000_staff_next_available_slot
-- ============================================================================
-- Section 9 (Scheduling) — P2-15 (Tools → Find next available).
--
-- The EP's "when's my next opening?" tool. client_available_slots is CLIENT-
-- scoped (it resolves the caller via the clients table and pins to the client's
-- org), so it cannot answer this for a staff member. This is its staff-scoped
-- sibling: same availability + closure + appointment-overlap logic, but scoped
-- to a staff_user_id in the CALLER's org, callable by authenticated owner/staff,
-- and returning only the SINGLE soonest open slot (LIMIT 1) within a bounded
-- 90-day forward window.
--
-- Additive + backward-compatible (deployed master never calls it). anon EXECUTE
-- revoked (P0-1 discipline: CREATE auto-grants it, and REVOKE FROM PUBLIC does
-- not strip the role-specific anon grant); the in-body auth.uid()/role guard
-- fails closed for anon regardless. Tripwire: pgTAP 26.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.staff_next_available_slot(
  p_staff_user_id uuid,
  p_from          timestamptz,
  p_slot_minutes  integer
)
RETURNS TABLE (
  slot_start timestamptz,
  slot_end   timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_id   uuid := auth.uid();
  caller_org  uuid := public.user_organization_id();
  caller_role text := public.user_role();
  caller_tz   text;
  v_to        timestamptz := p_from + interval '90 days';
BEGIN
  IF caller_id IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF caller_org IS NULL THEN
    RAISE EXCEPTION 'Caller has no organization';
  END IF;

  IF p_from IS NULL THEN
    RAISE EXCEPTION 'from is required';
  END IF;

  IF p_slot_minutes IS NULL OR p_slot_minutes < 5 OR p_slot_minutes > 240 THEN
    RAISE EXCEPTION 'slot minutes must be between 5 and 240';
  END IF;

  -- The target practitioner must belong to the caller's org (multi-tenant
  -- guard — an EP can only scan availability inside their own clinic).
  IF NOT EXISTS (
    SELECT 1 FROM user_organization_roles uor
     WHERE uor.user_id         = p_staff_user_id
       AND uor.organization_id = caller_org
       AND uor.role IN ('owner','staff')
  ) THEN
    RAISE EXCEPTION 'staff member not in your organization';
  END IF;

  SELECT o.timezone INTO caller_tz
    FROM organizations o WHERE o.id = caller_org;

  RETURN QUERY
  WITH rules AS (
    SELECT ar.*
      FROM availability_rules ar
     WHERE ar.organization_id = caller_org
       AND ar.staff_user_id   = p_staff_user_id
       AND ar.deleted_at      IS NULL
       AND ar.is_blocked      = false
       AND ar.effective_from <= (v_to AT TIME ZONE caller_tz)::date
       AND (ar.effective_to IS NULL OR ar.effective_to >= (p_from AT TIME ZONE caller_tz)::date)
  ),
  day_grid AS (
    SELECT generate_series(
             (p_from AT TIME ZONE caller_tz)::date,
             (v_to   AT TIME ZONE caller_tz)::date,
             interval '1 day'
           )::date AS d
  ),
  candidates AS (
    SELECT
      r.staff_user_id,
      ((d.d || ' ' || r.start_time)::timestamp AT TIME ZONE caller_tz) AS window_start,
      ((d.d || ' ' || r.end_time)::timestamp   AT TIME ZONE caller_tz) AS window_end
    FROM rules r
    JOIN day_grid d ON r.recurrence = 'weekly'
                    AND EXTRACT(ISODOW FROM d.d)::int - 1 = r.day_of_week
    WHERE d.d BETWEEN r.effective_from AND COALESCE(r.effective_to, d.d)

    UNION ALL

    SELECT
      r.staff_user_id,
      ((r.specific_date || ' ' || r.start_time)::timestamp AT TIME ZONE caller_tz),
      ((r.specific_date || ' ' || r.end_time)::timestamp   AT TIME ZONE caller_tz)
    FROM rules r
    WHERE r.recurrence = 'one_off'
      AND r.specific_date BETWEEN (p_from AT TIME ZONE caller_tz)::date
                              AND (v_to   AT TIME ZONE caller_tz)::date
  ),
  blocks AS (
    SELECT
      ar.staff_user_id,
      ((ar.specific_date || ' ' || ar.start_time)::timestamp AT TIME ZONE caller_tz) AS block_start,
      ((ar.specific_date || ' ' || ar.end_time)::timestamp   AT TIME ZONE caller_tz) AS block_end
    FROM availability_rules ar
   WHERE ar.organization_id = caller_org
     AND ar.staff_user_id   = p_staff_user_id
     AND ar.deleted_at      IS NULL
     AND ar.is_blocked      = true
     AND ar.recurrence      = 'one_off'
     AND ar.specific_date BETWEEN (p_from AT TIME ZONE caller_tz)::date
                             AND (v_to   AT TIME ZONE caller_tz)::date
  ),
  slots AS (
    SELECT
      c.staff_user_id,
      generate_series(
        c.window_start,
        c.window_end - (p_slot_minutes * interval '1 minute'),
        interval '15 minutes'
      ) AS slot_start,
      (p_slot_minutes * interval '1 minute') AS slot_len
    FROM candidates c
  )
  SELECT
    s.slot_start,
    s.slot_start + s.slot_len AS slot_end
  FROM slots s
  WHERE s.slot_start >= p_from
    AND s.slot_start + s.slot_len <= v_to
    AND NOT EXISTS (
      SELECT 1 FROM blocks b
       WHERE b.staff_user_id = s.staff_user_id
         AND tstzrange(b.block_start, b.block_end, '[)') &&
             tstzrange(s.slot_start, s.slot_start + s.slot_len, '[)')
    )
    AND NOT EXISTS (
      SELECT 1 FROM appointments a
       WHERE a.organization_id = caller_org
         AND a.staff_user_id   = s.staff_user_id
         AND a.status          IN ('pending', 'confirmed')
         AND a.deleted_at      IS NULL
         AND tstzrange(a.start_at, a.end_at, '[)') &&
             tstzrange(s.slot_start, s.slot_start + s.slot_len, '[)')
    )
  ORDER BY s.slot_start
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION public.staff_next_available_slot(uuid, timestamptz, integer) IS
  'Soonest open slot (LIMIT 1) for a staff member in the caller''s org within 90 days of p_from, minus closures + existing pending/confirmed appointments. Staff sibling of client_available_slots (Section 9 P2-15). Auth (org + owner/staff + target-in-org) checked in-body; anon EXECUTE revoked.';

REVOKE EXECUTE ON FUNCTION public.staff_next_available_slot(uuid, timestamptz, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.staff_next_available_slot(uuid, timestamptz, integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.staff_next_available_slot(uuid, timestamptz, integer) TO authenticated;
