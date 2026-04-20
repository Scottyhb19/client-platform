-- ============================================================================
-- 20260420100700_client_medical_history
-- ============================================================================
-- Why: Structured static medical history items — conditions, medications,
-- past surgeries. One row per item. Distinct from clinical_notes (which
-- captures session progress) and from injury_flags (which are time-bounded
-- status notes). Medical history rarely changes; clinical notes accumulate.
-- ============================================================================

CREATE TABLE client_medical_history (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid         NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  client_id        uuid         NOT NULL REFERENCES clients(id)       ON DELETE RESTRICT,
  condition        text         NOT NULL CHECK (length(trim(condition)) BETWEEN 1 AND 500),
  diagnosis_date   date,
  severity         smallint     CHECK (severity IS NULL OR severity BETWEEN 1 AND 5),
  notes            text,
  is_active        boolean      NOT NULL DEFAULT true,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  CONSTRAINT cmh_diagnosis_date_sane CHECK (
    diagnosis_date IS NULL OR diagnosis_date BETWEEN '1900-01-01' AND CURRENT_DATE
  )
);

CREATE INDEX cmh_client_idx
  ON client_medical_history (client_id)
  WHERE deleted_at IS NULL;

CREATE INDEX cmh_org_idx
  ON client_medical_history (organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX cmh_active_idx
  ON client_medical_history (client_id)
  WHERE is_active = true AND deleted_at IS NULL;

CREATE TRIGGER cmh_touch_updated_at
  BEFORE UPDATE ON client_medical_history
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER cmh_enforce_client_org
  BEFORE INSERT OR UPDATE ON client_medical_history
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_same_org_fk('clients', 'client_id', 'organization_id');

COMMENT ON TABLE client_medical_history IS
  'Static medical history items for a client — conditions, medications, past surgeries. One row per item.';
