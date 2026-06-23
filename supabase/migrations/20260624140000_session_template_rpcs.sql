-- ============================================================================
-- 20260624140000_session_template_rpcs
-- ============================================================================
-- Why: S-2/S-3 of the Library Sessions/Programs editors pass
-- (docs/polish/library-sessions-programs.md). The SECURITY DEFINER RPCs behind
-- the in-Library session editor + the apply/save loop.
--
-- Full parity (operator, 2026-06-24): the DayContentEditor cloned the session
-- builder's FULL grouping engine, so sessions get the builder's two engine RPCs
-- cloned 1:1 (retargeted to session_template_* tables, org-guarded via
-- session_templates rather than the program_days->programs walk):
--   • insert_session_exercise_at   — slot-aware insert + sort-shift + group
--                                     inheritance + per-set fan-out from the
--                                     exercise's defaults (mirrors
--                                     insert_program_exercise_at).
--   • reorder_session_exercises     — sort rewrite + moved-card group re-
--                                     derivation + section reconcile + singleton
--                                     cleanup (mirrors reorder_program_exercises).
-- Plus the copy + lifecycle RPCs:
--   • apply_session_to_program_day  — S-2 copy-on-apply: COPY a session's
--                                     exercises+sets into an EXISTING program day,
--                                     remapping every superset group to a fresh id
--                                     and appending after the day's rows.
--   • save_day_as_session           — S-6 save-from-builder: COPY a real
--                                     program_day's exercises+sets into a NEW
--                                     session_template (fresh group remap, dup-name
--                                     guard).
--   • soft_delete_session_template / _exercise / _exercise_set — the deleted_at
--                                     RLS trap escape (mirror the circuit family).
--
-- All: org/role guarded in-body (anon -> user_organization_id() NULL -> 42501),
-- and anon EXECUTE revoked AT CREATION (the Supabase default-grant trap). The
-- pgTAP grant tripwire is S-7 (test 41). rep_metric threads through every copy
-- + fan-out path (the volume axis).
--
-- Copy-on-apply / divergence (FM-D): apply + save COPY rows; editing a session
-- template never mutates an already-placed program instance, and vice-versa.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- insert_session_exercise_at — mirrors insert_program_exercise_at
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.insert_session_exercise_at(
  p_session_id   uuid,
  p_exercise_id  uuid,
  p_after_id     uuid DEFAULT NULL,
  p_slot         text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org   uuid := public.user_organization_id();
  caller_role  text := public.user_role();

  v_slot       text;
  v_session_org uuid;
  v_anchor_so  int;
  v_anchor_grp uuid;
  v_below_grp  uuid;
  v_new_so     int;
  v_new_grp    uuid;
  v_new_id     uuid;

  v_default_sets       smallint;
  v_default_reps       text;
  v_default_rep_metric text;
  v_default_metric     text;
  v_default_value      text;
  v_default_rest       int;
  v_default_instr      text;
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner', 'staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  v_slot := COALESCE(
    p_slot,
    CASE WHEN p_after_id IS NULL THEN 'at_start' ELSE 'after' END
  );

  IF v_slot NOT IN ('append', 'at_start', 'after') THEN
    RAISE EXCEPTION 'invalid p_slot %', v_slot USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_slot = 'after' AND p_after_id IS NULL THEN
    RAISE EXCEPTION 'p_slot=after requires p_after_id' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_slot IN ('append', 'at_start') AND p_after_id IS NOT NULL THEN
    RAISE EXCEPTION 'p_slot=% does not take an anchor', v_slot USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Session must be live + in the caller's org.
  SELECT organization_id INTO v_session_org
    FROM session_templates
   WHERE id = p_session_id AND deleted_at IS NULL;
  IF v_session_org IS NULL OR v_session_org <> caller_org THEN
    RAISE EXCEPTION 'session_template % not found in your organization', p_session_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Exercise must be live + in the caller's org (the enforce-org trigger backstops).
  SELECT default_sets, default_reps, default_rep_metric, default_metric,
         default_metric_value, default_rest_seconds, instructions
    INTO v_default_sets, v_default_reps, v_default_rep_metric, v_default_metric,
         v_default_value, v_default_rest, v_default_instr
    FROM exercises
   WHERE id = p_exercise_id AND deleted_at IS NULL AND organization_id = caller_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'exercise % not found in your organization', p_exercise_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_slot = 'after' THEN
    SELECT sort_order, superset_group_id INTO v_anchor_so, v_anchor_grp
      FROM session_template_exercises
     WHERE id = p_after_id AND session_template_id = p_session_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'anchor session_template_exercise % not found in this session', p_after_id
        USING ERRCODE = 'no_data_found';
    END IF;
  END IF;

  IF v_slot = 'append' THEN
    SELECT COALESCE(MAX(sort_order), -1) + 1 INTO v_new_so
      FROM session_template_exercises
     WHERE session_template_id = p_session_id AND deleted_at IS NULL;
  ELSIF v_slot = 'at_start' THEN
    UPDATE session_template_exercises
       SET sort_order = sort_order + 1
     WHERE session_template_id = p_session_id AND deleted_at IS NULL;
    v_new_so := 0;
  ELSE
    UPDATE session_template_exercises
       SET sort_order = sort_order + 1
     WHERE session_template_id = p_session_id AND deleted_at IS NULL AND sort_order > v_anchor_so;
    v_new_so := v_anchor_so + 1;
  END IF;

  -- Group inheritance: inserting between two members of the same group joins it.
  IF v_anchor_grp IS NOT NULL THEN
    SELECT superset_group_id INTO v_below_grp
      FROM session_template_exercises
     WHERE session_template_id = p_session_id AND deleted_at IS NULL AND sort_order = v_new_so + 1;
    IF v_below_grp IS NOT NULL AND v_below_grp = v_anchor_grp THEN
      v_new_grp := v_anchor_grp;
    END IF;
  END IF;

  INSERT INTO session_template_exercises (
    session_template_id, exercise_id, sort_order, superset_group_id,
    rest_seconds, instructions
  ) VALUES (
    p_session_id, p_exercise_id, v_new_so, v_new_grp,
    v_default_rest, v_default_instr
  )
  RETURNING id INTO v_new_id;

  INSERT INTO session_template_exercise_sets (
    session_template_exercise_id, set_number, reps, rep_metric, optional_metric, optional_value
  )
  SELECT v_new_id, gs::smallint, v_default_reps, v_default_rep_metric, v_default_metric, v_default_value
    FROM generate_series(1, GREATEST(1, COALESCE(v_default_sets, 1))) AS gs;

  RETURN v_new_id;
END;
$$;

COMMENT ON FUNCTION public.insert_session_exercise_at(uuid, uuid, uuid, text) IS
  'Atomic insert of a session_template_exercise + per-set fan-out from the exercise defaults (incl. rep_metric). Slot + group-inheritance mirror insert_program_exercise_at. Org/role guarded.';

REVOKE EXECUTE ON FUNCTION public.insert_session_exercise_at(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.insert_session_exercise_at(uuid, uuid, uuid, text) TO authenticated;


-- ----------------------------------------------------------------------------
-- reorder_session_exercises — mirrors reorder_program_exercises (Phase G+J)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reorder_session_exercises(
  p_session_id    uuid,
  p_ordered_ids   uuid[],
  p_moved_id      uuid      -- NULL = rewrite sort_orders only, no group changes
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org    uuid := public.user_organization_id();
  caller_role   text := public.user_role();

  v_session_org uuid;
  v_live_count  int;
  v_array_count int := COALESCE(array_length(p_ordered_ids, 1), 0);

  v_old_so      int;
  v_new_so      int;
  v_old_grp     uuid;
  v_above_grp   uuid;
  v_below_grp   uuid;
  v_new_grp     uuid;
  v_new_section text;
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner', 'staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT organization_id INTO v_session_org
    FROM session_templates
   WHERE id = p_session_id AND deleted_at IS NULL;
  IF v_session_org IS NULL OR v_session_org <> caller_org THEN
    RAISE EXCEPTION 'session_template % not found in your organization', p_session_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_array_count = 0 THEN
    RAISE EXCEPTION 'Empty reorder array' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT COUNT(*) INTO v_live_count
    FROM session_template_exercises
   WHERE session_template_id = p_session_id AND deleted_at IS NULL;
  IF v_live_count <> v_array_count THEN
    RAISE EXCEPTION 'Reorder array size mismatch: % live rows, % ids supplied',
      v_live_count, v_array_count USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_ordered_ids) AS u(id)
     WHERE NOT EXISTS (
       SELECT 1 FROM session_template_exercises se
        WHERE se.id = u.id AND se.session_template_id = p_session_id AND se.deleted_at IS NULL
     )
  ) THEN
    RAISE EXCEPTION 'Reorder array contains ids not in this session' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF (SELECT COUNT(DISTINCT id) FROM unnest(p_ordered_ids) AS u(id)) <> v_array_count THEN
    RAISE EXCEPTION 'Reorder array contains duplicate ids' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_moved_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM unnest(p_ordered_ids) AS u(id) WHERE u.id = p_moved_id) THEN
      RAISE EXCEPTION 'Moved id % not present in reorder array', p_moved_id
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    SELECT sort_order, superset_group_id INTO v_old_so, v_old_grp
      FROM session_template_exercises
     WHERE id = p_moved_id AND session_template_id = p_session_id AND deleted_at IS NULL;
  END IF;

  -- Phase 1 — write new sort_orders.
  UPDATE session_template_exercises se
     SET sort_order = u.ord - 1
    FROM unnest(p_ordered_ids) WITH ORDINALITY AS u(id, ord)
   WHERE se.id = u.id AND se.session_template_id = p_session_id AND se.deleted_at IS NULL;

  -- Phase 2 — re-derive the moved card's group + reconcile its section.
  IF p_moved_id IS NOT NULL THEN
    SELECT sort_order INTO v_new_so
      FROM session_template_exercises
     WHERE id = p_moved_id AND session_template_id = p_session_id AND deleted_at IS NULL;

    IF v_new_so IS DISTINCT FROM v_old_so THEN
      SELECT superset_group_id INTO v_above_grp
        FROM session_template_exercises
       WHERE session_template_id = p_session_id AND deleted_at IS NULL AND sort_order = v_new_so - 1;
      SELECT superset_group_id INTO v_below_grp
        FROM session_template_exercises
       WHERE session_template_id = p_session_id AND deleted_at IS NULL AND sort_order = v_new_so + 1;

      IF v_above_grp IS NOT NULL AND v_above_grp = v_below_grp THEN
        v_new_grp := v_above_grp;
      ELSE
        v_new_grp := NULL;
      END IF;

      IF v_new_grp IS DISTINCT FROM v_old_grp THEN
        IF v_new_grp IS NULL THEN
          UPDATE session_template_exercises
             SET superset_group_id = NULL, section_title = NULL
           WHERE id = p_moved_id;
        ELSE
          SELECT section_title INTO v_new_section
            FROM session_template_exercises
           WHERE session_template_id = p_session_id AND deleted_at IS NULL
             AND superset_group_id = v_new_grp AND id <> p_moved_id
           LIMIT 1;
          UPDATE session_template_exercises
             SET superset_group_id = v_new_grp, section_title = v_new_section
           WHERE id = p_moved_id;
        END IF;
      END IF;
    END IF;
  END IF;

  -- Phase 3 — singleton cleanup (survivor keeps its section).
  UPDATE session_template_exercises
     SET superset_group_id = NULL
   WHERE session_template_id = p_session_id AND deleted_at IS NULL
     AND superset_group_id IN (
       SELECT superset_group_id
         FROM session_template_exercises
        WHERE session_template_id = p_session_id AND deleted_at IS NULL
          AND superset_group_id IS NOT NULL
        GROUP BY superset_group_id
        HAVING COUNT(*) = 1
     );
END;
$$;

COMMENT ON FUNCTION public.reorder_session_exercises(uuid, uuid[], uuid) IS
  'Atomic reorder of a session template''s exercises. p_ordered_ids must be a permutation of the session''s live ids; sort_order is rewritten to ordinality. Group re-derivation + section reconcile + singleton cleanup mirror reorder_program_exercises. Org/role guarded.';

REVOKE EXECUTE ON FUNCTION public.reorder_session_exercises(uuid, uuid[], uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reorder_session_exercises(uuid, uuid[], uuid) TO authenticated;


-- ----------------------------------------------------------------------------
-- apply_session_to_program_day — S-2 copy-on-apply into an EXISTING day
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_session_to_program_day(
  p_session_id     uuid,
  p_program_day_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_org uuid := public.user_organization_id();
  v_caller_role text := public.user_role();
  v_base_sort  int;
  v_count      int := 0;
  v_se         record;
  v_new_pe_id  uuid;
  v_group_map  jsonb := '{}'::jsonb;   -- old session group id -> fresh program group id
  v_mapped     text;
  v_new_grp    uuid;
BEGIN
  IF v_caller_org IS NULL OR v_caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Session must be live + in the caller's org.
  PERFORM 1 FROM session_templates
   WHERE id = p_session_id AND organization_id = v_caller_org AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_template % not found in your organization', p_session_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Target day must be live + in the caller's org (via its program).
  PERFORM 1 FROM program_days pd
    JOIN programs p ON p.id = pd.program_id
   WHERE pd.id = p_program_day_id AND p.organization_id = v_caller_org AND pd.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'program_day % not found in your organization', p_program_day_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Append after the day's existing exercises.
  SELECT COALESCE(MAX(sort_order), -1) + 1 INTO v_base_sort
    FROM program_exercises
   WHERE program_day_id = p_program_day_id AND deleted_at IS NULL;

  FOR v_se IN
    SELECT * FROM session_template_exercises
     WHERE session_template_id = p_session_id AND deleted_at IS NULL
     ORDER BY sort_order, created_at
  LOOP
    -- Remap each distinct session superset group to a fresh id; solo stays solo.
    IF v_se.superset_group_id IS NOT NULL THEN
      v_mapped := v_group_map ->> v_se.superset_group_id::text;
      IF v_mapped IS NULL THEN
        v_mapped := gen_random_uuid()::text;
        v_group_map := v_group_map || jsonb_build_object(v_se.superset_group_id::text, v_mapped);
      END IF;
      v_new_grp := v_mapped::uuid;
    ELSE
      v_new_grp := NULL;
    END IF;

    INSERT INTO program_exercises (
      program_day_id, exercise_id, sort_order, section_title, superset_group_id,
      sets, reps, rest_seconds, rpe, optional_metric, optional_value, tempo, instructions
    ) VALUES (
      p_program_day_id, v_se.exercise_id, v_base_sort + v_count, v_se.section_title, v_new_grp,
      v_se.sets, v_se.reps, v_se.rest_seconds, v_se.rpe,
      v_se.optional_metric, v_se.optional_value, v_se.tempo, v_se.instructions
    )
    RETURNING id INTO v_new_pe_id;

    INSERT INTO program_exercise_sets (
      program_exercise_id, set_number, reps, rep_metric, optional_metric, optional_value
    )
    SELECT v_new_pe_id, ses.set_number, ses.reps, ses.rep_metric, ses.optional_metric, ses.optional_value
      FROM session_template_exercise_sets ses
     WHERE ses.session_template_exercise_id = v_se.id AND ses.deleted_at IS NULL
     ORDER BY ses.set_number;

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('status', 'inserted', 'inserted_count', v_count);
END;
$$;

COMMENT ON FUNCTION public.apply_session_to_program_day(uuid, uuid) IS
  'S-2: copy a session template''s exercises (+ per-set rows, incl. rep_metric) into an EXISTING program day, appended after its rows, with every superset group remapped to a fresh id. Copy-on-apply — editing the source session never touches a placed instance. Org/role guarded.';

REVOKE EXECUTE ON FUNCTION public.apply_session_to_program_day(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.apply_session_to_program_day(uuid, uuid) TO authenticated;


-- ----------------------------------------------------------------------------
-- save_day_as_session — S-6 save-from-builder: program_day -> new session
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_day_as_session(
  p_program_day_id uuid,
  p_name           text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_org uuid := public.user_organization_id();
  v_caller_role text := public.user_role();
  v_name       text := trim(p_name);
  v_session_id uuid;
  v_pe         record;
  v_new_se_id  uuid;
  v_sort       int := 0;
  v_group_map  jsonb := '{}'::jsonb;
  v_mapped     text;
  v_new_grp    uuid;
BEGIN
  IF v_caller_org IS NULL OR v_caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF v_name IS NULL OR length(v_name) < 1 OR length(v_name) > 80 THEN
    RAISE EXCEPTION 'Session name must be 1-80 characters' USING ERRCODE = 'check_violation';
  END IF;

  -- Source day must be live + in the caller's org.
  PERFORM 1 FROM program_days pd
    JOIN programs p ON p.id = pd.program_id
   WHERE pd.id = p_program_day_id AND p.organization_id = v_caller_org AND pd.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'program_day % not found in your organization', p_program_day_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Duplicate-name guard (case-insensitive, live session_templates only).
  IF EXISTS (
    SELECT 1 FROM session_templates
     WHERE organization_id = v_caller_org AND deleted_at IS NULL AND lower(name) = lower(v_name)
  ) THEN
    RETURN jsonb_build_object('status', 'duplicate_name');
  END IF;

  INSERT INTO session_templates (organization_id, created_by_user_id, name)
  VALUES (v_caller_org, auth.uid(), v_name)
  RETURNING id INTO v_session_id;

  FOR v_pe IN
    SELECT * FROM program_exercises
     WHERE program_day_id = p_program_day_id AND deleted_at IS NULL
     ORDER BY sort_order, created_at
  LOOP
    IF v_pe.superset_group_id IS NOT NULL THEN
      v_mapped := v_group_map ->> v_pe.superset_group_id::text;
      IF v_mapped IS NULL THEN
        v_mapped := gen_random_uuid()::text;
        v_group_map := v_group_map || jsonb_build_object(v_pe.superset_group_id::text, v_mapped);
      END IF;
      v_new_grp := v_mapped::uuid;
    ELSE
      v_new_grp := NULL;
    END IF;

    INSERT INTO session_template_exercises (
      session_template_id, exercise_id, sort_order, section_title, superset_group_id,
      sets, reps, rest_seconds, rpe, optional_metric, optional_value, tempo, instructions
    ) VALUES (
      v_session_id, v_pe.exercise_id, v_sort, v_pe.section_title, v_new_grp,
      v_pe.sets, v_pe.reps, v_pe.rest_seconds, v_pe.rpe,
      v_pe.optional_metric, v_pe.optional_value, v_pe.tempo, v_pe.instructions
    )
    RETURNING id INTO v_new_se_id;

    INSERT INTO session_template_exercise_sets (
      session_template_exercise_id, set_number, reps, rep_metric, optional_metric, optional_value
    )
    SELECT v_new_se_id, pes.set_number, pes.reps, pes.rep_metric, pes.optional_metric, pes.optional_value
      FROM program_exercise_sets pes
     WHERE pes.program_exercise_id = v_pe.id AND pes.deleted_at IS NULL
     ORDER BY pes.set_number;

    v_sort := v_sort + 1;
  END LOOP;

  RETURN jsonb_build_object('status', 'created', 'session_id', v_session_id);
END;
$$;

COMMENT ON FUNCTION public.save_day_as_session(uuid, text) IS
  'S-6: copy a real program_day''s exercises (+ per-set rows, incl. rep_metric) into a NEW session_template, remapping every superset group to a fresh id. Duplicate name (case-insensitive) returns status=duplicate_name. Org/role guarded.';

REVOKE EXECUTE ON FUNCTION public.save_day_as_session(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.save_day_as_session(uuid, text) TO authenticated;


-- ----------------------------------------------------------------------------
-- soft_delete_session_template — mirrors soft_delete_circuit
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.soft_delete_session_template(p_id uuid)
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

  UPDATE session_templates
     SET deleted_at = now()
   WHERE id = p_id AND organization_id = v_caller_org AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_template % not found in your organization, or already deleted', p_id
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.soft_delete_session_template(uuid) IS
  'Soft-delete a session template (deleted_at). Children left intact; already-placed instances are independent copies, unaffected.';

REVOKE EXECUTE ON FUNCTION public.soft_delete_session_template(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.soft_delete_session_template(uuid) TO authenticated;


-- ----------------------------------------------------------------------------
-- soft_delete_session_template_exercise — via-parent org walk
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.soft_delete_session_template_exercise(p_id uuid)
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

  UPDATE session_template_exercises se
     SET deleted_at = now()
   WHERE se.id = p_id
     AND se.deleted_at IS NULL
     AND EXISTS (
       SELECT 1 FROM session_templates s
        WHERE s.id = se.session_template_id
          AND s.organization_id = v_caller_org
          AND s.deleted_at IS NULL
     );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_template_exercise % not found in your organization, or already deleted', p_id
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.soft_delete_session_template_exercise(uuid) IS
  'Soft-delete one session_template_exercise (deleted_at), org-checked via its parent session. SECURITY DEFINER escapes the deleted_at-IS-NULL SELECT-policy trap.';

REVOKE EXECUTE ON FUNCTION public.soft_delete_session_template_exercise(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.soft_delete_session_template_exercise(uuid) TO authenticated;


-- ----------------------------------------------------------------------------
-- soft_delete_session_template_exercise_set — via-grandparent org walk
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.soft_delete_session_template_exercise_set(p_id uuid)
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

  UPDATE session_template_exercise_sets ses
     SET deleted_at = now()
   WHERE ses.id = p_id
     AND ses.deleted_at IS NULL
     AND EXISTS (
       SELECT 1 FROM session_template_exercises se
         JOIN session_templates s ON s.id = se.session_template_id
        WHERE se.id = ses.session_template_exercise_id
          AND s.organization_id = v_caller_org
          AND s.deleted_at IS NULL
     );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_template_exercise_set % not found in your organization, or already deleted', p_id
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.soft_delete_session_template_exercise_set(uuid) IS
  'Soft-delete one session_template_exercise_set (deleted_at), org-checked via its grandparent session. SECURITY DEFINER escapes the deleted_at-IS-NULL SELECT-policy trap.';

REVOKE EXECUTE ON FUNCTION public.soft_delete_session_template_exercise_set(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.soft_delete_session_template_exercise_set(uuid) TO authenticated;
