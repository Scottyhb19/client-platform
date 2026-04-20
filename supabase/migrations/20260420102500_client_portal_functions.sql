-- ============================================================================
-- 20260420102500_client_portal_functions
-- ============================================================================
-- Why: The client portal reads/writes across joins (program_exercises ⇄
-- exercises, sessions ⇄ program_days, appointments ⇄ availability_rules)
-- that would be expensive or awkward to express as bare RLS. Each function
-- is a SECURITY DEFINER with:
--
--   - SET search_path = public, pg_temp             (injection hardening)
--   - auth.uid() pin on the FIRST operation         (defence in depth)
--   - explicit GRANT EXECUTE to authenticated only  (no anon, no public)
--
-- Together these functions are the ONLY paths clients take to data their
-- role cannot read directly via RLS (notably: exercises table, availability
-- slots).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. client_list_program_days(program_id)
-- Returns the training days belonging to the calling client's OWN program,
-- provided the program is active/archived (never draft).
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
    pd.day_of_week,
    (
      SELECT count(*)::int FROM program_exercises pe
       WHERE pe.program_day_id = pd.id AND pe.deleted_at IS NULL
    )                                                      AS exercise_count
  FROM program_days pd
  JOIN program_weeks pw ON pw.id = pd.program_week_id
  JOIN programs p       ON p.id  = pw.program_id
  JOIN clients c        ON c.id  = p.client_id
  WHERE p.id           = p_program_id
    AND c.user_id      = auth.uid()
    AND c.deleted_at   IS NULL
    AND p.status       IN ('active', 'archived')
    AND p.deleted_at   IS NULL
    AND pw.deleted_at  IS NULL
    AND pd.deleted_at  IS NULL
  ORDER BY pw.week_number, pd.sort_order;
$$;

REVOKE EXECUTE ON FUNCTION public.client_list_program_days(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.client_list_program_days(uuid) TO authenticated;

COMMENT ON FUNCTION public.client_list_program_days(uuid) IS
  'Lists days in the caller''s own active/archived program. Pins to auth.uid() in the join.';


-- ----------------------------------------------------------------------------
-- 2. client_get_program_day_exercises(program_day_id)
-- The load-bearing portal read: exercise prescription + exercise-library
-- details (name, video URL, instructions) joined and filtered to the
-- caller's own program.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.client_get_program_day_exercises(p_program_day_id uuid)
RETURNS TABLE (
  program_exercise_id   uuid,
  sort_order            int,
  section_title         text,
  superset_group_id     uuid,
  exercise_id           uuid,
  exercise_name         text,
  exercise_video_url    text,
  instructions          text,
  sets                  smallint,
  reps                  text,
  rest_seconds          int,
  rpe                   smallint,
  tempo                 text,
  optional_metric       text,
  optional_value        text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    pe.id                                                  AS program_exercise_id,
    pe.sort_order,
    pe.section_title,
    pe.superset_group_id,
    e.id                                                   AS exercise_id,
    e.name                                                 AS exercise_name,
    e.video_url                                            AS exercise_video_url,
    COALESCE(pe.instructions, e.instructions)              AS instructions,
    COALESCE(pe.sets,           e.default_sets)            AS sets,
    COALESCE(pe.reps,           e.default_reps)            AS reps,
    COALESCE(pe.rest_seconds,   e.default_rest_seconds)    AS rest_seconds,
    COALESCE(pe.rpe,            e.default_rpe)             AS rpe,
    pe.tempo,
    COALESCE(pe.optional_metric, e.default_metric)         AS optional_metric,
    COALESCE(pe.optional_value,  e.default_metric_value)   AS optional_value
  FROM program_exercises pe
  JOIN exercises          e  ON e.id  = pe.exercise_id
  JOIN program_days       pd ON pd.id = pe.program_day_id
  JOIN program_weeks      pw ON pw.id = pd.program_week_id
  JOIN programs           p  ON p.id  = pw.program_id
  JOIN clients            c  ON c.id  = p.client_id
  WHERE pd.id             = p_program_day_id
    AND c.user_id         = auth.uid()
    AND c.deleted_at      IS NULL
    AND p.status          IN ('active', 'archived')
    AND p.deleted_at      IS NULL
    AND pw.deleted_at     IS NULL
    AND pd.deleted_at     IS NULL
    AND pe.deleted_at     IS NULL
    AND e.deleted_at      IS NULL
  ORDER BY pe.sort_order;
$$;

REVOKE EXECUTE ON FUNCTION public.client_get_program_day_exercises(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.client_get_program_day_exercises(uuid) TO authenticated;

COMMENT ON FUNCTION public.client_get_program_day_exercises(uuid) IS
  'Returns exercise prescriptions + library details for a program day belonging to the caller. Uses COALESCE so per-exercise overrides win over library defaults.';


-- ----------------------------------------------------------------------------
-- 3. client_start_session(program_day_id)
-- Creates a sessions row for the caller. Refuses if a session is already
-- in progress for the same client (at most one in-progress session).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.client_start_session(p_program_day_id uuid)
RETURNS uuid  -- the new sessions.id
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

  -- Resolve client_id + program org, pinning to auth.uid().
  -- Two scalar targets — PL/pgSQL forbids a %ROWTYPE in a multi-INTO list.
  SELECT c.id, p.organization_id
    INTO found_client_id, program_org_id
    FROM program_days pd
    JOIN program_weeks pw ON pw.id = pd.program_week_id
    JOIN programs p       ON p.id  = pw.program_id
    JOIN clients c        ON c.id  = p.client_id
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
  'Begin a training session for the caller against their own active program day. Refuses if another session is in progress.';


-- ----------------------------------------------------------------------------
-- 4. client_log_set(...) — logs a set to the caller's in-progress session.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.client_log_set(
  p_session_id          uuid,
  p_program_exercise_id uuid,
  p_set_number          smallint,
  p_weight_value        numeric,
  p_weight_metric       text,
  p_reps_performed      smallint,
  p_optional_metric     text,
  p_optional_value      text,
  p_rpe                 smallint,
  p_notes               text
)
RETURNS uuid  -- the new set_logs.id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_id       uuid := auth.uid();
  exercise_log_id uuid;
  session_row     sessions%ROWTYPE;
  program_exercise_exercise_id uuid;
  new_set_log_id  uuid;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Resolve the session + confirm caller owns it + confirm it is in-progress
  SELECT s.* INTO session_row
    FROM sessions s
    JOIN clients  c ON c.id = s.client_id
   WHERE s.id           = p_session_id
     AND c.user_id      = caller_id
     AND c.deleted_at   IS NULL
     AND s.completed_at IS NULL
     AND s.deleted_at   IS NULL;

  IF session_row.id IS NULL THEN
    RAISE EXCEPTION 'Session not found or not owned by caller or already completed';
  END IF;

  -- Resolve the exercise_id of the prescription (for denormalized log linkage)
  SELECT exercise_id INTO program_exercise_exercise_id
    FROM program_exercises
   WHERE id = p_program_exercise_id AND deleted_at IS NULL;

  IF program_exercise_exercise_id IS NULL THEN
    RAISE EXCEPTION 'Program exercise not found';
  END IF;

  -- Find or create the exercise_logs row for this (session, program_exercise)
  SELECT id INTO exercise_log_id
    FROM exercise_logs
   WHERE session_id          = p_session_id
     AND program_exercise_id = p_program_exercise_id
     AND deleted_at IS NULL;

  IF exercise_log_id IS NULL THEN
    INSERT INTO exercise_logs (session_id, program_exercise_id, exercise_id, sort_order)
    VALUES (
      p_session_id,
      p_program_exercise_id,
      program_exercise_exercise_id,
      COALESCE(
        (SELECT pe.sort_order FROM program_exercises pe WHERE pe.id = p_program_exercise_id),
        0
      )
    )
    RETURNING id INTO exercise_log_id;
  END IF;

  -- Insert or upsert the set log
  INSERT INTO set_logs (
    exercise_log_id, set_number,
    weight_value, weight_metric, reps_performed,
    optional_metric, optional_value, rpe, notes, completed_at
  )
  VALUES (
    exercise_log_id, p_set_number,
    p_weight_value, p_weight_metric, p_reps_performed,
    p_optional_metric, p_optional_value, p_rpe, p_notes, now()
  )
  ON CONFLICT (exercise_log_id, set_number) DO UPDATE
    SET weight_value    = EXCLUDED.weight_value,
        weight_metric   = EXCLUDED.weight_metric,
        reps_performed  = EXCLUDED.reps_performed,
        optional_metric = EXCLUDED.optional_metric,
        optional_value  = EXCLUDED.optional_value,
        rpe             = EXCLUDED.rpe,
        notes           = EXCLUDED.notes,
        completed_at    = EXCLUDED.completed_at
  RETURNING id INTO new_set_log_id;

  RETURN new_set_log_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.client_log_set(uuid, uuid, smallint, numeric, text, smallint, text, text, smallint, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.client_log_set(uuid, uuid, smallint, numeric, text, smallint, text, text, smallint, text) TO authenticated;

COMMENT ON FUNCTION public.client_log_set(uuid, uuid, smallint, numeric, text, smallint, text, text, smallint, text) IS
  'Caller logs or updates a set within their own in-progress session. Auto-creates the exercise_logs parent on first set.';


-- ----------------------------------------------------------------------------
-- 5. client_complete_session(session_id, session_rpe, feedback)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.client_complete_session(
  p_session_id  uuid,
  p_session_rpe smallint,
  p_feedback    text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_id   uuid := auth.uid();
  row_count   int;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_session_rpe IS NULL OR p_session_rpe NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'session_rpe must be between 1 and 10';
  END IF;

  UPDATE sessions s
     SET completed_at = now(),
         session_rpe  = p_session_rpe,
         feedback     = p_feedback
    FROM clients c
   WHERE s.id          = p_session_id
     AND s.client_id   = c.id
     AND c.user_id     = caller_id
     AND c.deleted_at  IS NULL
     AND s.completed_at IS NULL
     AND s.deleted_at  IS NULL;

  GET DIAGNOSTICS row_count = ROW_COUNT;
  IF row_count = 0 THEN
    RAISE EXCEPTION 'Session not found, not owned by caller, or already completed';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.client_complete_session(uuid, smallint, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.client_complete_session(uuid, smallint, text) TO authenticated;

COMMENT ON FUNCTION public.client_complete_session(uuid, smallint, text) IS
  'Marks the caller''s own in-progress session as complete with overall RPE and optional feedback.';


-- ----------------------------------------------------------------------------
-- 6. client_get_published_reports() — all reports published to this caller.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.client_get_published_reports()
RETURNS TABLE (
  report_id        uuid,
  title            text,
  report_type      text,
  test_date        date,
  published_at     timestamptz,
  storage_bucket   text,
  storage_path     text,
  current_version  smallint
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    r.id             AS report_id,
    r.title,
    r.report_type,
    r.test_date,
    r.published_at,
    r.storage_bucket,
    r.storage_path,
    r.current_version
  FROM reports r
  JOIN clients c ON c.id = r.client_id
  WHERE c.user_id      = auth.uid()
    AND c.deleted_at   IS NULL
    AND r.is_published = true
    AND r.deleted_at   IS NULL
  ORDER BY r.test_date DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.client_get_published_reports() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.client_get_published_reports() TO authenticated;


-- ----------------------------------------------------------------------------
-- 7. client_available_slots(from, to)
-- Computes bookable slots in the caller's organization between two times.
-- Weekly recurrence is materialized; one-off rules are included if in range.
-- Existing pending/confirmed appointments subtract from the grid.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.client_available_slots(
  p_from timestamptz,
  p_to   timestamptz
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

  -- Caller's org: derive from their client row (not JWT, so this works
  -- even if the claim is briefly stale after an invite accept).
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
    -- Weekly rules materialized over the grid
    SELECT
      r.staff_user_id,
      ((d.d || ' ' || r.start_time)::timestamp AT TIME ZONE caller_tz) AS window_start,
      ((d.d || ' ' || r.end_time)::timestamp   AT TIME ZONE caller_tz) AS window_end,
      r.slot_duration_minutes
    FROM rules r
    JOIN day_grid d ON r.recurrence = 'weekly'
                    AND EXTRACT(ISODOW FROM d.d)::int - 1 = r.day_of_week
    WHERE d.d BETWEEN r.effective_from
                  AND COALESCE(r.effective_to, d.d)

    UNION ALL

    -- One-off rules
    SELECT
      r.staff_user_id,
      ((r.specific_date || ' ' || r.start_time)::timestamp AT TIME ZONE caller_tz),
      ((r.specific_date || ' ' || r.end_time)::timestamp   AT TIME ZONE caller_tz),
      r.slot_duration_minutes
    FROM rules r
    WHERE r.recurrence = 'one_off'
      AND r.specific_date BETWEEN (p_from AT TIME ZONE caller_tz)::date
                              AND (p_to   AT TIME ZONE caller_tz)::date
  ),
  slots AS (
    SELECT
      c.staff_user_id,
      generate_series(
        c.window_start,
        c.window_end - (c.slot_duration_minutes * interval '1 minute'),
        (c.slot_duration_minutes * interval '1 minute')
      ) AS slot_start,
      (c.slot_duration_minutes * interval '1 minute') AS slot_len
    FROM candidates c
  )
  SELECT
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

REVOKE EXECUTE ON FUNCTION public.client_available_slots(timestamptz, timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.client_available_slots(timestamptz, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.client_available_slots(timestamptz, timestamptz) IS
  'Computes bookable slots within the caller''s organization. Materializes weekly rules + one-off rules, subtracts existing pending/confirmed appointments. Max range 90 days.';
