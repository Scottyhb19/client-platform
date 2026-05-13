-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), is(), throws_ok(), lives_ok() resolve
-- unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 14_audit_resolve_org_id_coverage
-- ============================================================================
-- Why: Regression test for the two-incident pattern documented in migration
-- 20260513150000_audit_resolver_coverage_guard.sql.
--
-- audit_resolve_org_id is a monolithic CASE statement rewritten in full by
-- every migration that touches it. Two separate migrations have silently
-- dropped branches:
--
--   - 20260505100100_audit_register_library (six branches affected)
--   - 20260510120200_audit_resolve_org_id_restore_nested
--     (program_exercise_sets dropped while fixing the previous regression)
--
-- The first symptom is a user-visible exception at click time:
-- "audit_resolve_org_id: unknown audited table <name>". This test catches
-- the regression at test-run time instead.
--
-- The 20260513150000 migration installs an event trigger that runs the
-- same check automatically on every CREATE/ALTER of the resolver. If
-- hosted Supabase blocks event triggers, this pgTAP test is the only
-- automated guard — run it via `supabase test db` (local Docker) or
-- via psql against the remote pooler URL on every push.
--
-- Test count: 1
-- ============================================================================

BEGIN;

SELECT plan(1);

SELECT lives_ok(
  $$SELECT public.assert_audit_resolver_coverage()$$,
  'audit_resolve_org_id has a CASE branch for every table with an audit_<name> trigger'
);

SELECT * FROM finish();

ROLLBACK;
