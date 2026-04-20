-- ============================================================================
-- 20260420100000_extensions_and_roles
-- ============================================================================
-- Why: the schema depends on pgcrypto (gen_random_uuid) and pg_trgm (fuzzy
-- search indexes). The audit_writer role owns audit-log trigger functions so
-- audit writes cannot be forged by normal database roles. The auth_hooks
-- schema hosts the JWT custom claim hook, separate from Supabase's `auth`
-- schema and our `public` schema to signal its privileged nature.
-- ============================================================================

-- UUID generation. Postgres 15+ has gen_random_uuid() when pgcrypto is
-- loaded. Loading explicitly keeps this portable if base image changes.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Trigram indexes for fuzzy search on exercise names, client names, and
-- clinical note SOAP fields. See /docs/schema.md §9.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Dedicated role owning audit-log trigger functions. Triggers run
-- SECURITY DEFINER as this role so audit writes bypass RLS without granting
-- ambient INSERT on audit_log to the service role.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'audit_writer') THEN
    CREATE ROLE audit_writer NOLOGIN;
  END IF;
END $$;

-- Schema hosting the JWT custom claim hook. See migration
-- 20260420100300_auth_helpers_and_jwt_hook.sql.
CREATE SCHEMA IF NOT EXISTS auth_hooks;
