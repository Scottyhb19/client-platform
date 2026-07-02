-- ============================================================================
-- 20260702180000_cmed_occ_version
-- ============================================================================
-- Why: parity with CN-6 (20260702120000_cmh_occ_version; docs/go-live-checklist.md
-- §8). client_medications is a direct clone of client_medical_history and carries
-- the identical property: no OCC version column, and a staff-org UPDATE policy
-- ("staff update medications in own org") that admits every owner/staff member of
-- the org with no author lock — so two staff editing the same medication row
-- silently clobber each other (last-write-wins). The beta already runs two staff
-- (operator + EP collaborator), so the clobber window is live now, the same as it
-- was for client_medical_history. The rows are short (name + one-line context
-- note), which caps the blast radius but does not remove the silent-clobber
-- failure mode — and now that the §12 pattern is a proven template, the marginal
-- cost of parity is trivial. Applying it also removes the "one sibling clinical
-- table hardened, the other not" trap.
--
-- Fix is the standing §12 pattern (docs/schema.md): additive version column
-- + the shared bump_version_and_touch() trigger, mirroring clients,
-- clinical_notes, and (since 20260702120000) client_medical_history. The
-- application (updateMedicationAction) includes the last-read version in its
-- UPDATE WHERE clause; a concurrent write matches zero rows and the action
-- surfaces a conflict message. The is_active toggle and archive stay
-- versionless deliberately (single-field verbs), exactly as CN-6 left them.
--
-- Pre-launch advantage applies: additive column, DEFAULT 1 backfills every
-- existing row, no rows reshaped.
-- ============================================================================

ALTER TABLE client_medications
  ADD COLUMN version integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN client_medications.version IS
  'Optimistic concurrency control. Application includes version in UPDATE WHERE clause; the bump_version_and_touch trigger increments. See /docs/schema.md §12.';

-- bump_version_and_touch() also touches updated_at, so the plain touch
-- trigger from 20260629140000 would double-fire for nothing — replace it,
-- matching how clients, clinical_notes, and client_medical_history each carry
-- exactly one BEFORE UPDATE version trigger.
DROP TRIGGER cmed_touch_updated_at ON client_medications;

CREATE TRIGGER cmed_bump_version
  BEFORE UPDATE ON client_medications
  FOR EACH ROW EXECUTE FUNCTION public.bump_version_and_touch();

-- ============================================================================
-- §ROLLBACK (down reversal) — Supabase migrations are forward-only, so this is
-- a documented, paste-runnable block. Restores the plain touch trigger and
-- drops the version column.
-- ----------------------------------------------------------------------------
-- DROP TRIGGER IF EXISTS cmed_bump_version ON client_medications;
-- CREATE TRIGGER cmed_touch_updated_at
--   BEFORE UPDATE ON client_medications
--   FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
-- ALTER TABLE client_medications DROP COLUMN IF EXISTS version;
-- ============================================================================
