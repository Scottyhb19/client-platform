-- ============================================================================
-- Phase E.1 — soft_delete_program_day RPC.
--
-- The EP can delete a programmed day from the calendar's day popover (the
-- bin icon, replacing the redundant close-X). This soft-deletes the day
-- AND cascades to its program_exercises so they're not left orphaned in
-- the database queryable through other paths.
--
-- Pattern: SECURITY DEFINER + manual org gate. The program_days SELECT
-- policy filters `deleted_at IS NULL`, which trips the WITH CHECK clause
-- on UPDATE under SECURITY INVOKER (documented soft-delete + RLS gotcha;
-- same pattern as the rest of the soft_delete_* RPC family in
-- 20260429120000_soft_delete_rpcs.sql and 20260429130000).
--
-- Org check: post-D-PROG-001, program_days carries program_id directly,
-- so the parent walk is a single hop (no program_weeks join required).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.soft_delete_program_day(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org  uuid := public.user_organization_id();
  caller_role text := public.user_role();
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Cascade: soft-delete every program_exercise on this day first.
  -- Keeps the database consistent (no exercises pointing at a deleted day)
  -- and avoids surprises if the day is later restored — exercises will
  -- need explicit restore too, but that's an explicit decision then.
  UPDATE program_exercises pe
     SET deleted_at = now()
   WHERE pe.program_day_id = p_id
     AND pe.deleted_at IS NULL
     AND EXISTS (
       SELECT 1
         FROM program_days pd
         JOIN programs p ON p.id = pd.program_id
        WHERE pd.id = pe.program_day_id
          AND p.organization_id = caller_org
          AND p.deleted_at IS NULL
     );

  -- Now the day itself.
  UPDATE program_days pd
     SET deleted_at = now()
   WHERE pd.id = p_id
     AND pd.deleted_at IS NULL
     AND EXISTS (
       SELECT 1
         FROM programs p
        WHERE p.id = pd.program_id
          AND p.organization_id = caller_org
          AND p.deleted_at IS NULL
     );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'program_day % not found in your organization, or already removed', p_id
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.soft_delete_program_day(uuid) IS
  'Soft-delete a program_day (the EP "delete session" action from the calendar popover). Cascades to program_exercises on that day. Walks via program_days.program_id (post-D-PROG-001 single-hop) to verify the row belongs to the caller''s org.';

REVOKE EXECUTE ON FUNCTION public.soft_delete_program_day(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.soft_delete_program_day(uuid) TO authenticated;
