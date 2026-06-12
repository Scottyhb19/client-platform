-- ============================================================================
-- 20260612130000_revoke_anon_execute_program_engine_rpcs
-- ============================================================================
-- Why: the section-5 acceptance verification (docs/Prompts/section5-verification.sql,
-- check 6) found that the `anon` (logged-out) role retains EXECUTE on every
-- function this pass created or replaced. This is the Supabase auto-grant
-- trap recorded in project memory: a new/replaced public function is
-- auto-granted EXECUTE to anon/authenticated/service_role DIRECTLY, and the
-- `REVOKE EXECUTE … FROM PUBLIC` lines in the source migrations remove only
-- the PUBLIC grant — anon's direct grant survives. (CREATE OR REPLACE can
-- also re-trip the auto-grant, so the REVOKE FROM PUBLIC in those files was
-- never sufficient for anon-safety on its own.)
--
-- Severity split:
--   - The five caller-facing functions all carry an in-body guard
--     (caller_org/caller_role from user_organization_id()/user_role(), which
--     are NULL for anon ⇒ RAISE 42501), so an anon call is rejected. The
--     lingering anon GRANT is defence-in-depth surface, the same condition
--     the deferred go-live "SECURITY DEFINER anon-EXECUTE grant sweep"
--     (docs/go-live-checklist.md) exists to clear across the whole schema.
--   - `_clone_program` is the real edge: it is an INTERNAL helper with NO
--     role guard (it trusts its inputs; copy_program / repeat_program gate
--     org/role before calling it). With a direct anon grant it is reachable
--     unauthenticated via PostgREST RPC. It needs no API-role grant at all —
--     its only callers are SECURITY DEFINER parents that invoke it as the
--     definer (postgres/owner), who always has EXECUTE.
--
-- Fix: explicitly REVOKE EXECUTE FROM anon on all six; additionally REVOKE
-- FROM authenticated on `_clone_program` so only the definer can call it.
-- This does not break the app — staff calls run as `authenticated`, and the
-- five caller-facing functions keep their authenticated grant. Scope is
-- exactly the functions this pass touched; the broad sweep over older
-- functions remains the tracked go-live item.
--
-- No signature changes, no body changes — grants only.
-- ============================================================================

-- G-1 / G-3 / G-2 caller-facing functions: drop the anon grant (authenticated
-- stays — the app calls these as a logged-in staff member).
REVOKE EXECUTE ON FUNCTION public.copy_program_day(uuid, date, boolean)             FROM anon;
REVOKE EXECUTE ON FUNCTION public.repeat_program_day_weekly(uuid, date, boolean)    FROM anon;
REVOKE EXECUTE ON FUNCTION public.insert_program_exercise_at(uuid, uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.save_program_as_template(uuid, text)              FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_program_from_template(uuid, uuid, date, text) FROM anon;

-- Internal helper: no API role should hold EXECUTE. Definer-only.
REVOKE EXECUTE ON FUNCTION public._clone_program(uuid, date, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public._clone_program(uuid, date, text) FROM authenticated;
