-- ============================================================================
-- 20260420101100_movement_patterns
-- ============================================================================
-- Why: Primary filter on the exercise library (Push, Pull, Squat, Hinge,
-- Carry, Core, Isometric). Brief §6.6 notes practitioners will customize
-- these over time. Lookup table instead of enum because list varies per org.
-- Seeded with the default set on signup via the bootstrap function.
-- ============================================================================

CREATE TABLE movement_patterns (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid         NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name             text         NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  sort_order       int          NOT NULL DEFAULT 0,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

CREATE UNIQUE INDEX movement_patterns_org_name_unique
  ON movement_patterns (organization_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE INDEX movement_patterns_org_idx
  ON movement_patterns (organization_id)
  WHERE deleted_at IS NULL;

CREATE TRIGGER movement_patterns_touch_updated_at
  BEFORE UPDATE ON movement_patterns
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE movement_patterns IS
  'Tenant-configurable movement-pattern taxonomy. Seeded per-organization with Push/Pull/Squat/Hinge/Carry/Core/Isometric on signup.';
