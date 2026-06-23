-- ============================================================================
-- 20260623180000_revoke_anon_soft_delete_restore_family
-- ============================================================================
-- Why: platform-wide anon-EXECUTE sweep (docs/go-live-checklist.md §4). The
-- staff-only soft-delete / restore RPC family was created with
-- `REVOKE EXECUTE … FROM PUBLIC` + `GRANT … TO authenticated` but never
-- `REVOKE … FROM anon`. Because each was a NEW function at creation, the
-- Supabase default-EXECUTE-grant trap handed anon a DIRECT EXECUTE that
-- `REVOKE … FROM PUBLIC` does not remove (project memory
-- project_supabase_default_execute_grants — "the auto-grant gives anon a
-- direct grant; REVOKE FROM PUBLIC ≠ authenticated-only").
--
-- Confirmed live before this migration: has_function_privilege('anon', …, 'EXECUTE')
-- = TRUE on all 18 functions below.
--
-- No breach — every function is SECURITY DEFINER with an owner/staff + org
-- guard as its FIRST statement (anon → user_organization_id() returns NULL →
-- 42501 'Unauthorized' before any write). This is the section-7
-- anon-EXECUTE-on-nothing posture (defence in depth); pgTAP 38
-- (38_soft_delete_restore_grants.sql, added alongside) is the tripwire that
-- catches a future CREATE OR REPLACE re-tripping the trap.
--
-- Scope: the test / client / clinical / library soft-delete + restore twins —
-- the family members never caught by a prior section sweep. The program-engine
-- (20260612150000), scheduling (20260615120000), unavailable-block
-- (20260616120000), program_template (20260623170000) and
-- restore_client_publication (20260612140000) members were already revoked by
-- their owning sections and are locked by pgTAP 23 / 26 / 36.
--
-- authenticated's grant is untouched on every function — the staff app calls
-- all of these as a logged-in owner/staff member; a revoke that stripped
-- authenticated would secure nothing and break the archive/restore actions.
-- ============================================================================

-- soft_delete_* (11)
REVOKE EXECUTE ON FUNCTION public.soft_delete_client(uuid)                 FROM anon;
REVOKE EXECUTE ON FUNCTION public.soft_delete_client_medical_history(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.soft_delete_client_publication(uuid)     FROM anon;
REVOKE EXECUTE ON FUNCTION public.soft_delete_clinical_note(uuid)          FROM anon;
REVOKE EXECUTE ON FUNCTION public.soft_delete_exercise(uuid)              FROM anon;
REVOKE EXECUTE ON FUNCTION public.soft_delete_exercise_tag(uuid)          FROM anon;
REVOKE EXECUTE ON FUNCTION public.soft_delete_movement_pattern(uuid)      FROM anon;
REVOKE EXECUTE ON FUNCTION public.soft_delete_practice_custom_test(uuid)  FROM anon;
REVOKE EXECUTE ON FUNCTION public.soft_delete_test_battery(uuid)          FROM anon;
REVOKE EXECUTE ON FUNCTION public.soft_delete_test_result(uuid)           FROM anon;
REVOKE EXECUTE ON FUNCTION public.soft_delete_test_session(uuid)          FROM anon;

-- restore_* (7)
REVOKE EXECUTE ON FUNCTION public.restore_client(uuid)                    FROM anon;
REVOKE EXECUTE ON FUNCTION public.restore_client_medical_history(uuid)    FROM anon;
REVOKE EXECUTE ON FUNCTION public.restore_clinical_note(uuid)             FROM anon;
REVOKE EXECUTE ON FUNCTION public.restore_practice_custom_test(uuid)      FROM anon;
REVOKE EXECUTE ON FUNCTION public.restore_test_battery(uuid)             FROM anon;
REVOKE EXECUTE ON FUNCTION public.restore_test_result(uuid)              FROM anon;
REVOKE EXECUTE ON FUNCTION public.restore_test_session(uuid)             FROM anon;
