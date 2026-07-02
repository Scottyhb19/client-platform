-- ============================================================================
-- 20260702130000_revoke_anon_execute_onboarding_and_audit_internals
-- ============================================================================
-- Why: discharges the final "candidate, owner-gated" bucket of the §4
-- SECURITY DEFINER anon-EXECUTE sweep (docs/go-live-checklist.md §4, the
-- 2026-06-23 platform-wide enumeration). All of these hold a direct anon
-- EXECUTE grant at runtime from the Supabase default-privilege trap
-- (live-probed 2026-07-02) despite REVOKE ... FROM PUBLIC in source.
--
-- The pre-auth-use verification the sweep required is now done (2026-07-02):
--
--   * client_accept_invite(uuid) — THE tracked item since section 2. Its
--     sole runtime caller is setPasswordAndAcceptAction
--     (src/app/welcome/actions.ts), which runs AFTER the magic-link callback
--     has established a session: it calls auth.getUser() and updateUser()
--     (both session-requiring) before the RPC. Every other repo reference is
--     a comment. The RPC's own body also raises 'Not authenticated' when
--     auth.uid() is null. It is never called pre-authentication -> anon
--     revoke is safe; authenticated retained (the welcome flow's role).
--   * create_organization_with_owner(...) — sole caller is
--     createOrganization (src/app/onboarding/org/actions.ts), behind the
--     auth middleware plus its own getUser() check. Post-auth only.
--   * staff_create_client_invite(...) — no runtime caller remains (the
--     invite flow moved to the admin generateLink path in
--     src/lib/clients/invite.ts). Authenticated retained anyway per the
--     checklist's authenticated-only-candidate framing; anon revoked.
--
-- Audit-infra internals go definer-only (the _clone_program posture). All
-- audit functions are owned by postgres (hosted Supabase blocked the
-- audit_writer ownership transfer — see 20260420102300), so log_audit_event
-- (SECURITY DEFINER) executes its inner calls as postgres: revoking the API
-- roles cannot break the trigger path, and pgTAP 14 / migration guards run
-- as postgres too.
--
--   * audit_resolve_org_id(text, jsonb)      — named candidate.
--   * assert_audit_resolver_coverage()       — named candidate.
--   * audit_trim_row(text, jsonb)            — same-family extension: not in
--   * audit_diff_fields(jsonb, jsonb)          the 2026-06-23 enumeration
--     only because that sweep enumerated SECURITY DEFINER functions and
--     these two are plain internal helpers; the probe shows the same anon
--     grant, and they have no caller outside log_audit_event.
--
-- log_audit_event() itself is left untouched per the checklist ("inert" —
-- trigger return type; EXECUTE on trigger functions is checked at CREATE
-- TRIGGER time, not fire time).
--
-- Grants-only migration: no function bodies change, no RLS touched.
-- pgTAP 52_onboarding_audit_rpc_grants.sql is the regression tripwire.
-- ============================================================================

-- Caller-facing onboarding/invite RPCs: anon out, authenticated stays.
REVOKE EXECUTE ON FUNCTION public.client_accept_invite(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_organization_with_owner(text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.staff_create_client_invite(text, text, text, date, text, text, uuid) FROM anon;

-- Audit-infra internals: definer-only (no API role reaches them; postgres
-- owns and calls them).
REVOKE EXECUTE ON FUNCTION public.audit_resolve_org_id(text, jsonb)  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assert_audit_resolver_coverage()   FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_trim_row(text, jsonb)        FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_diff_fields(jsonb, jsonb)    FROM anon, authenticated;

-- Belt-and-braces: prove the audit resolver still covers every audited table
-- after this migration (the 20260513160000 fallback rule targets body
-- changes, which a REVOKE is not — but the check is free and fails loud).
SELECT public.assert_audit_resolver_coverage();
