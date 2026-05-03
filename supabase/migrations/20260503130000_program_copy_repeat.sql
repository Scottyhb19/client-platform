-- ============================================================================
-- 20260503130000_program_copy_repeat
-- ============================================================================
-- Why: Phase D of the programs polish pass. Two RPCs so the EP can
-- clone an entire active program (with all its weeks, days, exercises)
-- onto a new start date, or repeat it back-to-back immediately
-- following the source.
--
--   copy_program(p_source_program_id, p_new_start_date, p_new_name?)
--     → jsonb { status, ... }
--
--   repeat_program(p_source_program_id)
--     → jsonb { status, ... }
--
-- Both share the internal _clone_program helper which does the actual
-- INSERT INTO programs + INSERT INTO program_weeks + INSERT INTO
-- program_days (with shifted scheduled_dates) + INSERT INTO
-- program_exercises (with remapped superset_group_ids).
--
-- Why SECURITY DEFINER: same reason as Phase C — soft-delete + RLS
-- gotcha. Also lets us catch the EXCLUDE constraint violation
-- (programs_no_active_overlap) cleanly and return a structured
-- 'overlap' status instead of bubbling 23P01 to the client.
--
-- Status decision (overrides §4 Q11 sign-off): both copy and repeat
-- create programs with status='active' rather than 'draft'. Reasoning:
-- there is no draft-activation UI in the calendar yet — a draft would
-- be orphaned. Both flows create active programs; the EXCLUDE
-- constraint enforces date-range non-overlap. The EP can manually
-- archive the new program if they change their mind. Drafts can come
-- back when there's a draft-activation surface.
--
-- Returns:
--   { status: 'created', new_program_id: <uuid> }
--   { status: 'overlap' }            — date range conflicts with another active program
--   { status: 'invalid_source' }     — source has no start_date or duration_weeks
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1. Internal helper — clone a program onto a new start_date.
--
-- Caller is responsible for org/role gating BEFORE invoking this. The
-- helper trusts its inputs and runs as SECURITY DEFINER so it can do
-- the multi-table inserts without re-checking RLS at every step.
--
-- The helper catches the EXCLUDE-constraint violation that fires when
-- the new program's date range overlaps an existing active program
-- for the same client. On overlap, returns status='overlap' without
-- creating any rows (the failed program INSERT is the first write,
-- so nothing dangling).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._clone_program(
  p_source_program_id uuid,
  p_new_start_date    date,
  p_new_name          text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  src_program_org      uuid;
  src_client_id        uuid;
  src_program_type     program_type;
  src_program_duration smallint;
  src_program_start    date;
  src_program_notes    text;
  date_shift           int;
  new_program_id       uuid;
  caller_user_id       uuid := auth.uid();
BEGIN
  SELECT
      organization_id, client_id, type, duration_weeks, start_date, notes
    INTO
      src_program_org, src_client_id, src_program_type,
      src_program_duration, src_program_start, src_program_notes
    FROM programs
   WHERE id = p_source_program_id
     AND deleted_at IS NULL;

  IF src_program_start IS NULL OR src_program_duration IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_source');
  END IF;

  date_shift := (p_new_start_date - src_program_start);

  -- INSERT the new program. If date range overlaps an existing active
  -- program for this client, the EXCLUDE constraint
  -- programs_no_active_overlap raises exclusion_violation; we catch
  -- and return a clean status. Wrapped in its own BEGIN/EXCEPTION
  -- block so subsequent writes are short-circuited.
  BEGIN
    INSERT INTO programs (
      organization_id, client_id, created_by_user_id, name, type, status,
      start_date, duration_weeks, notes
    ) VALUES (
      src_program_org, src_client_id, caller_user_id, p_new_name,
      src_program_type, 'active'::program_status,
      p_new_start_date, src_program_duration, src_program_notes
    ) RETURNING id INTO new_program_id;
  EXCEPTION WHEN exclusion_violation THEN
    RETURN jsonb_build_object('status', 'overlap');
  END;

  -- Clone weeks (week_number + notes carried over).
  INSERT INTO program_weeks (program_id, week_number, notes)
  SELECT new_program_id, week_number, notes
    FROM program_weeks
   WHERE program_id = p_source_program_id
     AND deleted_at IS NULL;

  -- Clone days. scheduled_date shifted by date_shift days.
  -- program_week_id resolved by matching week_number within the new
  -- program (week_numbers are unique per program). Days whose source
  -- program_week_id was NULL stay NULL on the clone.
  INSERT INTO program_days (
    program_id, program_week_id, day_label, scheduled_date, sort_order
  )
  SELECT
    new_program_id,
    new_pw.id,
    src_pd.day_label,
    (src_pd.scheduled_date + date_shift)::date,
    src_pd.sort_order
  FROM program_days src_pd
  LEFT JOIN program_weeks src_pw
    ON src_pw.id = src_pd.program_week_id
   AND src_pw.deleted_at IS NULL
  LEFT JOIN program_weeks new_pw
    ON new_pw.program_id = new_program_id
   AND new_pw.week_number = src_pw.week_number
  WHERE src_pd.program_id = p_source_program_id
    AND src_pd.deleted_at IS NULL;

  -- Clone exercises. Two parts:
  --   1. Build a remap from each unique source superset_group_id to a
  --      fresh uuid (deduplicate first to avoid the volatile-fn
  --      Cartesian-product trap from Phase C).
  --   2. Insert clones, joining src day → new day via shifted date,
  --      and substituting the new group_id where applicable.
  WITH source_groups AS (
    SELECT DISTINCT pe.superset_group_id AS old_id
      FROM program_exercises pe
      JOIN program_days pd ON pd.id = pe.program_day_id
     WHERE pd.program_id = p_source_program_id
       AND pe.superset_group_id IS NOT NULL
       AND pe.deleted_at IS NULL
       AND pd.deleted_at IS NULL
  ),
  remap AS (
    SELECT old_id, gen_random_uuid() AS new_id FROM source_groups
  )
  INSERT INTO program_exercises (
    program_day_id, exercise_id, sort_order, section_title,
    superset_group_id, sets, reps, rest_seconds, rpe,
    optional_metric, optional_value, tempo, instructions
  )
  SELECT
    new_pd.id, pe.exercise_id, pe.sort_order, pe.section_title,
    remap.new_id, pe.sets, pe.reps, pe.rest_seconds, pe.rpe,
    pe.optional_metric, pe.optional_value, pe.tempo, pe.instructions
  FROM program_exercises pe
  JOIN program_days src_pd ON src_pd.id = pe.program_day_id
  JOIN program_days new_pd
    ON new_pd.program_id = new_program_id
   AND new_pd.scheduled_date = (src_pd.scheduled_date + date_shift)::date
   AND new_pd.deleted_at IS NULL
  LEFT JOIN remap ON remap.old_id = pe.superset_group_id
  WHERE src_pd.program_id = p_source_program_id
    AND pe.deleted_at IS NULL
    AND src_pd.deleted_at IS NULL
  ORDER BY src_pd.scheduled_date, pe.sort_order;

  RETURN jsonb_build_object(
    'status', 'created',
    'new_program_id', new_program_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public._clone_program(uuid, date, text) FROM PUBLIC;

COMMENT ON FUNCTION public._clone_program(uuid, date, text) IS
  'Internal helper: clones a program (and its weeks, days, exercises) onto a new start_date. Caller responsible for org gating. Returns jsonb with status: created | overlap | invalid_source.';


-- ----------------------------------------------------------------------------
-- §2. copy_program — clone the source onto an EP-picked new start.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.copy_program(
  p_source_program_id uuid,
  p_new_start_date    date,
  p_new_name          text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org      uuid := public.user_organization_id();
  caller_role     text := public.user_role();
  src_program_org uuid;
  src_name        text;
  effective_name  text;
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT organization_id, name
    INTO src_program_org, src_name
    FROM programs
   WHERE id = p_source_program_id
     AND deleted_at IS NULL;

  IF src_program_org IS NULL THEN
    RAISE EXCEPTION 'Source program % not found', p_source_program_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF src_program_org <> caller_org THEN
    RAISE EXCEPTION 'Source program not in your organization'
      USING ERRCODE = '42501';
  END IF;

  effective_name := COALESCE(NULLIF(trim(p_new_name), ''), src_name || ' (copy)');

  RETURN public._clone_program(
    p_source_program_id,
    p_new_start_date,
    effective_name
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.copy_program(uuid, date, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.copy_program(uuid, date, text) TO authenticated;

COMMENT ON FUNCTION public.copy_program(uuid, date, text) IS
  'Clones a program (with all weeks, days, exercises) onto an EP-picked new start_date. Defaults the new name to <source.name> + " (copy)". Returns jsonb with status: created | overlap | invalid_source.';


-- ----------------------------------------------------------------------------
-- §3. repeat_program — clone the source back-to-back, immediately
-- following its end. new_start = source.start_date + duration_weeks * 7.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.repeat_program(
  p_source_program_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org           uuid := public.user_organization_id();
  caller_role          text := public.user_role();
  src_program_org      uuid;
  src_name             text;
  src_program_start    date;
  src_program_duration smallint;
  new_start_date       date;
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT organization_id, name, start_date, duration_weeks
    INTO src_program_org, src_name, src_program_start, src_program_duration
    FROM programs
   WHERE id = p_source_program_id
     AND deleted_at IS NULL;

  IF src_program_org IS NULL THEN
    RAISE EXCEPTION 'Source program % not found', p_source_program_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF src_program_org <> caller_org THEN
    RAISE EXCEPTION 'Source program not in your organization'
      USING ERRCODE = '42501';
  END IF;

  IF src_program_start IS NULL OR src_program_duration IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_source');
  END IF;

  new_start_date := (src_program_start + (src_program_duration * 7))::date;

  RETURN public._clone_program(
    p_source_program_id,
    new_start_date,
    src_name || ' (next)'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.repeat_program(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.repeat_program(uuid) TO authenticated;

COMMENT ON FUNCTION public.repeat_program(uuid) IS
  'Clones a program back-to-back immediately following its end. new_start = source.start_date + duration_weeks * 7. New name = <source.name> + " (next)". Returns jsonb with status: created | overlap | invalid_source.';
