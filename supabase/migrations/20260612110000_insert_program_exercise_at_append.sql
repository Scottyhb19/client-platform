-- ============================================================================
-- 20260612110000_insert_program_exercise_at_append
-- ============================================================================
-- Why: G-3 of the program-engine/session-builder polish pass
-- (docs/polish/program-engine-session-builder.md, FM-3; exercise-library
-- rider 2). Two default-application paths existed for add-exercise:
--
--   - append: TS-side in addExerciseToDayAction — three sequential
--     supabase-js calls (read defaults, insert parent, fan out sets) with
--     best-effort soft-delete compensation on partial failure. Not a
--     transaction.
--   - atStart / after: this RPC — atomic shift + insert + fan-out.
--
-- Identical field-for-field today; a consistency liability the moment a
-- future change touches one and not the other (the exercise-library §7
-- drift note called this). This migration adds an explicit append mode to
-- the RPC so the TS path can converge on it and be deleted.
--
-- Signature change (3-arg → 4-arg with defaults), so per project memory
-- (plpgsql function arity evolution) the old signature is DROPPED first —
-- CREATE OR REPLACE alone would leave both overloads live and supabase-js
-- named-arg calls could silently bind the stale one.
--
--   insert_program_exercise_at(
--     p_day_id      uuid,
--     p_exercise_id uuid,
--     p_after_pe_id uuid DEFAULT NULL,
--     p_slot        text DEFAULT NULL   -- 'append' | 'at_start' | 'after'
--   ) RETURNS uuid
--
-- Slot resolution preserves the legacy 3-arg contract exactly, so existing
-- callers (pgTAP test 20's positional NULL-anchor call) keep their
-- behaviour without edits:
--
--   p_slot NULL + anchor NULL     → 'at_start'  (legacy NULL-anchor semantics)
--   p_slot NULL + anchor present  → 'after'     (legacy anchor semantics)
--   p_slot 'append'               → MAX(sort_order)+1, no shift, no group
--                                    inheritance (end of day is always solo —
--                                    matches the retired TS path, which never
--                                    set a group)
--   p_slot 'after' + anchor NULL  → raises invalid_parameter_value
--   p_slot 'append'/'at_start' + anchor present → raises (caller bug guard)
--
-- Everything else — org gates, defaults read, shift strategy, Q3 group
-- inheritance, per-set fan-out — is unchanged from 20260507100300.
-- ============================================================================

DROP FUNCTION public.insert_program_exercise_at(uuid, uuid, uuid);

CREATE FUNCTION public.insert_program_exercise_at(
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
  v_anchor_so  int;     -- sort_order of the row to insert AFTER ('after' slot only)
  v_anchor_grp uuid;    -- superset_group_id of the anchor row
  v_below_grp  uuid;    -- post-shift group_id of the row one slot below the insertion
  v_new_so     int;
  v_new_grp    uuid;
  v_new_id     uuid;

  v_default_sets    smallint;
  v_default_reps    text;
  v_default_metric  text;
  v_default_value   text;
  v_default_rest    int;
  v_default_instr   text;
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner', 'staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Slot resolution. NULL p_slot maps to the legacy 3-arg contract.
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

  -- Resolve + authorise the target day. Single-hop walk via pd.program_id
  -- (post-D-PROG-001; matches the soft_delete_program_exercise pattern).
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

  -- Resolve the exercise + grab defaults. Same-org check defensive; the
  -- enforce_program_exercise_same_org INSERT trigger backstops this.
  SELECT default_sets, default_reps, default_metric,
         default_metric_value, default_rest_seconds, instructions
    INTO v_default_sets, v_default_reps, v_default_metric,
         v_default_value, v_default_rest, v_default_instr
    FROM exercises
   WHERE id = p_exercise_id
     AND deleted_at IS NULL
     AND organization_id = caller_org;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'exercise % not found in your organization', p_exercise_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Anchor lookup ('after' slot only) — asserts the anchor lives on this day.
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

  -- Compute the new sort_order (shifting downstream rows where needed).
  IF v_slot = 'append' THEN
    -- End of day: no shift, no group inheritance. Empty day → 0.
    SELECT COALESCE(MAX(sort_order), -1) + 1
      INTO v_new_so
      FROM program_exercises
     WHERE program_day_id = p_day_id
       AND deleted_at IS NULL;
  ELSIF v_slot = 'at_start' THEN
    -- Shift all existing rows on this day by +1, new row lands at 0.
    UPDATE program_exercises
       SET sort_order = sort_order + 1
     WHERE program_day_id = p_day_id
       AND deleted_at IS NULL;
    v_new_so := 0;
  ELSE
    -- Insert after the anchor: shift everyone strictly below the anchor.
    UPDATE program_exercises
       SET sort_order = sort_order + 1
     WHERE program_day_id = p_day_id
       AND deleted_at IS NULL
       AND sort_order > v_anchor_so;
    v_new_so := v_anchor_so + 1;
  END IF;

  -- Group inheritance check ('after' only — appends and top inserts always
  -- start solo). The "row below" was at v_anchor_so + 1 before the shift;
  -- after the shift it's at v_new_so + 1.
  IF v_anchor_grp IS NOT NULL THEN
    SELECT superset_group_id INTO v_below_grp
      FROM program_exercises
     WHERE program_day_id = p_day_id
       AND deleted_at IS NULL
       AND sort_order = v_new_so + 1;

    IF v_below_grp IS NOT NULL AND v_below_grp = v_anchor_grp THEN
      v_new_grp := v_anchor_grp;
    END IF;
    -- Else: solo. Boundary inserts (anchor in group, below NULL/different)
    -- keep the new row ungrouped per Q3 sign-off 2026-05-07.
  END IF;

  -- Insert the parent row. No legacy scalars (Phase C stopped writing them);
  -- per-exercise context comes from defaults.
  INSERT INTO program_exercises (
    program_day_id, exercise_id, sort_order, superset_group_id,
    rest_seconds, instructions
  ) VALUES (
    p_day_id, p_exercise_id, v_new_so, v_new_grp,
    v_default_rest, v_default_instr
  )
  RETURNING id INTO v_new_id;

  -- Fan out per-set rows: N rows where N = max(default_sets, 1), each
  -- carrying the exercise's default reps / metric / value. RPE rides
  -- optional_metric='rpe' when the EP sets it as the default metric
  -- (exercises.default_rpe dropped 20260612090100).
  INSERT INTO program_exercise_sets (
    program_exercise_id, set_number, reps, optional_metric, optional_value
  )
  SELECT v_new_id,
         gs::smallint,
         v_default_reps,
         v_default_metric,
         v_default_value
    FROM generate_series(1, GREATEST(1, COALESCE(v_default_sets, 1))) AS gs;

  RETURN v_new_id;
END;
$$;

COMMENT ON FUNCTION public.insert_program_exercise_at(uuid, uuid, uuid, text) IS
  'Atomic insert of a program_exercise plus per-set fan-out from the exercise''s defaults. p_slot: append (MAX+1, no shift), at_start (shift all, land at 0), after (shift below anchor). p_slot NULL preserves the legacy contract: NULL anchor = at_start, anchor = after. Group inheritance (after only): new row joins the anchor''s superset_group_id only when the anchor and the row immediately below share the same group (Q3 sign-off 2026-05-07). All add-exercise paths converge here as of G-3 (program-engine polish pass, 2026-06-12) — the TS append path in addExerciseToDayAction is retired.';

REVOKE EXECUTE ON FUNCTION public.insert_program_exercise_at(uuid, uuid, uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.insert_program_exercise_at(uuid, uuid, uuid, text) TO authenticated;
