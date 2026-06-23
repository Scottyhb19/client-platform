-- ============================================================================
-- 20260624150000_program_template_editor_rpcs
-- ============================================================================
-- Why: P-2 of the Library Sessions/Programs editors pass
-- (docs/polish/library-sessions-programs.md). The in-Library PROGRAM-TEMPLATE
-- editor (edit-existing, v1) reuses the same DayContentEditor as sessions, so
-- the same engine RPCs are cloned again — retargeted to the template_* tables
-- and org-guarded via the 3-hop walk template_days → template_weeks →
-- program_templates (template_exercises carries no organization_id).
--
--   • insert_template_exercise_at   — slot-aware insert + group inheritance +
--                                     per-set fan-out (mirrors the session RPC).
--   • reorder_template_exercises    — sort rewrite + group re-derivation +
--                                     section reconcile + singleton cleanup.
--   • soft_delete_template_exercise / _exercise_set / _day — the deleted_at RLS
--                                     trap escape (RLS denies DELETE on template_*).
--   • duplicate_template_day        — copy a day (+ exercises + per-set rows) within
--                                     its week, every superset group remapped fresh
--                                     (CTE pattern from duplicate_program_day).
--
-- All: org/role guarded in-body (anon → user_organization_id() NULL → 42501),
-- anon EXECUTE revoked AT CREATION. pgTAP grant tripwire is P-3 (test 42). The
-- existing template_exercises_enforce_org trigger (20260420101700) backstops
-- every exercise insert. rep_metric threads through every fan-out + copy path.
--
-- Editing a template does NOT touch programs instantiated from it
-- (create_program_from_template is a one-way copy — no trigger link). Day-level
-- add/rename/reorder are plain RLS writes from the editor; only the soft-delete
-- + duplicate operations need a SECURITY DEFINER RPC.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- insert_template_exercise_at — mirrors insert_session_exercise_at
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.insert_template_exercise_at(
  p_day_id       uuid,
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
  v_day_org    uuid;
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

  -- Day must be live + in the caller's org (walk day → week → template).
  SELECT pt.organization_id INTO v_day_org
    FROM template_days td
    JOIN template_weeks tw ON tw.id = td.template_week_id
    JOIN program_templates pt ON pt.id = tw.template_id
   WHERE td.id = p_day_id AND td.deleted_at IS NULL
     AND tw.deleted_at IS NULL AND pt.deleted_at IS NULL;
  IF v_day_org IS NULL OR v_day_org <> caller_org THEN
    RAISE EXCEPTION 'template_day % not found in your organization', p_day_id
      USING ERRCODE = 'no_data_found';
  END IF;

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
      FROM template_exercises
     WHERE id = p_after_id AND template_day_id = p_day_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'anchor template_exercise % not found in this day', p_after_id
        USING ERRCODE = 'no_data_found';
    END IF;
  END IF;

  IF v_slot = 'append' THEN
    SELECT COALESCE(MAX(sort_order), -1) + 1 INTO v_new_so
      FROM template_exercises WHERE template_day_id = p_day_id AND deleted_at IS NULL;
  ELSIF v_slot = 'at_start' THEN
    UPDATE template_exercises SET sort_order = sort_order + 1
     WHERE template_day_id = p_day_id AND deleted_at IS NULL;
    v_new_so := 0;
  ELSE
    UPDATE template_exercises SET sort_order = sort_order + 1
     WHERE template_day_id = p_day_id AND deleted_at IS NULL AND sort_order > v_anchor_so;
    v_new_so := v_anchor_so + 1;
  END IF;

  IF v_anchor_grp IS NOT NULL THEN
    SELECT superset_group_id INTO v_below_grp
      FROM template_exercises
     WHERE template_day_id = p_day_id AND deleted_at IS NULL AND sort_order = v_new_so + 1;
    IF v_below_grp IS NOT NULL AND v_below_grp = v_anchor_grp THEN
      v_new_grp := v_anchor_grp;
    END IF;
  END IF;

  INSERT INTO template_exercises (
    template_day_id, exercise_id, sort_order, superset_group_id,
    rest_seconds, instructions
  ) VALUES (
    p_day_id, p_exercise_id, v_new_so, v_new_grp, v_default_rest, v_default_instr
  )
  RETURNING id INTO v_new_id;

  INSERT INTO template_exercise_sets (
    template_exercise_id, set_number, reps, rep_metric, optional_metric, optional_value
  )
  SELECT v_new_id, gs::smallint, v_default_reps, v_default_rep_metric, v_default_metric, v_default_value
    FROM generate_series(1, GREATEST(1, COALESCE(v_default_sets, 1))) AS gs;

  RETURN v_new_id;
END;
$$;

COMMENT ON FUNCTION public.insert_template_exercise_at(uuid, uuid, uuid, text) IS
  'Atomic insert of a template_exercise + per-set fan-out from the exercise defaults (incl. rep_metric). Slot + group-inheritance mirror insert_session_exercise_at. Org/role guarded via the day→week→template walk.';

REVOKE EXECUTE ON FUNCTION public.insert_template_exercise_at(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.insert_template_exercise_at(uuid, uuid, uuid, text) TO authenticated;


-- ----------------------------------------------------------------------------
-- reorder_template_exercises — mirrors reorder_session_exercises
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reorder_template_exercises(
  p_day_id        uuid,
  p_ordered_ids   uuid[],
  p_moved_id      uuid      -- NULL = rewrite sort_orders only
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org    uuid := public.user_organization_id();
  caller_role   text := public.user_role();

  v_day_org     uuid;
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

  SELECT pt.organization_id INTO v_day_org
    FROM template_days td
    JOIN template_weeks tw ON tw.id = td.template_week_id
    JOIN program_templates pt ON pt.id = tw.template_id
   WHERE td.id = p_day_id AND td.deleted_at IS NULL
     AND tw.deleted_at IS NULL AND pt.deleted_at IS NULL;
  IF v_day_org IS NULL OR v_day_org <> caller_org THEN
    RAISE EXCEPTION 'template_day % not found in your organization', p_day_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_array_count = 0 THEN
    RAISE EXCEPTION 'Empty reorder array' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT COUNT(*) INTO v_live_count
    FROM template_exercises WHERE template_day_id = p_day_id AND deleted_at IS NULL;
  IF v_live_count <> v_array_count THEN
    RAISE EXCEPTION 'Reorder array size mismatch: % live rows, % ids supplied',
      v_live_count, v_array_count USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_ordered_ids) AS u(id)
     WHERE NOT EXISTS (
       SELECT 1 FROM template_exercises te
        WHERE te.id = u.id AND te.template_day_id = p_day_id AND te.deleted_at IS NULL
     )
  ) THEN
    RAISE EXCEPTION 'Reorder array contains ids not in this day' USING ERRCODE = 'invalid_parameter_value';
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
      FROM template_exercises
     WHERE id = p_moved_id AND template_day_id = p_day_id AND deleted_at IS NULL;
  END IF;

  -- Phase 1 — write new sort_orders.
  UPDATE template_exercises te
     SET sort_order = u.ord - 1
    FROM unnest(p_ordered_ids) WITH ORDINALITY AS u(id, ord)
   WHERE te.id = u.id AND te.template_day_id = p_day_id AND te.deleted_at IS NULL;

  -- Phase 2 — re-derive the moved card's group + reconcile its section.
  IF p_moved_id IS NOT NULL THEN
    SELECT sort_order INTO v_new_so
      FROM template_exercises
     WHERE id = p_moved_id AND template_day_id = p_day_id AND deleted_at IS NULL;

    IF v_new_so IS DISTINCT FROM v_old_so THEN
      SELECT superset_group_id INTO v_above_grp
        FROM template_exercises
       WHERE template_day_id = p_day_id AND deleted_at IS NULL AND sort_order = v_new_so - 1;
      SELECT superset_group_id INTO v_below_grp
        FROM template_exercises
       WHERE template_day_id = p_day_id AND deleted_at IS NULL AND sort_order = v_new_so + 1;

      IF v_above_grp IS NOT NULL AND v_above_grp = v_below_grp THEN
        v_new_grp := v_above_grp;
      ELSE
        v_new_grp := NULL;
      END IF;

      IF v_new_grp IS DISTINCT FROM v_old_grp THEN
        IF v_new_grp IS NULL THEN
          UPDATE template_exercises
             SET superset_group_id = NULL, section_title = NULL
           WHERE id = p_moved_id;
        ELSE
          SELECT section_title INTO v_new_section
            FROM template_exercises
           WHERE template_day_id = p_day_id AND deleted_at IS NULL
             AND superset_group_id = v_new_grp AND id <> p_moved_id
           LIMIT 1;
          UPDATE template_exercises
             SET superset_group_id = v_new_grp, section_title = v_new_section
           WHERE id = p_moved_id;
        END IF;
      END IF;
    END IF;
  END IF;

  -- Phase 3 — singleton cleanup (survivor keeps its section).
  UPDATE template_exercises
     SET superset_group_id = NULL
   WHERE template_day_id = p_day_id AND deleted_at IS NULL
     AND superset_group_id IN (
       SELECT superset_group_id
         FROM template_exercises
        WHERE template_day_id = p_day_id AND deleted_at IS NULL
          AND superset_group_id IS NOT NULL
        GROUP BY superset_group_id
        HAVING COUNT(*) = 1
     );
END;
$$;

COMMENT ON FUNCTION public.reorder_template_exercises(uuid, uuid[], uuid) IS
  'Atomic reorder of a template day''s exercises (group re-derivation + section reconcile + singleton cleanup), mirroring reorder_session_exercises. Org/role guarded via the day→week→template walk.';

REVOKE EXECUTE ON FUNCTION public.reorder_template_exercises(uuid, uuid[], uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reorder_template_exercises(uuid, uuid[], uuid) TO authenticated;


-- ----------------------------------------------------------------------------
-- soft_delete_template_exercise — via-parent (day→week→template) org walk
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.soft_delete_template_exercise(p_id uuid)
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

  UPDATE template_exercises te
     SET deleted_at = now()
   WHERE te.id = p_id
     AND te.deleted_at IS NULL
     AND EXISTS (
       SELECT 1 FROM template_days td
         JOIN template_weeks tw ON tw.id = td.template_week_id
         JOIN program_templates pt ON pt.id = tw.template_id
        WHERE td.id = te.template_day_id
          AND pt.organization_id = v_caller_org
          AND pt.deleted_at IS NULL
     );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'template_exercise % not found in your organization, or already deleted', p_id
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.soft_delete_template_exercise(uuid) IS
  'Soft-delete one template_exercise (deleted_at), org-checked via the day→week→template walk. SECURITY DEFINER escapes the deleted_at-IS-NULL SELECT-policy trap.';

REVOKE EXECUTE ON FUNCTION public.soft_delete_template_exercise(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.soft_delete_template_exercise(uuid) TO authenticated;


-- ----------------------------------------------------------------------------
-- soft_delete_template_exercise_set — via-grandparent walk
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.soft_delete_template_exercise_set(p_id uuid)
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

  UPDATE template_exercise_sets tes
     SET deleted_at = now()
   WHERE tes.id = p_id
     AND tes.deleted_at IS NULL
     AND EXISTS (
       SELECT 1 FROM template_exercises te
         JOIN template_days td ON td.id = te.template_day_id
         JOIN template_weeks tw ON tw.id = td.template_week_id
         JOIN program_templates pt ON pt.id = tw.template_id
        WHERE te.id = tes.template_exercise_id
          AND pt.organization_id = v_caller_org
          AND pt.deleted_at IS NULL
     );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'template_exercise_set % not found in your organization, or already deleted', p_id
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.soft_delete_template_exercise_set(uuid) IS
  'Soft-delete one template_exercise_set (deleted_at), org-checked via the exercise→day→week→template walk.';

REVOKE EXECUTE ON FUNCTION public.soft_delete_template_exercise_set(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.soft_delete_template_exercise_set(uuid) TO authenticated;


-- ----------------------------------------------------------------------------
-- soft_delete_template_day — via-parent (week→template) org walk
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.soft_delete_template_day(p_id uuid)
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

  UPDATE template_days td
     SET deleted_at = now()
   WHERE td.id = p_id
     AND td.deleted_at IS NULL
     AND EXISTS (
       SELECT 1 FROM template_weeks tw
         JOIN program_templates pt ON pt.id = tw.template_id
        WHERE tw.id = td.template_week_id
          AND pt.organization_id = v_caller_org
          AND pt.deleted_at IS NULL
     );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'template_day % not found in your organization, or already deleted', p_id
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.soft_delete_template_day(uuid) IS
  'Soft-delete a template_day (deleted_at), org-checked via the week→template walk. Child exercises/sets are left intact (the day''s deleted_at hides the subtree from the editor + the apply/preview queries).';

REVOKE EXECUTE ON FUNCTION public.soft_delete_template_day(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.soft_delete_template_day(uuid) TO authenticated;


-- ----------------------------------------------------------------------------
-- duplicate_template_day — copy a day (+ exercises + sets) within its week,
-- remapping superset groups (CTE pattern from duplicate_program_day).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.duplicate_template_day(p_source_day_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org  uuid := public.user_organization_id();
  caller_role text := public.user_role();
  v_week_id   uuid;
  v_label     text;
  v_day_org   uuid;
  v_new_label text;
  v_new_sort  int;
  new_day_id  uuid;
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT td.template_week_id, td.day_label, pt.organization_id
    INTO v_week_id, v_label, v_day_org
    FROM template_days td
    JOIN template_weeks tw ON tw.id = td.template_week_id
    JOIN program_templates pt ON pt.id = tw.template_id
   WHERE td.id = p_source_day_id AND td.deleted_at IS NULL
     AND tw.deleted_at IS NULL AND pt.deleted_at IS NULL;
  IF v_day_org IS NULL OR v_day_org <> caller_org THEN
    RAISE EXCEPTION 'template_day % not found in your organization', p_source_day_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- "(copy)" suffix capped at the 30-char day_label CHECK; append within the week.
  v_new_label := left(v_label || ' (copy)', 30);
  SELECT COALESCE(MAX(sort_order), -1) + 1 INTO v_new_sort
    FROM template_days WHERE template_week_id = v_week_id AND deleted_at IS NULL;

  INSERT INTO template_days (template_week_id, day_label, sort_order)
  VALUES (v_week_id, v_new_label, v_new_sort)
  RETURNING id INTO new_day_id;

  WITH remap AS (
    SELECT old_id, gen_random_uuid() AS new_id
      FROM (
        SELECT DISTINCT superset_group_id AS old_id
          FROM template_exercises
         WHERE template_day_id = p_source_day_id
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
      new_day_id, te.exercise_id, te.sort_order, te.section_title,
      remap.new_id, te.sets, te.reps, te.rest_seconds, te.rpe,
      te.optional_metric, te.optional_value, te.tempo, te.instructions
      FROM template_exercises te
      LEFT JOIN remap ON remap.old_id = te.superset_group_id
     WHERE te.template_day_id = p_source_day_id
       AND te.deleted_at IS NULL
     ORDER BY te.sort_order
    RETURNING id, sort_order
  )
  INSERT INTO template_exercise_sets (
    template_exercise_id, set_number, reps, rep_metric, optional_metric, optional_value
  )
  SELECT
    cloned.id, src_set.set_number, src_set.reps, src_set.rep_metric,
    src_set.optional_metric, src_set.optional_value
    FROM cloned
    JOIN template_exercises src_te
      ON src_te.template_day_id = p_source_day_id
     AND src_te.deleted_at IS NULL
     AND src_te.sort_order = cloned.sort_order
    JOIN template_exercise_sets src_set
      ON src_set.template_exercise_id = src_te.id
     AND src_set.deleted_at IS NULL;

  RETURN jsonb_build_object('status', 'created', 'new_day_id', new_day_id);
END;
$$;

COMMENT ON FUNCTION public.duplicate_template_day(uuid) IS
  'Duplicate a template_day (+ exercises + per-set rows, incl. rep_metric) within its week, appended at the end with a "(copy)" label and every superset group remapped to a fresh id. Org/role guarded.';

REVOKE EXECUTE ON FUNCTION public.duplicate_template_day(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.duplicate_template_day(uuid) TO authenticated;
