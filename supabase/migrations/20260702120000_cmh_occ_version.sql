-- ============================================================================
-- 20260702120000_cmh_occ_version
-- ============================================================================
-- Why: CN-6 deferred item, trigger fired (docs/go-live-checklist.md §8;
-- docs/polish/client-profile-clinical-notes.md CN-6). client_medical_history
-- had no OCC version column, and its UPDATE policy admits every owner/staff
-- member of the org with no author lock — so two staff editing the same
-- condition silently clobber each other (last-write-wins). The beta already
-- runs two staff (operator + EP collaborator), so the clobber window is live
-- now, not hypothetical.
--
-- Fix is the standing §12 pattern (docs/schema.md): additive version column
-- + the shared bump_version_and_touch() trigger, mirroring clients and
-- clinical_notes. The application (updateMedicalConditionAction) includes
-- the last-read version in its UPDATE WHERE clause; a concurrent write
-- matches zero rows and the action surfaces a conflict message.
--
-- Pre-launch advantage applies: additive column, DEFAULT 1 backfills every
-- existing row, no rows reshaped.
-- ============================================================================

ALTER TABLE client_medical_history
  ADD COLUMN version integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN client_medical_history.version IS
  'Optimistic concurrency control. Application includes version in UPDATE WHERE clause; the bump_version_and_touch trigger increments. See /docs/schema.md §12.';

-- bump_version_and_touch() also touches updated_at, so the plain touch
-- trigger from 20260420100700 would double-fire for nothing — replace it,
-- matching how clients and clinical_notes carry exactly one BEFORE UPDATE
-- version trigger.
DROP TRIGGER cmh_touch_updated_at ON client_medical_history;

CREATE TRIGGER cmh_bump_version
  BEFORE UPDATE ON client_medical_history
  FOR EACH ROW EXECUTE FUNCTION public.bump_version_and_touch();
