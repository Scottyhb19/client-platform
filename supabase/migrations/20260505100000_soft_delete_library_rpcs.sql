-- ============================================================================
-- 20260505100000_soft_delete_library_rpcs
-- ============================================================================
-- Why: Exercise library polish pass, gap P0-1 in
-- /docs/polish/exercise-library.md. Adds the soft-delete RPC trio for the
-- three library tables that get UI delete actions in this pass:
--
--   - exercises          — EP soft-deletes via the card "More" menu
--   - movement_patterns  — EP soft-deletes via Settings → Movement patterns
--   - exercise_tags      — EP soft-deletes via Settings → Exercise tags
--
-- Same SECURITY DEFINER + auth-check-first pattern as
-- 20260429120000_soft_delete_rpcs.sql and
-- 20260429130000_soft_delete_rpcs_clients_and_program_exercises.sql.
-- Reason for the pattern documented at length in 20260429120000 §0.
--
-- Out of scope for this migration:
--   - exercise_tag_assignments — no UI delete; the join row cascades when
--                                either parent is hard-deleted, and is
--                                also explicitly removed by the edit-form
--                                tag-diff path (DELETE on rows the EP
--                                unchecked). No soft-delete needed.
--   - exercise_metric_units    — no UI delete in this pass (D3 sign-off
--                                deferred the metric-units settings UI).
--   - restore_* RPCs           — UI undelete is explicitly out of scope
--                                (gap doc §5). Soft-deleted rows can be
--                                restored manually via SQL Editor for now;
--                                an RPC pair lands when restore UI does.
--
-- FK semantics confirmed:
--   - program_exercises.exercise_id → exercises(id) ON DELETE RESTRICT.
--     Soft-delete sets deleted_at only; the FK is not exercised. Existing
--     prescriptions in client programs continue to resolve the exercise
--     name via the FK regardless of the library's deleted_at filter.
--   - exercises.movement_pattern_id → movement_patterns(id) ON DELETE
--     RESTRICT. Same: soft-deleting a pattern does not break exercises
--     that reference it; the pattern just disappears from filter chips
--     and the create/edit dropdown.
--   - exercise_tag_assignments.tag_id → exercise_tags(id) ON DELETE
--     CASCADE. Soft-delete (deleted_at) does NOT cascade — only hard
--     DELETE does. Historical tag chips on existing exercises remain
--     in the join table; library + edit-form chip queries filter
--     deleted_at IS NULL so they won't render.
-- ============================================================================


-- ============================================================================
-- §1. exercises
--
-- No unique-active index on the table — uniqueness is by (organization_id,
-- lower(name)) only at the index level for the trigram search; no
-- collision path on soft-delete.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.soft_delete_exercise(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org  uuid := public.user_organization_id();
  caller_role text := public.user_role();
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  UPDATE exercises
     SET deleted_at = now()
   WHERE id = p_id
     AND organization_id = caller_org
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'exercise % not found in your organization, or already deleted', p_id
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.soft_delete_exercise(uuid) IS
  'Soft-delete an exercise library entry. Bypasses the deleted_at-IS-NULL SELECT-policy trap via SECURITY DEFINER. Existing program_exercises prescriptions are unaffected — they still resolve the exercise name via the RESTRICT FK.';

REVOKE EXECUTE ON FUNCTION public.soft_delete_exercise(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.soft_delete_exercise(uuid) TO authenticated;


-- ============================================================================
-- §2. movement_patterns
--
-- Unique-active index movement_patterns_org_name_unique on
-- (organization_id, lower(name)) WHERE deleted_at IS NULL releases the
-- name slot on soft-delete, so the EP can re-add a pattern with the same
-- name later without conflict.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.soft_delete_movement_pattern(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org  uuid := public.user_organization_id();
  caller_role text := public.user_role();
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  UPDATE movement_patterns
     SET deleted_at = now()
   WHERE id = p_id
     AND organization_id = caller_org
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'movement_pattern % not found in your organization, or already deleted', p_id
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.soft_delete_movement_pattern(uuid) IS
  'Soft-delete a movement pattern. Existing exercises that reference it keep the FK and continue to resolve the pattern name; the pattern just disappears from filter chips and pickers.';

REVOKE EXECUTE ON FUNCTION public.soft_delete_movement_pattern(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.soft_delete_movement_pattern(uuid) TO authenticated;


-- ============================================================================
-- §3. exercise_tags
--
-- Unique-active index exercise_tags_org_name_unique on (organization_id,
-- lower(name)) WHERE deleted_at IS NULL releases the name slot on soft-
-- delete, same shape as movement_patterns. Existing exercise_tag_assignments
-- rows survive (CASCADE only fires on hard DELETE).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.soft_delete_exercise_tag(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org  uuid := public.user_organization_id();
  caller_role text := public.user_role();
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  UPDATE exercise_tags
     SET deleted_at = now()
   WHERE id = p_id
     AND organization_id = caller_org
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'exercise_tag % not found in your organization, or already deleted', p_id
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.soft_delete_exercise_tag(uuid) IS
  'Soft-delete an exercise tag. Existing exercise_tag_assignments rows survive — historical chips just disappear from the library because the chip query filters deleted_at IS NULL.';

REVOKE EXECUTE ON FUNCTION public.soft_delete_exercise_tag(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.soft_delete_exercise_tag(uuid) TO authenticated;
