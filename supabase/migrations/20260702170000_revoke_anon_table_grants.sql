-- ============================================================================
-- 20260702170000_revoke_anon_table_grants
-- ============================================================================
-- Why: go-live-checklist §4b. Tenant tables kept the Supabase DEFAULT
-- table-level grant for anon (live-probed 2026-07-02: anon held 473 grants
-- across 68 tables/views in public — full DML, arwdDxtm). anon was denied
-- only by RLS (zero policies target anon), so a single RLS regression was
-- all that stood between anon and the row. This migration makes anon denied
-- at BOTH layers, closing the standing liability before identifiable client
-- health data enters the project.
--
-- Verified safe before writing (2026-07-02 recon):
--   * Zero RLS policies target anon (pg_policies live probe) — no table is
--     meant to be anon-readable.
--   * Every pre-auth surface reaches tables through SECURITY DEFINER
--     functions (consume_recovery_ticket, rate_limit_*, calendar_feed_events)
--     or the service-role client (the /i/[token] invite gate, /api/health) —
--     none resolve table access through anon's own grants.
--   * Realtime delivery is gated by the SUBSCRIBER's role (authenticated);
--     the app never opens an anon-token socket.
--
-- Scope notes:
--   * Sequences included — same liability class, zero legitimate anon use
--     (uuid PKs throughout; anon's default rwU would even allow setval).
--   * DELIBERATE EXTENSION, flagged: the postgres-role DEFAULT PRIVILEGES
--     for anon in public are revoked too (tables, sequences, AND functions).
--     The functions entry is the root cause of the §4 anon-EXECUTE trap that
--     five polish sections fought family-by-family — every new function was
--     born anon-executable. From this migration on, objects created by
--     migrations are born WITHOUT anon grants; a future pre-auth surface
--     (like calendar_feed_events) must say GRANT ... TO anon explicitly,
--     which is the correct, reviewable posture. authenticated defaults are
--     untouched (caller-facing RPCs rely on them). supabase_admin's default
--     ACL cannot be altered from the postgres role (not a member) — objects
--     it creates in public are rare and the pgTAP tripwire below catches any.
--   * EXISTING function grants are untouched (the §4 sweep already fixed
--     them); calendar_feed_events keeps its deliberate anon EXECUTE.
--
-- Behavioural consequence, encoded in tests: anon DML on tenant tables now
-- raises 42501 (permission denied) instead of matching zero rows through
-- RLS. pgTAP 46 assertion 2 is updated accordingly (its header pre-wrote
-- this exact contingency); pgTAP 54_anon_table_grants.sql is the new
-- dynamic tripwire (any future table/sequence/default-ACL regression fails
-- the suite).
-- ============================================================================

-- Existing tables + views in public.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

-- Existing sequences in public.
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- Future objects created by the postgres role (i.e. every migration):
-- born without anon grants from now on.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;
