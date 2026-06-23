-- ============================================================================
-- 20260623120000_rep_metric_clone_template_paths
-- ============================================================================
-- Why: item 1 / VU-3 (docs/polish/prescription-volume-unit.md). Every path
-- that COPIES a prescription's per-set rows must carry the new volume unit
-- (rep_metric, added 20260623100000) or a timed/distance set silently
-- collapses back to "reps" on the copy — the FM-3 drift risk.
--
-- Six functions, each a faithful CREATE OR REPLACE of its latest body with
-- ONE change: the per-set fan-out gains rep_metric in the INSERT column list
-- and the source SELECT. Nothing else changes. Base bodies:
--   copy_program_day, repeat_program_day_weekly, _clone_program  → 20260612100000
--   duplicate_program_day                                        → 20260508100000
--   save_program_as_template, create_program_from_template       → 20260612120000
--
-- rep_metric lives ONLY on the per-set tables (program_exercise_sets /
-- template_exercise_sets) — not on the legacy program_exercises/
-- template_exercises scalar columns — so only the set-insert changes; the
-- parent-row clone is untouched.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1. copy_program_day
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.copy_program_day(
  p_source_day_id uuid,
  p_target_date   date,
  p_force         boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org         uuid := public.user_organization_id();
  caller_role        text := public.user_role();
  src_record         program_days%ROWTYPE;
  src_client_id      uuid;
  src_program_org    uuid;
  target_program     uuid;
  target_program_org uuid;
  existing_day_id    uuid;
  new_day_id         uuid;
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO src_record
    FROM program_days
   WHERE id = p_source_day_id
     AND deleted_at IS NULL;

  IF src_record.id IS NULL THEN
    RAISE EXCEPTION 'Source day % not found', p_source_day_id
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT client_id, organization_id
    INTO src_client_id, src_program_org
    FROM programs
   WHERE id = src_record.program_id
     AND deleted_at IS NULL;

  IF src_program_org IS NULL OR src_program_org <> caller_org THEN
    RAISE EXCEPTION 'Source program not in your organization'
      USING ERRCODE = '42501';
  END IF;

  target_program := public._program_for_date(src_client_id, p_target_date);

  IF target_program IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'no_program',
      'target_date', p_target_date
    );
  END IF;

  SELECT organization_id INTO target_program_org
    FROM programs WHERE id = target_program;

  IF target_program_org <> caller_org THEN
    RAISE EXCEPTION 'Target program not in your organization'
      USING ERRCODE = '42501';
  END IF;

  SELECT id INTO existing_day_id
    FROM program_days
   WHERE program_id = target_program
     AND scheduled_date = p_target_date
     AND deleted_at IS NULL;

  IF existing_day_id IS NOT NULL AND NOT p_force THEN
    RETURN jsonb_build_object(
      'status', 'conflict',
      'conflicts', jsonb_build_array(
        jsonb_build_object(
          'date', p_target_date,
          'existing_day_id', existing_day_id
        )
      )
    );
  END IF;

  IF existing_day_id IS NOT NULL AND p_force THEN
    UPDATE program_days
       SET deleted_at = now()
     WHERE id = existing_day_id;
  END IF;

  INSERT INTO program_days (
    program_id, program_week_id, day_label, scheduled_date, sort_order
  ) VALUES (
    target_program,
    NULL,
    src_record.day_label,
    p_target_date,
    src_record.sort_order
  )
  RETURNING id INTO new_day_id;

  WITH remap AS (
    SELECT old_id, gen_random_uuid() AS new_id
      FROM (
        SELECT DISTINCT superset_group_id AS old_id
          FROM program_exercises
         WHERE program_day_id = p_source_day_id
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
      new_day_id, pe.exercise_id, pe.sort_order, pe.section_title,
      remap.new_id, pe.sets, pe.reps, pe.rest_seconds, pe.rpe,
      pe.optional_metric, pe.optional_value, pe.tempo, pe.instructions
      FROM program_exercises pe
      LEFT JOIN remap ON remap.old_id = pe.superset_group_id
     WHERE pe.program_day_id = p_source_day_id
       AND pe.deleted_at IS NULL
     ORDER BY pe.sort_order
    RETURNING id, sort_order
  )
  INSERT INTO program_exercise_sets (
    program_exercise_id, set_number, reps, rep_metric, optional_metric, optional_value
  )
  SELECT
    cloned.id, src_set.set_number, src_set.reps, src_set.rep_metric,
    src_set.optional_metric, src_set.optional_value
    FROM cloned
    JOIN program_exercises src_pe
      ON src_pe.program_day_id = p_source_day_id
     AND src_pe.deleted_at IS NULL
     AND src_pe.sort_order = cloned.sort_order
    JOIN program_exercise_sets src_set
      ON src_set.program_exercise_id = src_pe.id
     AND src_set.deleted_at IS NULL;

  RETURN jsonb_build_object(
    'status', 'created',
    'new_day_id', new_day_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.copy_program_day(uuid, date, boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.copy_program_day(uuid, date, boolean) TO authenticated;


-- ----------------------------------------------------------------------------
-- §2. repeat_program_day_weekly
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.repeat_program_day_weekly(
  p_source_day_id uuid,
  p_end_date      date,
  p_force         boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org           uuid := public.user_organization_id();
  caller_role          text := public.user_role();
  src_record           program_days%ROWTYPE;
  src_client_id        uuid;
  src_program_org      uuid;
  src_program_start    date;
  src_program_duration int;
  required_duration    int;
  cur_date             date;
  target_program       uuid;
  existing_day_id      uuid;
  new_day_id           uuid;
  conflicts            jsonb := '[]'::jsonb;
  no_program_dates     jsonb := '[]'::jsonb;
  new_day_ids          jsonb := '[]'::jsonb;
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO src_record
    FROM program_days
   WHERE id = p_source_day_id
     AND deleted_at IS NULL;

  IF src_record.id IS NULL THEN
    RAISE EXCEPTION 'Source day % not found', p_source_day_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF p_end_date <= src_record.scheduled_date THEN
    RETURN jsonb_build_object('status', 'invalid_end_date');
  END IF;

  SELECT client_id, organization_id, start_date, duration_weeks
    INTO src_client_id, src_program_org, src_program_start, src_program_duration
    FROM programs
   WHERE id = src_record.program_id
     AND deleted_at IS NULL;

  IF src_program_org IS NULL OR src_program_org <> caller_org THEN
    RAISE EXCEPTION 'Source program not in your organization'
      USING ERRCODE = '42501';
  END IF;

  IF src_program_start IS NOT NULL AND src_program_duration IS NOT NULL THEN
    required_duration := (p_end_date - src_program_start) / 7 + 1;
    IF required_duration > src_program_duration THEN
      BEGIN
        UPDATE programs
           SET duration_weeks = required_duration
         WHERE id = src_record.program_id;
      EXCEPTION WHEN exclusion_violation THEN
        NULL;
      END;
    END IF;
  END IF;

  cur_date := src_record.scheduled_date + 7;
  WHILE cur_date <= p_end_date LOOP
    target_program := public._program_for_date(src_client_id, cur_date);

    IF target_program IS NULL THEN
      no_program_dates := no_program_dates || to_jsonb(cur_date);
    ELSE
      SELECT id INTO existing_day_id
        FROM program_days
       WHERE program_id = target_program
         AND scheduled_date = cur_date
         AND deleted_at IS NULL;

      IF existing_day_id IS NOT NULL THEN
        conflicts := conflicts || jsonb_build_object(
          'date', cur_date,
          'existing_day_id', existing_day_id
        );
      END IF;
    END IF;

    cur_date := cur_date + 7;
  END LOOP;

  IF jsonb_array_length(conflicts) > 0 AND NOT p_force THEN
    RETURN jsonb_build_object(
      'status', 'conflict',
      'conflicts', conflicts,
      'no_program_dates', no_program_dates
    );
  END IF;

  cur_date := src_record.scheduled_date + 7;
  WHILE cur_date <= p_end_date LOOP
    target_program := public._program_for_date(src_client_id, cur_date);

    IF target_program IS NOT NULL THEN
      SELECT id INTO existing_day_id
        FROM program_days
       WHERE program_id = target_program
         AND scheduled_date = cur_date
         AND deleted_at IS NULL;

      IF existing_day_id IS NOT NULL THEN
        UPDATE program_days
           SET deleted_at = now()
         WHERE id = existing_day_id;
      END IF;

      INSERT INTO program_days (
        program_id, program_week_id, day_label, scheduled_date, sort_order
      ) VALUES (
        target_program,
        NULL,
        src_record.day_label,
        cur_date,
        src_record.sort_order
      )
      RETURNING id INTO new_day_id;

      WITH remap AS (
        SELECT old_id, gen_random_uuid() AS new_id
          FROM (
            SELECT DISTINCT superset_group_id AS old_id
              FROM program_exercises
             WHERE program_day_id = p_source_day_id
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
          new_day_id, pe.exercise_id, pe.sort_order, pe.section_title,
          remap.new_id, pe.sets, pe.reps, pe.rest_seconds, pe.rpe,
          pe.optional_metric, pe.optional_value, pe.tempo, pe.instructions
          FROM program_exercises pe
          LEFT JOIN remap ON remap.old_id = pe.superset_group_id
         WHERE pe.program_day_id = p_source_day_id
           AND pe.deleted_at IS NULL
         ORDER BY pe.sort_order
        RETURNING id, sort_order
      )
      INSERT INTO program_exercise_sets (
        program_exercise_id, set_number, reps, rep_metric, optional_metric, optional_value
      )
      SELECT
        cloned.id, src_set.set_number, src_set.reps, src_set.rep_metric,
        src_set.optional_metric, src_set.optional_value
        FROM cloned
        JOIN program_exercises src_pe
          ON src_pe.program_day_id = p_source_day_id
         AND src_pe.deleted_at IS NULL
         AND src_pe.sort_order = cloned.sort_order
        JOIN program_exercise_sets src_set
          ON src_set.program_exercise_id = src_pe.id
         AND src_set.deleted_at IS NULL;

      new_day_ids := new_day_ids || to_jsonb(new_day_id);
    END IF;

    cur_date := cur_date + 7;
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'created',
    'new_day_ids', new_day_ids,
    'no_program_dates', no_program_dates
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.repeat_program_day_weekly(uuid, date, boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.repeat_program_day_weekly(uuid, date, boolean) TO authenticated;


-- ----------------------------------------------------------------------------
-- §3. _clone_program (internal helper; REVOKE only, no GRANT)
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
  src_program_duration smallint;
  src_program_start    date;
  src_program_notes    text;
  date_shift           int;
  new_program_id       uuid;
  caller_user_id       uuid := auth.uid();
BEGIN
  SELECT
      organization_id, client_id, duration_weeks, start_date, notes
    INTO
      src_program_org, src_client_id,
      src_program_duration, src_program_start, src_program_notes
    FROM programs
   WHERE id = p_source_program_id
     AND deleted_at IS NULL;

  IF src_program_start IS NULL OR src_program_duration IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_source');
  END IF;

  date_shift := (p_new_start_date - src_program_start);

  BEGIN
    INSERT INTO programs (
      organization_id, client_id, created_by_user_id, name, status,
      start_date, duration_weeks, notes
    ) VALUES (
      src_program_org, src_client_id, caller_user_id, p_new_name,
      'active'::program_status,
      p_new_start_date, src_program_duration, src_program_notes
    ) RETURNING id INTO new_program_id;
  EXCEPTION WHEN exclusion_violation THEN
    RETURN jsonb_build_object('status', 'overlap');
  END;

  INSERT INTO program_weeks (program_id, week_number, notes)
  SELECT new_program_id, week_number, notes
    FROM program_weeks
   WHERE program_id = p_source_program_id
     AND deleted_at IS NULL;

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
  ),
  cloned AS (
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
    ORDER BY src_pd.scheduled_date, pe.sort_order
    RETURNING id, program_day_id, sort_order
  )
  INSERT INTO program_exercise_sets (
    program_exercise_id, set_number, reps, rep_metric, optional_metric, optional_value
  )
  SELECT
    cloned.id, src_set.set_number, src_set.reps, src_set.rep_metric,
    src_set.optional_metric, src_set.optional_value
    FROM cloned
    JOIN program_days new_pd ON new_pd.id = cloned.program_day_id
    JOIN program_days src_pd
      ON src_pd.program_id = p_source_program_id
     AND src_pd.scheduled_date = (new_pd.scheduled_date - date_shift)::date
     AND src_pd.deleted_at IS NULL
    JOIN program_exercises src_pe
      ON src_pe.program_day_id = src_pd.id
     AND src_pe.sort_order = cloned.sort_order
     AND src_pe.deleted_at IS NULL
    JOIN program_exercise_sets src_set
      ON src_set.program_exercise_id = src_pe.id
     AND src_set.deleted_at IS NULL;

  RETURN jsonb_build_object(
    'status', 'created',
    'new_program_id', new_program_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public._clone_program(uuid, date, text) FROM PUBLIC;


-- ----------------------------------------------------------------------------
-- §4. duplicate_program_day
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.duplicate_program_day(
  p_source_day_id uuid,
  p_target_date   date
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org         uuid := public.user_organization_id();
  caller_role        text := public.user_role();
  src_record         program_days%ROWTYPE;
  src_client_id      uuid;
  src_program_org    uuid;
  target_program     uuid;
  target_program_org uuid;
  existing_day_id    uuid;
  new_day_id         uuid;
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO src_record
    FROM program_days
   WHERE id = p_source_day_id
     AND deleted_at IS NULL;

  IF src_record.id IS NULL THEN
    RAISE EXCEPTION 'Source day % not found', p_source_day_id
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT client_id, organization_id
    INTO src_client_id, src_program_org
    FROM programs
   WHERE id = src_record.program_id
     AND deleted_at IS NULL;

  IF src_program_org IS NULL OR src_program_org <> caller_org THEN
    RAISE EXCEPTION 'Source program not in your organization'
      USING ERRCODE = '42501';
  END IF;

  target_program := public._program_for_date(src_client_id, p_target_date);

  IF target_program IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'no_program',
      'target_date', p_target_date
    );
  END IF;

  SELECT organization_id INTO target_program_org
    FROM programs WHERE id = target_program;

  IF target_program_org <> caller_org THEN
    RAISE EXCEPTION 'Target program not in your organization'
      USING ERRCODE = '42501';
  END IF;

  SELECT id INTO existing_day_id
    FROM program_days
   WHERE program_id = target_program
     AND scheduled_date = p_target_date
     AND deleted_at IS NULL;

  IF existing_day_id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'conflict');
  END IF;

  INSERT INTO program_days (
    program_id, program_week_id, day_label, scheduled_date, sort_order
  ) VALUES (
    target_program,
    NULL,
    src_record.day_label,
    p_target_date,
    src_record.sort_order
  )
  RETURNING id INTO new_day_id;

  WITH remap AS (
    SELECT old_id, gen_random_uuid() AS new_id
      FROM (
        SELECT DISTINCT superset_group_id AS old_id
          FROM program_exercises
         WHERE program_day_id = p_source_day_id
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
      new_day_id, pe.exercise_id, pe.sort_order, pe.section_title,
      remap.new_id, pe.sets, pe.reps, pe.rest_seconds, pe.rpe,
      pe.optional_metric, pe.optional_value, pe.tempo, pe.instructions
      FROM program_exercises pe
      LEFT JOIN remap ON remap.old_id = pe.superset_group_id
     WHERE pe.program_day_id = p_source_day_id
       AND pe.deleted_at IS NULL
     ORDER BY pe.sort_order
    RETURNING id, sort_order
  )
  INSERT INTO program_exercise_sets (
    program_exercise_id, set_number, reps, rep_metric, optional_metric, optional_value
  )
  SELECT
    cloned.id, src_set.set_number, src_set.reps, src_set.rep_metric,
    src_set.optional_metric, src_set.optional_value
    FROM cloned
    JOIN program_exercises src_pe
      ON src_pe.program_day_id = p_source_day_id
     AND src_pe.deleted_at IS NULL
     AND src_pe.sort_order = cloned.sort_order
    JOIN program_exercise_sets src_set
      ON src_set.program_exercise_id = src_pe.id
     AND src_set.deleted_at IS NULL;

  RETURN jsonb_build_object(
    'status', 'created',
    'new_day_id', new_day_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.duplicate_program_day(uuid, date) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.duplicate_program_day(uuid, date) TO authenticated;


-- ----------------------------------------------------------------------------
-- §5. save_program_as_template — program_exercise_sets → template_exercise_sets
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_program_as_template(
  p_program_id uuid,
  p_name       text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org      uuid := public.user_organization_id();
  caller_role     text := public.user_role();
  caller_user_id  uuid := auth.uid();

  v_src_org       uuid;
  v_src_name      text;
  v_src_notes     text;
  v_src_start     date;
  v_effective     text;
  v_template_id   uuid;
  v_day           record;
  v_week_number   int;
  v_tw_id         uuid;
  v_td_id         uuid;
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT organization_id, name, notes, start_date
    INTO v_src_org, v_src_name, v_src_notes, v_src_start
    FROM programs
   WHERE id = p_program_id
     AND deleted_at IS NULL;

  IF v_src_org IS NULL THEN
    RAISE EXCEPTION 'Source program % not found', p_program_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_src_org <> caller_org THEN
    RAISE EXCEPTION 'Source program not in your organization'
      USING ERRCODE = '42501';
  END IF;

  IF v_src_start IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_source');
  END IF;

  v_effective := COALESCE(NULLIF(trim(p_name), ''), v_src_name);

  IF EXISTS (
    SELECT 1 FROM program_templates
     WHERE organization_id = caller_org
       AND lower(name) = lower(v_effective)
       AND deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('status', 'duplicate_name', 'name', v_effective);
  END IF;

  INSERT INTO program_templates (organization_id, created_by_user_id, name, description)
  VALUES (caller_org, caller_user_id, v_effective, v_src_notes)
  RETURNING id INTO v_template_id;

  INSERT INTO template_weeks (template_id, week_number, notes)
  SELECT v_template_id, wk.week_number, pw.notes
    FROM (
      SELECT DISTINCT ((pd.scheduled_date - v_src_start) / 7 + 1)::smallint AS week_number
        FROM program_days pd
       WHERE pd.program_id = p_program_id
         AND pd.deleted_at IS NULL
    ) wk
    LEFT JOIN program_weeks pw
      ON pw.program_id = p_program_id
     AND pw.week_number = wk.week_number
     AND pw.deleted_at IS NULL;

  FOR v_day IN
    SELECT pd.id, pd.day_label, pd.scheduled_date
      FROM program_days pd
     WHERE pd.program_id = p_program_id
       AND pd.deleted_at IS NULL
     ORDER BY pd.scheduled_date
  LOOP
    v_week_number := (v_day.scheduled_date - v_src_start) / 7 + 1;

    SELECT id INTO v_tw_id
      FROM template_weeks
     WHERE template_id = v_template_id
       AND week_number = v_week_number;

    INSERT INTO template_days (template_week_id, day_label, sort_order)
    VALUES (
      v_tw_id,
      v_day.day_label,
      (v_day.scheduled_date - v_src_start) - (v_week_number - 1) * 7
    )
    RETURNING id INTO v_td_id;

    WITH remap AS (
      SELECT old_id, gen_random_uuid() AS new_id
        FROM (
          SELECT DISTINCT superset_group_id AS old_id
            FROM program_exercises
           WHERE program_day_id = v_day.id
             AND superset_group_id IS NOT NULL
             AND deleted_at IS NULL
        ) AS distinct_groups
    ),
    cloned AS (
      INSERT INTO template_exercises (
        template_day_id, exercise_id, sort_order, section_title,
        superset_group_id, sets, reps, rest_seconds, rpe,
        optional_metric, optional_value, tempo, instructions
      )
      SELECT
        v_td_id, pe.exercise_id, pe.sort_order, pe.section_title,
        remap.new_id, pe.sets, pe.reps, pe.rest_seconds, pe.rpe,
        pe.optional_metric, pe.optional_value, pe.tempo, pe.instructions
        FROM program_exercises pe
        LEFT JOIN remap ON remap.old_id = pe.superset_group_id
       WHERE pe.program_day_id = v_day.id
         AND pe.deleted_at IS NULL
       ORDER BY pe.sort_order
      RETURNING id, sort_order
    )
    INSERT INTO template_exercise_sets (
      template_exercise_id, set_number, reps, rep_metric, optional_metric, optional_value
    )
    SELECT
      cloned.id, src_set.set_number, src_set.reps, src_set.rep_metric,
      src_set.optional_metric, src_set.optional_value
      FROM cloned
      JOIN program_exercises src_pe
        ON src_pe.program_day_id = v_day.id
       AND src_pe.deleted_at IS NULL
       AND src_pe.sort_order = cloned.sort_order
      JOIN program_exercise_sets src_set
        ON src_set.program_exercise_id = src_pe.id
       AND src_set.deleted_at IS NULL;
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'created',
    'template_id', v_template_id,
    'name', v_effective
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_program_as_template(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.save_program_as_template(uuid, text) TO authenticated;


-- ----------------------------------------------------------------------------
-- §6. create_program_from_template — template_exercise_sets → program_exercise_sets
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_program_from_template(
  p_template_id uuid,
  p_client_id   uuid,
  p_start_date  date,
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
  v_duration      smallint;
  v_effective     text;
  v_program_id    uuid;
  v_day           record;
  v_pd_id         uuid;
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT organization_id, name, description
    INTO v_tpl_org, v_tpl_name, v_tpl_desc
    FROM program_templates
   WHERE id = p_template_id
     AND deleted_at IS NULL;

  IF v_tpl_org IS NULL THEN
    RAISE EXCEPTION 'Template % not found', p_template_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_tpl_org <> caller_org THEN
    RAISE EXCEPTION 'Template not in your organization'
      USING ERRCODE = '42501';
  END IF;

  SELECT organization_id INTO v_client_org
    FROM clients
   WHERE id = p_client_id
     AND deleted_at IS NULL;

  IF v_client_org IS NULL OR v_client_org <> caller_org THEN
    RAISE EXCEPTION 'Client not in your organization'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(MAX(week_number), 1) INTO v_duration
    FROM template_weeks
   WHERE template_id = p_template_id
     AND deleted_at IS NULL;

  v_effective := COALESCE(NULLIF(trim(p_name), ''), v_tpl_name);

  BEGIN
    INSERT INTO programs (
      organization_id, client_id, template_id, created_by_user_id,
      name, status, start_date, duration_weeks, notes
    ) VALUES (
      caller_org, p_client_id, p_template_id, caller_user_id,
      v_effective, 'active'::program_status,
      p_start_date, v_duration, v_tpl_desc
    ) RETURNING id INTO v_program_id;
  EXCEPTION WHEN exclusion_violation THEN
    RETURN jsonb_build_object('status', 'overlap');
  END;

  INSERT INTO program_weeks (program_id, week_number, notes)
  SELECT v_program_id, week_number, notes
    FROM template_weeks
   WHERE template_id = p_template_id
     AND deleted_at IS NULL;

  FOR v_day IN
    SELECT td.id, td.day_label, td.sort_order, tw.week_number
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
    SELECT
      v_program_id,
      pw.id,
      v_day.day_label,
      p_start_date + (v_day.week_number - 1) * 7 + v_day.sort_order,
      v_day.sort_order
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

  RETURN jsonb_build_object(
    'status', 'created',
    'new_program_id', v_program_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_program_from_template(uuid, uuid, date, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_program_from_template(uuid, uuid, date, text) TO authenticated;
