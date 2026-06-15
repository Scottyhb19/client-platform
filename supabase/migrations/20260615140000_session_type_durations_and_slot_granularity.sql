-- ============================================================================
-- 20260615140000_session_type_durations_and_slot_granularity
-- ============================================================================
-- Section 9 (Scheduling) — P1-6 (FM-18). Decouple session length from the slot
-- step so the booking grid stops wasting the part-hour after a shorter session.
--
-- BEFORE. client_available_slots welded the slot STEP to the slot LENGTH, both
-- = availability_rules.slot_duration_minutes (20260511120000:297-302). A 60-min
-- rule therefore offered only hourly starts, and the "next available" after an
-- 11:00 booking was 12:00 — the half-hour the EP actually had free was
-- unbookable.
--
-- AFTER. Per-type duration on session_types + a fixed 15-minute step: starts
-- are generated every 15 min, each slot is the chosen type's length, and the
-- existing appointment-overlap subtraction frees the exact remainder — so a
-- 30-min type offers 11:30 after an 11:00 booking, a 45-min offers 11:45.
--
-- DEPLOY SKEW (shared dev/prod DB). The new behaviour needs the chosen type's
-- duration, so it is a NEW 3-arg overload `client_available_slots(timestamptz,
-- timestamptz, integer)`. The existing 2-arg function is left UNTOUCHED — the
-- currently-deployed portal calls it and must keep working until the section-9
-- frontend deploys. p_slot_minutes carries NO default, so a 2-arg call
-- ({p_from,p_to}) can only ever resolve to the 2-arg function and a 3-arg call
-- to the 3-arg — never ambiguous (cf. project memory
-- `plpgsql function arity evolution`). After deploy #1 a post-deploy migration
-- drops the 2-arg overload (tracked like the section-7 reschedule shim).
--
-- seed_organization_defaults is NOT rewritten here — P1-7 rewrites it once
-- (durations + the new `kind` column + the seeded Unavailable types). Until
-- then a brand-new org's seeded types take the 60-min column default; the
-- single live org is corrected by the §2 UPDATE below.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1. Per-type default duration.
-- ----------------------------------------------------------------------------
ALTER TABLE session_types
  ADD COLUMN default_duration_minutes smallint NOT NULL DEFAULT 60
    CHECK (default_duration_minutes BETWEEN 5 AND 240);

COMMENT ON COLUMN session_types.default_duration_minutes IS
  'Default appointment length in minutes for this type. The booking picker offers slots of this length on a 15-minute step (P1-6, 2026-06-15). EP-editable in Settings → Appointment types.';


-- ----------------------------------------------------------------------------
-- §2. Seed durations for the four default types on the live org(s). Matched by
-- name, case-insensitively, among un-deleted rows. Renamed/custom types keep
-- the 60-minute column default and are EP-editable.
-- ----------------------------------------------------------------------------
UPDATE session_types SET default_duration_minutes = 60
  WHERE lower(name) = 'initial assessment' AND deleted_at IS NULL;
UPDATE session_types SET default_duration_minutes = 45
  WHERE lower(name) = 'review'             AND deleted_at IS NULL;
UPDATE session_types SET default_duration_minutes = 45
  WHERE lower(name) = 'session'            AND deleted_at IS NULL;
UPDATE session_types SET default_duration_minutes = 30
  WHERE lower(name) = 'telehealth'         AND deleted_at IS NULL;


-- ----------------------------------------------------------------------------
-- §3. The 3-arg slot generator. Body mirrors the 2-arg DISTINCT version
-- (20260511120000) except: candidates no longer carry slot_duration_minutes;
-- starts step by a fixed 15 minutes; slot length = p_slot_minutes.
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

    -- One-off rules.
    SELECT
      r.staff_user_id,
      ((r.specific_date || ' ' || r.start_time)::timestamp AT TIME ZONE caller_tz),
      ((r.specific_date || ' ' || r.end_time)::timestamp   AT TIME ZONE caller_tz)
    FROM rules r
    WHERE r.recurrence = 'one_off'
      AND r.specific_date BETWEEN (p_from AT TIME ZONE caller_tz)::date
                              AND (p_to   AT TIME ZONE caller_tz)::date
  ),
  slots AS (
    -- 15-minute step (decoupled from the slot length); each slot is
    -- p_slot_minutes long. The last start is one slot-length before the
    -- window end so the slot fits inside the availability window.
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

-- Auto-grant trap: a freshly-created function grants EXECUTE to anon by
-- default. Strip it (P0-1 posture) and grant only authenticated.
REVOKE EXECUTE ON FUNCTION public.client_available_slots(timestamptz, timestamptz, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.client_available_slots(timestamptz, timestamptz, integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.client_available_slots(timestamptz, timestamptz, integer) TO authenticated;

COMMENT ON FUNCTION public.client_available_slots(timestamptz, timestamptz, integer) IS
  'Per-type booking slots: candidate starts every 15 minutes across the caller''s availability, each p_slot_minutes long, minus existing pending/confirmed appointments. The 3-arg successor to the welded 2-arg version (P1-6). anon EXECUTE revoked (P0-1). The 2-arg overload is retained as a deploy-skew bridge and dropped post-deploy.';
