-- ============================================================================
-- 20260503120000_program_days_copy_repeat
-- ============================================================================
-- Why: Phase C of the programs polish pass. Two RPCs so the EP can
-- copy a single session day to any other date or repeat it weekly on
-- the same weekday up to a chosen end date.
--
--   copy_program_day(p_source_day_id, p_target_date, p_force)
--     → jsonb { status, ... }
--
--   repeat_program_day_weekly(p_source_day_id, p_end_date, p_force)
--     → jsonb { status, ... }
--
-- Why SECURITY DEFINER: the conflict-overwrite path soft-deletes an
-- existing program_day (UPDATE … SET deleted_at = now()). The SELECT
-- policy on program_days filters deleted_at IS NULL, which Postgres
-- applies as the UPDATE WITH CHECK on the new row — the new row fails
-- the policy, the UPDATE aborts with 42501. This is the documented
-- soft-delete + RLS gotcha (see migration 20260429120000 — every
-- soft_delete_<table> RPC there uses the same workaround).
--
-- Org boundary is enforced manually inside each function: caller_org
-- must equal the source program's org, and the target program (resolved
-- by date) must also be in the caller's org. Both reads and writes go
-- through these gates.
--
-- The `status: 'conflict'` return shape lets the UI distinguish the
-- outcomes without try/catching exceptions:
--
--   { status: 'created', new_day_id: <uuid> }
--   { status: 'created', new_day_ids: [<uuid>...], no_program_dates: [...] }
--   { status: 'conflict', conflicts: [{date, existing_day_id}, ...] }
--   { status: 'no_program', target_date: <date> }
--   { status: 'invalid_end_date' }
--
-- Cross-program copies (Q6 sign-off): the new day attaches to whichever
-- active program covers the target date, not necessarily the source's
-- program. If no active program covers the target date, the RPC
-- returns status='no_program' so the UI can surface a clear error.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1. Internal helper — resolve the active program covering a date for
-- a given client. SECURITY DEFINER so it can be called from inside the
-- copy/repeat RPCs without re-checking RLS (the RPCs have already
-- gated by org). REVOKE FROM PUBLIC keeps it internal.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._program_for_date(
  p_client_id uuid,
  p_date      date
) RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id
    FROM programs
   WHERE client_id = p_client_id
     AND status = 'active'
     AND deleted_at IS NULL
     AND start_date IS NOT NULL
     AND duration_weeks IS NOT NULL
     AND p_date >= start_date
     AND p_date < (start_date + (duration_weeks * 7))
   ORDER BY start_date DESC
   LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public._program_for_date(uuid, date) FROM PUBLIC;

COMMENT ON FUNCTION public._program_for_date(uuid, date) IS
  'Internal helper: returns the active program for this client whose date range covers p_date, or NULL. SECURITY DEFINER so callers (which are themselves SECURITY DEFINER) skip the second RLS round-trip; not granted to authenticated.';


-- ----------------------------------------------------------------------------
-- §2. copy_program_day — clone one day to a target date.
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

  -- Clone exercises with remapped superset groups (each source group_id
  -- maps to a fresh uuid so groupings stay together on the destination
  -- but don't collide with any existing group elsewhere).
  WITH remap AS (
    -- Generate one new uuid per UNIQUE source superset_group_id.
    -- The subquery deduplicates first; the outer SELECT then assigns
    -- a fresh uuid per distinct row. Doing this in one pass with
    -- `SELECT DISTINCT col, gen_random_uuid()` would not dedupe
    -- because gen_random_uuid() is volatile — every call produces
    -- a new value, so every row is "distinct" and the join below
    -- explodes into a Cartesian product.
    SELECT old_id, gen_random_uuid() AS new_id
      FROM (
        SELECT DISTINCT superset_group_id AS old_id
          FROM program_exercises
         WHERE program_day_id = p_source_day_id
           AND superset_group_id IS NOT NULL
           AND deleted_at IS NULL
      ) AS distinct_groups
  )
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
   ORDER BY pe.sort_order;

  RETURN jsonb_build_object(
    'status', 'created',
    'new_day_id', new_day_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.copy_program_day(uuid, date, boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.copy_program_day(uuid, date, boolean) TO authenticated;

COMMENT ON FUNCTION public.copy_program_day(uuid, date, boolean) IS
  'Clones a program_day (and its exercises) onto p_target_date in whichever active program covers that date. Returns jsonb with status: created | conflict | no_program. p_force=true overwrites an existing day on the target date. SECURITY DEFINER + manual org gate; soft-delete + RLS gotcha workaround.';


-- ----------------------------------------------------------------------------
-- §3. repeat_program_day_weekly — clone source onto every same-weekday
-- between source.scheduled_date+7 and p_end_date inclusive.
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
  caller_org        uuid := public.user_organization_id();
  caller_role       text := public.user_role();
  src_record        program_days%ROWTYPE;
  src_client_id     uuid;
  src_program_org   uuid;
  cur_date          date;
  target_program    uuid;
  existing_day_id   uuid;
  new_day_id        uuid;
  conflicts         jsonb := '[]'::jsonb;
  no_program_dates  jsonb := '[]'::jsonb;
  new_day_ids       jsonb := '[]'::jsonb;
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

  SELECT client_id, organization_id
    INTO src_client_id, src_program_org
    FROM programs
   WHERE id = src_record.program_id
     AND deleted_at IS NULL;

  IF src_program_org IS NULL OR src_program_org <> caller_org THEN
    RAISE EXCEPTION 'Source program not in your organization'
      USING ERRCODE = '42501';
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

      WITH remap AS (
        SELECT DISTINCT superset_group_id AS old_id, gen_random_uuid() AS new_id
          FROM program_exercises
         WHERE program_day_id = p_source_day_id
           AND superset_group_id IS NOT NULL
           AND deleted_at IS NULL
      )
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
       ORDER BY pe.sort_order;

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
  'Clones a program_day onto every same-weekday occurrence between source.scheduled_date+7 and p_end_date. Returns jsonb with status: created | conflict | invalid_end_date. p_force=true overwrites; dates outside any active program are silently skipped (reported in no_program_dates). SECURITY DEFINER + manual org gate; soft-delete + RLS gotcha workaround.';
