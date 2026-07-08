-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), ok(), is(), throws_ok() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 58_audit_wide_column_config_rls
-- ============================================================================
-- Locks migration 20260709120000 — the health-check P0-3 fix. audit_wide_column_config
-- had RLS off and full authenticated DML grants (an audit-integrity tamper vector).
-- Test 54 covers the ANON table-grant posture platform-wide; this suite is the
-- missing tripwire for the AUTHENTICATED write path on this specific table.
--
-- Assertions (8):
--   1. LOAD-BEARING — RLS is ENABLED on audit_wide_column_config.
--   2. RLS is NOT forced (the owner/definer audit read must keep bypassing it).
--   3. authenticated holds no INSERT grant.
--   4. authenticated holds no UPDATE grant.
--   5. authenticated holds no DELETE grant.
--   6. functional — an authenticated-role INSERT raises 42501 (grant-layer denial).
--   7. control — the config data is intact and readable by the owner (count > 0).
--   8. control — service_role keeps INSERT (the revoke was API-user-only, not a
--      lockout of the trusted server-side role).
--
-- No fixtures. BEGIN/ROLLBACK for live-run safety; finish() intentionally dropped
-- (same as 15/16/17/54).
-- ============================================================================

BEGIN;

SELECT plan(8);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated;

-- Test 1 (LOAD-BEARING): RLS enabled on the table.
INSERT INTO _tap (n, line) VALUES (1, (
  SELECT string_agg(l, E'\n') FROM ok(
    (SELECT c.relrowsecurity FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'audit_wide_column_config'),
    'LOAD-BEARING (P0-3): RLS is enabled on audit_wide_column_config'
  ) AS l
));

-- Test 2: RLS not forced (owner/definer audit read must keep bypassing).
INSERT INTO _tap (n, line) VALUES (2, (
  SELECT string_agg(l, E'\n') FROM ok(
    NOT (SELECT c.relforcerowsecurity FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'audit_wide_column_config'),
    'RLS is NOT forced — the postgres-owned audit definer chain still bypasses'
  ) AS l
));

-- Tests 3-5: authenticated holds no write grants.
INSERT INTO _tap (n, line) VALUES (3, (
  SELECT string_agg(l, E'\n') FROM ok(
    NOT has_table_privilege('authenticated', 'public.audit_wide_column_config', 'INSERT'),
    'authenticated holds no INSERT on audit_wide_column_config'
  ) AS l
));
INSERT INTO _tap (n, line) VALUES (4, (
  SELECT string_agg(l, E'\n') FROM ok(
    NOT has_table_privilege('authenticated', 'public.audit_wide_column_config', 'UPDATE'),
    'authenticated holds no UPDATE on audit_wide_column_config'
  ) AS l
));
INSERT INTO _tap (n, line) VALUES (5, (
  SELECT string_agg(l, E'\n') FROM ok(
    NOT has_table_privilege('authenticated', 'public.audit_wide_column_config', 'DELETE'),
    'authenticated holds no DELETE on audit_wide_column_config'
  ) AS l
));

-- Test 6 (functional): an authenticated-role INSERT is denied at the grant layer
-- (42501). throws_ok runs its SQL under the current role, so drop to authenticated
-- first (the test-54 idiom). _tap is granted to authenticated above so the result
-- row can be written under the switched role.
SET LOCAL ROLE authenticated;

INSERT INTO _tap (n, line) VALUES (6, (
  SELECT string_agg(l, E'\n') FROM throws_ok(
    $$INSERT INTO public.audit_wide_column_config (table_name, column_name) VALUES ('clients','notes')$$,
    '42501',
    NULL,
    'functional: authenticated INSERT raises 42501 (grant-layer denial)'
  ) AS l
));

RESET ROLE;

-- Test 7 (control): the config data is intact and readable by the owner (the
-- pgTAP session runs as postgres = table owner = the audit definer's effective
-- user), proving enabling RLS did not orphan the truncation config.
INSERT INTO _tap (n, line) VALUES (7, (
  SELECT string_agg(l, E'\n') FROM ok(
    (SELECT count(*) FROM public.audit_wide_column_config) > 0,
    'control: config rows intact + readable by the owner (audit read path unbroken)'
  ) AS l
));

-- Test 8 (control): service_role keeps write — the revoke was API-user-only.
INSERT INTO _tap (n, line) VALUES (8, (
  SELECT string_agg(l, E'\n') FROM ok(
    has_table_privilege('service_role', 'public.audit_wide_column_config', 'INSERT'),
    'control: service_role keeps INSERT (trusted server-side role untouched)'
  ) AS l
));

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
