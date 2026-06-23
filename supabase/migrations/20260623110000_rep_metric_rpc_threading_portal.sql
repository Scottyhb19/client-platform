-- ============================================================================
-- 20260623110000_rep_metric_rpc_threading_portal
-- ============================================================================
-- Why: item 1 / VU-2 + the default-application slice of VU-3
-- (docs/polish/prescription-volume-unit.md). Thread the new volume unit
-- (program_exercise_sets.rep_metric / set_logs.rep_metric, added in
-- 20260623100000) through the portal read+write path and the two paths that
-- seed a prescription from an exercise's defaults.
--
-- Four functions, all preserving everything else and only carrying rep_metric
-- alongside the existing optional axis:
--   1. client_log_set                  — WRITE: persist the logged unit.
--   2. client_get_program_day_exercises — READ: surface the prescribed unit.
--   3. insert_program_exercise_at       — seed rep_metric from default_rep_metric.
--   4. swap_program_exercise            — same, on swap.
--
-- The clone/template copy paths (copy/repeat day+program, duplicate_program_day,
-- save/create template) are threaded in the sibling migration 20260623120000.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1. client_log_set — add p_rep_metric and persist set_logs.rep_metric.
--
-- Arity change (10 → 11 args), so per project memory (plpgsql function arity
-- evolution) DROP the old signature before CREATE. p_rep_metric is appended
-- LAST with DEFAULT NULL so any positional 10-arg caller (pgTAP, the
-- currently-deployed TS) keeps working and resolves rep_metric to NULL (reps)
-- until updated. supabase-js calls by name, so adding the key is the only
-- client change. DROP loses grants → re-issue REVOKE/GRANT.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.client_log_set(
  uuid, uuid, smallint, numeric, text, smallint, text, text, smallint, text
);

CREATE FUNCTION public.client_log_set(
  p_session_id          uuid,
  p_program_exercise_id uuid,
  p_set_number          smallint,
  p_weight_value        numeric,
  p_weight_metric       text,
  p_reps_performed      smallint,
  p_optional_metric     text,
  p_optional_value      text,
  p_rpe                 smallint,
  p_notes               text,
  p_rep_metric          text DEFAULT NULL   -- volume unit (NULL = reps)
)
RETURNS uuid  -- the new set_logs.id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_id         uuid := auth.uid();
  v_exercise_log_id uuid;
  session_row       sessions%ROWTYPE;
  program_exercise_exercise_id uuid;
  new_set_log_id    uuid;
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
  SELECT id INTO v_exercise_log_id
    FROM exercise_logs
   WHERE session_id          = p_session_id
     AND program_exercise_id = p_program_exercise_id
     AND deleted_at IS NULL;

  IF v_exercise_log_id IS NULL THEN
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
    RETURNING id INTO v_exercise_log_id;
  END IF;

  -- Insert or upsert the set log. rep_metric records what reps_performed
  -- MEANS (NULL = reps, else a time/distance code), independent of the load
  -- columns (weight_value/weight_metric) and the optional axis.
  INSERT INTO set_logs (
    exercise_log_id, set_number,
    weight_value, weight_metric, reps_performed, rep_metric,
    optional_metric, optional_value, rpe, notes, completed_at
  )
  VALUES (
    v_exercise_log_id, p_set_number,
    p_weight_value, p_weight_metric, p_reps_performed, p_rep_metric,
    p_optional_metric, p_optional_value, p_rpe, p_notes, now()
  )
  ON CONFLICT (exercise_log_id, set_number) DO UPDATE
    SET weight_value    = EXCLUDED.weight_value,
        weight_metric   = EXCLUDED.weight_metric,
        reps_performed  = EXCLUDED.reps_performed,
        rep_metric      = EXCLUDED.rep_metric,
        optional_metric = EXCLUDED.optional_metric,
        optional_value  = EXCLUDED.optional_value,
        rpe             = EXCLUDED.rpe,
        notes           = EXCLUDED.notes,
        completed_at    = EXCLUDED.completed_at
  RETURNING id INTO new_set_log_id;

  RETURN new_set_log_id;
END;
$$;

COMMENT ON FUNCTION public.client_log_set(uuid, uuid, smallint, numeric, text, smallint, text, text, smallint, text, text) IS
  'Caller logs or updates a set within their own in-progress session. Auto-creates the exercise_logs parent on first set. 2026-06-23 (VU-2): added trailing p_rep_metric (volume unit; NULL = reps) persisted to set_logs.rep_metric, so a timed hold / distance carry logs in its own unit independent of the load columns.';

REVOKE EXECUTE ON FUNCTION public.client_log_set(uuid, uuid, smallint, numeric, text, smallint, text, text, smallint, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.client_log_set(uuid, uuid, smallint, numeric, text, smallint, text, text, smallint, text, text) TO authenticated;


-- ----------------------------------------------------------------------------
-- §2. client_get_program_day_exercises — surface rep_metric per set.
--
-- RETURNS TABLE shape is unchanged (prescription_sets stays jsonb); only the
-- per-set object gains a 'rep_metric' key. CREATE OR REPLACE keeps the grant,
-- but re-issue REVOKE/GRANT for explicitness (anon-EXECUTE sweep hygiene).
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
  rest_seconds          int,
  tempo                 text,
  prescription_sets     jsonb
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
    COALESCE(pe.rest_seconds, e.default_rest_seconds)      AS rest_seconds,
    pe.tempo                                               AS tempo,
    COALESCE(
      (
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'set_number',      pes.set_number,
                   'reps',            pes.reps,
                   'rep_metric',      pes.rep_metric,
                   'optional_metric', pes.optional_metric,
                   'optional_value',  pes.optional_value
                 )
                 ORDER BY pes.set_number
               )
          FROM program_exercise_sets pes
         WHERE pes.program_exercise_id = pe.id
           AND pes.deleted_at IS NULL
      ),
      '[]'::jsonb
    )                                                      AS prescription_sets
  FROM program_exercises pe
  JOIN exercises          e  ON e.id  = pe.exercise_id
  JOIN program_days       pd ON pd.id = pe.program_day_id
  JOIN programs           p  ON p.id  = pd.program_id
  JOIN clients            c  ON c.id  = p.client_id
  WHERE pd.id             = p_program_day_id
    AND c.user_id         = auth.uid()
    AND c.deleted_at      IS NULL
    AND p.status          IN ('active', 'archived')
    AND p.deleted_at      IS NULL
    AND pd.deleted_at     IS NULL
    AND pe.deleted_at     IS NULL
    AND e.deleted_at      IS NULL
  ORDER BY pe.sort_order;
$$;

REVOKE EXECUTE ON FUNCTION public.client_get_program_day_exercises(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.client_get_program_day_exercises(uuid) TO authenticated;

COMMENT ON FUNCTION public.client_get_program_day_exercises(uuid) IS
  'Returns exercise prescriptions + library details for a program day belonging to the caller. Per-set prescription is a JSON array (prescription_sets) from program_exercise_sets. 2026-06-23 (VU-2): each set object now carries rep_metric (volume unit; NULL = reps) so the portal logger can label/validate a timed or distance set.';


-- ----------------------------------------------------------------------------
-- §3. insert_program_exercise_at — seed rep_metric from default_rep_metric.
-- Same 4-arg signature → CREATE OR REPLACE (no DROP). Only the defaults read
-- and the per-set fan-out change; everything else is byte-for-byte the
-- 20260612110000 body.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.insert_program_exercise_at(
  p_day_id       uuid,
  p_exercise_id  uuid,
  p_after_pe_id  uuid DEFAULT NULL,
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
    CASE WHEN p_after_pe_id IS NULL THEN 'at_start' ELSE 'after' END
  );

  IF v_slot NOT IN ('append', 'at_start', 'after') THEN
    RAISE EXCEPTION 'invalid p_slot %', v_slot
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_slot = 'after' AND p_after_pe_id IS NULL THEN
    RAISE EXCEPTION 'p_slot=after requires p_after_pe_id'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_slot IN ('append', 'at_start') AND p_after_pe_id IS NOT NULL THEN
    RAISE EXCEPTION 'p_slot=% does not take an anchor', v_slot
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT p.organization_id
    INTO v_day_org
    FROM program_days pd
    JOIN programs     p  ON p.id = pd.program_id
   WHERE pd.id = p_day_id
     AND pd.deleted_at IS NULL
     AND p.deleted_at  IS NULL;

  IF v_day_org IS NULL OR v_day_org <> caller_org THEN
    RAISE EXCEPTION 'program_day % not found in your organization', p_day_id
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT default_sets, default_reps, default_rep_metric, default_metric,
         default_metric_value, default_rest_seconds, instructions
    INTO v_default_sets, v_default_reps, v_default_rep_metric, v_default_metric,
         v_default_value, v_default_rest, v_default_instr
    FROM exercises
   WHERE id = p_exercise_id
     AND deleted_at IS NULL
     AND organization_id = caller_org;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'exercise % not found in your organization', p_exercise_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_slot = 'after' THEN
    SELECT sort_order, superset_group_id
      INTO v_anchor_so, v_anchor_grp
      FROM program_exercises
     WHERE id = p_after_pe_id
       AND program_day_id = p_day_id
       AND deleted_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'anchor program_exercise % not found in this day', p_after_pe_id
        USING ERRCODE = 'no_data_found';
    END IF;
  END IF;

  IF v_slot = 'append' THEN
    SELECT COALESCE(MAX(sort_order), -1) + 1
      INTO v_new_so
      FROM program_exercises
     WHERE program_day_id = p_day_id
       AND deleted_at IS NULL;
  ELSIF v_slot = 'at_start' THEN
    UPDATE program_exercises
       SET sort_order = sort_order + 1
     WHERE program_day_id = p_day_id
       AND deleted_at IS NULL;
    v_new_so := 0;
  ELSE
    UPDATE program_exercises
       SET sort_order = sort_order + 1
     WHERE program_day_id = p_day_id
       AND deleted_at IS NULL
       AND sort_order > v_anchor_so;
    v_new_so := v_anchor_so + 1;
  END IF;

  IF v_anchor_grp IS NOT NULL THEN
    SELECT superset_group_id INTO v_below_grp
      FROM program_exercises
     WHERE program_day_id = p_day_id
       AND deleted_at IS NULL
       AND sort_order = v_new_so + 1;

    IF v_below_grp IS NOT NULL AND v_below_grp = v_anchor_grp THEN
      v_new_grp := v_anchor_grp;
    END IF;
  END IF;

  INSERT INTO program_exercises (
    program_day_id, exercise_id, sort_order, superset_group_id,
    rest_seconds, instructions
  ) VALUES (
    p_day_id, p_exercise_id, v_new_so, v_new_grp,
    v_default_rest, v_default_instr
  )
  RETURNING id INTO v_new_id;

  -- Fan out per-set rows, each carrying the exercise's default reps + volume
  -- unit (rep_metric) and the default load (optional_metric/value).
  INSERT INTO program_exercise_sets (
    program_exercise_id, set_number, reps, rep_metric, optional_metric, optional_value
  )
  SELECT v_new_id,
         gs::smallint,
         v_default_reps,
         v_default_rep_metric,
         v_default_metric,
         v_default_value
    FROM generate_series(1, GREATEST(1, COALESCE(v_default_sets, 1))) AS gs;

  RETURN v_new_id;
END;
$$;

COMMENT ON FUNCTION public.insert_program_exercise_at(uuid, uuid, uuid, text) IS
  'Atomic insert of a program_exercise plus per-set fan-out from the exercise''s defaults. 2026-06-23 (VU-3): fan-out now seeds program_exercise_sets.rep_metric from exercises.default_rep_metric. Slot + group-inheritance behaviour unchanged (Q3 sign-off 2026-05-07).';

REVOKE EXECUTE ON FUNCTION public.insert_program_exercise_at(uuid, uuid, uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.insert_program_exercise_at(uuid, uuid, uuid, text) TO authenticated;


-- ----------------------------------------------------------------------------
-- §4. swap_program_exercise — seed rep_metric from the new exercise default.
-- Same 2-arg signature → CREATE OR REPLACE.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.swap_program_exercise(
  p_pe_id           uuid,
  p_new_exercise_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org   uuid := public.user_organization_id();
  caller_role  text := public.user_role();

  v_day_id          uuid;
  v_sort_order      int;
  v_section_title   text;
  v_superset_group  uuid;

  v_default_sets       smallint;
  v_default_reps       text;
  v_default_rep_metric text;
  v_default_metric     text;
  v_default_value      text;
  v_default_rest       int;
  v_default_instr      text;

  v_new_id          uuid;
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner', 'staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT pe.program_day_id, pe.sort_order, pe.section_title, pe.superset_group_id
    INTO v_day_id, v_sort_order, v_section_title, v_superset_group
    FROM program_exercises pe
    JOIN program_days       pd ON pd.id = pe.program_day_id
    JOIN programs           p  ON p.id  = pd.program_id
   WHERE pe.id = p_pe_id
     AND pe.deleted_at IS NULL
     AND pd.deleted_at IS NULL
     AND p.deleted_at  IS NULL
     AND p.organization_id = caller_org;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'program_exercise % not found in your organization', p_pe_id
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT default_sets, default_reps, default_rep_metric, default_metric,
         default_metric_value, default_rest_seconds, instructions
    INTO v_default_sets, v_default_reps, v_default_rep_metric, v_default_metric,
         v_default_value, v_default_rest, v_default_instr
    FROM exercises
   WHERE id = p_new_exercise_id
     AND deleted_at IS NULL
     AND organization_id = caller_org;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'exercise % not found in your organization', p_new_exercise_id
      USING ERRCODE = 'no_data_found';
  END IF;

  UPDATE program_exercises
     SET deleted_at = now()
   WHERE id = p_pe_id;

  INSERT INTO program_exercises (
    program_day_id, exercise_id, sort_order, section_title,
    superset_group_id, rest_seconds, instructions
  ) VALUES (
    v_day_id, p_new_exercise_id, v_sort_order, v_section_title,
    v_superset_group, v_default_rest, v_default_instr
  )
  RETURNING id INTO v_new_id;

  INSERT INTO program_exercise_sets (
    program_exercise_id, set_number, reps, rep_metric, optional_metric, optional_value
  )
  SELECT v_new_id,
         gs::smallint,
         v_default_reps,
         v_default_rep_metric,
         v_default_metric,
         v_default_value
    FROM generate_series(1, GREATEST(1, COALESCE(v_default_sets, 1))) AS gs;

  RETURN v_new_id;
END;
$$;

COMMENT ON FUNCTION public.swap_program_exercise(uuid, uuid) IS
  'Atomic swap-in-place of a program_exercise. Soft-deletes the old row, inserts a replacement at the same slot, fans out per-set rows from the new exercise''s defaults. 2026-06-23 (VU-3): fan-out seeds rep_metric from the new exercise''s default_rep_metric. Old prescription discarded (Q1+Q2 sign-off 2026-05-07).';

REVOKE EXECUTE ON FUNCTION public.swap_program_exercise(uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.swap_program_exercise(uuid, uuid) TO authenticated;
