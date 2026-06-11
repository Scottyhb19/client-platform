-- ============================================================================
-- 20260611120100_cn3_note_template_types
-- ============================================================================
-- CN-3 (docs/polish/client-profile-clinical-notes.md): the note-template
-- system is declared the canonical "standardised template" mechanism per
-- master brief §9.1 ("standardised initial assessment template").
--
-- Templates now carry the note_type they stamp onto clinical_notes at
-- write time: an "Initial assessment" template produces
-- note_type = 'initial_assessment' rows, ordinary templates keep
-- producing 'progress_note'. This replaces the hardcoded
-- note_type: 'progress_note' in createClinicalNoteAction and retires the
-- need for a parallel assessment model — the dormant assessment_templates
-- / assessments tables stay untouched and are documented as dormant in
-- docs/schema.md (CN-8).
--
-- Flag types are deliberately excluded: injury_flag / contraindication
-- rows carry structured flag columns (body region, severity) that the
-- template form does not collect, and the clinical_notes_injury_flag_fields
-- CHECK would reject a flag note without them. Flags are created via the
-- dedicated flag control (CN-1), never via templates.
-- ============================================================================

ALTER TABLE note_templates
  ADD COLUMN note_type note_type NOT NULL DEFAULT 'progress_note';

ALTER TABLE note_templates
  ADD CONSTRAINT note_templates_type_not_flag
  CHECK (note_type NOT IN ('injury_flag', 'contraindication'));

COMMENT ON COLUMN note_templates.note_type IS
  'The note_type stamped onto clinical_notes rows written from this template. Flag types are excluded by CHECK — flags are created via the dedicated flag control, not templates.';

-- ----------------------------------------------------------------------------
-- One-time seed: an "Initial assessment" template for existing orgs.
-- ----------------------------------------------------------------------------
-- Runs once here so the operator's org gets the template without a
-- settings-page visit; new orgs are covered by the application-level
-- zero-template seeder (seedDefaultNoteTemplatesIfEmpty), which now seeds
-- both SOAP+ and Initial assessment.
--
-- Skipped for any org that already has an active initial_assessment
-- template OR a template named "Initial assessment" — deleting or
-- renaming the seeded template later will NOT resurrect it (this is a
-- migration, not a recurring ensure).
-- ----------------------------------------------------------------------------

WITH orgs_needing AS (
  SELECT o.id AS organization_id
    FROM organizations o
   WHERE NOT EXISTS (
           SELECT 1
             FROM note_templates nt
            WHERE nt.organization_id = o.id
              AND nt.deleted_at IS NULL
              AND (
                nt.note_type = 'initial_assessment'
                OR lower(nt.name) = 'initial assessment'
              )
         )
),
seeded AS (
  INSERT INTO note_templates (organization_id, name, note_type, sort_order)
  SELECT
    org.organization_id,
    'Initial assessment',
    'initial_assessment',
    COALESCE(
      (SELECT max(nt2.sort_order)
         FROM note_templates nt2
        WHERE nt2.organization_id = org.organization_id
          AND nt2.deleted_at IS NULL),
      0
    ) + 10
    FROM orgs_needing org
  RETURNING id
)
INSERT INTO note_template_fields (template_id, label, field_type, sort_order)
SELECT s.id, f.label, 'long_text'::note_template_field_type, f.sort_order
  FROM seeded s
 CROSS JOIN (
   VALUES
     ('Presenting complaint', 10),
     ('History',              20),
     ('Objective findings',   30),
     ('Assessment',           40),
     ('Plan',                 50)
 ) AS f(label, sort_order);
