-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), ok() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 38_soft_delete_restore_grants
-- ============================================================================
-- Why: platform-wide anon-EXECUTE sweep (docs/go-live-checklist.md §4). Locks
-- the EXECUTE-grant posture for the staff-only soft-delete / restore RPC
-- family (test / client / clinical / library tables) after the revoke
-- migration 20260623180000. The Supabase auto-grant trap means any future
-- CREATE OR REPLACE on these functions can silently re-grant anon — this test
-- is the tripwire. Companion to 23_program_rpc_grants (program engine),
-- 25_portal_rpc_grants (portal), 26_scheduling_rpc_grants (scheduling), and
-- 36_program_template_soft_delete §A6 (program_template).
--
--   §A anon holds EXECUTE on NOTHING in the family (19 functions).
--   §B caller-facing grants survive: authenticated must KEEP EXECUTE — the
--      staff app archives/restores as a logged-in owner/staff member; a
--      blanket revoke that stripped authenticated would pass §A while breaking
--      the archive/restore actions, not securing them.
--
-- Scope note: the program-engine soft_delete/restore twins (test 23), the
-- scheduling availability/unavailable soft-deletes (test 26), and
-- soft_delete_program_template (test 36 §A6) are owned by those tests and are
-- deliberately NOT duplicated here. restore_client_publication (swept by
-- 20260612140000) had no grants tripwire of its own — it is adopted here as
-- the restore family's orphan member (#14).
--
-- No fixtures, no JWT spoof — pure catalog checks as the test owner.
-- Test count: 38
-- ============================================================================

BEGIN;

SELECT plan(38);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;

-- ----------------------------------------------------------------------------
-- §A — anon must hold EXECUTE on nothing in the family.
-- ----------------------------------------------------------------------------
WITH family(ord, sig) AS (
  VALUES
    (1,  'public.soft_delete_client(uuid)'),
    (2,  'public.soft_delete_client_medical_history(uuid)'),
    (3,  'public.soft_delete_client_publication(uuid)'),
    (4,  'public.soft_delete_clinical_note(uuid)'),
    (5,  'public.soft_delete_exercise(uuid)'),
    (6,  'public.soft_delete_exercise_tag(uuid)'),
    (7,  'public.soft_delete_movement_pattern(uuid)'),
    (8,  'public.soft_delete_practice_custom_test(uuid)'),
    (9,  'public.soft_delete_test_battery(uuid)'),
    (10, 'public.soft_delete_test_result(uuid)'),
    (11, 'public.soft_delete_test_session(uuid)'),
    (12, 'public.restore_client(uuid)'),
    (13, 'public.restore_client_medical_history(uuid)'),
    (14, 'public.restore_client_publication(uuid)'),
    (15, 'public.restore_clinical_note(uuid)'),
    (16, 'public.restore_practice_custom_test(uuid)'),
    (17, 'public.restore_test_battery(uuid)'),
    (18, 'public.restore_test_result(uuid)'),
    (19, 'public.restore_test_session(uuid)')
)
INSERT INTO _tap (n, line)
SELECT ord, ok(
  NOT has_function_privilege('anon', sig, 'EXECUTE'),
  format('A%s: anon cannot execute %s', ord, sig)
)
FROM family;

-- ----------------------------------------------------------------------------
-- §B — caller-facing grants survive: authenticated must KEEP EXECUTE on each.
-- ----------------------------------------------------------------------------
WITH family(ord, sig) AS (
  VALUES
    (20, 'public.soft_delete_client(uuid)'),
    (21, 'public.soft_delete_client_medical_history(uuid)'),
    (22, 'public.soft_delete_client_publication(uuid)'),
    (23, 'public.soft_delete_clinical_note(uuid)'),
    (24, 'public.soft_delete_exercise(uuid)'),
    (25, 'public.soft_delete_exercise_tag(uuid)'),
    (26, 'public.soft_delete_movement_pattern(uuid)'),
    (27, 'public.soft_delete_practice_custom_test(uuid)'),
    (28, 'public.soft_delete_test_battery(uuid)'),
    (29, 'public.soft_delete_test_result(uuid)'),
    (30, 'public.soft_delete_test_session(uuid)'),
    (31, 'public.restore_client(uuid)'),
    (32, 'public.restore_client_medical_history(uuid)'),
    (33, 'public.restore_client_publication(uuid)'),
    (34, 'public.restore_clinical_note(uuid)'),
    (35, 'public.restore_practice_custom_test(uuid)'),
    (36, 'public.restore_test_battery(uuid)'),
    (37, 'public.restore_test_result(uuid)'),
    (38, 'public.restore_test_session(uuid)')
)
INSERT INTO _tap (n, line)
SELECT ord, ok(
  has_function_privilege('authenticated', sig, 'EXECUTE'),
  format('B%s: authenticated keeps EXECUTE on %s', ord - 19, sig)
)
FROM family;

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
