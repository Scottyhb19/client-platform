-- ============================================================================
-- 20260428120900_audit_register_testing_module
-- ============================================================================
-- Why: Three of the seven new testing-module tables are clinical /
-- client-visibility data and require audit triggers:
--   - test_sessions
--   - test_results
--   - client_publications
--
-- Settings tables (practice_test_settings, practice_disabled_tests,
-- practice_custom_tests, test_batteries) are NOT audited via triggers
-- per existing convention (schema.md §11.2). Application logs cover.
--
-- HOWEVER — the audit_resolve_org_id() function CASE statement only
-- recognises tables that are listed in it. Calls for unknown tables
-- raise an exception that aborts the original write. Per
-- /docs/testing-module-schema.md §8.2, defensively register every new
-- table here even if not all get audit triggers — this protects against
-- a later "let's audit settings too" decision missing a CASE branch.
--
-- This migration:
--   1. CREATE OR REPLACE audit_resolve_org_id with the seven new tables.
--   2. Attach log_audit_event triggers to the three audited tables.
--   3. Register test_sessions.notes in audit_wide_column_config.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Update audit_resolve_org_id with all seven new tables.
--
-- All seven carry organization_id directly, so they go in the first WHEN
-- branch. The function body is reproduced verbatim from the most recent
-- prior migration (20260428110000_audit_register_client_files.sql) — the
-- function is replaced as a whole.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_resolve_org_id(p_table text, p_row jsonb)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  org_id uuid;
BEGIN
  IF p_row IS NULL THEN
    RETURN NULL;
  END IF;

  CASE p_table
    -- Tables that carry organization_id directly
    WHEN 'clients',
         'client_medical_history',
         'clinical_notes',
         'assessments',
         'programs',
         'sessions',
         'appointments',
         'communications',
         'reports',
         'client_files',
         'test_sessions',
         'test_results',
         'practice_test_settings',
         'practice_disabled_tests',
         'practice_custom_tests',
         'test_batteries',
         'client_publications'
    THEN
      org_id := NULLIF(p_row ->> 'organization_id', '')::uuid;

    -- Nested within programs
    WHEN 'program_weeks' THEN
      SELECT p.organization_id INTO org_id
        FROM programs p
       WHERE p.id = NULLIF(p_row ->> 'program_id', '')::uuid;

    WHEN 'program_days' THEN
      SELECT p.organization_id INTO org_id
        FROM program_weeks pw
        JOIN programs p ON p.id = pw.program_id
       WHERE pw.id = NULLIF(p_row ->> 'program_week_id', '')::uuid;

    WHEN 'program_exercises' THEN
      SELECT p.organization_id INTO org_id
        FROM program_days pd
        JOIN program_weeks pw ON pw.id = pd.program_week_id
        JOIN programs p ON p.id = pw.program_id
       WHERE pd.id = NULLIF(p_row ->> 'program_day_id', '')::uuid;

    -- Nested within sessions
    WHEN 'exercise_logs' THEN
      SELECT s.organization_id INTO org_id
        FROM sessions s
       WHERE s.id = NULLIF(p_row ->> 'session_id', '')::uuid;

    WHEN 'set_logs' THEN
      SELECT s.organization_id INTO org_id
        FROM exercise_logs el
        JOIN sessions s ON s.id = el.session_id
       WHERE el.id = NULLIF(p_row ->> 'exercise_log_id', '')::uuid;

    -- Nested within appointments
    WHEN 'appointment_reminders' THEN
      SELECT a.organization_id INTO org_id
        FROM appointments a
       WHERE a.id = NULLIF(p_row ->> 'appointment_id', '')::uuid;

    -- Nested within reports
    WHEN 'report_versions' THEN
      SELECT r.organization_id INTO org_id
        FROM reports r
       WHERE r.id = NULLIF(p_row ->> 'report_id', '')::uuid;

    ELSE
      RAISE EXCEPTION 'audit_resolve_org_id: unknown audited table %', p_table;
  END CASE;

  RETURN org_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.audit_resolve_org_id(text, jsonb) FROM PUBLIC;


-- ----------------------------------------------------------------------------
-- 2. Attach log_audit_event triggers to the three clinical tables.
--    Settings tables are deliberately not audited.
-- ----------------------------------------------------------------------------
CREATE TRIGGER audit_test_sessions
  AFTER INSERT OR UPDATE OR DELETE ON test_sessions
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER audit_test_results
  AFTER INSERT OR UPDATE OR DELETE ON test_results
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER audit_client_publications
  AFTER INSERT OR UPDATE OR DELETE ON client_publications
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();


-- ----------------------------------------------------------------------------
-- 3. Register test_sessions.notes as a wide column.
--    Capped at 4 KB by CHECK constraint, but registering means we get
--    SHA-256 + preview semantics for free if a clinician writes anything
--    near the limit. test_results columns are all small. framing_text
--    on client_publications is capped at 280 chars — no truncation needed.
-- ----------------------------------------------------------------------------
INSERT INTO audit_wide_column_config (table_name, column_name) VALUES
  ('test_sessions', 'notes');
