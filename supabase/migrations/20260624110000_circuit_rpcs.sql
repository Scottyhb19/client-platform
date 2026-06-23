-- ============================================================================
-- 20260624110000_circuit_rpcs
-- ============================================================================
-- Why: C-2 of the Library Circuits/Sessions pass
-- (docs/polish/library-circuits-sessions.md). The three SECURITY DEFINER RPCs
-- behind the circuit loop:
--   • save_group_as_circuit   — C-5 save-from-builder (Q-2): a selected set of
--                               program_exercises (+ their per-set rows) → a new
--                               reusable circuit. Duplicate-name guarded.
--   • insert_circuit_into_day — C-6 use: COPY a circuit's exercises + per-set
--                               rows into an existing program day (copy-on-apply,
--                               FM-D: editing the library circuit never mutates a
--                               placed instance), under one fresh superset group.
--   • soft_delete_circuit     — C-4 delete (mirrors soft_delete_program_template).
--
-- All three: org/role guarded in-body (anon → user_organization_id() NULL →
-- 42501), and anon EXECUTE revoked AT CREATION (the Supabase default-grant trap
-- bit us 3× this session — client_log_set / soft_delete_program_template / the
-- soft_delete family; pgTAP grant tripwire is C-3 / test 39). rep_metric threads
-- through both copy paths (the volume axis, 20260623100000).
--
-- Cross-org safety: every path resolves the caller's org and checks each
-- referenced row (circuit / program_day / program_exercise) belongs to it; the
-- circuit_exercises enforce-exercise-org trigger (C-1) backstops the save path.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- save_group_as_circuit — C-5 (save-from-builder)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_group_as_circuit(
  p_name                 text,
  p_circuit_type         text,
  p_program_exercise_ids uuid[],
  p_notes                text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_org  uuid := public.user_organization_id();
  v_caller_role text := public.user_role();
  v_name        text := trim(p_name);
  v_circuit_id  uuid;
  v_pe_count    int;
  v_valid_count int;
  v_pe          record;
  v_new_ce_id   uuid;
  v_sort        int := 0;
BEGIN
  IF v_caller_org IS NULL OR v_caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF v_name IS NULL OR length(v_name) < 1 OR length(v_name) > 80 THEN
    RAISE EXCEPTION 'Circuit name must be 1-80 characters' USING ERRCODE = 'check_violation';
  END IF;
  IF p_circuit_type NOT IN ('superset','triset','circuit','finisher','warmup') THEN
    RAISE EXCEPTION 'Invalid circuit type %', p_circuit_type USING ERRCODE = 'check_violation';
  END IF;
  IF p_program_exercise_ids IS NULL OR array_length(p_program_exercise_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Pick at least one exercise' USING ERRCODE = 'check_violation';
  END IF;

  -- Every referenced program_exercise must be live + in the caller's org.
  v_pe_count := array_length(p_program_exercise_ids, 1);
  SELECT count(*) INTO v_valid_count
    FROM program_exercises pe
    JOIN program_days pd ON pd.id = pe.program_day_id
    JOIN programs      p  ON p.id  = pd.program_id
   WHERE pe.id = ANY(p_program_exercise_ids)
     AND pe.deleted_at IS NULL
     AND p.organization_id = v_caller_org;
  IF v_valid_count <> v_pe_count THEN
    RAISE EXCEPTION 'One or more exercises are not in your organization' USING ERRCODE = '42501';
  END IF;

  -- Duplicate-name guard (case-insensitive, live circuits only).
  IF EXISTS (
    SELECT 1 FROM circuits
     WHERE organization_id = v_caller_org
       AND deleted_at IS NULL
       AND lower(name) = lower(v_name)
  ) THEN
    RETURN jsonb_build_object('status', 'duplicate_name');
  END IF;

  INSERT INTO circuits (organization_id, created_by_user_id, name, circuit_type, notes)
  VALUES (v_caller_org, auth.uid(), v_name, p_circuit_type, p_notes)
  RETURNING id INTO v_circuit_id;

  -- Copy each exercise in the given array order → circuit_exercise + its per-set rows.
  FOR v_pe IN
    SELECT pe.*
      FROM program_exercises pe
     WHERE pe.id = ANY(p_program_exercise_ids) AND pe.deleted_at IS NULL
     ORDER BY array_position(p_program_exercise_ids, pe.id)
  LOOP
    INSERT INTO circuit_exercises (
      circuit_id, exercise_id, sort_order,
      sets, reps, rest_seconds, rpe, optional_metric, optional_value, tempo, instructions
    ) VALUES (
      v_circuit_id, v_pe.exercise_id, v_sort,
      v_pe.sets, v_pe.reps, v_pe.rest_seconds, v_pe.rpe,
      v_pe.optional_metric, v_pe.optional_value, v_pe.tempo, v_pe.instructions
    )
    RETURNING id INTO v_new_ce_id;

    INSERT INTO circuit_exercise_sets (
      circuit_exercise_id, set_number, reps, rep_metric, optional_metric, optional_value
    )
    SELECT v_new_ce_id, pes.set_number, pes.reps, pes.rep_metric, pes.optional_metric, pes.optional_value
      FROM program_exercise_sets pes
     WHERE pes.program_exercise_id = v_pe.id AND pes.deleted_at IS NULL
     ORDER BY pes.set_number;

    v_sort := v_sort + 1;
  END LOOP;

  RETURN jsonb_build_object('status', 'created', 'circuit_id', v_circuit_id);
END;
$$;

COMMENT ON FUNCTION public.save_group_as_circuit(text, text, uuid[], text) IS
  'C-5: save a selected set of program_exercises (+ per-set rows) as a reusable circuit. Org/role guarded; duplicate-name returns status=duplicate_name; rep_metric preserved.';

REVOKE EXECUTE ON FUNCTION public.save_group_as_circuit(text, text, uuid[], text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.save_group_as_circuit(text, text, uuid[], text) TO authenticated;

-- ----------------------------------------------------------------------------
-- insert_circuit_into_day — C-6 (copy-on-apply)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.insert_circuit_into_day(
  p_circuit_id     uuid,
  p_program_day_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_org   uuid := public.user_organization_id();
  v_caller_role  text := public.user_role();
  v_circuit_type text;
  v_circuit_name text;
  v_group_id     uuid;
  v_base_sort    int;
  v_count        int := 0;
  v_ce           record;
  v_new_pe_id    uuid;
BEGIN
  IF v_caller_org IS NULL OR v_caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Circuit must be live + in the caller's org.
  SELECT circuit_type, name INTO v_circuit_type, v_circuit_name
    FROM circuits
   WHERE id = p_circuit_id AND organization_id = v_caller_org AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Circuit % not found in your organization', p_circuit_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Target day must be live + in the caller's org (via its program).
  PERFORM 1
    FROM program_days pd
    JOIN programs p ON p.id = pd.program_id
   WHERE pd.id = p_program_day_id
     AND p.organization_id = v_caller_org
     AND pd.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Program day % not found in your organization', p_program_day_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Grouped circuit types share ONE fresh superset group; a warm-up stays flat.
  v_group_id := CASE WHEN v_circuit_type = 'warmup' THEN NULL ELSE gen_random_uuid() END;

  -- Append after the day's existing exercises.
  SELECT COALESCE(MAX(sort_order), -1) + 1 INTO v_base_sort
    FROM program_exercises
   WHERE program_day_id = p_program_day_id AND deleted_at IS NULL;

  FOR v_ce IN
    SELECT * FROM circuit_exercises
     WHERE circuit_id = p_circuit_id AND deleted_at IS NULL
     ORDER BY sort_order, created_at
  LOOP
    INSERT INTO program_exercises (
      program_day_id, exercise_id, sort_order, section_title, superset_group_id,
      sets, reps, rest_seconds, rpe, optional_metric, optional_value, tempo, instructions
    ) VALUES (
      p_program_day_id, v_ce.exercise_id, v_base_sort + v_count,
      -- Label the block with the circuit name on the first row only (superset
      -- section-title convention); cap at the section_title CHECK (60).
      CASE WHEN v_count = 0 THEN left(v_circuit_name, 60) ELSE NULL END,
      v_group_id,
      v_ce.sets, v_ce.reps, v_ce.rest_seconds, v_ce.rpe,
      v_ce.optional_metric, v_ce.optional_value, v_ce.tempo, v_ce.instructions
    )
    RETURNING id INTO v_new_pe_id;

    INSERT INTO program_exercise_sets (
      program_exercise_id, set_number, reps, rep_metric, optional_metric, optional_value
    )
    SELECT v_new_pe_id, ces.set_number, ces.reps, ces.rep_metric, ces.optional_metric, ces.optional_value
      FROM circuit_exercise_sets ces
     WHERE ces.circuit_exercise_id = v_ce.id AND ces.deleted_at IS NULL
     ORDER BY ces.set_number;

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'inserted',
    'inserted_count', v_count,
    'superset_group_id', v_group_id
  );
END;
$$;

COMMENT ON FUNCTION public.insert_circuit_into_day(uuid, uuid) IS
  'C-6: copy a circuit''s exercises (+ per-set rows, incl. rep_metric) into a program day under one fresh superset group (flat for warmups). Copy-on-apply — editing the source circuit never touches a placed instance. Org/role guarded.';

REVOKE EXECUTE ON FUNCTION public.insert_circuit_into_day(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.insert_circuit_into_day(uuid, uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- soft_delete_circuit — C-4 (mirrors soft_delete_program_template)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.soft_delete_circuit(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_org  uuid := public.user_organization_id();
  v_caller_role text := public.user_role();
BEGIN
  IF v_caller_org IS NULL OR v_caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  UPDATE circuits
     SET deleted_at = now()
   WHERE id = p_id AND organization_id = v_caller_org AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'circuit % not found in your organization, or already deleted', p_id
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.soft_delete_circuit(uuid) IS
  'C-4: soft-delete a circuit (deleted_at). Children left intact; already-placed instances are independent copies, unaffected. Mirrors soft_delete_program_template.';

REVOKE EXECUTE ON FUNCTION public.soft_delete_circuit(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.soft_delete_circuit(uuid) TO authenticated;
