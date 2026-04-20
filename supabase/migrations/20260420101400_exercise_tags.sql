-- ============================================================================
-- 20260420101400_exercise_tags
-- ============================================================================
-- Why: Secondary filter on the exercise library — tenant-configurable tags
-- (DGR, PRI, Plyometrics, Rehab, Prehab per the brief defaults). Linked to
-- exercises via exercise_tag_assignments (many-to-many, next migration).
-- ============================================================================

CREATE TABLE exercise_tags (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid         NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name             text         NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  color            text         CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order       int          NOT NULL DEFAULT 0,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

CREATE UNIQUE INDEX exercise_tags_org_name_unique
  ON exercise_tags (organization_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE INDEX exercise_tags_org_idx
  ON exercise_tags (organization_id)
  WHERE deleted_at IS NULL;

CREATE TRIGGER exercise_tags_touch_updated_at
  BEFORE UPDATE ON exercise_tags
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE exercise_tags IS
  'Tenant-configurable tags applied to exercises. Default set (DGR, PRI, Rehab, Prehab) seeded on signup.';
COMMENT ON COLUMN exercise_tags.color IS
  'Optional hex color for UI chip rendering. Validated to 6-digit hex.';
