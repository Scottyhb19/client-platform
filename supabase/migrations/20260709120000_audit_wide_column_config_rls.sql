-- ============================================================================
-- 20260709120000_audit_wide_column_config_rls
-- ============================================================================
-- Health-check P0-3 (docs/health-check-2026-07-09.md, Area 2).
--
-- audit_wide_column_config is the ONLY table in public with RLS disabled, and a
-- live grant probe (2026-07-09) showed `authenticated` holds full INSERT/UPDATE/
-- DELETE on it via PostgREST. It is a global (non-tenant) config table that
-- governs which columns the audit machinery truncates in audit_log snapshots, so
-- a hostile authenticated write is an audit-INTEGRITY tamper vector (add a
-- (table,column) pair -> future snapshots of that column silently truncate).
--
-- Fix (mirrors password_recovery_tickets — RLS on, no policy, deny-all-by-default):
--   1. ENABLE (not FORCE) RLS. NOT forced on purpose: the audit reader chain runs
--      as postgres — log_audit_event is SECURITY DEFINER owned by postgres, and it
--      calls the invoker helpers audit_trim_row / audit_diff_fields within that
--      definer context, so the config read happens as postgres. postgres OWNS this
--      table, and a non-forced RLS policy does not apply to the owner, so the audit
--      truncation keeps working. FORCE would subject the owner to RLS and break it.
--   2. REVOKE the API-role table grants (defense-in-depth, the §4b grant-layer
--      posture): authenticated had full DML (the finding); anon was already stripped
--      by 20260702170000 (the revoke below is a harmless no-op guard). service_role
--      (server-only, trusted) and postgres (owner: migrations + definer reads) keep
--      access. No app code reads this table (verified: only the generated type in
--      src/types/database.ts references the name; no runtime query).
--
-- ASSUMPTION (surfaced in docs/polish/audit-wide-column-config-rls.md §4, to
-- confirm before apply): the only legitimate writer is migrations, the only reader
-- is the audit trigger chain (as postgres). If this table is ever meant to become
-- settings-editable at runtime, deny-all is the wrong shape and this needs an
-- owner/authenticated-scoped policy instead.
-- ============================================================================

ALTER TABLE public.audit_wide_column_config ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.audit_wide_column_config FROM authenticated;
REVOKE ALL ON public.audit_wide_column_config FROM anon;  -- no-op guard (already zero since 20260702170000)

COMMENT ON TABLE public.audit_wide_column_config IS
  'Global config: which (table,column) pairs the audit machinery truncates in audit_log snapshots. Written only by migrations (postgres); read only by the audit trigger chain (log_audit_event SECURITY DEFINER as postgres -> audit_trim_row, which bypasses non-forced RLS as the owner). RLS ENABLED with NO policy = deny-all for API roles (deny-by-default, same shape as password_recovery_tickets); authenticated/anon hold no grants. This is NOT a forgotten policy. Health-check P0-3, 2026-07-09.';

-- ============================================================================
-- REVERSAL (do NOT run unless intentionally restoring the pre-fix state):
--   ALTER TABLE public.audit_wide_column_config DISABLE ROW LEVEL SECURITY;
--   GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_wide_column_config TO authenticated;
-- ============================================================================
