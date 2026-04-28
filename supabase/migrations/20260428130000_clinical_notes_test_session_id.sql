-- ============================================================================
-- 20260428130000_clinical_notes_test_session_id
-- ============================================================================
-- Why: Per /docs/testing-module-schema.md §14 Q2 sign-off, a clinical
-- note links to at most one test_session via a single nullable FK.
-- This is the data-layer support for brief §1.2 entry point #1 — the
-- clinician runs a "Run test battery" section inside an Initial
-- Assessment / Reassessment template; submitting the note creates the
-- test_session and writes the link.
--
-- N:M was rejected — a single FK matches the brief's wording and the
-- current note-template UX. Reversible to N:M later by adding a join
-- table without changing the existing column's semantics.
--
-- ON DELETE SET NULL: if the test_session is soft-deleted (or, in some
-- future bulk cleanup, hard-deleted), the note's narrative survives.
-- The link goes away; the clinical record does not.
--
-- audit_resolve_org_id already routes clinical_notes via the direct-
-- column branch — no audit registration changes needed. The column
-- becomes part of the snapshot the existing audit trigger captures.
-- ============================================================================

ALTER TABLE clinical_notes
  ADD COLUMN test_session_id uuid REFERENCES test_sessions(id) ON DELETE SET NULL;


-- Index: "find the note for this test session." Used by the Reports
-- tab card's "View linked note" link and by any future "session →
-- note" navigation.
CREATE INDEX clinical_notes_test_session_idx
  ON clinical_notes (test_session_id)
  WHERE test_session_id IS NOT NULL
    AND deleted_at IS NULL;


-- Cross-org guard: a note's linked session must belong to the same org.
CREATE TRIGGER clinical_notes_enforce_test_session_org
  BEFORE INSERT OR UPDATE ON clinical_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_same_org_fk('test_sessions', 'test_session_id', 'organization_id');


COMMENT ON COLUMN clinical_notes.test_session_id IS
  'Optional link to a test_session captured inside this note. Single FK; N:M was deliberately rejected for v1 (see /docs/testing-module-schema.md §14 Q2). ON DELETE SET NULL preserves the note narrative if the test_session is removed.';
