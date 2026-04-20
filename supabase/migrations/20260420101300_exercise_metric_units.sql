-- ============================================================================
-- 20260420101300_exercise_metric_units
-- ============================================================================
-- Why: Measurement-unit taxonomy for the "Optional" column of an exercise
-- prescription (kg, lb, time min:sec, distance m/km/mi, percentage, rpe,
-- tempo, bodyweight). Brief §6.5.3 shows the v1 default list.
--
-- Usage in exercises.default_metric and program_exercises.optional_metric
-- is as text (the `code` column), not FK. Enables tenant-configurable lists
-- while keeping prescription rows stable when a unit is renamed.
-- ============================================================================

CREATE TABLE exercise_metric_units (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid         NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code             text         NOT NULL CHECK (code ~ '^[a-z0-9_]{1,30}$'),
  display_label    text         NOT NULL CHECK (length(trim(display_label)) BETWEEN 1 AND 60),
  category         text         NOT NULL CHECK (category IN (
                     'weight', 'time', 'distance', 'ratio', 'rpe', 'tempo', 'bodyweight'
                   )),
  sort_order       int          NOT NULL DEFAULT 0,
  is_active        boolean      NOT NULL DEFAULT true,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

CREATE UNIQUE INDEX exercise_metric_units_org_code_unique
  ON exercise_metric_units (organization_id, code)
  WHERE deleted_at IS NULL;

CREATE INDEX exercise_metric_units_org_idx
  ON exercise_metric_units (organization_id)
  WHERE deleted_at IS NULL AND is_active = true;

CREATE TRIGGER exercise_metric_units_touch_updated_at
  BEFORE UPDATE ON exercise_metric_units
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE exercise_metric_units IS
  'Tenant-configurable measurement units for exercise prescription Optional field. Defaults seeded on signup.';
COMMENT ON COLUMN exercise_metric_units.code IS
  'Stable machine code (kg, lb, time_minsec, ...). Referenced by exercises.default_metric as text.';
