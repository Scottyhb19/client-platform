-- ============================================================================
-- 20260624160000_create_program_from_template_on_dates
-- ============================================================================
-- Why: dogfooding follow-up (operator, 2026-06-24). Applying a multi-day program
-- template should let the EP pick the ACTUAL date for each day, not pick one
-- start date and have create_program_from_template auto-place each day at
-- start + (week-1)*7 + the day's stored weekday-offset (which feels "random"
-- because the offset came from wherever the template was first saved).
--
-- This is a SIBLING to create_program_from_template — same structure (weeks,
-- days, exercise + per-set copy with fresh superset remap, rep_metric threaded),
-- but each program_day's scheduled_date comes from an explicit
-- template_day_id -> date map instead of the offset math. The original RPC is
-- left untouched (program/new "Start from template" still uses it).
--
-- p_day_dates: jsonb object { "<template_day_id>": "YYYY-MM-DD", ... } with an
-- entry for every LIVE template day. Validated: every live day dated, all dates
-- distinct (one day per date), and the resulting date range must not overlap an
-- active program for the client (the programs EXCLUDE constraint → 'overlap').
-- start_date = earliest chosen date; duration_weeks spans the chosen dates.
--
-- Org/role guarded in-body; anon EXECUTE revoked at creation (pgTAP 43).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_program_from_template_on_dates(
  p_template_id uuid,
  p_client_id   uuid,
  p_day_dates   jsonb,
  p_name        text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org      uuid := public.user_organization_id();
  caller_role     text := public.user_role();
  caller_user_id  uuid := auth.uid();

  v_tpl_org       uuid;
  v_tpl_name      text;
  v_tpl_desc      text;
  v_client_org    uuid;
  v_effective     text;
  v_program_id    uuid;

  v_live_days     int;
  v_provided      int;
  v_distinct      int;
  v_min_date      date;
  v_max_date      date;
  v_duration      smallint;

  v_day           record;
  v_pd_id         uuid;
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT organization_id, name, description
    INTO v_tpl_org, v_tpl_name, v_tpl_desc
    FROM program_templates
   WHERE id = p_template_id AND deleted_at IS NULL;
  IF v_tpl_org IS NULL THEN
    RAISE EXCEPTION 'Template % not found', p_template_id USING ERRCODE = 'no_data_found';
  END IF;
  IF v_tpl_org <> caller_org THEN
    RAISE EXCEPTION 'Template not in your organization' USING ERRCODE = '42501';
  END IF;

  SELECT organization_id INTO v_client_org
    FROM clients WHERE id = p_client_id AND deleted_at IS NULL;
  IF v_client_org IS NULL OR v_client_org <> caller_org THEN
    RAISE EXCEPTION 'Client not in your organization' USING ERRCODE = '42501';
  END IF;

  IF p_day_dates IS NULL OR jsonb_typeof(p_day_dates) <> 'object' THEN
    RAISE EXCEPTION 'A date is required for every day' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Validate the date map against the template's live days. v_provided counts
  -- live days that have a (non-null) date; v_distinct counts distinct dates.
  SELECT
    count(*),
    count(p_day_dates ->> td.id::text),
    count(DISTINCT (p_day_dates ->> td.id::text)),
    min((p_day_dates ->> td.id::text)::date),
    max((p_day_dates ->> td.id::text)::date)
  INTO v_live_days, v_provided, v_distinct, v_min_date, v_max_date
  FROM template_days td
  JOIN template_weeks tw ON tw.id = td.template_week_id
  WHERE tw.template_id = p_template_id
    AND td.deleted_at IS NULL
    AND tw.deleted_at IS NULL;

  IF v_live_days = 0 THEN
    RAISE EXCEPTION 'Template has no days to schedule' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_provided <> v_live_days THEN
    RAISE EXCEPTION 'A date is required for every day' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_distinct <> v_live_days THEN
    RAISE EXCEPTION 'Two days cannot share the same date' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_duration := GREATEST(1, CEIL(((v_max_date - v_min_date) + 1)::numeric / 7))::smallint;
  v_effective := COALESCE(NULLIF(trim(p_name), ''), v_tpl_name);

  BEGIN
    INSERT INTO programs (
      organization_id, client_id, template_id, created_by_user_id,
      name, status, start_date, duration_weeks, notes
    ) VALUES (
      caller_org, p_client_id, p_template_id, caller_user_id,
      v_effective, 'active'::program_status,
      v_min_date, v_duration, v_tpl_desc
    ) RETURNING id INTO v_program_id;
  EXCEPTION WHEN exclusion_violation THEN
    RETURN jsonb_build_object('status', 'overlap');
  END;

  INSERT INTO program_weeks (program_id, week_number, notes)
  SELECT v_program_id, week_number, notes
    FROM template_weeks
   WHERE template_id = p_template_id AND deleted_at IS NULL;

  FOR v_day IN
    SELECT td.id, td.day_label, td.sort_order, tw.week_number,
           (p_day_dates ->> td.id::text)::date AS chosen_date
      FROM template_days td
      JOIN template_weeks tw ON tw.id = td.template_week_id
     WHERE tw.template_id = p_template_id
       AND td.deleted_at IS NULL
       AND tw.deleted_at IS NULL
     ORDER BY tw.week_number, td.sort_order
  LOOP
    INSERT INTO program_days (
      program_id, program_week_id, day_label, scheduled_date, sort_order
    )
    SELECT v_program_id, pw.id, v_day.day_label, v_day.chosen_date, v_day.sort_order
      FROM program_weeks pw
     WHERE pw.program_id = v_program_id
       AND pw.week_number = v_day.week_number
    RETURNING id INTO v_pd_id;

    WITH remap AS (
      SELECT old_id, gen_random_uuid() AS new_id
        FROM (
          SELECT DISTINCT superset_group_id AS old_id
            FROM template_exercises
           WHERE template_day_id = v_day.id
             AND superset_group_id IS NOT NULL
             AND deleted_at IS NULL
        ) AS distinct_groups
    ),
    cloned AS (
      INSERT INTO program_exercises (
        program_day_id, exercise_id, sort_order, section_title,
        superset_group_id, sets, reps, rest_seconds, rpe,
        optional_metric, optional_value, tempo, instructions
      )
      SELECT
        v_pd_id, te.exercise_id, te.sort_order, te.section_title,
        remap.new_id, te.sets, te.reps, te.rest_seconds, te.rpe,
        te.optional_metric, te.optional_value, te.tempo, te.instructions
        FROM template_exercises te
        LEFT JOIN remap ON remap.old_id = te.superset_group_id
       WHERE te.template_day_id = v_day.id
         AND te.deleted_at IS NULL
       ORDER BY te.sort_order
      RETURNING id, sort_order
    )
    INSERT INTO program_exercise_sets (
      program_exercise_id, set_number, reps, rep_metric, optional_metric, optional_value
    )
    SELECT
      cloned.id, src_set.set_number, src_set.reps, src_set.rep_metric,
      src_set.optional_metric, src_set.optional_value
      FROM cloned
      JOIN template_exercises src_te
        ON src_te.template_day_id = v_day.id
       AND src_te.deleted_at IS NULL
       AND src_te.sort_order = cloned.sort_order
      JOIN template_exercise_sets src_set
        ON src_set.template_exercise_id = src_te.id
       AND src_set.deleted_at IS NULL;
  END LOOP;

  RETURN jsonb_build_object('status', 'created', 'new_program_id', v_program_id);
END;
$$;

COMMENT ON FUNCTION public.create_program_from_template_on_dates(uuid, uuid, jsonb, text) IS
  'Instantiate a template as a new active program with an EXPLICIT date per day (template_day_id -> date map), instead of one start date + weekday-offset. Validates every live day is dated + all dates distinct; start_date = earliest, duration spans the dates; overlap with an active block returns status=overlap. Org/role guarded. Sibling of create_program_from_template.';

REVOKE EXECUTE ON FUNCTION public.create_program_from_template_on_dates(uuid, uuid, jsonb, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_program_from_template_on_dates(uuid, uuid, jsonb, text) TO authenticated;
