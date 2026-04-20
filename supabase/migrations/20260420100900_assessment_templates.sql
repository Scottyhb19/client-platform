-- ============================================================================
-- 20260420100900_assessment_templates
-- ============================================================================
-- Why: Tenant-configurable assessment form definitions. `schema_json`
-- describes the questions; `assessments.responses_json` holds responses
-- following that shape. JSON chosen over EAV because templates vary per
-- organization and are read/written whole, not queried per-question.
--
-- Staff-only. No client-facing UI for assessments in v1.
-- ============================================================================

CREATE TABLE assessment_templates (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid         NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name             text         NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  description      text,
  schema_json      jsonb        NOT NULL DEFAULT '{}'::jsonb,
  is_active        boolean      NOT NULL DEFAULT true,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  CONSTRAINT assessment_templates_schema_is_object CHECK (
    jsonb_typeof(schema_json) = 'object'
  )
);

CREATE UNIQUE INDEX assessment_templates_org_name_unique
  ON assessment_templates (organization_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE INDEX assessment_templates_org_idx
  ON assessment_templates (organization_id)
  WHERE deleted_at IS NULL;

CREATE TRIGGER assessment_templates_touch_updated_at
  BEFORE UPDATE ON assessment_templates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE assessment_templates IS
  'Tenant-configurable assessment form definitions. schema_json describes questions; responses in assessments.responses_json follow this shape.';
COMMENT ON COLUMN assessment_templates.schema_json IS
  'Form schema as jsonb object. Validated at application layer against the templates UI.';
