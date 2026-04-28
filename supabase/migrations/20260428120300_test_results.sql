-- ============================================================================
-- 20260428120300_test_results
-- ============================================================================
-- Why: One row per (test_session, test_id, metric_id, side). Captures the
-- numeric value at the moment of recording, with the unit denormalised
-- from the schema so a future schema-version bump that renames units
-- (e.g. mm → cm) cannot silently reinterpret historical numbers.
--
-- Append-only with soft-delete. The only legal UPDATE is to deleted_at
-- (and back to NULL for restoration). All other field changes are
-- denied by the lockdown trigger below — equivalent posture to
-- appointments_client_field_lockdown but applied to every role.
--
-- To "amend" a wrong reading, the clinician soft-deletes the row and
-- re-inserts. The audit trail captures both events.
--
-- organization_id is denormalised onto results for two reasons:
--   1. RLS policies can filter by org without joining test_sessions.
--   2. audit_resolve_org_id can take the direct-column fast path.
-- The cross-org guard ensures it stays consistent with the parent.
--
-- See /docs/testing-module-schema.md §4.2 for the design rationale.
-- ============================================================================

CREATE TABLE test_results (
  id                uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid             NOT NULL REFERENCES organizations(id)   ON DELETE RESTRICT,
  test_session_id   uuid             NOT NULL REFERENCES test_sessions(id)   ON DELETE CASCADE,
  test_id           text             NOT NULL CHECK (test_id ~ '^[a-z0-9_]{1,80}$'),
  metric_id         text             NOT NULL CHECK (metric_id ~ '^[a-z0-9_]{1,80}$'),
  side              test_side_t,                 -- NULL for non-bilateral metrics
  value             numeric          NOT NULL,
  unit              text             NOT NULL CHECK (length(trim(unit)) BETWEEN 1 AND 30),
  created_at        timestamptz      NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);


-- Fan-out from session — "all metrics captured in this session".
CREATE INDEX test_results_session_idx
  ON test_results (test_session_id)
  WHERE deleted_at IS NULL;

-- RLS scope.
CREATE INDEX test_results_org_idx
  ON test_results (organization_id)
  WHERE deleted_at IS NULL;

-- Cross-session metric history — "every reading of metric X across all sessions".
-- Charts use this index, joined to test_sessions for client_id + conducted_at.
CREATE INDEX test_results_test_metric_idx
  ON test_results (test_id, metric_id)
  WHERE deleted_at IS NULL;

-- Bilateral side filter — "left-only readings of metric X".
CREATE INDEX test_results_side_idx
  ON test_results (test_id, metric_id, side)
  WHERE deleted_at IS NULL
    AND side IS NOT NULL;


-- ----------------------------------------------------------------------------
-- Cross-org guard: test_session_id must belong to the same org as this row.
-- ----------------------------------------------------------------------------
CREATE TRIGGER test_results_enforce_session_org
  BEFORE INSERT OR UPDATE ON test_results
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_same_org_fk('test_sessions', 'test_session_id', 'organization_id');


-- ----------------------------------------------------------------------------
-- Field lockdown: only deleted_at may change on UPDATE.
--
-- This is what makes test_results "append-only with soft-delete." A
-- clinician who realises a value is wrong soft-deletes the row and
-- inserts a new one — the audit trail reflects both. We deliberately do
-- NOT allow editing the value, because the audit trigger only sees the
-- diff and the original number is the clinically meaningful one.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.test_results_lock_immutable_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.organization_id  IS DISTINCT FROM OLD.organization_id
  OR NEW.test_session_id  IS DISTINCT FROM OLD.test_session_id
  OR NEW.test_id          IS DISTINCT FROM OLD.test_id
  OR NEW.metric_id        IS DISTINCT FROM OLD.metric_id
  OR NEW.side             IS DISTINCT FROM OLD.side
  OR NEW.value            IS DISTINCT FROM OLD.value
  OR NEW.unit             IS DISTINCT FROM OLD.unit
  OR NEW.created_at       IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'test_results.% is immutable after insert; soft-delete the row and insert a corrected one',
      'value/unit/side/test_id/metric_id/test_session_id/organization_id/created_at'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.test_results_lock_immutable_fields() IS
  'Field-lockdown trigger for test_results. Allows only deleted_at to change on UPDATE. To amend a wrong reading, soft-delete and re-insert.';

CREATE TRIGGER test_results_lock_immutable_fields_trg
  BEFORE UPDATE ON test_results
  FOR EACH ROW EXECUTE FUNCTION public.test_results_lock_immutable_fields();


COMMENT ON TABLE test_results IS
  'One row per (test_session, test_id, metric_id, side). Append-only with soft-delete; value/unit/side/test_id/metric_id are immutable post-insert via the lockdown trigger.';
COMMENT ON COLUMN test_results.unit IS
  'Denormalised from the schema at capture time. Historical immutability — a future schema bump that renames units must not silently reinterpret old numbers.';
COMMENT ON COLUMN test_results.organization_id IS
  'Denormalised from test_sessions for RLS perf and audit fast-path. Cross-org guard keeps it consistent.';
