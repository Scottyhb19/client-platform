-- ============================================================================
-- 20260421100000_contacts
-- ============================================================================
-- Why: Referral network for the practice — GPs, surgeons, sports doctors,
-- physios, chiropractors, exercise physiologists. Tenant-scoped. No client
-- relationship enforced in the schema today; `clients.referred_by` stays as
-- free-text for v1. Linking the two is a Phase 4 data-migration task.
-- ============================================================================

CREATE TABLE contacts (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid         NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,

  name             text         NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  practice         text,
  phone            text,
  email            text,
  contact_group    text         NOT NULL CHECK (contact_group IN (
                                  'gps', 'surgeons', 'sports-doc',
                                  'physios', 'chiros', 'eps', 'other'
                                )),
  tags             text[]       NOT NULL DEFAULT '{}',
  notes            text,

  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  version          integer      NOT NULL DEFAULT 1
);

CREATE INDEX contacts_org_idx
  ON contacts (organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX contacts_org_group_idx
  ON contacts (organization_id, contact_group)
  WHERE deleted_at IS NULL;

CREATE TRIGGER contacts_touch_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- RLS: Pattern A (staff-org-scoped CRUD, no client access)
-- ----------------------------------------------------------------------------
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts FORCE ROW LEVEL SECURITY;

CREATE POLICY "staff select contacts in own org"
  ON contacts FOR SELECT TO authenticated
  USING (organization_id = public.user_organization_id()
         AND deleted_at IS NULL
         AND public.user_role() IN ('owner','staff'));

CREATE POLICY "staff insert contacts in own org"
  ON contacts FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.user_organization_id()
              AND public.user_role() IN ('owner','staff'));

CREATE POLICY "staff update contacts in own org"
  ON contacts FOR UPDATE TO authenticated
  USING (organization_id = public.user_organization_id()
         AND public.user_role() IN ('owner','staff'))
  WITH CHECK (organization_id = public.user_organization_id());

CREATE POLICY "deny delete contacts"
  ON contacts FOR DELETE TO authenticated USING (false);

COMMENT ON TABLE contacts IS
  'Referral network: medical professionals referring into or co-treating with the practice. Tenant-scoped, staff-only.';
COMMENT ON COLUMN contacts.contact_group IS
  'Discipline: gps / surgeons / sports-doc / physios / chiros / eps / other.';
COMMENT ON COLUMN contacts.tags IS
  'Free-text labels like "Knee", "NDIS", "Primary referrer". Used for filtering.';
