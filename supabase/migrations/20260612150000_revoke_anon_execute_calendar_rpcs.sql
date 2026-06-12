-- ============================================================================
-- 20260612150000_revoke_anon_execute_calendar_rpcs
-- ============================================================================
-- Why: P0-1 of the program-calendar polish pass (docs/polish/program-calendar.md,
-- FM-2). A live-database probe (2026-06-12) confirmed the program-engine /
-- calendar RPC family created BEFORE 20260612130000 still carries the
-- Supabase auto-grant: anon holds EXECUTE on every function below. Same trap
-- as 20260612130000 — `REVOKE … FROM PUBLIC` in the source migrations never
-- removed anon's DIRECT grant.
--
-- Severity split (mirrors 20260612130000):
--   - Ten caller-facing functions all carry the in-body org/role guard
--     (caller_org/caller_role NULL for anon ⇒ RAISE 42501), so the lingering
--     anon grant is defence-in-depth surface only.
--   - `_program_for_date` is the real edge: an INTERNAL helper with NO guard,
--     reachable unauthenticated via PostgREST RPC. Read-only (returns the
--     active program uuid covering a date for a client), but it discloses
--     program existence to anyone holding the anon key plus a client uuid.
--     Its only callers are SECURITY DEFINER parents (copy_program_day,
--     repeat_program_day_weekly, create_program_day, duplicate_program_day)
--     which invoke it as the definer — no API role needs EXECUTE at all.
--     Verified 2026-06-12: no supabase-js caller in src/ references it.
--
-- Scope: exactly the calendar/program-engine family predating 20260612130000,
-- enumerated from the live grant probe. The platform-wide sweep over all
-- remaining anon-executable functions stays the tracked go-live item in
-- docs/go-live-checklist.md (notably the _test_* pgTAP fixture helpers,
-- recorded there 2026-06-12).
--
-- No signature changes, no body changes — grants only.
-- pgTAP: tests/database/23_program_rpc_grants.sql locks the posture in.
-- ============================================================================

-- Caller-facing, in-body-guarded: drop the anon grant (authenticated stays —
-- the app calls these as a logged-in staff member).
REVOKE EXECUTE ON FUNCTION public.copy_program(uuid, date, text)                 FROM anon;
REVOKE EXECUTE ON FUNCTION public.repeat_program(uuid)                           FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_program_day(uuid, date)                 FROM anon;
REVOKE EXECUTE ON FUNCTION public.duplicate_program_day(uuid, date)              FROM anon;
REVOKE EXECUTE ON FUNCTION public.soft_delete_program_day(uuid)                  FROM anon;
REVOKE EXECUTE ON FUNCTION public.soft_delete_program_exercise(uuid)             FROM anon;
REVOKE EXECUTE ON FUNCTION public.restore_program_exercise(uuid)                 FROM anon;
REVOKE EXECUTE ON FUNCTION public.soft_delete_program_exercise_set(uuid)         FROM anon;
REVOKE EXECUTE ON FUNCTION public.reorder_program_exercises(uuid, uuid[], uuid)  FROM anon;
REVOKE EXECUTE ON FUNCTION public.swap_program_exercise(uuid, uuid)              FROM anon;

-- Internal guardless helper: no API role should hold EXECUTE. Definer-only,
-- mirroring the _clone_program treatment in 20260612130000.
REVOKE EXECUTE ON FUNCTION public._program_for_date(uuid, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public._program_for_date(uuid, date) FROM authenticated;
