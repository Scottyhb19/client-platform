-- ============================================================================
-- 20260420100800_clinical_notes
-- ============================================================================
-- Why: SOAP-structured staff progress notes, injury flags, contraindications.
-- Staff-only ALWAYS — v0.2 of the schema doc removed the `visible_to_client`
-- boolean to prevent accidental exposure of clinical reasoning when an EP
-- "publishes" a note. Client-facing content lives on programs.notes and
-- program_exercises.instructions.
--
-- OCC via `version` column: two staff editing the same note cannot silently
-- clobber each other. Application includes the last-read version in the
-- UPDATE WHERE clause.
--
-- Injury flag fields are only populated when note_type = 'injury_flag'.
-- Enforced by CHECK constraint.
-- ============================================================================

CREATE TABLE clinical_notes (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid         NOT NULL REFERENCES organizations(id)        ON DELETE RESTRICT,
  client_id         uuid         NOT NULL REFERENCES clients(id)              ON DELETE RESTRICT,
  author_user_id    uuid         NOT NULL REFERENCES user_profiles(user_id)   ON DELETE RESTRICT,
  note_type         note_type    NOT NULL DEFAULT 'progress_note',
  note_date         date         NOT NULL DEFAULT CURRENT_DATE,
  title             text,
  -- SOAP structure
  subjective        text,
  objective         text,
  assessment        text,
  plan              text,
  body_rich         text,
  -- Injury flag fields (only populated when note_type = 'injury_flag')
  flag_body_region  text,
  flag_severity     smallint     CHECK (flag_severity IS NULL OR flag_severity BETWEEN 1 AND 5),
  flag_reviewed_at  timestamptz,
  flag_resolved_at  timestamptz,
  -- Bookkeeping
  is_pinned         boolean      NOT NULL DEFAULT false,
  version           int          NOT NULL DEFAULT 1,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CONSTRAINT clinical_notes_content_present CHECK (
    COALESCE(subjective, objective, assessment, plan, body_rich) IS NOT NULL
  ),
  CONSTRAINT clinical_notes_injury_flag_fields CHECK (
    CASE
      WHEN note_type = 'injury_flag' THEN flag_body_region IS NOT NULL
      ELSE flag_body_region IS NULL
       AND flag_severity   IS NULL
       AND flag_reviewed_at IS NULL
       AND flag_resolved_at IS NULL
    END
  )
);

-- Per-client chronological timeline
CREATE INDEX clinical_notes_client_time_idx
  ON clinical_notes (client_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX clinical_notes_org_idx
  ON clinical_notes (organization_id)
  WHERE deleted_at IS NULL;

-- Dashboard needs-attention: active injury flags in this org
CREATE INDEX clinical_notes_active_flags_idx
  ON clinical_notes (organization_id, client_id)
  WHERE note_type = 'injury_flag'
    AND flag_resolved_at IS NULL
    AND deleted_at IS NULL;

-- EP search across SOAP fields
CREATE INDEX clinical_notes_search_trgm_idx
  ON clinical_notes USING gin (
    (lower(
      COALESCE(subjective,'') || ' ' ||
      COALESCE(objective,'')  || ' ' ||
      COALESCE(assessment,'') || ' ' ||
      COALESCE(plan,'')       || ' ' ||
      COALESCE(body_rich,'')
    )) gin_trgm_ops
  )
  WHERE deleted_at IS NULL;

-- OCC + updated_at
CREATE TRIGGER clinical_notes_bump_version
  BEFORE UPDATE ON clinical_notes
  FOR EACH ROW EXECUTE FUNCTION public.bump_version_and_touch();

-- Cross-org: client_id must belong to same org as the note
CREATE TRIGGER clinical_notes_enforce_client_org
  BEFORE INSERT OR UPDATE ON clinical_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_same_org_fk('clients', 'client_id', 'organization_id');

COMMENT ON TABLE clinical_notes IS
  'Staff-only SOAP-structured clinical notes and injury flags. Never visible to clients. Client-facing content lives on programs.notes and program_exercises.instructions.';
COMMENT ON COLUMN clinical_notes.version IS
  'Optimistic concurrency control. Application includes version in UPDATE WHERE clause; trigger bumps. See /docs/schema.md §12.';
