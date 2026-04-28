-- ============================================================================
-- 20260428100000_client_files
-- ============================================================================
-- Why: Per-client document store. The Files tab on the client profile holds
-- referrals, GPCCMP / Medicare plans, radiology reports, Worker's Comp / CTP
-- paperwork, specialist letters, and anything else the EP needs to keep
-- alongside the clinical record. Mirrors the storage_bucket / storage_path
-- pattern from the reports table — the binary lives in Supabase Storage,
-- the row holds metadata + the path.
--
-- Categories are an enum, not a lookup, because the set is fixed by the EP
-- workflow (the brief). If we need to add one (e.g. "consent_form"), it's a
-- one-line ALTER TYPE migration. Lookup table would be overkill.
--
-- Hard delete (no soft delete on rows): the audit_log trigger snapshots the
-- row on DELETE so the compliance trail survives. Avoids the documented
-- PostgREST soft-delete RLS RETURNING gotcha entirely.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- file_category enum
-- ----------------------------------------------------------------------------
CREATE TYPE file_category AS ENUM (
  'gpccmp',
  'radiology',
  'workers_comp',
  'specialist_letter',
  'referral',
  'other'
);

COMMENT ON TYPE file_category IS
  'Document classification surfaced as filter chips on the Files tab. gpccmp = GP Chronic Care Management Plan / Medicare. workers_comp = Worker''s Compensation or CTP. other = anything that doesn''t fit the named buckets (consent forms, demo videos, etc.).';


-- ----------------------------------------------------------------------------
-- client_files
-- ----------------------------------------------------------------------------
CREATE TABLE client_files (
  id                    uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid           NOT NULL REFERENCES organizations(id)            ON DELETE RESTRICT,
  client_id             uuid           NOT NULL REFERENCES clients(id)                  ON DELETE RESTRICT,
  uploaded_by_user_id   uuid           NOT NULL REFERENCES user_profiles(user_id)       ON DELETE RESTRICT,

  category              file_category  NOT NULL DEFAULT 'other',
  -- Display name shown in the UI. Editable; defaults to original_filename
  -- minus extension at upload time.
  name                  text           NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  original_filename     text           NOT NULL CHECK (length(trim(original_filename)) BETWEEN 1 AND 255),
  mime_type             text,
  size_bytes            bigint         NOT NULL CHECK (size_bytes >= 0),

  storage_bucket        text           NOT NULL DEFAULT 'client-files',
  storage_path          text           NOT NULL,

  notes                 text,

  created_at            timestamptz    NOT NULL DEFAULT now(),
  updated_at            timestamptz    NOT NULL DEFAULT now()
);

-- Files-tab listing for one client, newest first.
CREATE INDEX client_files_client_created_idx
  ON client_files (client_id, created_at DESC);

-- Filter chips: client + category lookup.
CREATE INDEX client_files_client_category_idx
  ON client_files (client_id, category);

-- Org-wide queries (e.g. retention purge).
CREATE INDEX client_files_org_idx
  ON client_files (organization_id);

CREATE TRIGGER client_files_touch_updated_at
  BEFORE UPDATE ON client_files
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Cross-org guard: client_id must belong to the same org as this row.
CREATE TRIGGER client_files_enforce_client_org
  BEFORE INSERT OR UPDATE ON client_files
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_same_org_fk('clients', 'client_id', 'organization_id');

-- Audit trail: snapshot every INSERT / UPDATE / DELETE (the trigger function
-- already exists — see 20260420102300_audit_log_and_triggers).
CREATE TRIGGER audit_client_files
  AFTER INSERT OR UPDATE OR DELETE ON client_files
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

COMMENT ON TABLE client_files IS
  'Per-client document store (referrals, GPCCMP plans, imaging, etc.). Binary lives in Supabase Storage at storage_bucket/storage_path; this row holds metadata + classification.';
COMMENT ON COLUMN client_files.storage_path IS
  'Path within the bucket. Convention: {organization_id}/{client_id}/{file_id}.{ext}. The org_id prefix is what storage RLS policies match against.';


-- ============================================================================
-- RLS — client_files (Pattern A: staff-org-scoped CRUD, no client access)
-- Hard DELETE allowed because audit_log captures pre-delete state.
-- ============================================================================
ALTER TABLE client_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_files FORCE ROW LEVEL SECURITY;

CREATE POLICY "staff select client_files in own org"
  ON client_files FOR SELECT TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner', 'staff')
  );

CREATE POLICY "staff insert client_files in own org"
  ON client_files FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner', 'staff')
  );

CREATE POLICY "staff update client_files in own org"
  ON client_files FOR UPDATE TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner', 'staff')
  )
  WITH CHECK (organization_id = public.user_organization_id());

CREATE POLICY "staff delete client_files in own org"
  ON client_files FOR DELETE TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner', 'staff')
  );


-- ============================================================================
-- Storage bucket: client-files (private, 25 MB cap, all MIME types)
-- ============================================================================
-- The bucket is created here so the migration is self-contained. ON CONFLICT
-- DO NOTHING makes the migration idempotent — re-running it (or running it
-- on a project where the bucket was already created via the dashboard) is
-- safe.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'client-files',
  'client-files',
  false,
  26214400,  -- 25 MB
  null       -- allow any MIME; server-action validates instead
)
ON CONFLICT (id) DO NOTHING;


-- ============================================================================
-- Storage RLS — client-files
-- ============================================================================
-- Path convention is {organization_id}/{client_id}/{file_id}.{ext}, so
-- storage.foldername(name)[1] returns the organization_id portion. We match
-- that against the caller's JWT-claim org via public.user_organization_id().
--
-- Storage policies sit on storage.objects, not the bucket. Each operation
-- (SELECT/INSERT/UPDATE/DELETE) needs its own policy.

CREATE POLICY "staff read client-files in own org"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'client-files'
    AND (storage.foldername(name))[1] = public.user_organization_id()::text
    AND public.user_role() IN ('owner', 'staff')
  );

CREATE POLICY "staff upload client-files in own org"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'client-files'
    AND (storage.foldername(name))[1] = public.user_organization_id()::text
    AND public.user_role() IN ('owner', 'staff')
  );

CREATE POLICY "staff update client-files in own org"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'client-files'
    AND (storage.foldername(name))[1] = public.user_organization_id()::text
    AND public.user_role() IN ('owner', 'staff')
  );

CREATE POLICY "staff delete client-files in own org"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'client-files'
    AND (storage.foldername(name))[1] = public.user_organization_id()::text
    AND public.user_role() IN ('owner', 'staff')
  );
