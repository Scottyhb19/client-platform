-- ============================================================================
-- 20260614130000_revoke_anon_execute_portal_rpcs
-- ============================================================================
-- Section 7 (Client portal PWA) — P0-2 (FM-2). Anon-EXECUTE sweep of the
-- client-portal RPC family. Mirrors the program-engine / calendar sweeps
-- (20260612130000 / 20260612150000) one surface up.
--
-- WHY. Every public function auto-grants EXECUTE to anon on creation (project
-- memory `project_supabase_default_execute_grants`), and the grant re-trips
-- on every CREATE OR REPLACE. A live grant-probe on 2026-06-14 confirmed the
-- whole client_* family was anon-executable. These functions are the security
-- boundary for the client portal; the in-body auth.uid() pins already refuse
-- an anon caller (auth.uid() is NULL), so this revoke is defence-in-depth
-- hardening, not a hole being plugged — but anon should hold EXECUTE on none
-- of them regardless. pgTAP `25_portal_rpc_grants` is the regression tripwire.
--
-- SCOPE — the section-7 portal family only (signatures from the live probe):
--   client_start_session, client_log_set, client_complete_session,
--   client_get_week_overview, client_get_program_day_exercises,
--   client_get_published_reports, client_owns_test_session,
--   client_list_program_days.
-- (client_reschedule_program_day_to_today was already anon-revoked in the v3
-- migration 20260614120000.) All eight are called only by an authenticated
-- client from the portal, so REVOKE FROM anon cannot break a legitimate path;
-- authenticated keeps its grant (untouched here, asserted by the test §B).
--
-- DELIBERATELY OUT OF SCOPE — flagged to the operator + go-live-checklist,
-- NOT revoked here (each is owned by another, separately-gated section, and
-- one needs its auth context verified before any revoke):
--   client_accept_invite(uuid)              — §2 onboarding. VERIFY whether it
--      is ever called pre-authentication before revoking anon (could break
--      the invite-accept flow). Do not revoke blind.
--   client_available_slots, client_book_appointment, client_cancel_appointment
--                                           — §9 scheduling (booking).
--   client_cascade_thread_archive()         — §10 messaging (no-arg; looks
--      like a trigger/internal helper — confirm it is not caller-facing).
-- These remain part of the platform-wide SECURITY DEFINER anon-EXECUTE sweep
-- indexed in docs/go-live-checklist.md.
--
-- No signature or body changes — grants only. No type regen needed.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.client_start_session(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.client_log_set(
  uuid, uuid, smallint, numeric, text, smallint, text, text, smallint, text
) FROM anon;
REVOKE EXECUTE ON FUNCTION public.client_complete_session(uuid, smallint, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.client_get_week_overview(date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.client_get_program_day_exercises(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.client_get_published_reports() FROM anon;
REVOKE EXECUTE ON FUNCTION public.client_owns_test_session(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.client_list_program_days(uuid) FROM anon;
