-- ============================================================================
-- 20260507100300_insert_program_exercise_at
-- ============================================================================
-- Why: Phase D of the session-builder polish pass — action bar moves to
-- between cards, and "+ Add exercise" on a between-cards bar inserts the
-- new exercise at that slot rather than appending at MAX(sort_order)+1.
-- /docs/polish/session-builder.md §2.3 + §0.1 ø-1 + ø-3 + §4 row D.
--
-- The TS-side addExerciseToDayAction can't do shift+insert+per-set fan-out
-- atomically across three tables — three round-trips with no transactional
-- envelope means a partial failure mid-shift leaves the day's sort_order
-- ranks corrupt. Wrapping it in a SECURITY DEFINER plpgsql RPC gives us:
--   - one transaction (rollback on any failure, including the per-set fan-out)
--   - one cross-org check at the top (clean error UX before the trigger fires)
--   - one place that owns the group-inheritance rule (anchor and below
--     share a group_id ⇒ inserted row inherits it; otherwise solo)
--
-- Sort-order strategy: integer shift via UPDATE. The day's existing rows
-- carry consecutive integer sort_orders; on insert-after, every row with
-- sort_order > anchor gets +1 in a single SQL statement, then we INSERT at
-- anchor + 1. No UNIQUE constraint on (program_day_id, sort_order) so the
-- shift doesn't transiently violate anything. Q1 sign-off chat 2026-05-07
-- (alternatives — gap-based numbering, fractional indices — rejected as
-- avoiding a problem we don't have at this scale).
--
-- Group inheritance: enforced inside the RPC, not exposed as a parameter.
-- The caller doesn't say "join group G" — it says "insert after row X" and
-- the RPC reads X.superset_group_id and the post-shift row-below's
-- superset_group_id, then inherits when both match (the "+ Add exercise"
-- between two same-group members case from Q3). All other cases (boundary,
-- adjacent-different-groups, ungrouped) keep the new row solo. The grouping
-- "Superset" affordance on a between-cards bar is a separate primitive
-- (groupAcrossActionBarAction) that runs after the rows already exist.
--
-- Cross-org defence-in-depth: the existing
-- enforce_program_exercise_same_org BEFORE INSERT trigger
-- (20260503100000 §8) walks pe → pd → p and compares with
-- exercises.organization_id, raising on mismatch. This RPC adds an upfront
-- caller-org check on both the day and the exercise so the EP gets a clean
-- 'not found in your organization' message instead of an integrity-
-- constraint-violation from the trigger.
--
-- Function is new — no DROP needed. (Project memory note
-- `plpgsql function arity evolution` only applies to signature changes on
-- existing functions.)
-- ============================================================================


CREATE OR REPLACE FUNCTION public.insert_program_exercise_at(
  p_day_id       uuid,
  p_exercise_id  uuid,
  p_after_pe_id  uuid    -- NULL = insert at the start of the day
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org   uuid := public.user_organization_id();
  caller_role  text := public.user_role();

  v_day_org    uuid;
  v_anchor_so  int;     -- sort_order of the row to insert AFTER (NULL when inserting at start)
  v_anchor_grp uuid;    -- superset_group_id of the anchor row
  v_below_grp  uuid;    -- post-shift group_id of the row that's now one slot below the new insertion
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

  -- Anchor lookup. NULL anchor = insert at start; everything else asserts
  -- the anchor lives on this day.
  IF p_after_pe_id IS NOT NULL THEN
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

  -- Shift downstream rows + compute the new sort_order.
  IF v_anchor_so IS NULL THEN
    -- Insert at start: shift all existing rows on this day by +1, new row
    -- lands at sort_order 0. Empty day → no rows match, no-op shift.
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

  -- Group inheritance check. Only relevant when there's an anchor (top-bar
  -- inserts always start solo). The "row below" was at sort_order =
  -- v_anchor_so + 1 before the shift; after the shift it's at v_new_so + 1.
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

  -- Fan out per-set rows. Mirrors the TS append path in
  -- addExerciseToDayAction: N rows where N = max(default_sets, 1), each
  -- carrying the exercise's default reps / metric / value. RPE intentionally
  -- absent on the per-set table per Phase C Q6 sign-off; Phase F lands the
  -- metric dropdown that lets the EP set rpe via optional_metric/value.
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

COMMENT ON FUNCTION public.insert_program_exercise_at(uuid, uuid, uuid) IS
  'Atomic shift-and-insert of a program_exercise at a specific slot, plus per-set fan-out. p_after_pe_id NULL = insert at start; otherwise insert immediately after that row, shifting downstream sort_orders by +1. Group inheritance: new row joins the anchor''s superset_group_id only when the anchor and the row immediately below share the same group (Q3 sign-off 2026-05-07). Phase D of the session-builder polish pass (/docs/polish/session-builder.md §4 row D).';

REVOKE EXECUTE ON FUNCTION public.insert_program_exercise_at(uuid, uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.insert_program_exercise_at(uuid, uuid, uuid) TO authenticated;
