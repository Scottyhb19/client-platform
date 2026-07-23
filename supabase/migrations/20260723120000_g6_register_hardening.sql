-- ============================================================================
-- 20260723120000_g6_register_hardening.sql
-- ============================================================================
-- Closes three items from the G-6 deferred register (auth-onboarding-staff.md
-- "Sign-off — G-6", indexed in go-live-checklist.md §8), pulled forward as
-- part of the 2026-07-23 paying-client parity pass:
--
--   F-4  TRUNCATE blind spot — a row-level trigger cannot fire on TRUNCATE,
--        and service_role retained TRUNCATE via Supabase default privileges,
--        so the only control preventing audit-log erasure by service_role was
--        that PostgREST exposes no TRUNCATE verb. Revoked here so the
--        append-only property no longer depends on the API surface's verb
--        list. postgres (owner) retains TRUNCATE for retention maintenance.
--
--   F-2b per-IP login-failure threshold was NOT computable — auth_events had
--        no client-IP column and no emitter captured an IP. `client_ip`
--        (inet, nullable) is added here; capture happens in
--        src/lib/auth/events.ts (x-forwarded-for first hop, best-effort —
--        NULL when no request scope exists). The §11 ">50 login failures/
--        hour/IP" threshold becomes computable from this point forward;
--        rows predating this migration have NULL and are honestly outside
--        the per-IP window.
--
--   F-1  org-attribution snapshot — organization_id is ON DELETE SET NULL so
--        audit rows survive org teardown, but teardown is the event most
--        worth attributing. `organization_id_snapshot` (bare uuid, no FK) is
--        stamped at insert and survives teardown.
--
-- No RLS change, no new API-role grant. pgTAP 61 extended (assertions 9–11).
-- ============================================================================

REVOKE TRUNCATE ON TABLE public.auth_events FROM service_role;

ALTER TABLE public.auth_events
  ADD COLUMN client_ip inet NULL,
  ADD COLUMN organization_id_snapshot uuid NULL;

COMMENT ON COLUMN public.auth_events.client_ip IS
  'Requesting client IP (x-forwarded-for first hop), captured best-effort by logAuthEvent. NULL when no request scope existed (scripts, pre-capture rows). Added 20260723120000 (G-6 register F-2b) — makes the auth.md §11 per-IP login-failure threshold computable.';

COMMENT ON COLUMN public.auth_events.organization_id_snapshot IS
  'Denormalised copy of organization_id stamped at insert (no FK). Survives org teardown, which ON DELETE SET NULL on organization_id deliberately does not. Added 20260723120000 (G-6 register F-1).';
