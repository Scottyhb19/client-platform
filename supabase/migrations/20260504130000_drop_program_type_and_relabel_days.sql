-- ============================================================================
-- 20260504130000_drop_program_type_and_relabel_days
-- ============================================================================
-- Why: Programs polish — two intertwined changes the EP requested:
--
--   (1) "Location" (in_clinic | home_gym) is being removed entirely from
--       the new-training-block flow. It's pre-launch, no real data, no
--       feature surface depended on it. Per CLAUDE.md "Avoid backwards-
--       compatibility hacks ... If you are certain that something is
--       unused, you can delete it completely." Drop the column from both
--       `programs` and `program_templates`, drop the enum type, fix the
--       `_clone_program` RPC that still references it.
--
--   (2) Day labels move from terse single-letter codes (A, B, C) to
--       human-readable "Day 1", "Day 2", "Day 3" defaults that the EP
--       can rename to anything (e.g. "Lower body push") inside the
--       session builder. The CHECK constraint already permits 1..30
--       chars so the column doesn't need to change — only the existing
--       seed values get rewritten and the `create_program_day` RPC's
--       hardcoded 'A' default becomes 'Day 1'.
--
-- Order matters:
--   §1 must run BEFORE §3 (the RPC drops the `type` reference; once the
--       column is dropped in §3 the old function body would break).
--   §3 (column drops) must run BEFORE §4 (enum drop) — Postgres won't
--       drop a type still referenced by a column.
--   §5 + §6 are independent of §1–§4 and can sit anywhere.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1. Replace _clone_program body — strip every reference to programs.type.
--     Signature unchanged, so CREATE OR REPLACE is safe (no arity drift).
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

  INSERT INTO program_weeks (program_id, week_number, notes)
  SELECT new_program_id, week_number, notes
    FROM program_weeks
   WHERE program_id = p_source_program_id
     AND deleted_at IS NULL;

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
  )
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
  ORDER BY src_pd.scheduled_date, pe.sort_order;

  RETURN jsonb_build_object(
    'status', 'created',
    'new_program_id', new_program_id
  );
END;
$$;

COMMENT ON FUNCTION public._clone_program(uuid, date, text) IS
  'Internal helper: clones a program (and its weeks, days, exercises) onto a new start_date. Caller responsible for org gating. Returns jsonb with status: created | overlap | invalid_source. (programs.type removed in 20260504130000.)';


-- ----------------------------------------------------------------------------
-- §2. Drop the column default on programs.type so the next ALTER doesn't
--     trip over a default that references the type we're about to drop.
--     (Postgres lets us drop a column even with a default, but being
--     explicit makes the intent clear.)
-- ----------------------------------------------------------------------------
ALTER TABLE programs
  ALTER COLUMN type DROP DEFAULT;

ALTER TABLE program_templates
  ALTER COLUMN type DROP DEFAULT;


-- ----------------------------------------------------------------------------
-- §3. Drop the columns. CASCADE not needed — no FKs, no views, no
--     generated columns reference these.
-- ----------------------------------------------------------------------------
ALTER TABLE programs           DROP COLUMN type;
ALTER TABLE program_templates  DROP COLUMN type;


-- ----------------------------------------------------------------------------
-- §4. Drop the now-orphaned enum type.
-- ----------------------------------------------------------------------------
DROP TYPE program_type;


-- ----------------------------------------------------------------------------
-- §5. Migrate existing program_days seed labels: A → Day 1, B → Day 2, ...
--     Pre-launch — only fake/seed data exists. The regex match is
--     intentionally tight (single uppercase A–G) so any already-renamed
--     labels (anything multi-character, anything outside A–G) are
--     untouched.
-- ----------------------------------------------------------------------------
UPDATE program_days
   SET day_label = 'Day ' || (ascii(day_label) - 64)::text
 WHERE day_label ~ '^[A-G]$'
   AND deleted_at IS NULL;


-- ----------------------------------------------------------------------------
-- §6. Update create_program_day RPC: hardcoded 'A' → 'Day 1'.
--     Signature unchanged, body-only change.
--
--     Default kept simple per the original D-PROG-004 reasoning — the EP
--     can rename inside the session builder. Computing "next available
--     numeric label" gets messy once the EP has renamed siblings to
--     non-numeric values, and gives no real win for a one-off cell add.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_program_day(
  p_client_id   uuid,
  p_target_date date
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org         uuid := public.user_organization_id();
  caller_role        text := public.user_role();
  client_org         uuid;
  target_program     uuid;
  target_program_org uuid;
  existing_day_id    uuid;
  next_sort_order    int;
  new_day_id         uuid;
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT organization_id INTO client_org
    FROM clients
   WHERE id = p_client_id
     AND deleted_at IS NULL;

  IF client_org IS NULL OR client_org <> caller_org THEN
    RAISE EXCEPTION 'Client % not in your organization', p_client_id
      USING ERRCODE = '42501';
  END IF;

  target_program := public._program_for_date(p_client_id, p_target_date);

  IF target_program IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'no_program',
      'target_date', p_target_date
    );
  END IF;

  SELECT organization_id INTO target_program_org
    FROM programs WHERE id = target_program;

  IF target_program_org <> caller_org THEN
    RAISE EXCEPTION 'Target program not in your organization'
      USING ERRCODE = '42501';
  END IF;

  SELECT id INTO existing_day_id
    FROM program_days
   WHERE program_id = target_program
     AND scheduled_date = p_target_date
     AND deleted_at IS NULL;

  IF existing_day_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'conflict',
      'existing_day_id', existing_day_id
    );
  END IF;

  next_sort_order := 0;

  INSERT INTO program_days (
    program_id, program_week_id, day_label, scheduled_date, sort_order
  ) VALUES (
    target_program,
    NULL,
    'Day 1',
    p_target_date,
    next_sort_order
  )
  RETURNING id INTO new_day_id;

  RETURN jsonb_build_object(
    'status', 'created',
    'new_day_id', new_day_id
  );
END;
$$;

COMMENT ON FUNCTION public.create_program_day(uuid, date) IS
  'D-PROG-004: create an ad-hoc program_day on p_target_date for p_client_id. Resolves the active program covering the date via _program_for_date. Returns jsonb with status: created | no_program | conflict. SECURITY DEFINER + manual org gate. Default day_label is ''Day 1'' — EP renames in the session builder. (Default updated from ''A'' in 20260504130000.)';
