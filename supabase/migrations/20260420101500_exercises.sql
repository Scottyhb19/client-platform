-- ============================================================================
-- 20260420101500_exercises
-- ============================================================================
-- Why: First-class entity in the exercise library. Carries default
-- prescription so adding to a program auto-populates sets/reps/rest/RPE/etc.
-- YouTube video URL per exercise (EP's own coaching videos). Usage count
-- surfaces the most-prescribed exercises in the library UI.
--
-- Cross-org: movement_pattern_id must belong to same org as the exercise.
-- default_metric is a TEXT code matching exercise_metric_units.code — not
-- an FK so a metric rename doesn't ripple into historical exercise records.
-- ============================================================================

CREATE TABLE exercises (
  id                    uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid         NOT NULL REFERENCES organizations(id)     ON DELETE RESTRICT,
  movement_pattern_id   uuid         REFERENCES movement_patterns(id)          ON DELETE RESTRICT,
  created_by_user_id    uuid         REFERENCES user_profiles(user_id)         ON DELETE SET NULL,
  name                  text         NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  description           text,
  video_url             text         CHECK (
                          video_url IS NULL
                          OR video_url ~ '^https?://'
                        ),
  instructions          text,   -- coaching cues, common errors, contraindications
  -- Default prescription (nullable — library entry may omit defaults)
  default_sets          smallint     CHECK (default_sets IS NULL OR default_sets BETWEEN 1 AND 50),
  default_reps          text         CHECK (
                          default_reps IS NULL
                          OR length(trim(default_reps)) BETWEEN 1 AND 40
                        ),
  default_rest_seconds  int          CHECK (
                          default_rest_seconds IS NULL
                          OR default_rest_seconds BETWEEN 0 AND 3600
                        ),
  default_rpe           smallint     CHECK (default_rpe IS NULL OR default_rpe BETWEEN 1 AND 10),
  default_metric        text,         -- e.g. 'kg', 'time_minsec' — matches exercise_metric_units.code
  default_metric_value  text,         -- e.g. '40', '3:00'
  -- Usage tracking
  usage_count           int          NOT NULL DEFAULT 0,
  created_at            timestamptz  NOT NULL DEFAULT now(),
  updated_at            timestamptz  NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);

-- Library list by org
CREATE INDEX exercises_org_active_idx
  ON exercises (organization_id)
  WHERE deleted_at IS NULL;

-- Alphabetical library + search prefix
CREATE INDEX exercises_org_name_idx
  ON exercises (organization_id, lower(name))
  WHERE deleted_at IS NULL;

-- Filter by pattern
CREATE INDEX exercises_movement_pattern_idx
  ON exercises (movement_pattern_id)
  WHERE deleted_at IS NULL;

-- Fuzzy search (session builder library tab + library screen)
CREATE INDEX exercises_name_trgm_idx
  ON exercises USING gin (lower(name) gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- Usage-sorted "most prescribed" lists
CREATE INDEX exercises_usage_idx
  ON exercises (organization_id, usage_count DESC)
  WHERE deleted_at IS NULL;

CREATE TRIGGER exercises_touch_updated_at
  BEFORE UPDATE ON exercises
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Cross-org: movement pattern belongs to same org
CREATE TRIGGER exercises_enforce_pattern_org
  BEFORE INSERT OR UPDATE ON exercises
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_same_org_fk('movement_patterns', 'movement_pattern_id', 'organization_id');

COMMENT ON TABLE exercises IS
  'Exercise library entries. Default prescription auto-populates when added to a template or program.';
COMMENT ON COLUMN exercises.default_metric IS
  'Code matching exercise_metric_units.code (kg, lb, time_minsec, etc.). Stored as text for rename stability.';
COMMENT ON COLUMN exercises.usage_count IS
  'How many times this exercise has been prescribed. Incremented by application when adding to program_exercises/template_exercises.';
