-- ============================================================================
-- 20260507100400_reorder_program_exercises
-- ============================================================================
-- Why: Phase G of the session-builder polish pass — drag-and-drop reorder.
-- /docs/polish/session-builder.md §2.5 + §0.1 ø-2 + §4 row G.
--
-- The TS-side moveProgramExerciseAction (sentinel-swap pattern) is a
-- single-position adjacent move. DnD via @dnd-kit naturally produces "the
-- new full order", and dragging a card across multiple positions through
-- chained adjacent swaps would be (a) non-atomic across N round-trips and
-- (b) intermediate sort_order states the server transiently exposes via
-- realtime subscriptions. Wrapping the whole reorder in a SECURITY DEFINER
-- plpgsql RPC gives us:
--
--   - one transaction (rollback on validation failure or any DB error)
--   - one cross-org check up front (clean error UX before any data shifts)
--   - one place that owns the group-inheritance rule for reorders
--   - the drag re-derivation lives next to the insert re-derivation in
--     insert_program_exercise_at — same shape, same neighbours-share rule.
--
-- Sort-order strategy: single UPDATE FROM unnest(... WITH ORDINALITY) to
-- rewrite every row's sort_order to its position in the array. No UNIQUE
-- constraint on (program_day_id, sort_order) so no sentinel-swap needed —
-- the table tolerates a transient duplicate during the UPDATE.
--
-- Group inheritance — the moved card only:
--
--   The Q3 sign-off (chat 2026-05-07) is "server re-derives group_ids from
--   position." The minimal-surface implementation re-evaluates only the
--   moved card via the same "both new neighbours share a non-NULL group
--   ⇒ join; otherwise solo" rule used by insert_program_exercise_at.
--   Cards that didn't move keep their group_id — their group identity
--   hasn't changed, only their neighbour set has, and any group reduced to
--   1 member by the move falls out via the singleton cleanup at the end.
--
--   Examples, all verified against the algorithm:
--
--     [A, B1, B2, B3, C] drag B1 to bottom → [A, B2, B3, C, B1]
--       B1 new neighbours: C (none), end. Not both same ⇒ solo.
--       Singleton check: X has {B2, B3} = 2 members ⇒ no cleanup.
--       Result: A, [B2, B3] in X, C, B1 (solo).
--
--     [A, B1, B2, C] drag B1 to bottom → [A, B2, C, B1]
--       B1 new neighbours: C (none), end. ⇒ solo.
--       Singleton check: X has {B2} = 1 ⇒ B2 also clears.
--       Result: all solo. (User dragged the only-other group member out.)
--
--     [A, B1, B2, C, D1, D2] drag B1 between D1 and D2
--                          → [A, B2, C, D1, B1, D2]
--       B1 new neighbours: D1 (Y), D2 (Y). Both Y ⇒ join Y.
--       Singleton check: X has {B2} = 1 ⇒ B2 clears. Y has {D1, B1, D2}
--                        = 3 ⇒ no cleanup.
--       Result: A, B2 (solo), C, [D1, B1, D2] in Y. (Cross-group drag —
--       leaves A, joins B per Q2.)
--
--     [B1, B2, A] drag A between B1 and B2 → [B1, A, B2]
--       A new neighbours: B1 (X), B2 (X). Both X ⇒ join X.
--       Singleton check: X has {B1, A, B2} = 3 ⇒ no cleanup.
--       Result: superset gained a member.
--
-- Defence: if the moved card's old sort_order equals its new sort_order
-- (no-op reorder — client should have returned early but defends), skip
-- the group re-derivation entirely. Otherwise the insert rule applied to
-- a non-moving card with only one same-group neighbour would spuriously
-- dissolve the group.
--
-- Cross-org defence-in-depth: caller's org checked at the top before any
-- write. The single-hop walk via pd.program_id mirrors
-- soft_delete_program_exercise (post-D-PROG-001 — program_week_id is
-- nullable on copy/repeat-created days, see migration 20260504110000).
--
-- Function is new — no DROP needed.
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

  v_old_so      int;     -- moved card's sort_order before the rewrite
  v_new_so      int;     -- moved card's sort_order after the rewrite
  v_old_grp     uuid;    -- moved card's group_id before re-derivation
  v_above_grp   uuid;    -- group_id of the row immediately above (post-rewrite)
  v_below_grp   uuid;    -- group_id of the row immediately below (post-rewrite)
  v_new_grp     uuid;    -- moved card's group_id after re-derivation
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

  -- Every supplied id must be a live program_exercise on this day.
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

  -- No duplicates. Combined with the size + membership checks above this
  -- guarantees orderedIds is a permutation of the day's live ids.
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

    -- Capture the moved card's pre-rewrite sort_order so we can detect a
    -- no-op reorder after Phase 1 and skip group re-derivation in that case.
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

  -- Phase 2 — re-derive the moved card's group_id from its new neighbours.
  IF p_moved_pe_id IS NOT NULL THEN
    SELECT sort_order INTO v_new_so
      FROM program_exercises
     WHERE id = p_moved_pe_id
       AND program_day_id = p_day_id
       AND deleted_at IS NULL;

    -- Skip re-derivation when the moved card didn't actually move. Without
    -- this guard, a card with only one same-group neighbour would be set
    -- solo by the insert rule even though its group is still well-formed.
    IF v_new_so IS DISTINCT FROM v_old_so THEN
      -- Above neighbour. NULL when the moved card landed at the top.
      SELECT superset_group_id INTO v_above_grp
        FROM program_exercises
       WHERE program_day_id = p_day_id
         AND deleted_at IS NULL
         AND sort_order = v_new_so - 1;

      -- Below neighbour. NULL when the moved card landed at the bottom.
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
        UPDATE program_exercises
           SET superset_group_id = v_new_grp
         WHERE id = p_moved_pe_id;
      END IF;
    END IF;
  END IF;

  -- Phase 3 — singleton cleanup. Any group with only one live member on
  -- this day is meaningless (a "superset of one" reads as a regular
  -- exercise); clear that member's group_id. Mirrors the cleanup branch
  -- in ungroupFromSupersetAction.
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
  'Atomic reorder of a program_day''s exercises. p_ordered_ids must be a permutation of the day''s live program_exercise ids; sort_order is rewritten to match the array''s ordinality. Group inheritance: if p_moved_pe_id is supplied AND that card''s sort_order actually changed, its superset_group_id is re-derived using the insert rule (both new neighbours share a non-NULL group ⇒ join; otherwise solo). Singleton cleanup runs at the end. Phase G of the session-builder polish pass (/docs/polish/session-builder.md §4 row G).';

REVOKE EXECUTE ON FUNCTION public.reorder_program_exercises(uuid, uuid[], uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.reorder_program_exercises(uuid, uuid[], uuid) TO authenticated;
