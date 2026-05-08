-- ============================================================================
-- 20260508100000_duplicate_program_day
-- ============================================================================
-- Why: Phase I of the session-builder polish pass. The Duplicate button
-- on the session builder header has been disabled since the page was
-- first scaffolded. This RPC is what the button now calls — it copies
-- the source day, its program_exercises, and the per-set rows in
-- program_exercise_sets onto a chosen target date, then returns the new
-- day_id so the page action can navigate the EP straight there.
--
--   duplicate_program_day(p_source_day_id, p_target_date)
--     → jsonb { status, ... }
--
-- Why a NEW RPC rather than reusing copy_program_day:
--   1) copy_program_day was written in 2026-05-03 (programs Phase C),
--      before per-set storage landed in 2026-05-07 (session-builder
--      Phase C). It still inserts into the legacy program_exercises
--      scalars (sets/reps/optional_metric/optional_value/rpe) and does
--      not fan out program_exercise_sets, so a copied day comes out with
--      zero per-set rows. That's a pre-existing bug on the calendar's
--      copy/repeat flow — see /docs/deferred-prompts.md for the tracked
--      fix-up task.
--   2) Q1 sign-off (Phase I, 2026-05-08): the duplicate flow refuses on
--      conflict — there is no force-overwrite path. copy_program_day
--      supports p_force=true; mixing the two semantics into one RPC
--      muddies the contract. A separate RPC keeps each shape clear.
--
-- Behaviour:
--   - Source day must be in caller's org (manual gate inside the
--     SECURITY DEFINER body).
--   - Target program is whatever active program covers p_target_date for
--     the same client. If none, status='no_program'.
--   - If a live program_day already exists on the target date in the
--     covering program, status='conflict' (NO overwrite path).
--   - Otherwise: insert the cloned program_day (published_at NULL — the
--     copy lands as a draft), clone all live program_exercises (with
--     superset_group_id remapping per copy_program_day's pattern), then
--     fan out each new program_exercise's program_exercise_sets from the
--     source's live per-set rows.
--
-- All writes happen inside a single transaction (the function body).
-- SECURITY DEFINER bypasses RLS for the writes so the parent-walk
-- inserts/updates don't trip the deleted_at-IS-NULL UPDATE trap that
-- catches direct soft-deletes (project_postgrest_soft_delete_rls).
-- The org gate is re-implemented manually inside.
--
-- Returns:
--   { status: 'created', new_day_id: <uuid> }
--   { status: 'conflict' }
--   { status: 'no_program', target_date: <date> }
--
-- Reuses public._program_for_date(client_id, date) — internal helper
-- introduced by 20260503120000_program_days_copy_repeat for resolving
-- the active program covering a given date.
-- ============================================================================


CREATE OR REPLACE FUNCTION public.duplicate_program_day(
  p_source_day_id uuid,
  p_target_date   date
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org         uuid := public.user_organization_id();
  caller_role        text := public.user_role();
  src_record         program_days%ROWTYPE;
  src_client_id      uuid;
  src_program_org    uuid;
  target_program     uuid;
  target_program_org uuid;
  existing_day_id    uuid;
  new_day_id         uuid;
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO src_record
    FROM program_days
   WHERE id = p_source_day_id
     AND deleted_at IS NULL;

  IF src_record.id IS NULL THEN
    RAISE EXCEPTION 'Source day % not found', p_source_day_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Source program must be in the caller's org.
  SELECT client_id, organization_id
    INTO src_client_id, src_program_org
    FROM programs
   WHERE id = src_record.program_id
     AND deleted_at IS NULL;

  IF src_program_org IS NULL OR src_program_org <> caller_org THEN
    RAISE EXCEPTION 'Source program not in your organization'
      USING ERRCODE = '42501';
  END IF;

  -- Resolve target program by date (same client).
  target_program := public._program_for_date(src_client_id, p_target_date);

  IF target_program IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'no_program',
      'target_date', p_target_date
    );
  END IF;

  -- Defensive: same client, so same org — but verify before writing.
  SELECT organization_id INTO target_program_org
    FROM programs WHERE id = target_program;

  IF target_program_org <> caller_org THEN
    RAISE EXCEPTION 'Target program not in your organization'
      USING ERRCODE = '42501';
  END IF;

  -- Conflict check (Q1 sign-off: refuse, no force).
  SELECT id INTO existing_day_id
    FROM program_days
   WHERE program_id = target_program
     AND scheduled_date = p_target_date
     AND deleted_at IS NULL;

  IF existing_day_id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'conflict');
  END IF;

  -- Insert the cloned day. published_at left NULL — the copy lands as a
  -- draft regardless of the source's publish state. Per Q1 spec:
  -- "copy lands as a draft on the chosen date".
  INSERT INTO program_days (
    program_id, program_week_id, day_label, scheduled_date, sort_order
  ) VALUES (
    target_program,
    NULL,
    src_record.day_label,
    p_target_date,
    src_record.sort_order
  )
  RETURNING id INTO new_day_id;

  -- Clone exercises with remapped superset groups. Pattern matches
  -- copy_program_day: dedupe distinct old group_ids first, then assign
  -- one fresh uuid per distinct row. The dedup-then-uuid order matters —
  -- gen_random_uuid() is volatile, so SELECT DISTINCT col, gen_random_uuid()
  -- returns one row per *source row* (every uuid is "distinct"), causing
  -- the LEFT JOIN below to fan out into a Cartesian product.
  --
  -- We capture (old_pe_id, new_pe_id) so the per-set fan-out below can
  -- target the right new program_exercises rows; INSERT … RETURNING with
  -- a separate per-row source uuid is the cleanest way to thread that
  -- pairing through.
  WITH remap AS (
    SELECT old_id, gen_random_uuid() AS new_id
      FROM (
        SELECT DISTINCT superset_group_id AS old_id
          FROM program_exercises
         WHERE program_day_id = p_source_day_id
           AND superset_group_id IS NOT NULL
           AND deleted_at IS NULL
      ) AS distinct_groups
  ),
  cloned AS (
    INSERT INTO program_exercises (
      program_day_id, exercise_id, sort_order, section_title,
      superset_group_id, sets, reps, rest_seconds, rpe,
      optional_metric, optional_value, tempo, instructions
    )
    SELECT
      new_day_id, pe.exercise_id, pe.sort_order, pe.section_title,
      remap.new_id, pe.sets, pe.reps, pe.rest_seconds, pe.rpe,
      pe.optional_metric, pe.optional_value, pe.tempo, pe.instructions
      FROM program_exercises pe
      LEFT JOIN remap ON remap.old_id = pe.superset_group_id
     WHERE pe.program_day_id = p_source_day_id
       AND pe.deleted_at IS NULL
     ORDER BY pe.sort_order
    RETURNING id, sort_order
  )
  -- Fan out program_exercise_sets per cloned program_exercise. Pair the
  -- new id back to the source by sort_order — within a program_day,
  -- sort_order is unique among live rows (the page enforces it via the
  -- shift-on-insert RPC and moveProgramExerciseAction's sentinel-swap),
  -- so a 1:1 pairing on sort_order is safe here.
  INSERT INTO program_exercise_sets (
    program_exercise_id, set_number, reps, optional_metric, optional_value
  )
  SELECT
    cloned.id, src_set.set_number, src_set.reps,
    src_set.optional_metric, src_set.optional_value
    FROM cloned
    JOIN program_exercises src_pe
      ON src_pe.program_day_id = p_source_day_id
     AND src_pe.deleted_at IS NULL
     AND src_pe.sort_order = cloned.sort_order
    JOIN program_exercise_sets src_set
      ON src_set.program_exercise_id = src_pe.id
     AND src_set.deleted_at IS NULL;

  RETURN jsonb_build_object(
    'status', 'created',
    'new_day_id', new_day_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.duplicate_program_day(uuid, date) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.duplicate_program_day(uuid, date) TO authenticated;

COMMENT ON FUNCTION public.duplicate_program_day(uuid, date) IS
  'Clones a program_day (and its program_exercises + program_exercise_sets) onto p_target_date in whichever active program covers that date for the same client. Returns jsonb with status: created | conflict | no_program. Refuses on conflict — no force-overwrite path (Q1 sign-off, session-builder Phase I 2026-05-08). The new day lands as a draft (published_at NULL).';
