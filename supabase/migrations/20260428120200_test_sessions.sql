-- ============================================================================
-- 20260428120200_test_sessions
-- ============================================================================
-- Why: The unit of clinical record for the testing module. One row per
-- (clinician, client, conducted_at). Carries the source enum so a future
-- VALD importer can drop sessions in alongside manual captures, and an
-- optional appointment_id link so a test session can be tied to the
-- consultation it was performed at.
--
-- OCC via `version` column: a clinician editing the session's notes or
-- conducted_at typo while another staff member is also looking at it
-- must not silently clobber.
--
-- Field-level field-lockdown for clients is unnecessary here — clients
-- have no UPDATE path on this table at all (RLS denies). Lockdown lives
-- on test_results instead, where a clinician's UPDATE could otherwise
-- mutate value/unit/side post-capture.
--
-- See /docs/testing-module-schema.md §4.1 for the design rationale.
-- ============================================================================

CREATE TABLE test_sessions (
  id                uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid             NOT NULL REFERENCES organizations(id)        ON DELETE RESTRICT,
  client_id         uuid             NOT NULL REFERENCES clients(id)              ON DELETE RESTRICT,
  conducted_by      uuid             NOT NULL REFERENCES user_profiles(user_id)   ON DELETE RESTRICT,
  conducted_at      timestamptz      NOT NULL,
  appointment_id    uuid             REFERENCES appointments(id)                  ON DELETE SET NULL,
  source            test_source_t    NOT NULL DEFAULT 'manual',
  notes             text,
  version           int              NOT NULL DEFAULT 1,
  created_at        timestamptz      NOT NULL DEFAULT now(),
  updated_at        timestamptz      NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CONSTRAINT test_sessions_conducted_at_sane CHECK (
    conducted_at BETWEEN '1900-01-01' AND now() + INTERVAL '1 day'
  ),
  CONSTRAINT test_sessions_notes_length CHECK (
    notes IS NULL OR length(notes) <= 4000
  )
);


-- Reports tab + chart fan-in — "all sessions for this client, newest first".
CREATE INDEX test_sessions_client_time_idx
  ON test_sessions (client_id, conducted_at DESC)
  WHERE deleted_at IS NULL;

-- RLS scope.
CREATE INDEX test_sessions_org_idx
  ON test_sessions (organization_id)
  WHERE deleted_at IS NULL;

-- Appointment detail page — "tests linked to this consultation".
CREATE INDEX test_sessions_appointment_idx
  ON test_sessions (appointment_id)
  WHERE appointment_id IS NOT NULL
    AND deleted_at IS NULL;

-- Owner audit — "what did this clinician do".
CREATE INDEX test_sessions_clinician_idx
  ON test_sessions (conducted_by, conducted_at DESC)
  WHERE deleted_at IS NULL;


-- OCC + updated_at bump on every UPDATE.
CREATE TRIGGER test_sessions_bump_version
  BEFORE UPDATE ON test_sessions
  FOR EACH ROW EXECUTE FUNCTION public.bump_version_and_touch();

-- Cross-org guard: client_id must belong to the same org as the session.
CREATE TRIGGER test_sessions_enforce_client_org
  BEFORE INSERT OR UPDATE ON test_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_same_org_fk('clients', 'client_id', 'organization_id');

-- Cross-org guard: appointment_id (when present) must belong to the same org.
CREATE TRIGGER test_sessions_enforce_appointment_org
  BEFORE INSERT OR UPDATE ON test_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_same_org_fk('appointments', 'appointment_id', 'organization_id');


COMMENT ON TABLE test_sessions IS
  'One test session = one clinician × one client × one conducted_at. Audited. Soft-deletable. Holds N test_results via test_session_id FK.';
COMMENT ON COLUMN test_sessions.source IS
  'Where this session originated. manual is the default; vald is reserved for a future importer; imported is generic bulk upload. The data model accepts vald-sourced sessions today even though the importer is not built.';
COMMENT ON COLUMN test_sessions.version IS
  'Optimistic concurrency control. Application includes version in UPDATE WHERE clause; the bump_version_and_touch trigger increments. See /docs/schema.md §12.';
