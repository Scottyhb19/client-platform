-- ============================================================================
-- 20260420100500_client_categories
-- ============================================================================
-- Why: Tenant-configurable client taxonomy (Athlete, Rehab, Lifestyle, Golf,
-- Osteoporosis, Neurological, ...). Each organization gets the default set
-- seeded at signup via the bootstrap function (later migration). Lookup
-- table instead of enum because the list grows and varies per organization.
-- ============================================================================

CREATE TABLE client_categories (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid         NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name             text         NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  sort_order       int          NOT NULL DEFAULT 0,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

-- Case-insensitive uniqueness within an organization (only among live rows).
CREATE UNIQUE INDEX client_categories_org_name_unique
  ON client_categories (organization_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE INDEX client_categories_org_idx
  ON client_categories (organization_id)
  WHERE deleted_at IS NULL;

CREATE TRIGGER client_categories_touch_updated_at
  BEFORE UPDATE ON client_categories
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE client_categories IS
  'Tenant-configurable client category taxonomy. Defaults seeded per-organization on signup.';
