-- ============================================================================
-- 20260507100500_swap_program_exercise
-- ============================================================================
-- Note: filename bumped from 20260507100400 to 20260507100500 during the
-- F+G+H consolidation (2026-05-08). Phase G's reorder_program_exercises
-- migration claimed 20260507100400 first and is already applied to live
-- Supabase; renaming F's so `supabase db push` picks it up as a new
-- version rather than silently skipping it as already-applied.
-- ============================================================================
-- Why: Phase F of the session-builder polish pass — swap-in-place. The EP
-- clicks an exercise name → right panel arms a swap → the next library pick
-- replaces the exercise in that slot, keeping sort_order, section_title,
-- and superset_group_id intact while resetting prescription to the new
-- exercise's defaults. /docs/polish/session-builder.md §2.4 + §0.1 row 5
-- + §4 row F.
--
-- The TS side can't soft-delete + insert + fan-out across three statements
-- atomically; mid-swap orphans (old soft-deleted, new not yet inserted)
-- would be visible to the EP if the page revalidates between calls, and a
-- per-set fan-out failure would leave the new row with zero set rows.
-- Wrapping in a SECURITY DEFINER plpgsql RPC gives:
--   - one transaction (rollback on any failure)
--   - one upfront caller-org check on both the existing pe and the
--     replacement exercise (clean error UX before triggers fire)
--   - one place that owns the "preserve slot, discard prescription" rule
--     (Q1+Q2 sign-off chat 2026-05-07: atomic + reset to new defaults)
--
-- History preservation: exercise_logs.exercise_id is NOT NULL REFERENCES
-- exercises(id) — direct FK that survives the program_exercise soft-delete.
-- exercise_logs.program_exercise_id is ON DELETE SET NULL, but soft-delete
-- only sets deleted_at; the FK stays intact pointing at the now-soft-
-- deleted row. Phase H "Last logged" lookups key off exercise_id, so a swap
-- correctly resets the footer to the new exercise's history.
--
-- Cross-org defence-in-depth: enforce_program_exercise_same_org BEFORE
-- INSERT trigger (20260420101800 §enforce_program_exercise_same_org) walks
-- pe → pd → p and compares with exercises.organization_id, raising on
-- mismatch. This RPC adds an upfront caller-org check on both the old pe
-- and the replacement exercise so the EP gets a clean
-- 'not found in your organization' message instead of an integrity-
-- constraint-violation from the trigger.
--
-- Function is new — no DROP needed. (Project memory note
-- `plpgsql function arity evolution` only applies to signature changes on
-- existing functions.)
--
-- Audit register: program_exercise_sets is already in audit_resolve_org_id
-- (Phase C, 20260507100000 §4); program_exercises has been in there since
-- the original audit migration. No new branch needed.
-- ============================================================================


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

  -- Slot fields preserved from the old row.
  v_day_id          uuid;
  v_sort_order      int;
  v_section_title   text;
  v_superset_group  uuid;

  -- Defaults pulled from the replacement exercise.
  v_default_sets    smallint;
  v_default_reps    text;
  v_default_metric  text;
  v_default_value   text;
  v_default_rest    int;
  v_default_instr   text;

  v_new_id          uuid;
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner', 'staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Resolve + authorise the old row. Single-hop walk via pd.program_id
  -- (post-D-PROG-001; matches the soft_delete_program_exercise pattern).
  -- The slot fields we need (program_day_id, sort_order, section_title,
  -- superset_group_id) come back here so the new row can claim the same
  -- coordinates.
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

  -- Resolve the replacement exercise + grab defaults. Same-org check
  -- defensive; the enforce_program_exercise_same_org INSERT trigger
  -- backstops this. Q2 sign-off (2026-05-07): the new row's prescription
  -- comes entirely from the new exercise's defaults — old reps / load /
  -- metric / sets are discarded.
  SELECT default_sets, default_reps, default_metric,
         default_metric_value, default_rest_seconds, instructions
    INTO v_default_sets, v_default_reps, v_default_metric,
         v_default_value, v_default_rest, v_default_instr
    FROM exercises
   WHERE id = p_new_exercise_id
     AND deleted_at IS NULL
     AND organization_id = caller_org;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'exercise % not found in your organization', p_new_exercise_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Soft-delete the old row. Cascade is intentionally NOT relied on here
  -- because program_exercise_sets uses CASCADE on hard delete only — soft-
  -- delete leaves the per-set rows live but unreachable through the
  -- soft-deleted parent (the SELECT policy filters pe.deleted_at IS NULL).
  -- That's fine: the page loader joins via the parent so they disappear
  -- from the EP's view immediately, and historical exercise_logs.
  -- program_exercise_id stays valid pointing at the now-soft-deleted row.
  UPDATE program_exercises
     SET deleted_at = now()
   WHERE id = p_pe_id;

  -- Insert the replacement at the same slot. New row's superset_group_id
  -- is preserved from the old row (Q1 sign-off 2026-05-07: slot keeps
  -- sort_order, section_title, superset_group_id). If the swapped row
  -- was in a superset, the new row stays a member of the same group;
  -- the spine letter (B1, B2…) renders identically.
  INSERT INTO program_exercises (
    program_day_id, exercise_id, sort_order, section_title,
    superset_group_id, rest_seconds, instructions
  ) VALUES (
    v_day_id, p_new_exercise_id, v_sort_order, v_section_title,
    v_superset_group, v_default_rest, v_default_instr
  )
  RETURNING id INTO v_new_id;

  -- Fan out per-set rows from the new exercise's defaults. Q2 follow-on
  -- sign-off (2026-05-07): set count resets to new exercise's
  -- default_sets (or 1 when NULL) — preserving the old set count would
  -- be inconsistent with "discard entirely" since the count goes with
  -- the prescription it sized.
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

COMMENT ON FUNCTION public.swap_program_exercise(uuid, uuid) IS
  'Atomic swap-in-place of a program_exercise. Soft-deletes the old row, inserts a replacement at the same sort_order / section_title / superset_group_id, and fans out per-set rows from the new exercise''s defaults. Old prescription is discarded (Q1+Q2 sign-off 2026-05-07). History (exercise_logs / set_logs) survives because exercise_logs.exercise_id is a direct FK to exercises that doesn''t change on swap. Phase F of the session-builder polish pass (/docs/polish/session-builder.md §4 row F).';

REVOKE EXECUTE ON FUNCTION public.swap_program_exercise(uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.swap_program_exercise(uuid, uuid) TO authenticated;
