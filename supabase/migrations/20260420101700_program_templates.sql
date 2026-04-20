-- ============================================================================
-- 20260420101700_program_templates
-- ============================================================================
-- Why: Reusable exercise protocols. Cloning a template to a client creates an
-- independent copy (see programs migration); template edits do not propagate
-- to existing client programs. Retroactive changes to active programs would
-- be clinically unsafe.
--
-- Nested structure (TrainHeroic-style):
--   program_templates
--     └── template_weeks (1..n, typically 4–6 for mesocycles)
--           └── template_days (Day A, Day B, ...)
--                 └── template_exercises (with prescription, order,
--                                         optional superset grouping)
--
-- Cross-org enforcement: template_exercises.exercise_id requires a bespoke
-- walker since the nested tables do not carry organization_id directly.
-- The walker climbs template_days → template_weeks → program_templates and
-- compares with the referenced exercise's organization_id.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- program_templates
-- ----------------------------------------------------------------------------
CREATE TABLE program_templates (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid          NOT NULL REFERENCES organizations(id)      ON DELETE RESTRICT,
  created_by_user_id  uuid          REFERENCES user_profiles(user_id)          ON DELETE SET NULL,
  name                text          NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  description         text,
  type                program_type  NOT NULL DEFAULT 'home_gym',
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

CREATE INDEX program_templates_org_idx
  ON program_templates (organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX program_templates_org_name_idx
  ON program_templates (organization_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE TRIGGER program_templates_touch_updated_at
  BEFORE UPDATE ON program_templates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE program_templates IS
  'Reusable exercise protocol. Cloned to a client program to instantiate a concrete plan. Changes here do NOT propagate to existing client programs.';


-- ----------------------------------------------------------------------------
-- template_weeks
-- ----------------------------------------------------------------------------
CREATE TABLE template_weeks (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id   uuid         NOT NULL REFERENCES program_templates(id) ON DELETE CASCADE,
  week_number   smallint     NOT NULL CHECK (week_number BETWEEN 1 AND 52),
  notes         text,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  UNIQUE (template_id, week_number)
);

CREATE INDEX template_weeks_template_idx
  ON template_weeks (template_id, week_number)
  WHERE deleted_at IS NULL;

CREATE TRIGGER template_weeks_touch_updated_at
  BEFORE UPDATE ON template_weeks
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- ----------------------------------------------------------------------------
-- template_days
-- ----------------------------------------------------------------------------
CREATE TABLE template_days (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  template_week_id  uuid         NOT NULL REFERENCES template_weeks(id) ON DELETE CASCADE,
  day_label         text         NOT NULL CHECK (length(trim(day_label)) BETWEEN 1 AND 30),
  sort_order        int          NOT NULL DEFAULT 0,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);

CREATE INDEX template_days_week_idx
  ON template_days (template_week_id, sort_order)
  WHERE deleted_at IS NULL;

CREATE TRIGGER template_days_touch_updated_at
  BEFORE UPDATE ON template_days
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- ----------------------------------------------------------------------------
-- template_exercises
-- ----------------------------------------------------------------------------
CREATE TABLE template_exercises (
  id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  template_day_id      uuid         NOT NULL REFERENCES template_days(id) ON DELETE CASCADE,
  exercise_id          uuid         NOT NULL REFERENCES exercises(id)     ON DELETE RESTRICT,
  sort_order           int          NOT NULL DEFAULT 0,
  section_title        text         CHECK (
                         section_title IS NULL
                         OR length(trim(section_title)) BETWEEN 1 AND 60
                       ),
  superset_group_id    uuid,        -- siblings with same group_id form a superset
  -- Prescription overrides; NULL falls back to exercise defaults at time-of-use
  sets                 smallint     CHECK (sets IS NULL OR sets BETWEEN 1 AND 50),
  reps                 text         CHECK (reps IS NULL OR length(trim(reps)) BETWEEN 1 AND 40),
  rest_seconds         int          CHECK (rest_seconds IS NULL OR rest_seconds BETWEEN 0 AND 3600),
  rpe                  smallint     CHECK (rpe IS NULL OR rpe BETWEEN 1 AND 10),
  optional_metric      text,
  optional_value       text,
  tempo                text         CHECK (tempo IS NULL OR tempo ~ '^[0-9x]{4}$'),
  instructions         text,
  created_at           timestamptz  NOT NULL DEFAULT now(),
  updated_at           timestamptz  NOT NULL DEFAULT now(),
  deleted_at           timestamptz
);

CREATE INDEX template_exercises_day_idx
  ON template_exercises (template_day_id, sort_order)
  WHERE deleted_at IS NULL;

CREATE INDEX template_exercises_exercise_idx
  ON template_exercises (exercise_id)
  WHERE deleted_at IS NULL;

-- Superset group queries (show exercises in a group together)
CREATE INDEX template_exercises_superset_idx
  ON template_exercises (template_day_id, superset_group_id)
  WHERE superset_group_id IS NOT NULL AND deleted_at IS NULL;

CREATE TRIGGER template_exercises_touch_updated_at
  BEFORE UPDATE ON template_exercises
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- ----------------------------------------------------------------------------
-- Cross-org walker: template_exercises.exercise_id must live in the same org
-- as its containing template. Bespoke because template_exercises has no
-- self.organization_id column.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_template_exercise_same_org()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  template_org_id  uuid;
  exercise_org_id  uuid;
BEGIN
  SELECT pt.organization_id
    INTO template_org_id
    FROM template_days td
    JOIN template_weeks tw ON tw.id = td.template_week_id
    JOIN program_templates pt ON pt.id = tw.template_id
   WHERE td.id = NEW.template_day_id;

  SELECT organization_id
    INTO exercise_org_id
    FROM exercises
   WHERE id = NEW.exercise_id;

  IF template_org_id IS NULL OR exercise_org_id IS NULL THEN
    RAISE EXCEPTION 'template_exercises parent lookup failed (day %, exercise %)',
      NEW.template_day_id, NEW.exercise_id;
  END IF;

  IF template_org_id IS DISTINCT FROM exercise_org_id THEN
    RAISE EXCEPTION 'Cross-org: template in org % cannot reference exercise in org %',
      template_org_id, exercise_org_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_template_exercise_same_org() IS
  'BEFORE INSERT/UPDATE trigger: walks template_exercises → template_days → template_weeks → program_templates to resolve template org, and compares with exercises.organization_id.';

CREATE TRIGGER template_exercises_enforce_org
  BEFORE INSERT OR UPDATE ON template_exercises
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_template_exercise_same_org();


COMMENT ON TABLE template_exercises IS
  'Exercise prescriptions within a template day. Prescription fields inherit from exercises defaults when NULL; overrides stored here.';
COMMENT ON COLUMN template_exercises.superset_group_id IS
  'Siblings within the same template_day sharing this UUID form a superset. NULL means standalone.';
COMMENT ON COLUMN template_exercises.tempo IS
  'Four-digit tempo string (e.g. 3010 = 3s eccentric, 0s bottom, 1s concentric, 0s top). Digit may be "x" for max-speed.';
