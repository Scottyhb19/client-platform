-- ============================================================================
-- 20260427110000_note_defaults_and_author_lock
-- ============================================================================
-- Why: Two related changes to the note-template + clinical-notes flow.
--
-- 1. Field default values
--    EPs want each template field to carry pre-filled "starter" text that
--    auto-populates a new note when written from that template (e.g. the
--    Plan field defaults to "Continue current programming. Reassess in 2
--    weeks."). Adds a nullable text column on note_template_fields.
--
-- 2. Author-locked clinical-note edits
--    The previous UPDATE policy let any staff/owner in the org modify any
--    clinical_note. AHPRA record integrity wants only the original
--    practitioner to edit their own note (no owner override either —
--    that's a hard constraint per the user). Drop the broad UPDATE policy
--    and replace it with an author-only one.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. note_template_fields.default_value
-- ----------------------------------------------------------------------------
ALTER TABLE note_template_fields
  ADD COLUMN default_value text;

COMMENT ON COLUMN note_template_fields.default_value IS
  'Optional starter text copied into a new note''s content_json field when the EP picks this template. Editable per note. NULL = no starter text (empty box).';


-- ----------------------------------------------------------------------------
-- 2. Author-only update on clinical_notes
-- ----------------------------------------------------------------------------
-- Replace the broad staff-org UPDATE policy with an author-locked one.
-- Reads stay org-wide so colleagues can still view a note; writes are
-- restricted to the original author. Pinning, editing field content,
-- changing the linked appointment — all gated behind author identity.
DROP POLICY IF EXISTS "staff update clinical_notes in own org" ON clinical_notes;

CREATE POLICY "author updates own clinical_notes"
  ON clinical_notes FOR UPDATE TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner', 'staff')
    AND author_user_id = auth.uid()
    AND deleted_at IS NULL
  )
  WITH CHECK (
    organization_id = public.user_organization_id()
    AND author_user_id = auth.uid()
  );

COMMENT ON POLICY "author updates own clinical_notes" ON clinical_notes IS
  'Author-locked: only the practitioner who wrote the note can edit, pin/unpin, or otherwise modify it. Even the practice owner has no override — clinical-record integrity. Soft-deletes go through the same gate.';
