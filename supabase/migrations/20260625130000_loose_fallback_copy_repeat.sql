-- ============================================================================
-- 20260625130000_loose_fallback_copy_repeat
-- ============================================================================
-- Why: item 3 follow-up (docs/polish/one-off-sessions.md G3-7, was deferred).
-- create_program_day learned to attach a session to the client's loose
-- container when no dated block covers the date (20260625120000), but the
-- COPY / REPEAT family did not — so copying or repeating a session onto a
-- block-less date still failed ("needs to be within a block"). This extends
-- the same loose-container fallback across every copy/repeat path, day AND
-- week.
--
-- DRY: the get-or-create logic that was inlined in create_program_day is
-- lifted into a single internal helper, _get_or_create_loose_program, and
-- every path now routes through it. The helper is NOT API-exposed (REVOKE
-- anon+authenticated, like the _test_* and _clone_program internals); it is
-- only ever called from the already-guarded SECURITY DEFINER RPCs, which run
-- as the function owner.
--
-- Resolution rule everywhere: a dated active block covering the date wins;
-- otherwise the day attaches to the get-or-created loose container. So
-- 'no_program' / no_program_dates are now unreachable for a valid client —
-- the return shapes are unchanged (callers still tolerate them) but those
-- branches no longer fire.
--
-- Scan vs apply (repeat + week ops): the conflict-scan pass uses the
-- EXISTING container id only (looked up once, never created) so a dry-run /
-- cancelled confirm has no side effect; the apply pass get-or-creates.
--
-- Each function below is a faithful CREATE OR REPLACE of its latest body
-- (create_program_day → 20260625120000; copy/repeat/duplicate day →
-- 20260623120000; week ops → 20260612160000) with ONLY the resolution
-- change. Signatures unchanged → no DROP, deployed callers unaffected.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §0. Internal helper — get-or-create the client's loose one-off container.
--     Race-safe via ON CONFLICT against programs_one_loose_per_client_idx.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._get_or_create_loose_program(p_client_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id  uuid;
  v_org uuid;
BEGIN
  SELECT id INTO v_id
    FROM programs
   WHERE client_id = p_client_id AND is_loose AND deleted_at IS NULL
   LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT organization_id INTO v_org
    FROM clients WHERE id = p_client_id AND deleted_at IS NULL;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Client % not found', p_client_id USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO programs (organization_id, client_id, name, status, is_loose)
  VALUES (v_org, p_client_id, 'One-off sessions', 'active', true)
  ON CONFLICT (client_id) WHERE (is_loose AND deleted_at IS NULL) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id
      FROM programs
     WHERE client_id = p_client_id AND is_loose AND deleted_at IS NULL
     LIMIT 1;
  END IF;

  RETURN v_id;
END;
$$;

-- Internal only — never reachable from the API roles.
REVOKE EXECUTE ON FUNCTION public._get_or_create_loose_program(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._get_or_create_loose_program(uuid) FROM anon, authenticated;

COMMENT ON FUNCTION public._get_or_create_loose_program(uuid) IS
  'Internal (item 3): returns the client''s single live is_loose one-off container, creating it (status=active, null dates, name ''One-off sessions'') on first use. Race-safe via programs_one_loose_per_client_idx. Called only from the SECURITY DEFINER copy/repeat/create RPCs; not API-exposed.';


-- ----------------------------------------------------------------------------
-- §1. create_program_day — route the fallback through the shared helper.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_program_day(
  p_client_id   uuid,
  p_target_date date
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org         uuid := public.user_organization_id();
  caller_role        text := public.user_role();
  client_org         uuid;
  target_program     uuid;
  target_program_org uuid;
  existing_day_id    uuid;
  next_sort_order    int;
  new_day_id         uuid;
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT organization_id INTO client_org
    FROM clients
   WHERE id = p_client_id
     AND deleted_at IS NULL;

  IF client_org IS NULL OR client_org <> caller_org THEN
    RAISE EXCEPTION 'Client % not in your organization', p_client_id
      USING ERRCODE = '42501';
  END IF;

  -- A dated block covering the date wins; otherwise the loose container.
  target_program := COALESCE(
    public._program_for_date(p_client_id, p_target_date),
    public._get_or_create_loose_program(p_client_id)
  );

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
    RETURN jsonb_build_object(
      'status', 'conflict',
      'existing_day_id', existing_day_id
    );
  END IF;

  next_sort_order := 0;

  INSERT INTO program_days (
    program_id, program_week_id, day_label, scheduled_date, sort_order
  ) VALUES (
    target_program,
    NULL,
    'Day 1',
    p_target_date,
    next_sort_order
  )
  RETURNING id INTO new_day_id;

  RETURN jsonb_build_object(
    'status', 'created',
    'new_day_id', new_day_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_program_day(uuid, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_program_day(uuid, date) FROM anon;
GRANT  EXECUTE ON FUNCTION public.create_program_day(uuid, date) TO authenticated;


-- ----------------------------------------------------------------------------
-- §2. copy_program_day — fall back to the loose container on a bare date.
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

  -- Dated block covering the target wins; otherwise the loose container.
  target_program := COALESCE(
    public._program_for_date(src_client_id, p_target_date),
    public._get_or_create_loose_program(src_client_id)
  );

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
REVOKE EXECUTE ON FUNCTION public.copy_program_day(uuid, date, boolean) FROM anon;
GRANT  EXECUTE ON FUNCTION public.copy_program_day(uuid, date, boolean) TO authenticated;


-- ----------------------------------------------------------------------------
-- §3. duplicate_program_day — same loose fallback (session-builder "duplicate
--     this day to a date"). Refuses on conflict (no force path); a bare date
--     now lands on the loose container instead of returning no_program.
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

  target_program := COALESCE(
    public._program_for_date(src_client_id, p_target_date),
    public._get_or_create_loose_program(src_client_id)
  );

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
REVOKE EXECUTE ON FUNCTION public.duplicate_program_day(uuid, date) FROM anon;
GRANT  EXECUTE ON FUNCTION public.duplicate_program_day(uuid, date) TO authenticated;


-- ----------------------------------------------------------------------------
-- §4. repeat_program_day_weekly — scan uses the EXISTING container (no
--     create); apply get-or-creates. no_program_dates is now always empty.
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
  v_loose_id           uuid;
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

  -- Existing loose container (if any) — used by the scan pass only, so a
  -- cancelled conflict confirm creates nothing.
  SELECT id INTO v_loose_id
    FROM programs
   WHERE client_id = src_client_id AND is_loose AND deleted_at IS NULL
   LIMIT 1;

  cur_date := src_record.scheduled_date + 7;
  WHILE cur_date <= p_end_date LOOP
    target_program := COALESCE(
      public._program_for_date(src_client_id, cur_date),
      v_loose_id
    );

    -- NULL ⇒ no block AND no container yet ⇒ a fresh day, never a conflict.
    IF target_program IS NOT NULL THEN
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
    -- Dated block wins; otherwise get-or-create the loose container.
    target_program := COALESCE(
      public._program_for_date(src_client_id, cur_date),
      public._get_or_create_loose_program(src_client_id)
    );

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
REVOKE EXECUTE ON FUNCTION public.repeat_program_day_weekly(uuid, date, boolean) FROM anon;
GRANT  EXECUTE ON FUNCTION public.repeat_program_day_weekly(uuid, date, boolean) TO authenticated;


-- ----------------------------------------------------------------------------
-- §5. copy_program_week — pass 1 scan resolves bare targets to the existing
--     container; pass 2 already delegates to copy_program_day (now loose-
--     aware), so it needs no change.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.copy_program_week(
  p_client_id         uuid,
  p_source_week_start date,
  p_target_week_start date,
  p_force             boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org       uuid := public.user_organization_id();
  caller_role      text := public.user_role();
  v_client_org     uuid;
  v_src            record;
  v_target         date;
  v_target_program uuid;
  v_loose_id       uuid;
  v_existing       uuid;
  v_result         jsonb;
  v_found_any      boolean := false;
  conflicts        jsonb := '[]'::jsonb;
  no_program_dates jsonb := '[]'::jsonb;
  new_day_ids      jsonb := '[]'::jsonb;
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT organization_id INTO v_client_org
    FROM clients
   WHERE id = p_client_id
     AND deleted_at IS NULL;

  IF v_client_org IS NULL OR v_client_org <> caller_org THEN
    RAISE EXCEPTION 'Client not in your organization'
      USING ERRCODE = '42501';
  END IF;

  IF EXTRACT(ISODOW FROM p_source_week_start) <> 1
     OR EXTRACT(ISODOW FROM p_target_week_start) <> 1
     OR p_target_week_start = p_source_week_start THEN
    RETURN jsonb_build_object('status', 'invalid_week');
  END IF;

  -- Existing loose container (scan only — pass 2's copy_program_day creates).
  SELECT id INTO v_loose_id
    FROM programs
   WHERE client_id = p_client_id AND is_loose AND deleted_at IS NULL
   LIMIT 1;

  -- Pass 1: bucket every source day's target into {create, conflict}. A bare
  -- target with no existing container day is just a fresh create (no conflict).
  FOR v_src IN
    SELECT pd.id, pd.scheduled_date
      FROM program_days pd
      JOIN programs p ON p.id = pd.program_id
     WHERE p.client_id = p_client_id
       AND p.organization_id = caller_org
       AND p.status = 'active'
       AND p.deleted_at IS NULL
       AND pd.deleted_at IS NULL
       AND pd.scheduled_date >= p_source_week_start
       AND pd.scheduled_date <  p_source_week_start + 7
     ORDER BY pd.scheduled_date, pd.sort_order
  LOOP
    v_found_any := true;
    v_target := p_target_week_start + (v_src.scheduled_date - p_source_week_start);
    v_target_program := COALESCE(
      public._program_for_date(p_client_id, v_target),
      v_loose_id
    );

    IF v_target_program IS NOT NULL THEN
      SELECT id INTO v_existing
        FROM program_days
       WHERE program_id = v_target_program
         AND scheduled_date = v_target
         AND deleted_at IS NULL;

      IF v_existing IS NOT NULL THEN
        conflicts := conflicts || jsonb_build_object(
          'date', v_target,
          'existing_day_id', v_existing
        );
      END IF;
    END IF;
  END LOOP;

  IF NOT v_found_any THEN
    RETURN jsonb_build_object('status', 'empty_week');
  END IF;

  IF jsonb_array_length(conflicts) > 0 AND NOT p_force THEN
    RETURN jsonb_build_object(
      'status', 'conflict',
      'conflicts', conflicts,
      'no_program_dates', no_program_dates
    );
  END IF;

  -- Pass 2: delegate each pair to copy_program_day (loose-aware; force=true).
  FOR v_src IN
    SELECT pd.id, pd.scheduled_date
      FROM program_days pd
      JOIN programs p ON p.id = pd.program_id
     WHERE p.client_id = p_client_id
       AND p.organization_id = caller_org
       AND p.status = 'active'
       AND p.deleted_at IS NULL
       AND pd.deleted_at IS NULL
       AND pd.scheduled_date >= p_source_week_start
       AND pd.scheduled_date <  p_source_week_start + 7
     ORDER BY pd.scheduled_date, pd.sort_order
  LOOP
    v_target := p_target_week_start + (v_src.scheduled_date - p_source_week_start);
    v_result := public.copy_program_day(v_src.id, v_target, true);

    IF v_result->>'status' = 'created' THEN
      new_day_ids := new_day_ids || (v_result->'new_day_id');
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'created',
    'new_day_ids', new_day_ids,
    'no_program_dates', no_program_dates
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.copy_program_week(uuid, date, date, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.copy_program_week(uuid, date, date, boolean) FROM anon;
GRANT  EXECUTE ON FUNCTION public.copy_program_week(uuid, date, date, boolean) TO authenticated;


-- ----------------------------------------------------------------------------
-- §6. repeat_program_week — pass 1 scan resolves bare targets to the existing
--     container; pass 2 drops its _program_for_date guard so bare targets are
--     delegated to copy_program_day (which lands them on the loose container).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.repeat_program_week(
  p_client_id         uuid,
  p_source_week_start date,
  p_end_date          date,
  p_force             boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org        uuid := public.user_organization_id();
  caller_role       text := public.user_role();
  v_client_org      uuid;
  v_src             record;
  v_offset          int;
  v_target          date;
  v_target_program  uuid;
  v_loose_id        uuid;
  v_existing        uuid;
  v_result          jsonb;
  v_found_any       boolean := false;
  v_anchor_program  uuid;
  v_anchor_start    date;
  v_anchor_duration int;
  required_duration int;
  conflicts         jsonb := '[]'::jsonb;
  no_program_dates  jsonb := '[]'::jsonb;
  new_day_ids       jsonb := '[]'::jsonb;
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT organization_id INTO v_client_org
    FROM clients
   WHERE id = p_client_id
     AND deleted_at IS NULL;

  IF v_client_org IS NULL OR v_client_org <> caller_org THEN
    RAISE EXCEPTION 'Client not in your organization'
      USING ERRCODE = '42501';
  END IF;

  IF EXTRACT(ISODOW FROM p_source_week_start) <> 1 THEN
    RETURN jsonb_build_object('status', 'invalid_week');
  END IF;

  IF p_end_date <= p_source_week_start + 6
     OR p_end_date > p_source_week_start + (7 * 105) THEN
    RETURN jsonb_build_object('status', 'invalid_end_date');
  END IF;

  SELECT p.id, p.start_date, p.duration_weeks
    INTO v_anchor_program, v_anchor_start, v_anchor_duration
    FROM program_days pd
    JOIN programs p ON p.id = pd.program_id
   WHERE p.client_id = p_client_id
     AND p.organization_id = caller_org
     AND p.status = 'active'
     AND p.deleted_at IS NULL
     AND pd.deleted_at IS NULL
     AND pd.scheduled_date >= p_source_week_start
     AND pd.scheduled_date <  p_source_week_start + 7
   ORDER BY pd.scheduled_date DESC, pd.sort_order DESC
   LIMIT 1;

  IF v_anchor_program IS NULL THEN
    RETURN jsonb_build_object('status', 'empty_week');
  END IF;

  IF v_anchor_start IS NOT NULL AND v_anchor_duration IS NOT NULL THEN
    required_duration := (p_end_date - v_anchor_start) / 7 + 1;
    IF required_duration > v_anchor_duration THEN
      BEGIN
        UPDATE programs
           SET duration_weeks = required_duration
         WHERE id = v_anchor_program;
      EXCEPTION WHEN exclusion_violation THEN
        NULL;
      END;
    END IF;
  END IF;

  -- Existing loose container (scan only).
  SELECT id INTO v_loose_id
    FROM programs
   WHERE client_id = p_client_id AND is_loose AND deleted_at IS NULL
   LIMIT 1;

  -- Pass 1: bucket every (source day x target week) pair into {create, conflict}.
  v_offset := 7;
  WHILE p_source_week_start + v_offset <= p_end_date LOOP
    FOR v_src IN
      SELECT pd.id, pd.scheduled_date
        FROM program_days pd
        JOIN programs p ON p.id = pd.program_id
       WHERE p.client_id = p_client_id
         AND p.organization_id = caller_org
         AND p.status = 'active'
         AND p.deleted_at IS NULL
         AND pd.deleted_at IS NULL
         AND pd.scheduled_date >= p_source_week_start
         AND pd.scheduled_date <  p_source_week_start + 7
       ORDER BY pd.scheduled_date, pd.sort_order
    LOOP
      v_found_any := true;
      v_target := v_src.scheduled_date + v_offset;
      EXIT WHEN v_target > p_end_date;

      v_target_program := COALESCE(
        public._program_for_date(p_client_id, v_target),
        v_loose_id
      );

      IF v_target_program IS NOT NULL THEN
        SELECT id INTO v_existing
          FROM program_days
         WHERE program_id = v_target_program
           AND scheduled_date = v_target
           AND deleted_at IS NULL;

        IF v_existing IS NOT NULL THEN
          conflicts := conflicts || jsonb_build_object(
            'date', v_target,
            'existing_day_id', v_existing
          );
        END IF;
      END IF;
    END LOOP;

    v_offset := v_offset + 7;
  END LOOP;

  IF NOT v_found_any THEN
    RETURN jsonb_build_object('status', 'empty_week');
  END IF;

  IF jsonb_array_length(conflicts) > 0 AND NOT p_force THEN
    RETURN jsonb_build_object(
      'status', 'conflict',
      'conflicts', conflicts,
      'no_program_dates', no_program_dates
    );
  END IF;

  -- Pass 2: delegate every pair to copy_program_day (loose-aware; force=true).
  -- No _program_for_date guard — a bare target lands on the loose container.
  v_offset := 7;
  WHILE p_source_week_start + v_offset <= p_end_date LOOP
    FOR v_src IN
      SELECT pd.id, pd.scheduled_date
        FROM program_days pd
        JOIN programs p ON p.id = pd.program_id
       WHERE p.client_id = p_client_id
         AND p.organization_id = caller_org
         AND p.status = 'active'
         AND p.deleted_at IS NULL
         AND pd.deleted_at IS NULL
         AND pd.scheduled_date >= p_source_week_start
         AND pd.scheduled_date <  p_source_week_start + 7
       ORDER BY pd.scheduled_date, pd.sort_order
    LOOP
      v_target := v_src.scheduled_date + v_offset;
      EXIT WHEN v_target > p_end_date;

      v_result := public.copy_program_day(v_src.id, v_target, true);
      IF v_result->>'status' = 'created' THEN
        new_day_ids := new_day_ids || (v_result->'new_day_id');
      END IF;
    END LOOP;

    v_offset := v_offset + 7;
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'created',
    'new_day_ids', new_day_ids,
    'no_program_dates', no_program_dates
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.repeat_program_week(uuid, date, date, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.repeat_program_week(uuid, date, date, boolean) FROM anon;
GRANT  EXECUTE ON FUNCTION public.repeat_program_week(uuid, date, date, boolean) TO authenticated;
