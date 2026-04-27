-- ============================================================================
-- 20260427100000_note_templates
-- ============================================================================
-- Why: Replace the hard-coded SOAP shape on clinical_notes with a per-org
-- template system. EPs can define their own templates with arbitrary
-- field labels and types (short_text / long_text / number).
--
-- Design choice: notes self-contain their answers in `content_json` as a
-- denormalized array of {label, value, type}. The template_id is just a
-- breadcrumb pointing back at the template that was used at write time.
-- This way, editing or deleting a template never breaks historical notes —
-- old notes keep rendering with the labels they were saved with.
--
-- Existing SOAP columns (subjective/objective/assessment/plan/body_rich)
-- are kept for backward-compatibility with notes already on disk. The
-- content_present CHECK is widened to accept either path.
--
-- Templates and their fields are tenant-owned. Template deletion is hard
-- DELETE (the project's standing convention to avoid PostgREST's
-- post-soft-delete RLS trip — see /docs/schema.md and project memory).
-- Field rows cascade with their parent template.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Field type enum
-- ----------------------------------------------------------------------------
CREATE TYPE note_template_field_type AS ENUM (
  'short_text',
  'long_text',
  'number'
);

COMMENT ON TYPE note_template_field_type IS
  'Field input shape for a note template. short_text = single-line input, long_text = multi-line textarea, number = numeric input.';


-- ----------------------------------------------------------------------------
-- note_templates
-- ----------------------------------------------------------------------------
CREATE TABLE note_templates (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid         NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name             text         NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  sort_order       int          NOT NULL DEFAULT 0,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

-- Per-org listing
CREATE INDEX note_templates_org_idx
  ON note_templates (organization_id, sort_order)
  WHERE deleted_at IS NULL;

-- Name uniqueness within an org (case-insensitive)
CREATE UNIQUE INDEX note_templates_org_name_unique
  ON note_templates (organization_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE TRIGGER note_templates_touch_updated_at
  BEFORE UPDATE ON note_templates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE note_templates IS
  'Per-organization clinical note templates. Each template defines the field shape for new clinical_notes saved against it.';


-- ----------------------------------------------------------------------------
-- note_template_fields
-- ----------------------------------------------------------------------------
CREATE TABLE note_template_fields (
  id           uuid                       PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id  uuid                       NOT NULL REFERENCES note_templates(id) ON DELETE CASCADE,
  label        text                       NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 80),
  field_type   note_template_field_type   NOT NULL DEFAULT 'long_text',
  sort_order   int                        NOT NULL DEFAULT 0,
  created_at   timestamptz                NOT NULL DEFAULT now(),
  updated_at   timestamptz                NOT NULL DEFAULT now()
);

-- Render fields in declared order
CREATE INDEX note_template_fields_template_idx
  ON note_template_fields (template_id, sort_order);

CREATE TRIGGER note_template_fields_touch_updated_at
  BEFORE UPDATE ON note_template_fields
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE note_template_fields IS
  'Ordered fields belonging to a note_templates row. Hard-deleted with parent (cascade). No soft delete — fields are owned by the template.';


-- ----------------------------------------------------------------------------
-- clinical_notes additions
-- ----------------------------------------------------------------------------
ALTER TABLE clinical_notes
  ADD COLUMN template_id     uuid  REFERENCES note_templates(id) ON DELETE SET NULL,
  ADD COLUMN appointment_id  uuid  REFERENCES appointments(id)   ON DELETE SET NULL,
  ADD COLUMN content_json    jsonb;

COMMENT ON COLUMN clinical_notes.template_id IS
  'Optional pointer to the template used at write time. SET NULL on template delete — content_json carries the labels needed to render the note.';
COMMENT ON COLUMN clinical_notes.appointment_id IS
  'Optional link to the appointment this note was written for. Defaults to the next future appointment in the UI; user can change.';
COMMENT ON COLUMN clinical_notes.content_json IS
  'Self-contained denormalized field answers: {"fields":[{"label":"Subjective","value":"…","type":"long_text"}, …]}. Independent of template_id so historical notes remain readable after template edits/deletes.';

-- Widen the content-present check: a note is now valid if EITHER the legacy
-- SOAP fields are filled OR content_json is present.
ALTER TABLE clinical_notes DROP CONSTRAINT clinical_notes_content_present;
ALTER TABLE clinical_notes ADD CONSTRAINT clinical_notes_content_present CHECK (
  COALESCE(subjective, objective, assessment, plan, body_rich) IS NOT NULL
  OR content_json IS NOT NULL
);

-- Cross-org guards on the new FKs
CREATE TRIGGER clinical_notes_enforce_template_org
  BEFORE INSERT OR UPDATE ON clinical_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_same_org_fk('note_templates', 'template_id', 'organization_id');

CREATE TRIGGER clinical_notes_enforce_appointment_org
  BEFORE INSERT OR UPDATE ON clinical_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_same_org_fk('appointments', 'appointment_id', 'organization_id');

-- "Notes for this appointment" lookup
CREATE INDEX clinical_notes_appointment_idx
  ON clinical_notes (appointment_id)
  WHERE deleted_at IS NULL AND appointment_id IS NOT NULL;


-- ============================================================================
-- RLS — note_templates (Pattern A: staff-org-scoped CRUD, hard delete allowed)
-- ============================================================================
ALTER TABLE note_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff select note_templates in own org"
  ON note_templates FOR SELECT TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND deleted_at IS NULL
    AND public.user_role() IN ('owner', 'staff')
  );

CREATE POLICY "staff insert note_templates in own org"
  ON note_templates FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner', 'staff')
  );

CREATE POLICY "staff update note_templates in own org"
  ON note_templates FOR UPDATE TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner', 'staff')
  )
  WITH CHECK (organization_id = public.user_organization_id());

CREATE POLICY "staff delete note_templates in own org"
  ON note_templates FOR DELETE TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner', 'staff')
  );


-- ============================================================================
-- RLS — note_template_fields (Pattern C: via parent template)
-- ============================================================================
ALTER TABLE note_template_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff select note_template_fields via parent"
  ON note_template_fields FOR SELECT TO authenticated
  USING (
    public.user_role() IN ('owner', 'staff')
    AND EXISTS (
      SELECT 1 FROM note_templates nt
       WHERE nt.id = note_template_fields.template_id
         AND nt.organization_id = public.user_organization_id()
         AND nt.deleted_at IS NULL
    )
  );

CREATE POLICY "staff insert note_template_fields via parent"
  ON note_template_fields FOR INSERT TO authenticated
  WITH CHECK (
    public.user_role() IN ('owner', 'staff')
    AND EXISTS (
      SELECT 1 FROM note_templates nt
       WHERE nt.id = note_template_fields.template_id
         AND nt.organization_id = public.user_organization_id()
         AND nt.deleted_at IS NULL
    )
  );

CREATE POLICY "staff update note_template_fields via parent"
  ON note_template_fields FOR UPDATE TO authenticated
  USING (
    public.user_role() IN ('owner', 'staff')
    AND EXISTS (
      SELECT 1 FROM note_templates nt
       WHERE nt.id = note_template_fields.template_id
         AND nt.organization_id = public.user_organization_id()
         AND nt.deleted_at IS NULL
    )
  );

CREATE POLICY "staff delete note_template_fields via parent"
  ON note_template_fields FOR DELETE TO authenticated
  USING (
    public.user_role() IN ('owner', 'staff')
    AND EXISTS (
      SELECT 1 FROM note_templates nt
       WHERE nt.id = note_template_fields.template_id
         AND nt.organization_id = public.user_organization_id()
    )
  );
