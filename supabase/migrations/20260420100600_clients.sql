-- ============================================================================
-- 20260420100600_clients
-- ============================================================================
-- Why: The clinical record for a person in care. May have a linked portal
-- login via user_id (nullable — EP creates client row before the invite is
-- accepted). Soft-delete only. Retention clock starts at last_activity_at
-- computed at soft-delete time (see /docs/schema.md §10.3).
--
-- OCC via version column: two staff editing the same client concurrently
-- cannot silently clobber. See /docs/schema.md §12.
-- ============================================================================

CREATE TABLE clients (
  id                       uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid         NOT NULL REFERENCES organizations(id)       ON DELETE RESTRICT,
  user_id                  uuid                  REFERENCES user_profiles(user_id)  ON DELETE SET NULL,
  first_name               text         NOT NULL CHECK (length(trim(first_name)) BETWEEN 1 AND 100),
  last_name                text         NOT NULL CHECK (length(trim(last_name))  BETWEEN 1 AND 100),
  email                    text         NOT NULL CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone                    text,
  dob                      date,
  gender                   text,
  address                  text,
  emergency_contact_name   text,
  emergency_contact_phone  text,
  referral_source          text,
  referred_by              text,
  category_id              uuid         REFERENCES client_categories(id) ON DELETE SET NULL,
  goals                    text,
  -- Retention clock anchor, computed at soft-delete time
  last_activity_at         timestamptz,
  invited_at               timestamptz,
  onboarded_at             timestamptz,
  archived_at              timestamptz,
  -- OCC
  version                  int          NOT NULL DEFAULT 1,
  created_at               timestamptz  NOT NULL DEFAULT now(),
  updated_at               timestamptz  NOT NULL DEFAULT now(),
  deleted_at               timestamptz,
  CONSTRAINT clients_dob_sane CHECK (dob IS NULL OR dob BETWEEN '1900-01-01' AND CURRENT_DATE)
);

-- Uniqueness: one live row per (org, email). Archival frees the address.
CREATE UNIQUE INDEX clients_org_email_unique
  ON clients (organization_id, lower(email))
  WHERE deleted_at IS NULL;

-- Core list view
CREATE INDEX clients_org_active_idx
  ON clients (organization_id) WHERE deleted_at IS NULL;

-- Reverse lookup when a client logs in
CREATE INDEX clients_user_id_idx
  ON clients (user_id) WHERE user_id IS NOT NULL;

-- Category filter chips
CREATE INDEX clients_category_idx
  ON clients (category_id) WHERE deleted_at IS NULL AND category_id IS NOT NULL;

-- Dashboard sticky sidebar fuzzy search
CREATE INDEX clients_name_trgm_idx
  ON clients USING gin ((lower(first_name) || ' ' || lower(last_name)) gin_trgm_ops)
  WHERE deleted_at IS NULL;
CREATE INDEX clients_email_trgm_idx
  ON clients USING gin (lower(email) gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- Retention purge scan
CREATE INDEX clients_retention_idx
  ON clients (deleted_at, last_activity_at)
  WHERE deleted_at IS NOT NULL;

-- OCC + updated_at
CREATE TRIGGER clients_bump_version
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION public.bump_version_and_touch();

-- Cross-org: category_id must belong to the same org as the client.
CREATE TRIGGER clients_enforce_category_org
  BEFORE INSERT OR UPDATE ON clients
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_same_org_fk('client_categories', 'category_id', 'organization_id');

COMMENT ON TABLE clients IS
  'Clinical record for a person in care. user_id links to a portal login when the client accepts their invite. Soft-deleted only; retained per Privacy Act retention.';
COMMENT ON COLUMN clients.last_activity_at IS
  'Most recent clinical activity timestamp; computed at soft-delete time. Retention clock starts here. See /docs/schema.md §10.3.';
COMMENT ON COLUMN clients.version IS
  'Optimistic concurrency control; see /docs/schema.md §12.';
