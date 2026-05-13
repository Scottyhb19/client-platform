-- ============================================================================
-- 20260513150000_audit_resolver_coverage_guard
-- ============================================================================
-- Why: Two-incident pattern repair.
--
-- The bug: audit_resolve_org_id() is a monolithic CASE statement. Every
-- migration that touches it does a full CREATE OR REPLACE rewriting the
-- entire body. When the author reconstructs the CASE list from a stale
-- mental model, branches go missing — and the failure is silent until a
-- user clicks a button that writes to the un-covered table.
--
-- This has happened twice in eight days:
--
--   1. 2026-05-05 — 20260505100100_audit_register_library accidentally
--      dropped six branches (appointment_reminders entirely; moved four
--      nested tables into the direct-org branch where they silently wrote
--      NULL org_id; dropped client_medical_history + communications from
--      the direct branch). Repaired 2026-05-10 by
--      20260510120200_audit_resolve_org_id_restore_nested.
--
--   2. 2026-05-10 — 20260510120200 (the repair migration itself) was
--      authored from a pre-Phase-C mental model. It silently dropped the
--      program_exercise_sets nested branch that
--      20260507100000_program_exercise_sets had added three days earlier.
--      20260511120000_availability_rules_audit_and_constraints explicitly
--      based its body on the broken 0510 version and inherited the gap.
--
-- Today (2026-05-13) the EP clicks "Add exercise" in the session builder.
-- addExerciseToDayAction inserts a program_exercises parent row (covered),
-- then fans out program_exercise_sets rows (uncovered). The audit trigger
-- on program_exercise_sets fires log_audit_event(), which calls
-- audit_resolve_org_id('program_exercise_sets', NEW). The CASE has no
-- matching WHEN, falls through to the ELSE, and raises
-- "unknown audited table program_exercise_sets". The transaction aborts;
-- the action returns "Couldn't seed sets: …".
--
-- This migration fixes the bug AND installs the structural guard that
-- prevents the next regression in this class. Three layers:
--
--   §1  Restore the program_exercise_sets nested branch (the immediate fix).
--   §2  Define assert_audit_resolver_coverage() — a public function that
--       enumerates every table with an audit_<name> trigger, calls the
--       resolver with a synthetic jsonb row, and RAISEs if any branch is
--       missing. This is the reusable check.
--   §3  Invoke the check now, against the function body just installed.
--       Migration fails-loud if any OTHER table is also un-covered (defense
--       in depth — the diagnosis above named only program_exercise_sets,
--       but the check is the authoritative source of truth).
--   §4  Attempt to install an event trigger that calls the coverage check
--       automatically after any future CREATE/ALTER on the resolver.
--       Wrapped in EXCEPTION handling — if hosted Supabase blocks event
--       trigger creation (insufficient_privilege or feature_not_supported)
--       the migration still succeeds; RAISE NOTICE tells us we're on the
--       manual-discipline fallback. The companion pgTAP test
--       (supabase/tests/database/14_audit_resolve_org_id_coverage.sql) is
--       the second-line guard regardless of which path lands here.
--
-- Why not refactor to a data-driven resolver (a public.audit_org_resolvers
-- table keyed on table_name): that's the architecturally correct answer but
-- it's a bigger refactor than is appropriate this close to launch. Phase-2
-- hardening can revisit. For now, the guard is sufficient: the resolver
-- stays as plpgsql CASE, but the *guard* makes it impossible to ship a
-- regression without the migration aborting at push time.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1. Restore audit_resolve_org_id with program_exercise_sets branch.
--
-- Body is verbatim 20260511120000 (the latest canonical version) plus the
-- program_exercise_sets WHEN branch from 20260507100000_program_exercise_sets
-- §4. No other changes — every other branch retained as-is so this commit
-- is a true narrow repair, not a stealth rewrite.
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
         'availability_rules'
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

    -- Restored 2026-05-13 — accidentally dropped by 20260510120200, then
    -- inherited-dropped by 20260511120000. Three-hop walk via
    -- program_exercises → program_days → programs. Original branch lives
    -- in 20260507100000_program_exercise_sets.sql §4.
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
  'Resolves organization_id for audit log writes. Direct lookup for tables that carry the column; parent walk for nested tables. 2026-05-13: restored program_exercise_sets branch (regression from 20260510120200) and installed assert_audit_resolver_coverage() as a structural guard against this class of regression.';


-- ----------------------------------------------------------------------------
-- §2. assert_audit_resolver_coverage()
--
-- For every table that has at least one audit_<name> trigger attached, call
-- audit_resolve_org_id with a synthetic jsonb row and check that the call
-- does NOT raise "unknown audited table". The synthetic row carries every
-- foreign-key column the resolver might look at — actual values don't
-- matter for the coverage check; the resolver is STABLE and we're not
-- looking at its return value, only at whether it threw the unknown-table
-- exception.
--
-- Any table that doesn't have a matching CASE branch surfaces in the
-- 'missing' array and the function raises with the full list. Both the §3
-- self-check DO block and the §4 event trigger call this function — single
-- source of truth.
--
-- SECURITY DEFINER so the function can read pg_trigger / pg_class even
-- when called from an unprivileged session (the pgTAP test runs as
-- 'postgres' but the event trigger context is implicit superuser anyway).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_audit_resolver_coverage()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_table_name text;
  v_synthetic  jsonb := jsonb_build_object(
    'id',                  '00000000-0000-0000-0000-000000000001',
    'organization_id',     '00000000-0000-0000-0000-000000000001',
    'program_id',          '00000000-0000-0000-0000-000000000001',
    'program_day_id',      '00000000-0000-0000-0000-000000000001',
    'program_exercise_id', '00000000-0000-0000-0000-000000000001',
    'session_id',          '00000000-0000-0000-0000-000000000001',
    'exercise_log_id',     '00000000-0000-0000-0000-000000000001',
    'appointment_id',      '00000000-0000-0000-0000-000000000001',
    'report_id',           '00000000-0000-0000-0000-000000000001',
    'exercise_id',         '00000000-0000-0000-0000-000000000001'
  );
  v_missing text[] := ARRAY[]::text[];
  v_err_msg text;
BEGIN
  FOR v_table_name IN
    SELECT DISTINCT c.relname::text
      FROM pg_trigger t
      JOIN pg_class c     ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE NOT t.tgisinternal
       AND t.tgname LIKE 'audit_%'
       AND n.nspname = 'public'
     ORDER BY c.relname
  LOOP
    BEGIN
      PERFORM public.audit_resolve_org_id(v_table_name, v_synthetic);
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
      -- Only the "unknown audited table" exception indicates missing
      -- coverage. Any other error (e.g. a typo in a parent-walk query
      -- producing an undefined_column) is a different bug; let it
      -- propagate so the author sees it.
      IF v_err_msg LIKE 'audit_resolve_org_id: unknown audited table%' THEN
        v_missing := array_append(v_missing, v_table_name);
      ELSE
        RAISE;
      END IF;
    END;
  END LOOP;

  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      'audit_resolve_org_id coverage gap — % table(s) have an audit_<name> trigger but no matching CASE branch in the resolver: [%]. Fix: add the missing WHEN branch(es) to audit_resolve_org_id().',
      array_length(v_missing, 1),
      array_to_string(v_missing, ', ');
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assert_audit_resolver_coverage() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.assert_audit_resolver_coverage() TO postgres;

COMMENT ON FUNCTION public.assert_audit_resolver_coverage() IS
  'Coverage assertion: for every table with an audit_<name> trigger, verify audit_resolve_org_id has a matching CASE branch. RAISEs with the full list of un-covered tables if any are missing. Called by (a) the migration that defines it, (b) the event trigger guard_audit_resolver_coverage if hosted Postgres allows it, (c) the pgTAP test 14_audit_resolve_org_id_coverage.sql.';


-- ----------------------------------------------------------------------------
-- §3. Self-check against the function body we just installed.
--
-- If §1 missed any other branch (defense in depth — the diagnosis was that
-- program_exercise_sets is the only gap, but if Phase H or any in-flight
-- work added a new audit trigger that I didn't catch, this fails-loud now,
-- not at user-click time).
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM public.assert_audit_resolver_coverage();
  RAISE NOTICE 'audit_resolve_org_id coverage check passed at migration time.';
END $$;


-- ----------------------------------------------------------------------------
-- §4. Event trigger guard — automatic coverage check on future CREATE/ALTER
-- of audit_resolve_org_id.
--
-- Filter inside the trigger function rather than at trigger declaration:
-- ddl_command_end fires for every CREATE/ALTER FUNCTION, but the inner
-- pg_event_trigger_ddl_commands() walk skips the check unless the affected
-- function is audit_resolve_org_id specifically. Negligible cost when
-- migrations touch other functions.
--
-- Hosted Supabase typically permits CREATE EVENT TRIGGER from the postgres
-- role, but this is one of the more frequently-tweaked hosting policies.
-- The DO-block wrapper catches the two error codes that signal "your role
-- can't do this" (insufficient_privilege, feature_not_supported) and
-- degrades gracefully — the migration succeeds, the guard is unavailable,
-- and the RAISE NOTICE makes the fallback explicit. Manual discipline
-- (the pgTAP test) is then the backstop.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_resolver_coverage_event_guard()
RETURNS event_trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_obj record;
  v_touches_resolver boolean := false;
BEGIN
  FOR v_obj IN SELECT * FROM pg_event_trigger_ddl_commands() LOOP
    IF v_obj.object_type = 'function'
       AND v_obj.object_identity = 'public.audit_resolve_org_id(text,jsonb)'
    THEN
      v_touches_resolver := true;
      EXIT;
    END IF;
  END LOOP;

  IF v_touches_resolver THEN
    PERFORM public.assert_audit_resolver_coverage();
  END IF;
END;
$$;

COMMENT ON FUNCTION public.audit_resolver_coverage_event_guard() IS
  'Event-trigger callback: when ddl_command_end fires for CREATE/ALTER FUNCTION public.audit_resolve_org_id, runs assert_audit_resolver_coverage() so the DDL transaction aborts if any audit-triggered table is missing from the CASE list.';

DO $$
BEGIN
  DROP EVENT TRIGGER IF EXISTS guard_audit_resolver_coverage;
  CREATE EVENT TRIGGER guard_audit_resolver_coverage
    ON ddl_command_end
    WHEN TAG IN ('CREATE FUNCTION', 'ALTER FUNCTION')
    EXECUTE FUNCTION public.audit_resolver_coverage_event_guard();
  RAISE NOTICE
    'Event trigger guard_audit_resolver_coverage installed. Future CREATE OR REPLACE on audit_resolve_org_id will be coverage-checked automatically — the migration will abort if any audit-triggered table is missing a CASE branch.';
EXCEPTION
  WHEN insufficient_privilege OR feature_not_supported THEN
    RAISE NOTICE
      'Event trigger NOT installed (hosted Postgres blocks the role). Fallback in effect: every future migration that touches audit_resolve_org_id must end with `SELECT public.assert_audit_resolver_coverage();` or it can ship a coverage regression. The pgTAP test at supabase/tests/database/14_audit_resolve_org_id_coverage.sql is the backstop.';
END $$;
