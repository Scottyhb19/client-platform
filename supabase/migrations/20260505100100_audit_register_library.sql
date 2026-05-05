-- ============================================================================
-- 20260505100100_audit_register_library
-- ============================================================================
-- Why: Exercise library polish pass, gap P0-2 in
-- /docs/polish/exercise-library.md. Adds audit-log coverage to the
-- five exercise-library tables. The motivation is multi-practitioner
-- traceability ("who edited the back-squat default?"), regulatory hygiene
-- (Privacy Act 1988), and consistency with the rest of the schema.
-- Pre-launch is the cheapest moment to add (per CLAUDE.md "open gates"
-- and the polish-pass philosophy of harden-now-before-real-data).
--
-- Per project memory `audit_register_new_tables` and the precedent in
-- 20260428120900_audit_register_testing_module.sql:
--   - Tenant tables must be added to audit_resolve_org_id()'s CASE list,
--     not just given a trigger. Calls for unknown tables raise an
--     exception that aborts the original write.
--   - The function is replaced as a whole — no plpgsql mechanism for
--     patching a single CASE branch.
--
-- This migration:
--   1. CREATE OR REPLACE audit_resolve_org_id with the four new tables
--      registered (movement_patterns, exercise_tags, exercise_metric_units,
--      exercise_tag_assignments). exercises is already in the CASE list
--      from a prior migration; no change to that branch.
--   2. Attach log_audit_event triggers to the four tables that have an
--      `id uuid` primary key. exercise_tag_assignments uses a composite
--      PK (exercise_id, tag_id) so log_audit_event's NEW.id assumption
--      doesn't apply — registered in CASE for defensive future-proofing
--      but no trigger attached. Tag assignment changes are observable via
--      the parent exercise's audit row (the EP edit flow rewrites
--      assignments in the same transaction as the exercise update).
--
-- Function body reproduced verbatim from the most recent prior migration
-- (20260503100000_program_days_scheduled_date.sql §9, post D-PROG-001).
-- The four new tables go in the existing "carry organization_id directly"
-- WHEN branch; exercise_tag_assignments gets its own WHEN with a one-hop
-- walk via the exercises FK.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1. Update audit_resolve_org_id with the four new library tables.
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
  CASE p_table
    -- Direct: row carries organization_id.
    WHEN 'organizations' THEN
      org_id := NULLIF(p_row ->> 'id', '')::uuid;

    WHEN 'user_organization_roles', 'invitations', 'clients',
         'client_categories', 'client_tags', 'client_tag_assignments',
         'exercises', 'program_templates', 'template_weeks',
         'template_days', 'template_exercises', 'programs', 'sessions',
         'exercise_logs', 'set_logs', 'appointments', 'reports',
         'report_versions', 'vald_raw_uploads', 'vald_device_types',
         'clinical_notes', 'assessment_templates', 'assessments',
         'session_types', 'note_templates', 'client_files',
         'test_sessions', 'test_results', 'practice_test_settings',
         'practice_custom_tests', 'practice_disabled_tests',
         'test_batteries', 'client_publications',
         -- Added 2026-05-05 (exercise library polish pass, gap P0-2):
         'movement_patterns', 'exercise_tags', 'exercise_metric_units' THEN
      org_id := NULLIF(p_row ->> 'organization_id', '')::uuid;

    -- Nested within programs
    WHEN 'program_weeks' THEN
      SELECT p.organization_id INTO org_id
        FROM programs p
       WHERE p.id = NULLIF(p_row ->> 'program_id', '')::uuid;

    WHEN 'program_days' THEN
      -- Post D-PROG-001: program_days carries program_id directly.
      SELECT p.organization_id INTO org_id
        FROM programs p
       WHERE p.id = NULLIF(p_row ->> 'program_id', '')::uuid;

    WHEN 'program_exercises' THEN
      -- Post D-PROG-001: walk via pd.program_id (one hop).
      SELECT p.organization_id INTO org_id
        FROM program_days pd
        JOIN programs p ON p.id = pd.program_id
       WHERE pd.id = NULLIF(p_row ->> 'program_day_id', '')::uuid;

    -- Nested within exercises (added 2026-05-05).
    -- Composite PK (exercise_id, tag_id); no audit trigger attached
    -- but registered defensively per the testing-module convention.
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

COMMENT ON FUNCTION public.audit_resolve_org_id(text, jsonb) IS
  'Resolves organization_id for audit log writes. Direct lookup for tables that carry the column; parent walk for nested tables. Updated 2026-05-05 to register the exercise library tables (movement_patterns, exercise_tags, exercise_metric_units, exercise_tag_assignments — last via one-hop walk through exercises).';

REVOKE EXECUTE ON FUNCTION public.audit_resolve_org_id(text, jsonb) FROM PUBLIC;


-- ----------------------------------------------------------------------------
-- §2. Attach log_audit_event triggers.
--
-- Four tables get triggers (all have `id uuid` PRIMARY KEY which the
-- generic log_audit_event reads as NEW.id / OLD.id).
--
-- exercise_tag_assignments is excluded — composite PK (exercise_id, tag_id),
-- no `id` column. The EP add/remove tag flow rewrites assignments inside
-- the same transaction as the parent exercise UPDATE; the parent exercise's
-- audit row records the intent, and the changed_fields diff doesn't
-- (currently) include the tag set anyway. If a future change needs this
-- coverage, options are: (a) add an `id uuid` synthetic PK column, or
-- (b) extend log_audit_event to handle composite-PK tables. Both are
-- larger surface than this pass needs.
-- ----------------------------------------------------------------------------
CREATE TRIGGER audit_exercises
  AFTER INSERT OR UPDATE OR DELETE ON exercises
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER audit_movement_patterns
  AFTER INSERT OR UPDATE OR DELETE ON movement_patterns
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER audit_exercise_tags
  AFTER INSERT OR UPDATE OR DELETE ON exercise_tags
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER audit_exercise_metric_units
  AFTER INSERT OR UPDATE OR DELETE ON exercise_metric_units
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();
