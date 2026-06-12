-- ============================================================================
-- 20260612100000_clone_rpcs_per_set_fanout
-- ============================================================================
-- Why: G-1 of the program-engine/session-builder polish pass
-- (docs/polish/program-engine-session-builder.md, FM-1). The four clone
-- RPCs written before per-set storage landed (session-builder Phase C,
-- migration 20260507100000) insert program_days + program_exercises but
-- never fan out program_exercise_sets:
--
--   copy_program_day            (20260503120000 §2)
--   repeat_program_day_weekly   (20260503120000 §3)
--   _clone_program              (20260503130000 §1, serving copy_program
--                                and repeat_program)
--
-- Every calendar copy/repeat therefore produces days whose exercises have
-- zero live set rows — the builder shows an empty prescription table and
-- the portal RPC (client_get_program_day_exercises_v2) returns
-- prescription_sets: []. duplicate_program_day (20260508100000) was built
-- after the per-set table and is the proven pattern this migration
-- mirrors: clone exercises in a `cloned AS (INSERT … RETURNING id,
-- sort_order)` CTE, then pair each new row back to its source by
-- sort_order (unique among live rows within a day — enforced by the
-- shift-on-insert RPC and the reorder RPC's full rewrite) and fan out the
-- source's live program_exercise_sets.
--
-- This supersedes the under-scoped /docs/deferred-prompts.md entry
-- "Calendar copy/repeat: per-set fan-out fix", which recorded only the
-- two day-level RPCs. The audit found all four clone paths affected.
--
-- ALSO FIXED HERE (found during the G-1 audit read): §3's remap CTE used
-- the one-pass `SELECT DISTINCT superset_group_id, gen_random_uuid()`
-- form that §2's comment explicitly warns against. gen_random_uuid() is
-- volatile, so DISTINCT never collapses duplicate group ids — a source
-- day holding an N-member superset produced N remap rows, and the LEFT
-- JOIN fanned out into N copies of every grouped exercise with mismatched
-- fresh group ids. Repeating a superset day weekly inserted duplicate,
-- broken-grouped exercises on every target date. pgTAP test 10 only
-- counted created *days* on the repeat path, so this passed green;
-- the test now also asserts exercise count, group cohesion, and set
-- fan-out per repeated day.
--
-- No signature changes — CREATE OR REPLACE only; grants unchanged but
-- re-stated per house pattern. All bodies remain SECURITY DEFINER with
-- the manual org/role gate at top (in-body guard per
-- docs/rls-policies.md; Supabase default-EXECUTE posture).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1. copy_program_day — now fans out program_exercise_sets.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.copy_program_day(
  p_source_day_id uuid,
  p_target_date   date,
  p_force         boolean DEFAULT false
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

  -- Resolve target program by date.
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

  -- Conflict check.
  SELECT id INTO existing_day_id
    FROM program_days
   WHERE program_id = target_program
     AND scheduled_date = p_target_date
     AND deleted_at IS NULL;

  IF existing_day_id IS NOT NULL AND NOT p_force THEN
    RETURN jsonb_build_object(
      'status', 'conflict',
      'conflicts', jsonb_build_array(
        jsonb_build_object(
          'date', p_target_date,
          'existing_day_id', existing_day_id
        )
      )
    );
  END IF;

  -- Force path: soft-delete the existing day. SECURITY DEFINER bypasses
  -- the SELECT policy's deleted_at filter that would otherwise abort
  -- the UPDATE WITH CHECK.
  IF existing_day_id IS NOT NULL AND p_force THEN
    UPDATE program_days
       SET deleted_at = now()
     WHERE id = existing_day_id;
  END IF;

  -- Insert the cloned day. Q7: keep source.day_label.
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

  -- Clone exercises with remapped superset groups (dedupe-then-uuid —
  -- gen_random_uuid() is volatile; a one-pass SELECT DISTINCT would
  -- never collapse duplicates and the join would fan out), capturing
  -- (new id, sort_order) so the per-set fan-out can pair each clone
  -- back to its source row.
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
  -- Fan out program_exercise_sets per cloned exercise (G-1). Pairing by
  -- sort_order is safe within a day — unique among live rows, enforced
  -- by the shift-on-insert and reorder RPCs.
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

REVOKE EXECUTE ON FUNCTION public.copy_program_day(uuid, date, boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.copy_program_day(uuid, date, boolean) TO authenticated;

COMMENT ON FUNCTION public.copy_program_day(uuid, date, boolean) IS
  'Clones a program_day (its exercises AND per-set program_exercise_sets rows) onto p_target_date in whichever active program covers that date. Returns jsonb with status: created | conflict | no_program. p_force=true overwrites an existing day on the target date. SECURITY DEFINER + manual org gate; soft-delete + RLS gotcha workaround. Per-set fan-out added 2026-06-12 (G-1, program-engine polish pass).';


-- ----------------------------------------------------------------------------
-- §2. repeat_program_day_weekly — remap CTE fixed (dedupe-then-uuid) and
-- per-set fan-out added inside the write loop.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.repeat_program_day_weekly(
  p_source_day_id uuid,
  p_end_date      date,
  p_force         boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org           uuid := public.user_organization_id();
  caller_role          text := public.user_role();
  src_record           program_days%ROWTYPE;
  src_client_id        uuid;
  src_program_org      uuid;
  src_program_start    date;
  src_program_duration int;
  required_duration    int;
  cur_date             date;
  target_program       uuid;
  existing_day_id      uuid;
  new_day_id           uuid;
  conflicts            jsonb := '[]'::jsonb;
  no_program_dates     jsonb := '[]'::jsonb;
  new_day_ids          jsonb := '[]'::jsonb;
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

  IF p_end_date <= src_record.scheduled_date THEN
    RETURN jsonb_build_object('status', 'invalid_end_date');
  END IF;

  SELECT client_id, organization_id, start_date, duration_weeks
    INTO src_client_id, src_program_org, src_program_start, src_program_duration
    FROM programs
   WHERE id = src_record.program_id
     AND deleted_at IS NULL;

  IF src_program_org IS NULL OR src_program_org <> caller_org THEN
    RAISE EXCEPTION 'Source program not in your organization'
      USING ERRCODE = '42501';
  END IF;

  -- Auto-extend the source program's duration_weeks if the picked
  -- end date falls outside the block's current range. Best-effort:
  -- the EXCLUDE constraint (programs_no_active_overlap) raises 23P01
  -- if extension would overlap another block; we catch and fall back
  -- to the original behavior (out-of-coverage dates reported in
  -- no_program_dates). Two-pass validate/write below is intentional —
  -- concurrent deletions between passes surface in no_program_dates,
  -- never as orphans (FK CASCADE).
  IF src_program_start IS NOT NULL AND src_program_duration IS NOT NULL THEN
    required_duration := (p_end_date - src_program_start) / 7 + 1;
    IF required_duration > src_program_duration THEN
      BEGIN
        UPDATE programs
           SET duration_weeks = required_duration
         WHERE id = src_record.program_id;
      EXCEPTION WHEN exclusion_violation THEN
        NULL;
      END;
    END IF;
  END IF;

  -- First pass: bucket every target date into {will-create, conflict,
  -- no-program} so the UI can show a single confirm dialog.
  cur_date := src_record.scheduled_date + 7;
  WHILE cur_date <= p_end_date LOOP
    target_program := public._program_for_date(src_client_id, cur_date);

    IF target_program IS NULL THEN
      no_program_dates := no_program_dates || to_jsonb(cur_date);
    ELSE
      SELECT id INTO existing_day_id
        FROM program_days
       WHERE program_id = target_program
         AND scheduled_date = cur_date
         AND deleted_at IS NULL;

      IF existing_day_id IS NOT NULL THEN
        conflicts := conflicts || jsonb_build_object(
          'date', cur_date,
          'existing_day_id', existing_day_id
        );
      END IF;
    END IF;

    cur_date := cur_date + 7;
  END LOOP;

  IF jsonb_array_length(conflicts) > 0 AND NOT p_force THEN
    RETURN jsonb_build_object(
      'status', 'conflict',
      'conflicts', conflicts,
      'no_program_dates', no_program_dates
    );
  END IF;

  -- Second pass: actually do the writes. Skip dates without a covering
  -- program; soft-delete + insert for conflicts; plain insert otherwise.
  cur_date := src_record.scheduled_date + 7;
  WHILE cur_date <= p_end_date LOOP
    target_program := public._program_for_date(src_client_id, cur_date);

    IF target_program IS NOT NULL THEN
      SELECT id INTO existing_day_id
        FROM program_days
       WHERE program_id = target_program
         AND scheduled_date = cur_date
         AND deleted_at IS NULL;

      IF existing_day_id IS NOT NULL THEN
        UPDATE program_days
           SET deleted_at = now()
         WHERE id = existing_day_id;
      END IF;

      INSERT INTO program_days (
        program_id, program_week_id, day_label, scheduled_date, sort_order
      ) VALUES (
        target_program,
        NULL,
        src_record.day_label,
        cur_date,
        src_record.sort_order
      )
      RETURNING id INTO new_day_id;

      -- Clone exercises. Remap CTE FIXED 2026-06-12: the original
      -- one-pass `SELECT DISTINCT superset_group_id, gen_random_uuid()`
      -- never deduplicated (volatile uuid makes every row distinct) and
      -- the LEFT JOIN fanned a superset day out into duplicate exercise
      -- rows with mismatched group ids on every repeat. Dedupe first,
      -- then assign one uuid per distinct group — same pattern as
      -- copy_program_day, which documented this exact trap.
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
      -- Per-set fan-out (G-1), pairing clone → source by sort_order.
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

      new_day_ids := new_day_ids || to_jsonb(new_day_id);
    END IF;

    cur_date := cur_date + 7;
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'created',
    'new_day_ids', new_day_ids,
    'no_program_dates', no_program_dates
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.repeat_program_day_weekly(uuid, date, boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.repeat_program_day_weekly(uuid, date, boolean) TO authenticated;

COMMENT ON FUNCTION public.repeat_program_day_weekly(uuid, date, boolean) IS
  'Clones a program_day (exercises AND per-set rows) onto every same-weekday occurrence between source.scheduled_date+7 and p_end_date. Returns jsonb with status: created | conflict | invalid_end_date. p_force=true overwrites; dates outside any active program are skipped (reported in no_program_dates). SECURITY DEFINER + manual org gate. 2026-06-12 (G-1): per-set fan-out added; superset remap Cartesian bug fixed (dedupe-then-uuid).';


-- ----------------------------------------------------------------------------
-- §3. _clone_program — per-set fan-out added. New exercise rows pair
-- back to their source via (scheduled_date - date_shift, sort_order):
-- the day-clone join already trusts shifted-date uniqueness, and
-- sort_order is unique among live rows within a day.
--
-- Base body is the CURRENT definition from 20260504130000 §1 (which
-- stripped programs.type when the enum was dropped) — NOT the original
-- 20260503130000 shape. The first cut of this migration was drafted
-- against the original and failed db push with 42704 on the dropped
-- program_type enum; recorded here so the next reader diffs against the
-- latest replacement, not the file that first created the function.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._clone_program(
  p_source_program_id uuid,
  p_new_start_date    date,
  p_new_name          text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  src_program_org      uuid;
  src_client_id        uuid;
  src_program_duration smallint;
  src_program_start    date;
  src_program_notes    text;
  date_shift           int;
  new_program_id       uuid;
  caller_user_id       uuid := auth.uid();
BEGIN
  SELECT
      organization_id, client_id, duration_weeks, start_date, notes
    INTO
      src_program_org, src_client_id,
      src_program_duration, src_program_start, src_program_notes
    FROM programs
   WHERE id = p_source_program_id
     AND deleted_at IS NULL;

  IF src_program_start IS NULL OR src_program_duration IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_source');
  END IF;

  date_shift := (p_new_start_date - src_program_start);

  -- INSERT the new program. EXCLUDE violation → clean 'overlap' status.
  BEGIN
    INSERT INTO programs (
      organization_id, client_id, created_by_user_id, name, status,
      start_date, duration_weeks, notes
    ) VALUES (
      src_program_org, src_client_id, caller_user_id, p_new_name,
      'active'::program_status,
      p_new_start_date, src_program_duration, src_program_notes
    ) RETURNING id INTO new_program_id;
  EXCEPTION WHEN exclusion_violation THEN
    RETURN jsonb_build_object('status', 'overlap');
  END;

  -- Clone weeks (week_number + notes carried over).
  INSERT INTO program_weeks (program_id, week_number, notes)
  SELECT new_program_id, week_number, notes
    FROM program_weeks
   WHERE program_id = p_source_program_id
     AND deleted_at IS NULL;

  -- Clone days. scheduled_date shifted by date_shift days.
  INSERT INTO program_days (
    program_id, program_week_id, day_label, scheduled_date, sort_order
  )
  SELECT
    new_program_id,
    new_pw.id,
    src_pd.day_label,
    (src_pd.scheduled_date + date_shift)::date,
    src_pd.sort_order
  FROM program_days src_pd
  LEFT JOIN program_weeks src_pw
    ON src_pw.id = src_pd.program_week_id
   AND src_pw.deleted_at IS NULL
  LEFT JOIN program_weeks new_pw
    ON new_pw.program_id = new_program_id
   AND new_pw.week_number = src_pw.week_number
  WHERE src_pd.program_id = p_source_program_id
    AND src_pd.deleted_at IS NULL;

  -- Clone exercises (dedupe-then-uuid remap, unchanged), now capturing
  -- (id, program_day_id, sort_order) so the per-set fan-out can pair
  -- each clone back to its source row across all days at once.
  WITH source_groups AS (
    SELECT DISTINCT pe.superset_group_id AS old_id
      FROM program_exercises pe
      JOIN program_days pd ON pd.id = pe.program_day_id
     WHERE pd.program_id = p_source_program_id
       AND pe.superset_group_id IS NOT NULL
       AND pe.deleted_at IS NULL
       AND pd.deleted_at IS NULL
  ),
  remap AS (
    SELECT old_id, gen_random_uuid() AS new_id FROM source_groups
  ),
  cloned AS (
    INSERT INTO program_exercises (
      program_day_id, exercise_id, sort_order, section_title,
      superset_group_id, sets, reps, rest_seconds, rpe,
      optional_metric, optional_value, tempo, instructions
    )
    SELECT
      new_pd.id, pe.exercise_id, pe.sort_order, pe.section_title,
      remap.new_id, pe.sets, pe.reps, pe.rest_seconds, pe.rpe,
      pe.optional_metric, pe.optional_value, pe.tempo, pe.instructions
    FROM program_exercises pe
    JOIN program_days src_pd ON src_pd.id = pe.program_day_id
    JOIN program_days new_pd
      ON new_pd.program_id = new_program_id
     AND new_pd.scheduled_date = (src_pd.scheduled_date + date_shift)::date
     AND new_pd.deleted_at IS NULL
    LEFT JOIN remap ON remap.old_id = pe.superset_group_id
    WHERE src_pd.program_id = p_source_program_id
      AND pe.deleted_at IS NULL
      AND src_pd.deleted_at IS NULL
    ORDER BY src_pd.scheduled_date, pe.sort_order
    RETURNING id, program_day_id, sort_order
  )
  -- Per-set fan-out (G-1): new pe → its new day → unshift the date to
  -- find the source day → source pe by sort_order → its live set rows.
  INSERT INTO program_exercise_sets (
    program_exercise_id, set_number, reps, optional_metric, optional_value
  )
  SELECT
    cloned.id, src_set.set_number, src_set.reps,
    src_set.optional_metric, src_set.optional_value
    FROM cloned
    JOIN program_days new_pd ON new_pd.id = cloned.program_day_id
    JOIN program_days src_pd
      ON src_pd.program_id = p_source_program_id
     AND src_pd.scheduled_date = (new_pd.scheduled_date - date_shift)::date
     AND src_pd.deleted_at IS NULL
    JOIN program_exercises src_pe
      ON src_pe.program_day_id = src_pd.id
     AND src_pe.sort_order = cloned.sort_order
     AND src_pe.deleted_at IS NULL
    JOIN program_exercise_sets src_set
      ON src_set.program_exercise_id = src_pe.id
     AND src_set.deleted_at IS NULL;

  RETURN jsonb_build_object(
    'status', 'created',
    'new_program_id', new_program_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public._clone_program(uuid, date, text) FROM PUBLIC;

COMMENT ON FUNCTION public._clone_program(uuid, date, text) IS
  'Internal helper: clones a program (weeks, days, exercises, per-set program_exercise_sets rows) onto a new start_date. Caller responsible for org gating. Returns jsonb with status: created | overlap | invalid_source. (programs.type removed in 20260504130000.) Per-set fan-out added 2026-06-12 (G-1, program-engine polish pass).';
