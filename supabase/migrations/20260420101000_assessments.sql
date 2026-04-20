-- ============================================================================
-- 20260420101000_assessments
-- ============================================================================
-- Why: A completed assessment for a client, keyed to a template. Responses
-- stored as jsonb following template.schema_json (validated at application
-- layer, not at the DB — the shape is by design variable).
--
-- OCC: `version` column + bump trigger. Assessment editing is common during
-- intake; concurrent edits by multiple staff must not silently clobber.
--
-- Cross-org enforcement: both client_id and template_id must belong to the
-- same organization as this assessment (defense-in-depth if service role
-- code bypasses RLS on read).
-- ============================================================================

CREATE TABLE assessments (
  id                uuid               PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid               NOT NULL REFERENCES organizations(id)         ON DELETE RESTRICT,
  client_id         uuid               NOT NULL REFERENCES clients(id)               ON DELETE RESTRICT,
  template_id       uuid               NOT NULL REFERENCES assessment_templates(id)  ON DELETE RESTRICT,
  author_user_id    uuid               NOT NULL REFERENCES user_profiles(user_id)    ON DELETE RESTRICT,
  status            assessment_status  NOT NULL DEFAULT 'draft',
  responses_json    jsonb              NOT NULL DEFAULT '{}'::jsonb,
  completed_at      timestamptz,
  version           int                NOT NULL DEFAULT 1,
  created_at        timestamptz        NOT NULL DEFAULT now(),
  updated_at        timestamptz        NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CONSTRAINT assessments_responses_is_object CHECK (
    jsonb_typeof(responses_json) = 'object'
  ),
  CONSTRAINT assessments_completed_has_timestamp CHECK (
    (status = 'completed' AND completed_at IS NOT NULL)
    OR status <> 'completed'
  )
);

-- Client profile assessments tab, time-descending
CREATE INDEX assessments_client_time_idx
  ON assessments (client_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- "How many assessments use this template" for template-delete checks
CREATE INDEX assessments_template_idx
  ON assessments (template_id)
  WHERE deleted_at IS NULL;

CREATE INDEX assessments_org_idx
  ON assessments (organization_id)
  WHERE deleted_at IS NULL;

-- Status state machine
CREATE INDEX assessments_status_idx
  ON assessments (organization_id, status)
  WHERE deleted_at IS NULL;

-- OCC + updated_at
CREATE TRIGGER assessments_bump_version
  BEFORE UPDATE ON assessments
  FOR EACH ROW EXECUTE FUNCTION public.bump_version_and_touch();

-- Cross-org: client belongs to same org
CREATE TRIGGER assessments_enforce_client_org
  BEFORE INSERT OR UPDATE ON assessments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_same_org_fk('clients', 'client_id', 'organization_id');

-- Cross-org: template belongs to same org
CREATE TRIGGER assessments_enforce_template_org
  BEFORE INSERT OR UPDATE ON assessments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_same_org_fk('assessment_templates', 'template_id', 'organization_id');

COMMENT ON TABLE assessments IS
  'Completed assessment for a client. responses_json follows the template.schema_json shape (validated at application layer).';
