-- ============================================================================
-- 20260508120000_reorder_section_reconcile
-- ============================================================================
-- Why: Phase J of the session-builder polish pass — section_title now follows
-- the group when an exercise moves into / out of / between supersets.
--
-- The Phase G reorder_program_exercises RPC (migration 20260507100400) re-
-- derived the moved card's superset_group_id from its new neighbours but left
-- section_title alone. That created the bug from chat 2026-05-08: drag a
-- "Strength" card into a "Movement Restoration" superset, the card stays
-- visually "Strength" — section mismatch within a group the EP can't recover
-- from short of clicking the joiner's SectionTitleField. The existing
-- updateSectionTitleAction comment ("section is conceptually a property of
-- the *block*") implies the fix; this migration brings the reorder path in
-- line with that contract.
--
-- New rules (Q1-A / Q2-Yes / Q3-A sign-off 2026-05-08):
--
--   - Card joins a fresh-or-existing group ⇒ adopt that group's section_title
--     (any sibling's value; fan-out logic keeps them uniform).
--   - Card leaves a group via outbound move ⇒ section_title clears to NULL.
--   - Card stays in same group (within-group reorder) ⇒ no section change.
--   - Singleton cleanup (group reduced to one survivor) ⇒ survivor KEEPS its
--     section. The surviving card didn't *leave* — its partner did, so the
--     EP's intent for that block is preserved (Q3-A).
--
-- Scope: only reorder_program_exercises is replaced. The TS-side
-- groupAcrossActionBarAction (explicit Superset button) and
-- ungroupFromSupersetAction (explicit Ungroup button) get matching updates
-- in the same commit. insert_program_exercise_at is intentionally left
-- alone — the new-exercise-via-library flow isn't part of the reported bug
-- and a separate Phase will revisit that path if it needs the same rule.
--
-- Migration shape: REPLACE the function body. Signature unchanged so no DROP
-- needed; same SECURITY DEFINER + search_path; same return type.
-- ============================================================================


CREATE OR REPLACE FUNCTION public.reorder_program_exercises(
  p_day_id        uuid,
  p_ordered_ids   uuid[],
  p_moved_pe_id   uuid     -- NULL = rewrite sort_orders only, no group changes
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

  v_old_so      int;       -- moved card's sort_order before the rewrite
  v_new_so      int;       -- moved card's sort_order after the rewrite
  v_old_grp     uuid;      -- moved card's group_id before re-derivation
  v_above_grp   uuid;      -- group_id of the row immediately above (post-rewrite)
  v_below_grp   uuid;      -- group_id of the row immediately below (post-rewrite)
  v_new_grp     uuid;      -- moved card's group_id after re-derivation
  v_new_section text;      -- section adopted from the new group, if any
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner', 'staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Resolve + auth the day. Single-hop via pd.program_id.
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

  -- Validate the ordered-ids array.
  IF v_array_count = 0 THEN
    RAISE EXCEPTION 'Empty reorder array'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT COUNT(*) INTO v_live_count
    FROM program_exercises
   WHERE program_day_id = p_day_id
     AND deleted_at IS NULL;

  IF v_live_count <> v_array_count THEN
    RAISE EXCEPTION
      'Reorder array size mismatch: % live rows, % ids supplied',
      v_live_count, v_array_count
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM unnest(p_ordered_ids) AS u(id)
     WHERE NOT EXISTS (
       SELECT 1 FROM program_exercises pe
        WHERE pe.id = u.id
          AND pe.program_day_id = p_day_id
          AND pe.deleted_at IS NULL
     )
  ) THEN
    RAISE EXCEPTION 'Reorder array contains ids not in this day'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF (
    SELECT COUNT(DISTINCT id) FROM unnest(p_ordered_ids) AS u(id)
  ) <> v_array_count THEN
    RAISE EXCEPTION 'Reorder array contains duplicate ids'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Validate the moved-id hint, if present.
  IF p_moved_pe_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM unnest(p_ordered_ids) AS u(id) WHERE u.id = p_moved_pe_id
    ) THEN
      RAISE EXCEPTION 'Moved id % not present in reorder array', p_moved_pe_id
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    SELECT sort_order, superset_group_id
      INTO v_old_so, v_old_grp
      FROM program_exercises
     WHERE id = p_moved_pe_id
       AND program_day_id = p_day_id
       AND deleted_at IS NULL;
  END IF;

  -- Phase 1 — write new sort_orders. Single UPDATE.
  UPDATE program_exercises pe
     SET sort_order = u.ord - 1
    FROM unnest(p_ordered_ids) WITH ORDINALITY AS u(id, ord)
   WHERE pe.id = u.id
     AND pe.program_day_id = p_day_id
     AND pe.deleted_at IS NULL;

  -- Phase 2 — re-derive the moved card's group_id from its new neighbours
  -- AND reconcile its section_title (Phase J 2026-05-08).
  IF p_moved_pe_id IS NOT NULL THEN
    SELECT sort_order INTO v_new_so
      FROM program_exercises
     WHERE id = p_moved_pe_id
       AND program_day_id = p_day_id
       AND deleted_at IS NULL;

    IF v_new_so IS DISTINCT FROM v_old_so THEN
      SELECT superset_group_id INTO v_above_grp
        FROM program_exercises
       WHERE program_day_id = p_day_id
         AND deleted_at IS NULL
         AND sort_order = v_new_so - 1;

      SELECT superset_group_id INTO v_below_grp
        FROM program_exercises
       WHERE program_day_id = p_day_id
         AND deleted_at IS NULL
         AND sort_order = v_new_so + 1;

      -- Insert rule: both neighbours share a non-NULL group ⇒ join.
      IF v_above_grp IS NOT NULL AND v_above_grp = v_below_grp THEN
        v_new_grp := v_above_grp;
      ELSE
        v_new_grp := NULL;
      END IF;

      -- Apply only if the group actually changed; avoids a needless write
      -- + audit-log entry for shuffles that preserved membership.
      IF v_new_grp IS DISTINCT FROM v_old_grp THEN
        IF v_new_grp IS NULL THEN
          -- Outbound move: card became solo. Per Phase J, leaving a group
          -- clears the joiner's section_title.
          UPDATE program_exercises
             SET superset_group_id = NULL,
                 section_title     = NULL
           WHERE id = p_moved_pe_id;
        ELSE
          -- Inbound or cross-group move: adopt the new group's section
          -- (read any sibling — fan-out keeps them uniform). LIMIT 1 is
          -- defensive against any transient mismatch from a stale row.
          SELECT section_title INTO v_new_section
            FROM program_exercises
           WHERE program_day_id = p_day_id
             AND deleted_at IS NULL
             AND superset_group_id = v_new_grp
             AND id <> p_moved_pe_id
           LIMIT 1;

          UPDATE program_exercises
             SET superset_group_id = v_new_grp,
                 section_title     = v_new_section
           WHERE id = p_moved_pe_id;
        END IF;
      END IF;
    END IF;
  END IF;

  -- Phase 3 — singleton cleanup. A group reduced to one live member
  -- dissolves; the survivor keeps its section_title (Q3-A 2026-05-08), so
  -- we touch only superset_group_id here.
  UPDATE program_exercises
     SET superset_group_id = NULL
   WHERE program_day_id = p_day_id
     AND deleted_at IS NULL
     AND superset_group_id IN (
       SELECT superset_group_id
         FROM program_exercises
        WHERE program_day_id = p_day_id
          AND deleted_at IS NULL
          AND superset_group_id IS NOT NULL
        GROUP BY superset_group_id
        HAVING COUNT(*) = 1
     );
END;
$$;

COMMENT ON FUNCTION public.reorder_program_exercises(uuid, uuid[], uuid) IS
  'Atomic reorder of a program_day''s exercises. p_ordered_ids must be a permutation of the day''s live program_exercise ids; sort_order is rewritten to match the array''s ordinality. Group inheritance: if p_moved_pe_id is supplied AND that card''s sort_order actually changed, its superset_group_id is re-derived using the insert rule (both new neighbours share a non-NULL group ⇒ join; otherwise solo). Section reconciliation (Phase J 2026-05-08): the moved card adopts the new group''s section_title when joining/switching groups, or clears it when leaving a group; singleton-survivor''s section is preserved. Phase G+J of the session-builder polish pass.';

REVOKE EXECUTE ON FUNCTION public.reorder_program_exercises(uuid, uuid[], uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.reorder_program_exercises(uuid, uuid[], uuid) TO authenticated;
