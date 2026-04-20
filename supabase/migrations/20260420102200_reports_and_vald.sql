-- ============================================================================
-- 20260420102200_reports_and_vald
-- ============================================================================
-- Why: Phase 3 scaffolding. VALD CSV/XML payloads are staged in
-- vald_raw_uploads, then parsed into structured content that drives
-- reports. Rendered report HTML lives in Supabase Storage (not Postgres);
-- reports holds metadata + the storage_path reference.
--
-- vald_device_types is a lookup table (per /docs/schema.md §14.2) so new
-- devices can be added without a migration.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- vald_device_types (lookup)
-- ----------------------------------------------------------------------------
CREATE TABLE vald_device_types (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid         NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code             text         NOT NULL CHECK (code ~ '^[a-z0-9_]{1,30}$'),
  display_label    text         NOT NULL CHECK (length(trim(display_label)) BETWEEN 1 AND 60),
  is_active        boolean      NOT NULL DEFAULT true,
  sort_order       int          NOT NULL DEFAULT 0,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

CREATE UNIQUE INDEX vald_device_types_org_code_unique
  ON vald_device_types (organization_id, code)
  WHERE deleted_at IS NULL;

CREATE INDEX vald_device_types_org_idx
  ON vald_device_types (organization_id)
  WHERE deleted_at IS NULL AND is_active = true;

CREATE TRIGGER vald_device_types_touch_updated_at
  BEFORE UPDATE ON vald_device_types
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE vald_device_types IS
  'Tenant-configurable VALD device taxonomy. Defaults (forcedecks, nordbord, forceframe, dynamo) seeded on signup.';


-- ----------------------------------------------------------------------------
-- reports — metadata; rendered HTML lives in Supabase Storage
-- ----------------------------------------------------------------------------
CREATE TABLE reports (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid         NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  client_id         uuid         NOT NULL REFERENCES clients(id)       ON DELETE RESTRICT,
  report_type       text         NOT NULL CHECK (length(trim(report_type)) BETWEEN 1 AND 80),
  title             text         NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  test_date         date         NOT NULL,
  is_published      boolean      NOT NULL DEFAULT false,
  published_at      timestamptz,
  generated_by_user_id uuid      REFERENCES user_profiles(user_id) ON DELETE SET NULL,
  storage_bucket    text         NOT NULL DEFAULT 'reports',
  storage_path      text         NOT NULL,       -- path within bucket
  current_version   smallint     NOT NULL DEFAULT 1,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CONSTRAINT reports_published_fields CHECK (
    (is_published = true  AND published_at IS NOT NULL) OR
    (is_published = false AND published_at IS NULL)
  ),
  CONSTRAINT reports_test_date_sane CHECK (
    test_date BETWEEN '1900-01-01' AND CURRENT_DATE + INTERVAL '1 day'
  )
);

-- Client reports tab, sorted by test date
CREATE INDEX reports_client_test_date_idx
  ON reports (client_id, test_date DESC)
  WHERE deleted_at IS NULL;

-- Org-wide dashboard counts for published
CREATE INDEX reports_org_published_idx
  ON reports (organization_id, is_published)
  WHERE deleted_at IS NULL;

CREATE INDEX reports_org_idx
  ON reports (organization_id)
  WHERE deleted_at IS NULL;

CREATE TRIGGER reports_touch_updated_at
  BEFORE UPDATE ON reports
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER reports_enforce_client_org
  BEFORE INSERT OR UPDATE ON reports
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_same_org_fk('clients', 'client_id', 'organization_id');

COMMENT ON TABLE reports IS
  'Metadata for rendered performance reports. The rendered HTML lives in Supabase Storage at storage_bucket/storage_path.';


-- ----------------------------------------------------------------------------
-- report_versions — historical renderings as formats evolve
-- ----------------------------------------------------------------------------
CREATE TABLE report_versions (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id        uuid         NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  version_number   smallint     NOT NULL CHECK (version_number >= 1),
  storage_bucket   text         NOT NULL,
  storage_path     text         NOT NULL,
  generated_at     timestamptz  NOT NULL DEFAULT now(),
  generated_by_user_id uuid     REFERENCES user_profiles(user_id) ON DELETE SET NULL,
  format_notes     text,
  UNIQUE (report_id, version_number)
);

CREATE INDEX report_versions_report_idx
  ON report_versions (report_id, version_number DESC);

COMMENT ON TABLE report_versions IS
  'Historical renderings of a report. Immutable once written — if a report needs re-rendering, a new version is appended.';


-- ----------------------------------------------------------------------------
-- vald_raw_uploads — pre-parse staging
-- ----------------------------------------------------------------------------
CREATE TABLE vald_raw_uploads (
  id                      uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid         NOT NULL REFERENCES organizations(id)    ON DELETE RESTRICT,
  uploaded_by_user_id     uuid         NOT NULL REFERENCES user_profiles(user_id) ON DELETE RESTRICT,
  device_type_id          uuid         NOT NULL REFERENCES vald_device_types(id) ON DELETE RESTRICT,
  source_filename         text         NOT NULL,
  storage_bucket          text         NOT NULL DEFAULT 'vald-raw',
  storage_path            text         NOT NULL,
  file_size_bytes         bigint       CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
  payload                 jsonb,       -- parsed JSON; NULL until parser runs
  parsed_at               timestamptz,
  parse_error             text,
  associated_report_id    uuid         REFERENCES reports(id) ON DELETE SET NULL,
  uploaded_at             timestamptz  NOT NULL DEFAULT now(),
  deleted_at              timestamptz
);

-- Upload history
CREATE INDEX vald_raw_uploads_org_time_idx
  ON vald_raw_uploads (organization_id, uploaded_at DESC)
  WHERE deleted_at IS NULL;

-- Parser queue (pending uploads)
CREATE INDEX vald_raw_uploads_pending_idx
  ON vald_raw_uploads (uploaded_at)
  WHERE parsed_at IS NULL AND deleted_at IS NULL;

CREATE TRIGGER vald_raw_uploads_enforce_device_org
  BEFORE INSERT OR UPDATE ON vald_raw_uploads
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_same_org_fk('vald_device_types', 'device_type_id', 'organization_id');

CREATE TRIGGER vald_raw_uploads_enforce_report_org
  BEFORE INSERT OR UPDATE ON vald_raw_uploads
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_same_org_fk('reports', 'associated_report_id', 'organization_id');

COMMENT ON TABLE vald_raw_uploads IS
  'Raw VALD CSV/XML payloads pre-parse. payload jsonb captures the parsed shape once parse_error is NULL and parsed_at is set.';
COMMENT ON COLUMN vald_raw_uploads.payload IS
  'Parsed JSON (NULL until parser runs). Shape varies by device type — justified jsonb.';
