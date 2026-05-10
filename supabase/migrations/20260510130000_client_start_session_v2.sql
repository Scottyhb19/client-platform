-- ============================================================================
-- 20260510130000_client_start_session_v2
-- ============================================================================
-- Why: Two RPCs in 20260420102500_client_portal_functions.sql still walk
-- the program_days → program_weeks → programs chain via INNER JOIN. Post
-- D-PROG-001 (see docs/schema.md §3.4 line 141 + §10 lines 519-520),
-- program_days carries program_id directly and program_week_id is NULLABLE
-- (NULL on copy/repeat-created days). Any INNER JOIN against program_weeks
-- silently drops those days. Symptom in the portal:
--
--   "Can't start this session — No active program day for this caller"
--
-- when the day was created via "copy day" or "repeat block". The day
-- exists, the user owns it, RLS allows it; the join just discards the row.
--
-- Both functions in this migration use CREATE OR REPLACE — name + arity +
-- return shape are unchanged, so no DROP needed and supabase-js call sites
-- don't change. (Per the project memory note `plpgsql function arity
-- evolution`, DROP is only required when the signature itself shifts.)
--
-- 1. client_start_session — the load-bearing fix. Switches to
--    program_days.program_id direct.
--
-- 2. client_list_program_days — same hazard, defensive sweep. Uses LEFT
--    JOIN program_weeks so week_number remains accessible when present
--    (NULL on copy/repeat-created days). No TS code currently calls this
--    function (verified via grep), but leaving the broken JOIN behind would
--    mask the same class of bug if/when a caller appears.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. client_start_session(program_day_id) — v2
-- Walks via program_days.program_id direct. program_weeks dropped from the
-- join chain entirely.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.client_start_session(p_program_day_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_id        uuid := auth.uid();
  found_client_id  uuid;
  program_org_id   uuid;
  new_session_id   uuid;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Resolve client_id + program org. Walks via pd.program_id (post-D-PROG-001),
  -- so copy/repeat-created days with NULL program_week_id are no longer dropped.
  SELECT c.id, p.organization_id
    INTO found_client_id, program_org_id
    FROM program_days pd
    JOIN programs p ON p.id = pd.program_id
    JOIN clients c  ON c.id = p.client_id
   WHERE pd.id           = p_program_day_id
     AND c.user_id       = caller_id
     AND c.deleted_at    IS NULL
     AND p.status        = 'active'
     AND p.deleted_at    IS NULL
     AND pd.deleted_at   IS NULL;

  IF found_client_id IS NULL THEN
    RAISE EXCEPTION 'No active program day for this caller';
  END IF;

  -- Refuse if an in-progress session already exists for this client
  IF EXISTS (
    SELECT 1 FROM sessions
     WHERE client_id    = found_client_id
       AND completed_at IS NULL
       AND deleted_at   IS NULL
  ) THEN
    RAISE EXCEPTION 'A session is already in progress'
      USING HINT = 'Resume or complete the in-progress session before starting a new one.';
  END IF;

  INSERT INTO sessions (organization_id, client_id, program_day_id, started_at)
  VALUES (program_org_id, found_client_id, p_program_day_id, now())
  RETURNING id INTO new_session_id;

  RETURN new_session_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.client_start_session(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.client_start_session(uuid) TO authenticated;

COMMENT ON FUNCTION public.client_start_session(uuid) IS
  'Begin a training session for the caller against their own active program day. Refuses if another session is in progress. Walks via program_days.program_id direct (post-D-PROG-001) — no longer joins program_weeks, so copy/repeat-created days work.';


-- ----------------------------------------------------------------------------
-- 2. client_list_program_days(program_id) — defensive sweep
-- Same fix shape: walk via program_days.program_id direct. program_weeks
-- becomes a LEFT JOIN so week_number stays available when present and is
-- NULL on copy/repeat-created days.
--
-- day_of_week was dropped from program_days in 20260503100000 (the
-- scheduled_date migration); the original RPC return shape kept it as a
-- column. Derive it from scheduled_date here using ISODOW (Mon=1..Sun=7,
-- shifted to Mon=0..Sun=6 to match the historic convention from
-- 20260420101800_programs.sql line 116). Return shape unchanged so the
-- function signature stays CREATE OR REPLACE-able with no DROP.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.client_list_program_days(p_program_id uuid)
RETURNS TABLE (
  program_day_id     uuid,
  week_number        smallint,
  day_label          text,
  sort_order         int,
  day_of_week        smallint,
  exercise_count     int
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    pd.id                                                  AS program_day_id,
    pw.week_number,
    pd.day_label,
    pd.sort_order,
    (EXTRACT(ISODOW FROM pd.scheduled_date)::int - 1)::smallint AS day_of_week,
    (
      SELECT count(*)::int FROM program_exercises pe
       WHERE pe.program_day_id = pd.id AND pe.deleted_at IS NULL
    )                                                      AS exercise_count
  FROM program_days pd
  JOIN programs p          ON p.id  = pd.program_id
  JOIN clients c           ON c.id  = p.client_id
  LEFT JOIN program_weeks pw
                           ON pw.id = pd.program_week_id
                          AND pw.deleted_at IS NULL
  WHERE p.id           = p_program_id
    AND c.user_id      = auth.uid()
    AND c.deleted_at   IS NULL
    AND p.status       IN ('active', 'archived')
    AND p.deleted_at   IS NULL
    AND pd.deleted_at  IS NULL
  ORDER BY pd.sort_order;
$$;

REVOKE EXECUTE ON FUNCTION public.client_list_program_days(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.client_list_program_days(uuid) TO authenticated;

COMMENT ON FUNCTION public.client_list_program_days(uuid) IS
  'Lists days in the caller''s own active/archived program. Walks via program_days.program_id direct (post-D-PROG-001); program_weeks LEFT-JOINed for week_number — NULL on copy/repeat-created days. Pins to auth.uid() in the join.';
