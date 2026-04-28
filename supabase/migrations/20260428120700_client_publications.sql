-- ============================================================================
-- 20260428120700_client_publications
-- ============================================================================
-- Why: The publish gate. One row = one act of "I, the clinician, am
-- making this test session visible to the client at this time, with
-- this framing." Per brief §1.4 and §4.2.
--
-- Soft-deletable so a clinician can "unpublish" — the brief's Test 3
-- specifically tests soft-deleting a publication and verifying the
-- result disappears from the client portal. The history of
-- publish/unpublish events is preserved.
--
-- UNIQUE (test_session_id) WHERE deleted_at IS NULL ensures only one
-- live publication per session. A historical row remains for audit.
--
-- No updated_at — to "republish," soft-delete the existing row and
-- insert a new one. published_at semantics (when did the session
-- become visible to the client?) need to be inspected per row, not
-- mutated.
--
-- See /docs/testing-module-schema.md §4.7 for the design rationale.
-- ============================================================================

CREATE TABLE client_publications (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid          NOT NULL REFERENCES organizations(id)        ON DELETE RESTRICT,
  test_session_id   uuid          NOT NULL REFERENCES test_sessions(id)        ON DELETE CASCADE,
  published_at      timestamptz   NOT NULL DEFAULT now(),
  published_by      uuid          NOT NULL REFERENCES user_profiles(user_id)   ON DELETE RESTRICT,
  framing_text      text          CHECK (framing_text IS NULL OR length(framing_text) <= 280),
  created_at        timestamptz   NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);


-- One live publication per session. Historical (soft-deleted) rows excluded.
CREATE UNIQUE INDEX client_publications_session_unique_active
  ON client_publications (test_session_id)
  WHERE deleted_at IS NULL;

-- Recent publications for the dashboard's "Recently published" panel.
CREATE INDEX client_publications_org_published_at_idx
  ON client_publications (organization_id, published_at DESC)
  WHERE deleted_at IS NULL;

-- RLS scope.
CREATE INDEX client_publications_org_idx
  ON client_publications (organization_id)
  WHERE deleted_at IS NULL;


-- Cross-org guard: test_session must belong to the same org as the publication.
CREATE TRIGGER client_publications_enforce_session_org
  BEFORE INSERT OR UPDATE ON client_publications
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_same_org_fk('test_sessions', 'test_session_id', 'organization_id');


COMMENT ON TABLE client_publications IS
  'Publish-gate record per test_session. Existence (with deleted_at IS NULL) signals "the client may see this session, subject to per-metric visibility." Soft-delete = unpublish; the audit trail preserves both events.';
COMMENT ON COLUMN client_publications.framing_text IS
  'Optional one-sentence clinician interpretation, max 280 chars. Shown above the chart for the corresponding metric in the client portal.';
