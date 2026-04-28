-- ============================================================================
-- 20260428110000_audit_register_client_files
-- ============================================================================
-- Why: Hotfix. The previous migration (20260428100000_client_files) attached
-- the standard audit trigger to client_files but forgot to register the table
-- in the audit_resolve_org_id() CASE statement. As a result, every INSERT/
-- UPDATE/DELETE on client_files raises:
--
--   audit_resolve_org_id: unknown audited table client_files
--
-- which aborts the write before the row is saved. The Files tab modal
-- surfaces this verbatim and uploads can't complete.
--
-- Fix: CREATE OR REPLACE the function with client_files added to the first
-- WHEN branch (tables that carry organization_id directly). The rest of the
-- function body is reproduced verbatim from the original migration — the
-- function has to be replaced as a whole, there's no "patch a single
-- branch" mechanism in plpgsql.
-- ============================================================================

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
         'client_files'
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
