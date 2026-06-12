-- ============================================================================
-- 20260612120000_program_templates_lifecycle
-- ============================================================================
-- Why: G-2 of the program-engine/session-builder polish pass
-- (docs/polish/program-engine-session-builder.md, FM-2; Q-B sign-off
-- option (a) 2026-06-12). Brief §5.2 specifies reusable program templates;
-- the template tables have existed since 20260420101700 with zero
-- application code touching them — no save path, no instantiate path, and
-- no cross-client program reuse anywhere. This migration lands the
-- minimal lifecycle:
--
--   save_program_as_template(p_program_id, p_name)        → jsonb
--   create_program_from_template(p_template_id, p_client_id,
--                                p_start_date, p_name)     → jsonb
--
-- §1 also adds template_exercise_sets. The template tables predate the
-- per-set prescription model (20260507100000) the same way the clone RPCs
-- did (G-1): without a per-set mirror, saving a pyramid prescription
-- (12/10/8) would collapse to the scalar "3 × 12" and instantiation would
-- re-fan a uniform prescription — silent clinical data loss through the
-- save→instantiate round trip. The table mirrors program_exercise_sets
-- exactly (minus audit: program_templates and children are intentionally
-- NOT audited per schema.md §11.2 — "template library, not a patient
-- record" — so no audit trigger and no audit_resolve_org_id branch).
--
-- Week/day mapping convention (both directions):
--   week_number              = (scheduled_date - program.start_date) / 7 + 1
--   template_days.sort_order = day offset WITHIN the week (0–6),
--                              i.e. (scheduled_date - start_date) % 7
-- so instantiating onto a new start date reproduces the source program's
-- weekday rhythm exactly (Mon/Wed/Fri stays Mon/Wed/Fri relative to the
-- new start). template_days.sort_order is a plain int with no constraint,
-- so repurposing it as the offset is shape-compatible; the convention is
-- owned by these two RPCs.
--
-- Limits inherited from the template DDL: template_weeks.week_number CHECK
-- 1..52 — saving a program longer than 52 weeks raises. Accepted (no real
-- program at this practice runs past a year without re-programming).
--
-- Divergence guarantee (brief §5.2): create_program_from_template copies
-- rows and stamps programs.template_id for provenance only (FK SET NULL);
-- no trigger links template edits to instantiated programs.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1. template_exercise_sets — per-set mirror for template fidelity.
-- ----------------------------------------------------------------------------
CREATE TABLE template_exercise_sets (
  id                    uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  template_exercise_id  uuid         NOT NULL REFERENCES template_exercises(id) ON DELETE CASCADE,
  set_number            smallint     NOT NULL CHECK (set_number BETWEEN 1 AND 50),
  reps                  text         CHECK (reps IS NULL OR length(trim(reps)) BETWEEN 1 AND 40),
  optional_metric       text,        -- code matching exercise_metric_units.code
  optional_value        text,
  created_at            timestamptz  NOT NULL DEFAULT now(),
  updated_at            timestamptz  NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);

CREATE UNIQUE INDEX template_exercise_sets_te_set_unique
  ON template_exercise_sets (template_exercise_id, set_number)
  WHERE deleted_at IS NULL;

CREATE INDEX template_exercise_sets_te_idx
  ON template_exercise_sets (template_exercise_id, set_number)
  WHERE deleted_at IS NULL;

CREATE TRIGGER template_exercise_sets_touch_updated_at
  BEFORE UPDATE ON template_exercise_sets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE template_exercise_sets IS
  'Per-set prescription rows for template_exercises (G-2, program-engine polish pass 2026-06-12). Mirrors program_exercise_sets so the save→instantiate round trip preserves per-set variation (pyramids, top sets). NOT audited — template library, not a patient record (schema.md §11.2).';

-- RLS — Pattern C, four-hop walk to program_templates. Staff only, org
-- scoped; deny delete (soft delete only, and only via future template
-- management — the lifecycle RPCs below never delete).
ALTER TABLE template_exercise_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff select template_exercise_sets via parent"
  ON template_exercise_sets FOR SELECT TO authenticated
  USING (
    public.user_role() IN ('owner','staff')
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM template_exercises te
        JOIN template_days td ON td.id = te.template_day_id
        JOIN template_weeks tw ON tw.id = td.template_week_id
        JOIN program_templates pt ON pt.id = tw.template_id
       WHERE te.id = template_exercise_sets.template_exercise_id
         AND pt.organization_id = public.user_organization_id()
         AND pt.deleted_at IS NULL
    )
  );

CREATE POLICY "staff insert template_exercise_sets via parent"
  ON template_exercise_sets FOR INSERT TO authenticated
  WITH CHECK (
    public.user_role() IN ('owner','staff')
    AND EXISTS (
      SELECT 1 FROM template_exercises te
        JOIN template_days td ON td.id = te.template_day_id
        JOIN template_weeks tw ON tw.id = td.template_week_id
        JOIN program_templates pt ON pt.id = tw.template_id
       WHERE te.id = template_exercise_sets.template_exercise_id
         AND pt.organization_id = public.user_organization_id()
    )
  );

CREATE POLICY "staff update template_exercise_sets via parent"
  ON template_exercise_sets FOR UPDATE TO authenticated
  USING (
    public.user_role() IN ('owner','staff')
    AND EXISTS (
      SELECT 1 FROM template_exercises te
        JOIN template_days td ON td.id = te.template_day_id
        JOIN template_weeks tw ON tw.id = td.template_week_id
        JOIN program_templates pt ON pt.id = tw.template_id
       WHERE te.id = template_exercise_sets.template_exercise_id
         AND pt.organization_id = public.user_organization_id()
    )
  );

CREATE POLICY "deny delete template_exercise_sets"
  ON template_exercise_sets FOR DELETE TO authenticated USING (false);


-- ----------------------------------------------------------------------------
-- §2. save_program_as_template — snapshot a program into the template
-- library. Per-day loop so each template_day's exercises and per-set rows
-- pair back to their source via sort_order (the duplicate_program_day
-- pattern, proven again in G-1).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_program_as_template(
  p_program_id uuid,
  p_name       text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org      uuid := public.user_organization_id();
  caller_role     text := public.user_role();
  caller_user_id  uuid := auth.uid();

  v_src_org       uuid;
  v_src_name      text;
  v_src_notes     text;
  v_src_start     date;
  v_effective     text;
  v_template_id   uuid;
  v_day           record;
  v_week_number   int;
  v_tw_id         uuid;
  v_td_id         uuid;
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT organization_id, name, notes, start_date
    INTO v_src_org, v_src_name, v_src_notes, v_src_start
    FROM programs
   WHERE id = p_program_id
     AND deleted_at IS NULL;

  IF v_src_org IS NULL THEN
    RAISE EXCEPTION 'Source program % not found', p_program_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_src_org <> caller_org THEN
    RAISE EXCEPTION 'Source program not in your organization'
      USING ERRCODE = '42501';
  END IF;

  -- Week derivation needs a real start date.
  IF v_src_start IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_source');
  END IF;

  v_effective := COALESCE(NULLIF(trim(p_name), ''), v_src_name);

  -- Name collision: unique (org, lower(name)) among live templates.
  IF EXISTS (
    SELECT 1 FROM program_templates
     WHERE organization_id = caller_org
       AND lower(name) = lower(v_effective)
       AND deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('status', 'duplicate_name', 'name', v_effective);
  END IF;

  INSERT INTO program_templates (organization_id, created_by_user_id, name, description)
  VALUES (caller_org, caller_user_id, v_effective, v_src_notes)
  RETURNING id INTO v_template_id;

  -- One template_week per distinct derived week number; carry
  -- program_weeks.notes when a matching week_number row exists.
  INSERT INTO template_weeks (template_id, week_number, notes)
  SELECT v_template_id, wk.week_number, pw.notes
    FROM (
      SELECT DISTINCT ((pd.scheduled_date - v_src_start) / 7 + 1)::smallint AS week_number
        FROM program_days pd
       WHERE pd.program_id = p_program_id
         AND pd.deleted_at IS NULL
    ) wk
    LEFT JOIN program_weeks pw
      ON pw.program_id = p_program_id
     AND pw.week_number = wk.week_number
     AND pw.deleted_at IS NULL;

  -- Per-day: template_day + exercises (per-day superset remap) + per-set
  -- fan-out, pairing clone → source by sort_order within the day.
  FOR v_day IN
    SELECT pd.id, pd.day_label, pd.scheduled_date
      FROM program_days pd
     WHERE pd.program_id = p_program_id
       AND pd.deleted_at IS NULL
     ORDER BY pd.scheduled_date
  LOOP
    v_week_number := (v_day.scheduled_date - v_src_start) / 7 + 1;

    SELECT id INTO v_tw_id
      FROM template_weeks
     WHERE template_id = v_template_id
       AND week_number = v_week_number;

    INSERT INTO template_days (template_week_id, day_label, sort_order)
    VALUES (
      v_tw_id,
      v_day.day_label,
      (v_day.scheduled_date - v_src_start) - (v_week_number - 1) * 7
    )
    RETURNING id INTO v_td_id;

    WITH remap AS (
      SELECT old_id, gen_random_uuid() AS new_id
        FROM (
          SELECT DISTINCT superset_group_id AS old_id
            FROM program_exercises
           WHERE program_day_id = v_day.id
             AND superset_group_id IS NOT NULL
             AND deleted_at IS NULL
        ) AS distinct_groups
    ),
    cloned AS (
      INSERT INTO template_exercises (
        template_day_id, exercise_id, sort_order, section_title,
        superset_group_id, sets, reps, rest_seconds, rpe,
        optional_metric, optional_value, tempo, instructions
      )
      SELECT
        v_td_id, pe.exercise_id, pe.sort_order, pe.section_title,
        remap.new_id, pe.sets, pe.reps, pe.rest_seconds, pe.rpe,
        pe.optional_metric, pe.optional_value, pe.tempo, pe.instructions
        FROM program_exercises pe
        LEFT JOIN remap ON remap.old_id = pe.superset_group_id
       WHERE pe.program_day_id = v_day.id
         AND pe.deleted_at IS NULL
       ORDER BY pe.sort_order
      RETURNING id, sort_order
    )
    INSERT INTO template_exercise_sets (
      template_exercise_id, set_number, reps, optional_metric, optional_value
    )
    SELECT
      cloned.id, src_set.set_number, src_set.reps,
      src_set.optional_metric, src_set.optional_value
      FROM cloned
      JOIN program_exercises src_pe
        ON src_pe.program_day_id = v_day.id
       AND src_pe.deleted_at IS NULL
       AND src_pe.sort_order = cloned.sort_order
      JOIN program_exercise_sets src_set
        ON src_set.program_exercise_id = src_pe.id
       AND src_set.deleted_at IS NULL;
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'created',
    'template_id', v_template_id,
    'name', v_effective
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_program_as_template(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.save_program_as_template(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.save_program_as_template(uuid, text) IS
  'Snapshots a program (weeks, days, exercises, per-set rows) into the template library. Name defaults to the program name; collision with a live template returns status=duplicate_name. Week/day mapping: week_number from scheduled_date offset, template_days.sort_order = weekday offset 0-6 so instantiation reproduces the weekday rhythm. Returns status: created | duplicate_name | invalid_source. G-2, program-engine polish pass 2026-06-12.';


-- ----------------------------------------------------------------------------
-- §3. create_program_from_template — instantiate for any client in the
-- caller's org. The cross-client reuse path the brief promises.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_program_from_template(
  p_template_id uuid,
  p_client_id   uuid,
  p_start_date  date,
  p_name        text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org      uuid := public.user_organization_id();
  caller_role     text := public.user_role();
  caller_user_id  uuid := auth.uid();

  v_tpl_org       uuid;
  v_tpl_name      text;
  v_tpl_desc      text;
  v_client_org    uuid;
  v_duration      smallint;
  v_effective     text;
  v_program_id    uuid;
  v_day           record;
  v_pd_id         uuid;
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT organization_id, name, description
    INTO v_tpl_org, v_tpl_name, v_tpl_desc
    FROM program_templates
   WHERE id = p_template_id
     AND deleted_at IS NULL;

  IF v_tpl_org IS NULL THEN
    RAISE EXCEPTION 'Template % not found', p_template_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_tpl_org <> caller_org THEN
    RAISE EXCEPTION 'Template not in your organization'
      USING ERRCODE = '42501';
  END IF;

  SELECT organization_id INTO v_client_org
    FROM clients
   WHERE id = p_client_id
     AND deleted_at IS NULL;

  IF v_client_org IS NULL OR v_client_org <> caller_org THEN
    RAISE EXCEPTION 'Client not in your organization'
      USING ERRCODE = '42501';
  END IF;

  -- Duration spans the template's structure (default 1 week when the
  -- template has no weeks — degenerate but valid).
  SELECT COALESCE(MAX(week_number), 1) INTO v_duration
    FROM template_weeks
   WHERE template_id = p_template_id
     AND deleted_at IS NULL;

  v_effective := COALESCE(NULLIF(trim(p_name), ''), v_tpl_name);

  -- INSERT the program; EXCLUDE violation (programs_no_active_overlap)
  -- → clean 'overlap' status, no rows created.
  BEGIN
    INSERT INTO programs (
      organization_id, client_id, template_id, created_by_user_id,
      name, status, start_date, duration_weeks, notes
    ) VALUES (
      caller_org, p_client_id, p_template_id, caller_user_id,
      v_effective, 'active'::program_status,
      p_start_date, v_duration, v_tpl_desc
    ) RETURNING id INTO v_program_id;
  EXCEPTION WHEN exclusion_violation THEN
    RETURN jsonb_build_object('status', 'overlap');
  END;

  INSERT INTO program_weeks (program_id, week_number, notes)
  SELECT v_program_id, week_number, notes
    FROM template_weeks
   WHERE template_id = p_template_id
     AND deleted_at IS NULL;

  -- Per-day: program_day (scheduled_date from the week/offset convention)
  -- + exercises (per-day superset remap) + per-set fan-out.
  FOR v_day IN
    SELECT td.id, td.day_label, td.sort_order, tw.week_number
      FROM template_days td
      JOIN template_weeks tw ON tw.id = td.template_week_id
     WHERE tw.template_id = p_template_id
       AND td.deleted_at IS NULL
       AND tw.deleted_at IS NULL
     ORDER BY tw.week_number, td.sort_order
  LOOP
    INSERT INTO program_days (
      program_id, program_week_id, day_label, scheduled_date, sort_order
    )
    SELECT
      v_program_id,
      pw.id,
      v_day.day_label,
      p_start_date + (v_day.week_number - 1) * 7 + v_day.sort_order,
      v_day.sort_order
      FROM program_weeks pw
     WHERE pw.program_id = v_program_id
       AND pw.week_number = v_day.week_number
    RETURNING id INTO v_pd_id;

    WITH remap AS (
      SELECT old_id, gen_random_uuid() AS new_id
        FROM (
          SELECT DISTINCT superset_group_id AS old_id
            FROM template_exercises
           WHERE template_day_id = v_day.id
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
        v_pd_id, te.exercise_id, te.sort_order, te.section_title,
        remap.new_id, te.sets, te.reps, te.rest_seconds, te.rpe,
        te.optional_metric, te.optional_value, te.tempo, te.instructions
        FROM template_exercises te
        LEFT JOIN remap ON remap.old_id = te.superset_group_id
       WHERE te.template_day_id = v_day.id
         AND te.deleted_at IS NULL
       ORDER BY te.sort_order
      RETURNING id, sort_order
    )
    INSERT INTO program_exercise_sets (
      program_exercise_id, set_number, reps, optional_metric, optional_value
    )
    SELECT
      cloned.id, src_set.set_number, src_set.reps,
      src_set.optional_metric, src_set.optional_value
      FROM cloned
      JOIN template_exercises src_te
        ON src_te.template_day_id = v_day.id
       AND src_te.deleted_at IS NULL
       AND src_te.sort_order = cloned.sort_order
      JOIN template_exercise_sets src_set
        ON src_set.template_exercise_id = src_te.id
       AND src_set.deleted_at IS NULL;
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'created',
    'new_program_id', v_program_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_program_from_template(uuid, uuid, date, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_program_from_template(uuid, uuid, date, text) TO authenticated;

COMMENT ON FUNCTION public.create_program_from_template(uuid, uuid, date, text) IS
  'Instantiates a template as a new active program for any client in the caller''s org (weeks, days on the weekday-rhythm convention, exercises with fresh superset group ids, per-set rows). Stamps programs.template_id for provenance only — template edits never propagate (brief §5.2). Returns status: created | overlap. G-2, program-engine polish pass 2026-06-12.';
