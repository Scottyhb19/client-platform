-- ============================================================================
-- 20260623160000_revoke_anon_client_log_set
-- ============================================================================
-- Why: grant-posture regression introduced by the VU-2 migration
-- (20260623110000), caught by a full re-run of pgTAP 25 during the
-- prescription-volume-unit reviewer follow-up.
--
-- That migration DROP+CREATEd client_log_set to add the trailing p_rep_metric
-- param (10-arg → 11-arg). The Supabase default-EXECUTE-grant trap re-granted
-- anon EXECUTE on the NEW function (project memory:
-- project_supabase_default_execute_grants — "every new public function
-- auto-grants EXECUTE to anon/authenticated/service_role; REVOKE FROM PUBLIC ≠
-- authenticated-only"). The migration's REVOKE … FROM PUBLIC did not remove
-- the DIRECT anon grant, so anon held EXECUTE on the new client_log_set —
-- violating the section-7 anon-EXECUTE-on-nothing posture that pgTAP 25 (§A)
-- is the tripwire for. (No breach: client_log_set is SECURITY DEFINER with an
-- in-body `auth.uid() IS NULL → Not authenticated` guard, so anon gets nothing;
-- but the grant must still be revoked — defence in depth, and the tripwire.)
--
-- Fix: revoke the direct anon grant on the 11-arg signature. authenticated's
-- grant (re-issued in 20260623110000) is untouched.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.client_log_set(
  uuid, uuid, smallint, numeric, text, smallint, text, text, smallint, text, text
) FROM anon;
