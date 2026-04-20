-- ============================================================================
-- 20260420101800_programs
-- ============================================================================
-- Why: Client-specific active exercise plan. Cloned from a template or
-- authored from scratch. Structure mirrors templates (weeks → days →
-- exercises) but with calendar scheduling (program_days.day_of_week) and
-- optimistic-concurrency on the prescription rows.
--
-- Cross-org enforcement:
--   programs.client_id, programs.template_id via generic enforce_same_org_fk
--   program_exercises.exercise_id via bespoke walker
-- ============================================================================

-- ----------------------------------------------------------------------------
-- programs — top-level container, linked to one client
-- ----------------------------------------------------------------------------
CREATE TABLE programs (
  id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid            NOT NULL REFERENCES organizations(id)       ON DELETE RESTRICT,
  client_id           uuid            NOT NULL REFERENCES clients(id)             ON DELETE RESTRICT,
  template_id         uuid            REFERENCES program_templates(id)            ON DELETE SET NULL,
  created_by_user_id  uuid            REFERENCES user_profiles(user_id)           ON DELETE SET NULL,
  name                text            NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  type                program_type    NOT NULL DEFAULT 'home_gym',
  status              program_status  NOT NULL DEFAULT 'draft',
  start_date          date,
  duration_weeks      smallint        CHECK (duration_weeks IS NULL OR duration_weeks BETWEEN 1 AND 52),
  notes               text,           -- client-visible when status is active/archived (see RLS)
  version             int             NOT NULL DEFAULT 1,
  created_at          timestamptz     NOT NULL DEFAULT now(),
  updated_at          timestamptz     NOT NULL DEFAULT now(),
  archived_at         timestamptz,
  deleted_at          timestamptz,
  CONSTRAINT programs_archived_has_timestamp CHECK (
    (status = 'archived' AND archived_at IS NOT NULL) OR status <> 'archived'
  )
);

-- Client profile program tab (active program lookup)
CREATE INDEX programs_client_status_idx
  ON programs (client_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX programs_org_idx
  ON programs (organization_id)
  WHERE deleted_at IS NULL;

-- Template dependency check (can we delete a template?)
CREATE INDEX programs_template_idx
  ON programs (template_id)
  WHERE template_id IS NOT NULL AND deleted_at IS NULL;

-- Single-active-program-per-client invariant (application enforces; this
-- partial unique index is a safety net the app cannot forget).
CREATE UNIQUE INDEX programs_one_active_per_client_idx
  ON programs (client_id)
  WHERE status = 'active' AND deleted_at IS NULL;

-- OCC + updated_at
CREATE TRIGGER programs_bump_version
  BEFORE UPDATE ON programs
  FOR EACH ROW EXECUTE FUNCTION public.bump_version_and_touch();

-- Cross-org FK triggers
CREATE TRIGGER programs_enforce_client_org
  BEFORE INSERT OR UPDATE ON programs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_same_org_fk('clients', 'client_id', 'organization_id');

CREATE TRIGGER programs_enforce_template_org
  BEFORE INSERT OR UPDATE ON programs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_same_org_fk('program_templates', 'template_id', 'organization_id');

COMMENT ON TABLE programs IS
  'Client-specific active exercise plan. Divergent from its source template after cloning; template edits never propagate.';
COMMENT ON COLUMN programs.notes IS
  'Program-level commentary. Client-visible when status is active or archived (see RLS policy on programs).';
COMMENT ON COLUMN programs.version IS
  'Optimistic concurrency control; see /docs/schema.md §12.';


-- ----------------------------------------------------------------------------
-- program_weeks
-- ----------------------------------------------------------------------------
CREATE TABLE program_weeks (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id    uuid         NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  week_number   smallint     NOT NULL CHECK (week_number BETWEEN 1 AND 52),
  notes         text,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  UNIQUE (program_id, week_number)
);

CREATE INDEX program_weeks_program_idx
  ON program_weeks (program_id, week_number)
  WHERE deleted_at IS NULL;

CREATE TRIGGER program_weeks_touch_updated_at
  BEFORE UPDATE ON program_weeks
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- ----------------------------------------------------------------------------
-- program_days — calendar-scheduled within a week
-- ----------------------------------------------------------------------------
-- day_of_week is nullable to allow a day to exist before the EP schedules it
-- on the calendar. When non-null, 0=Monday through 6=Sunday.
CREATE TABLE program_days (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  program_week_id   uuid         NOT NULL REFERENCES program_weeks(id) ON DELETE CASCADE,
  day_label         text         NOT NULL CHECK (length(trim(day_label)) BETWEEN 1 AND 30),
  sort_order        int          NOT NULL DEFAULT 0,
  day_of_week       smallint     CHECK (day_of_week IS NULL OR day_of_week BETWEEN 0 AND 6),
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);

CREATE INDEX program_days_week_idx
  ON program_days (program_week_id, sort_order)
  WHERE deleted_at IS NULL;

-- Calendar render: find days scheduled on a specific day-of-week
CREATE INDEX program_days_dow_idx
  ON program_days (program_week_id, day_of_week)
  WHERE day_of_week IS NOT NULL AND deleted_at IS NULL;

CREATE TRIGGER program_days_touch_updated_at
  BEFORE UPDATE ON program_days
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- ----------------------------------------------------------------------------
-- program_exercises — the prescription rows, with OCC
-- ----------------------------------------------------------------------------
CREATE TABLE program_exercises (
  id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  program_day_id       uuid         NOT NULL REFERENCES program_days(id) ON DELETE CASCADE,
  exercise_id          uuid         NOT NULL REFERENCES exercises(id)    ON DELETE RESTRICT,
  sort_order           int          NOT NULL DEFAULT 0,
  section_title        text         CHECK (
                         section_title IS NULL
                         OR length(trim(section_title)) BETWEEN 1 AND 60
                       ),
  superset_group_id    uuid,
  -- Prescription — NULL falls back to exercise defaults at read time
  sets                 smallint     CHECK (sets IS NULL OR sets BETWEEN 1 AND 50),
  reps                 text         CHECK (reps IS NULL OR length(trim(reps)) BETWEEN 1 AND 40),
  rest_seconds         int          CHECK (rest_seconds IS NULL OR rest_seconds BETWEEN 0 AND 3600),
  rpe                  smallint     CHECK (rpe IS NULL OR rpe BETWEEN 1 AND 10),
  optional_metric      text,
  optional_value       text,
  tempo                text         CHECK (tempo IS NULL OR tempo ~ '^[0-9x]{4}$'),
  instructions         text,        -- client-visible during session; see RLS
  version              int          NOT NULL DEFAULT 1,
  created_at           timestamptz  NOT NULL DEFAULT now(),
  updated_at           timestamptz  NOT NULL DEFAULT now(),
  deleted_at           timestamptz
);

CREATE INDEX program_exercises_day_idx
  ON program_exercises (program_day_id, sort_order)
  WHERE deleted_at IS NULL;

CREATE INDEX program_exercises_exercise_idx
  ON program_exercises (exercise_id)
  WHERE deleted_at IS NULL;

CREATE INDEX program_exercises_superset_idx
  ON program_exercises (program_day_id, superset_group_id)
  WHERE superset_group_id IS NOT NULL AND deleted_at IS NULL;

-- OCC + updated_at
CREATE TRIGGER program_exercises_bump_version
  BEFORE UPDATE ON program_exercises
  FOR EACH ROW EXECUTE FUNCTION public.bump_version_and_touch();


-- ----------------------------------------------------------------------------
-- Cross-org walker: program_exercises.exercise_id must match the containing
-- program's organization_id.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_program_exercise_same_org()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  program_org_id   uuid;
  exercise_org_id  uuid;
BEGIN
  SELECT p.organization_id
    INTO program_org_id
    FROM program_days pd
    JOIN program_weeks pw ON pw.id = pd.program_week_id
    JOIN programs p ON p.id = pw.program_id
   WHERE pd.id = NEW.program_day_id;

  SELECT organization_id
    INTO exercise_org_id
    FROM exercises
   WHERE id = NEW.exercise_id;

  IF program_org_id IS NULL OR exercise_org_id IS NULL THEN
    RAISE EXCEPTION 'program_exercises parent lookup failed (day %, exercise %)',
      NEW.program_day_id, NEW.exercise_id;
  END IF;

  IF program_org_id IS DISTINCT FROM exercise_org_id THEN
    RAISE EXCEPTION 'Cross-org: program in org % cannot reference exercise in org %',
      program_org_id, exercise_org_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_program_exercise_same_org() IS
  'BEFORE INSERT/UPDATE trigger: walks program_exercises → program_days → program_weeks → programs to resolve org, and compares with exercises.organization_id.';

CREATE TRIGGER program_exercises_enforce_org
  BEFORE INSERT OR UPDATE ON program_exercises
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_program_exercise_same_org();


COMMENT ON TABLE program_exercises IS
  'Client-specific exercise prescriptions. OCC via version column. Instructions are client-visible during session logging.';
COMMENT ON COLUMN program_exercises.instructions IS
  'Coaching cues visible to the client during session logging. Overrides exercises.instructions when present.';
