-- ============================================================================
-- 20260618120200_audit_messages                            (Messaging P0-3)
-- ============================================================================
-- Why: messages + message_threads carried NO audit trigger and were absent
-- from audit_resolve_org_id(). Brief §7.4 requires "audit logging for all
-- data access and modifications", and the owner-approved messaging deviation
-- (20260425100000:6-9) was explicitly conditioned on health-adjacent content
-- staying "subject to APP compliance + DR tooling". With the immutability
-- trigger (P0-2) tampering is blocked; this makes every message mutation
-- auditable so it is also traceable. Closes messaging premortem FM-2.
--
-- Two coupled changes, in the order the coverage guard requires:
--   §1  CREATE OR REPLACE audit_resolve_org_id adding 'messages' and
--       'message_threads' to the direct-org branch (both carry
--       organization_id). Body is reproduced verbatim from the canonical
--       latest version (20260513160000) — every existing branch retained —
--       per the "base rewrites on the LATEST replacement" rule.
--   §2  Attach log_audit_event triggers to both tables.
--   §3  Assert resolver coverage (the fallback the guard migration mandates
--       at the end of any migration that touches the resolver).
--
-- Ordering note: if the guard_audit_resolver_coverage event trigger is live,
-- it fires on §1's CREATE OR REPLACE — at which point the new audit_<table>
-- triggers do not yet exist, so coverage holds (the resolver already lists
-- them, harmlessly ahead of their triggers). §2's CREATE TRIGGER is not in the
-- event guard's TAG filter. §3 re-checks with the triggers present.
--
-- messages.body is capped at 1000 chars (< 4 KB), so no audit_wide_column_config
-- entry is needed (cf. client_publications.framing_text at 280 chars).
--
-- Backward-compatible: adds audit rows on message writes; no table/column
-- change. The resolver covers the new tables in the same migration, so writes
-- never hit the ELSE/RAISE. Safe to push to the live shared DB.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1. audit_resolve_org_id — canonical 20260513160000 body + the two
--     messaging tables in the direct-org WHEN branch.
-- ----------------------------------------------------------------------------
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
    -- Direct: row carries organization_id.
    -- ------------------------------------------------------------------
    WHEN 'organizations' THEN
      org_id := NULLIF(p_row ->> 'id', '')::uuid;

    WHEN 'user_organization_roles', 'invitations', 'clients',
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
         'movement_patterns', 'exercise_tags', 'exercise_metric_units',
         'availability_rules',
         -- Messaging (added 2026-06-18, §10 P0-3). Both carry organization_id.
         'messages', 'message_threads'
         THEN
      org_id := NULLIF(p_row ->> 'organization_id', '')::uuid;

    -- ------------------------------------------------------------------
    -- Nested via programs.
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

    WHEN 'program_exercise_sets' THEN
      SELECT p.organization_id INTO org_id
        FROM program_exercises pe
        JOIN program_days       pd ON pd.id = pe.program_day_id
        JOIN programs           p  ON p.id  = pd.program_id
       WHERE pe.id = NULLIF(p_row ->> 'program_exercise_id', '')::uuid;

    -- ------------------------------------------------------------------
    -- Nested via sessions.
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
    -- Nested via appointments.
    -- ------------------------------------------------------------------
    WHEN 'appointment_reminders' THEN
      SELECT a.organization_id INTO org_id
        FROM appointments a
       WHERE a.id = NULLIF(p_row ->> 'appointment_id', '')::uuid;

    -- ------------------------------------------------------------------
    -- Nested via reports.
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
  'Resolves organization_id for audit log writes. Direct lookup for tables that carry the column; parent walk for nested tables. 2026-06-18: added messages + message_threads (§10 P0-3) to the direct-org branch.';


-- ----------------------------------------------------------------------------
-- §2. Attach log_audit_event to both messaging tables.
-- ----------------------------------------------------------------------------
CREATE TRIGGER audit_messages
  AFTER INSERT OR UPDATE OR DELETE ON messages
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER audit_message_threads
  AFTER INSERT OR UPDATE OR DELETE ON message_threads
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();


-- ----------------------------------------------------------------------------
-- §3. Fallback coverage assertion (mandated for any migration that touches
--     the resolver — see 20260513160000 §4). Fails the migration loud if any
--     audit_<name> trigger now lacks a matching CASE branch.
-- ----------------------------------------------------------------------------
SELECT public.assert_audit_resolver_coverage();
