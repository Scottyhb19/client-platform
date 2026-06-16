-- ============================================================================
-- 20260615180000_availability_close_a_date
-- ============================================================================
-- Section 9 (Scheduling) — P1-5 (FM-6). Negative availability: "close a date".
--
-- BEFORE. availability_rules were additive only — a one-off rule could ADD a
-- window, never subtract one. On a public holiday / sick day / leave the
-- recurring weekly rule kept generating bookable slots and a client could book
-- into a closed clinic. The documented AVL-1 workaround ("book yourself an
-- Unavailable appointment") was non-buildable (client_id was NOT NULL — now
-- relaxed by P1-7, but the clean whole-day mechanism is this).
--
-- AFTER. availability_rules.is_blocked. A one-off rule with is_blocked=true
-- SUBTRACTS its window from the generated slots (the mirror of the positive
-- one-off). The "Close a date" editor action writes whole-day blocks
-- (00:00–23:59:59) by default, or a partial window; a date range fans out to
-- one blocked row per day.
--
-- The 3-arg client_available_slots (P1-6) is taught to subtract blocked
-- windows. Only the 3-arg: closures are produced by the new availability editor
-- and consumed by the new picker, both landing at deploy #1; the 2-arg bridge
-- has no closure producer/consumer while it lives and is dropped post-deploy.
--
-- The partial unique index (20260511120000) deliberately does NOT include
-- is_blocked — a positive one-off and a whole-day closure at the identical
-- window is not a realistic shape, so the column stays out of the key.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1. The negative-availability flag.
-- ----------------------------------------------------------------------------
ALTER TABLE availability_rules
  ADD COLUMN is_blocked boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN availability_rules.is_blocked IS
  'true = a one-off rule that SUBTRACTS its window from generated slots (a date closure / leave), false = a positive availability window. Section 9 P1-5.';


-- ----------------------------------------------------------------------------
-- §2. client_available_slots (3-arg) — positive rules now exclude is_blocked,
-- and a blocks CTE subtracts closed windows before the appointment filter.
-- Body reproduced from 20260615140000 with those two changes.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.client_available_slots(
  p_from         timestamptz,
  p_to           timestamptz,
  p_slot_minutes integer
)
RETURNS TABLE (
  staff_user_id   uuid,
  slot_start      timestamptz,
  slot_end        timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_id   uuid := auth.uid();
  caller_org  uuid;
  caller_tz   text;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN
    RAISE EXCEPTION 'from must precede to';
  END IF;

  IF p_to - p_from > interval '90 days' THEN
    RAISE EXCEPTION 'Range too large (max 90 days)';
  END IF;

  IF p_slot_minutes IS NULL OR p_slot_minutes < 5 OR p_slot_minutes > 240 THEN
    RAISE EXCEPTION 'slot minutes must be between 5 and 240';
  END IF;

  SELECT c.organization_id, o.timezone
    INTO caller_org, caller_tz
    FROM clients c
    JOIN organizations o ON o.id = c.organization_id
   WHERE c.user_id    = caller_id
     AND c.deleted_at IS NULL
   LIMIT 1;

  IF caller_org IS NULL THEN
    RAISE EXCEPTION 'Caller has no client record';
  END IF;

  RETURN QUERY
  WITH rules AS (
    SELECT ar.*
      FROM availability_rules ar
     WHERE ar.organization_id = caller_org
       AND ar.deleted_at      IS NULL
       AND ar.is_blocked      = false
       AND ar.effective_from <= (p_to AT TIME ZONE caller_tz)::date
       AND (ar.effective_to IS NULL OR ar.effective_to >= (p_from AT TIME ZONE caller_tz)::date)
  ),
  day_grid AS (
    SELECT generate_series(
             (p_from AT TIME ZONE caller_tz)::date,
             (p_to   AT TIME ZONE caller_tz)::date,
             interval '1 day'
           )::date AS d
  ),
  candidates AS (
    -- Weekly rules materialized over the grid.
    SELECT
      r.staff_user_id,
      ((d.d || ' ' || r.start_time)::timestamp AT TIME ZONE caller_tz) AS window_start,
      ((d.d || ' ' || r.end_time)::timestamp   AT TIME ZONE caller_tz) AS window_end
    FROM rules r
    JOIN day_grid d ON r.recurrence = 'weekly'
                    AND EXTRACT(ISODOW FROM d.d)::int - 1 = r.day_of_week
    WHERE d.d BETWEEN r.effective_from
                  AND COALESCE(r.effective_to, d.d)

    UNION ALL

    -- One-off (positive) rules.
    SELECT
      r.staff_user_id,
      ((r.specific_date || ' ' || r.start_time)::timestamp AT TIME ZONE caller_tz),
      ((r.specific_date || ' ' || r.end_time)::timestamp   AT TIME ZONE caller_tz)
    FROM rules r
    WHERE r.recurrence = 'one_off'
      AND r.specific_date BETWEEN (p_from AT TIME ZONE caller_tz)::date
                              AND (p_to   AT TIME ZONE caller_tz)::date
  ),
  blocks AS (
    -- Date closures (is_blocked one-offs) subtract their window. P1-5.
    SELECT
      ar.staff_user_id,
      ((ar.specific_date || ' ' || ar.start_time)::timestamp AT TIME ZONE caller_tz) AS block_start,
      ((ar.specific_date || ' ' || ar.end_time)::timestamp   AT TIME ZONE caller_tz) AS block_end
    FROM availability_rules ar
   WHERE ar.organization_id = caller_org
     AND ar.deleted_at      IS NULL
     AND ar.is_blocked      = true
     AND ar.recurrence      = 'one_off'
     AND ar.specific_date BETWEEN (p_from AT TIME ZONE caller_tz)::date
                              AND (p_to   AT TIME ZONE caller_tz)::date
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
  SELECT DISTINCT
    s.staff_user_id,
    s.slot_start,
    s.slot_start + s.slot_len AS slot_end
  FROM slots s
  WHERE s.slot_start >= p_from
    AND s.slot_start +  s.slot_len <= p_to
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
  ORDER BY s.slot_start, s.staff_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.client_available_slots(timestamptz, timestamptz, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.client_available_slots(timestamptz, timestamptz, integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.client_available_slots(timestamptz, timestamptz, integer) TO authenticated;

COMMENT ON FUNCTION public.client_available_slots(timestamptz, timestamptz, integer) IS
  'Per-type booking slots (15-min step, P1-6) minus date closures (is_blocked one-offs, P1-5) and existing pending/confirmed appointments. anon EXECUTE revoked (P0-1).';
