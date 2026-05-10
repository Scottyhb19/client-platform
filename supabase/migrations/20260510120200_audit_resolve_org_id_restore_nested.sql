-- ============================================================================
-- 20260510120200_audit_resolve_org_id_restore_nested
-- ============================================================================
-- Why: Regression repair. The 2026-05-05 audit-register migration
-- (20260505100100_audit_register_library) replaced the body of
-- audit_resolve_org_id but accidentally:
--
--   (a) Moved four nested tables into the "direct organization_id" WHEN
--       branch, even though those tables don't have an organization_id
--       column:
--         - exercise_logs   (parent: sessions)
--         - set_logs        (parent: exercise_logs → sessions)
--         - report_versions (parent: reports)
--         - appointment_reminders (parent: appointments)
--
--       For (a)–(c), the audit_log row landed with org_id = NULL because
--       `NULLIF(row->>'organization_id', '')::uuid` is NULL for rows that
--       don't carry that field. Audit data was being recorded but
--       unattributable to a tenant. Silent data-quality bug.
--
--   (b) DROPPED 'appointment_reminders' from the CASE list entirely.
--       The ELSE branch raises 'unknown audited table'. This is a
--       transaction-aborting bug — any write to appointment_reminders
--       fails. Phase F's client_book_appointment is the first code path
--       to write to that table, which is how the regression surfaced.
--
--   (c) Dropped 'client_medical_history' and 'communications' from the
--       direct branch — both DO have organization_id columns (verified
--       against 20260420100700 and 20260420102100). Like (a), this fails
--       silently with NULL org_id on audit rows.
--
-- This migration:
--   1. CREATE OR REPLACE the function with all 38 audited tables in their
--      correct branches (direct vs nested).
--   2. Adds an explicit ELSE that raises with the offending table name so
--      future regressions surface loudly.
--
-- No data backfill of existing audit_log rows. Pre-launch — there's no
-- production data to attribute to the right org, and rewriting historical
-- audit rows would itself be auditable (and arguably wrong — the snapshot
-- of "who knew what when" should not be retroactively edited).
--
-- ============================================================================

CREATE OR REPLACE FUNCTION public.audit_resolve_org_id(p_table text, p_row jsonb)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  org_id uuid;
BEGIN
  IF p_row IS NULL THEN
    RETURN NULL;
  END IF;

  CASE p_table
    -- ------------------------------------------------------------------
    -- Direct: row carries organization_id. Verified against the
    -- table's CREATE TABLE in its own migration.
    -- ------------------------------------------------------------------
    WHEN 'organizations' THEN
      org_id := NULLIF(p_row ->> 'id', '')::uuid;

    WHEN 'user_organization_roles', 'invitations', 'clients',
         -- Restored 2026-05-10 — has organization_id; was dropped by
         -- 20260505100100 along with 'communications'.
         'client_medical_history',
         'communications',
         'client_categories', 'client_tags', 'client_tag_assignments',
         'exercises', 'program_templates', 'template_weeks',
         'template_days', 'template_exercises', 'programs', 'sessions',
         'appointments', 'reports',
         'vald_raw_uploads', 'vald_device_types',
         'clinical_notes', 'assessment_templates', 'assessments',
         'session_types', 'note_templates', 'client_files',
         'test_sessions', 'test_results', 'practice_test_settings',
         'practice_custom_tests', 'practice_disabled_tests',
         'test_batteries', 'client_publications',
         'movement_patterns', 'exercise_tags', 'exercise_metric_units' THEN
      org_id := NULLIF(p_row ->> 'organization_id', '')::uuid;

    -- ------------------------------------------------------------------
    -- Nested via programs (post D-PROG-001: program_days has
    -- program_id directly, so the walk is one hop, not two).
    -- ------------------------------------------------------------------
    WHEN 'program_weeks' THEN
      SELECT p.organization_id INTO org_id
        FROM programs p
       WHERE p.id = NULLIF(p_row ->> 'program_id', '')::uuid;

    WHEN 'program_days' THEN
      SELECT p.organization_id INTO org_id
        FROM programs p
       WHERE p.id = NULLIF(p_row ->> 'program_id', '')::uuid;

    WHEN 'program_exercises' THEN
      SELECT p.organization_id INTO org_id
        FROM program_days pd
        JOIN programs p ON p.id = pd.program_id
       WHERE pd.id = NULLIF(p_row ->> 'program_day_id', '')::uuid;

    -- ------------------------------------------------------------------
    -- Nested via sessions (restored 2026-05-10).
    -- ------------------------------------------------------------------
    WHEN 'exercise_logs' THEN
      SELECT s.organization_id INTO org_id
        FROM sessions s
       WHERE s.id = NULLIF(p_row ->> 'session_id', '')::uuid;

    WHEN 'set_logs' THEN
      SELECT s.organization_id INTO org_id
        FROM exercise_logs el
        JOIN sessions s ON s.id = el.session_id
       WHERE el.id = NULLIF(p_row ->> 'exercise_log_id', '')::uuid;

    -- ------------------------------------------------------------------
    -- Nested via appointments (restored 2026-05-10 — was dropped from
    -- the CASE list entirely; this was the user-visible bug).
    -- ------------------------------------------------------------------
    WHEN 'appointment_reminders' THEN
      SELECT a.organization_id INTO org_id
        FROM appointments a
       WHERE a.id = NULLIF(p_row ->> 'appointment_id', '')::uuid;

    -- ------------------------------------------------------------------
    -- Nested via reports (restored 2026-05-10).
    -- ------------------------------------------------------------------
    WHEN 'report_versions' THEN
      SELECT r.organization_id INTO org_id
        FROM reports r
       WHERE r.id = NULLIF(p_row ->> 'report_id', '')::uuid;

    -- ------------------------------------------------------------------
    -- Nested via exercises (composite PK; defensive registration only).
    -- ------------------------------------------------------------------
    WHEN 'exercise_tag_assignments' THEN
      SELECT e.organization_id INTO org_id
        FROM exercises e
       WHERE e.id = NULLIF(p_row ->> 'exercise_id', '')::uuid;

    ELSE
      RAISE EXCEPTION 'audit_resolve_org_id: unknown audited table %', p_table;
  END CASE;

  RETURN org_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.audit_resolve_org_id(text, jsonb) FROM PUBLIC;

COMMENT ON FUNCTION public.audit_resolve_org_id(text, jsonb) IS
  'Resolves organization_id for audit log writes. Direct lookup for tables that carry the column; parent walk for nested tables. 2026-05-10: restored four nested branches (exercise_logs, set_logs, appointment_reminders, report_versions) and two direct entries (client_medical_history, communications) accidentally dropped by 20260505100100.';
