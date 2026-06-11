-- ============================================================================
-- 20260611120200_cn1_flag_fields_on_contraindications
-- ============================================================================
-- CN-1 (docs/polish/client-profile-clinical-notes.md): widen the flag-field
-- CHECK so contraindication notes carry the structured flag columns, the
-- same as injury flags.
--
-- The original constraint allowed flag_body_region / flag_severity /
-- flag_reviewed_at / flag_resolved_at ONLY on note_type = 'injury_flag'
-- and forced them NULL everywhere else. That contradicts the rest of the
-- system, which treats contraindications as flags:
--
--   * the dashboard needs-attention query filters
--     note_type IN ('injury_flag','contraindication') AND
--     flag_resolved_at IS NULL — but a contraindication could never set
--     flag_resolved_at, so once visible it could never be resolved;
--   * the CN-1 flag control creates both types with a body region and
--     optional severity.
--
-- Both flag types now REQUIRE flag_body_region (it is the banner
-- headline; for systemic contraindications the EP writes the system —
-- the field is free text, not an anatomy list). Non-flag note types must
-- still carry no flag fields, unchanged.
--
-- Safe pre-launch: no UI path has ever been able to create a
-- contraindication row, so no existing row can violate the new shape.
-- ============================================================================

ALTER TABLE clinical_notes
  DROP CONSTRAINT clinical_notes_injury_flag_fields;

ALTER TABLE clinical_notes
  ADD CONSTRAINT clinical_notes_injury_flag_fields CHECK (
    CASE
      WHEN note_type IN ('injury_flag', 'contraindication')
        THEN flag_body_region IS NOT NULL
      ELSE flag_body_region IS NULL
       AND flag_severity    IS NULL
       AND flag_reviewed_at IS NULL
       AND flag_resolved_at IS NULL
    END
  );

COMMENT ON CONSTRAINT clinical_notes_injury_flag_fields ON clinical_notes IS
  'Flag note types (injury_flag, contraindication) must carry a body region and may carry severity/review/resolve timestamps; all other note types must carry none of the flag fields.';
