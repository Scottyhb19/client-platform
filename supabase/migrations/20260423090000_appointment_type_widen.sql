-- ============================================================================
-- 20260423090000_appointment_type_widen
-- ============================================================================
-- Why: The original constraint treated appointment_type as delivery-mode
-- (in_clinic | telehealth), but the staff booking UI uses it as a clinical
-- category (Session | Initial assessment | Review | Telehealth). Location
-- captures the "where" already.
--
-- This migration:
--   1. Drops the old check constraint.
--   2. Migrates existing rows (in_clinic -> 'Session', telehealth -> 'Telehealth').
--   3. Sets a new default of 'Session'.
--   4. Adds a new check constraint with the four UI values.
-- ============================================================================

ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS appointments_appointment_type_check;

UPDATE appointments
SET appointment_type = CASE
  WHEN appointment_type = 'in_clinic'  THEN 'Session'
  WHEN appointment_type = 'telehealth' THEN 'Telehealth'
  ELSE appointment_type
END
WHERE appointment_type IN ('in_clinic', 'telehealth');

ALTER TABLE appointments
  ALTER COLUMN appointment_type SET DEFAULT 'Session';

ALTER TABLE appointments
  ADD CONSTRAINT appointments_appointment_type_check
  CHECK (appointment_type IN ('Session', 'Initial assessment', 'Review', 'Telehealth'));
