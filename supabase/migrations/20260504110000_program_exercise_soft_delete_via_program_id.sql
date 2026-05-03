-- ============================================================================
-- 20260504110000_program_exercise_soft_delete_via_program_id
-- ============================================================================
-- Why: Phase F.7 — close the latent post-D-PROG-001 footgun in the
-- soft_delete_program_exercise / restore_program_exercise RPCs.
--
-- Both originally walked program_days → program_weeks → programs to
-- verify the row's org. After D-PROG-001 made program_week_id nullable,
-- exercises on copy/repeat-created days (program_week_id = NULL) cannot
-- be soft-deleted through that walk — the JOIN drops the row and the
-- RPC raises no_data_found from the EP's perspective.
--
-- Pre-launch impact: zero (no real data has gone through the new flows
-- yet), but the user-visible bug would surface the moment the EP tries
-- to delete an exercise from a copied day. Fixed proactively.
--
-- Pattern matches soft_delete_program_day (migration 20260503140000):
-- single-hop walk via the direct pd.program_id FK that D-PROG-001 added.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.soft_delete_program_exercise(p_id uuid)
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

  UPDATE program_exercises pe
     SET deleted_at = now()
   WHERE pe.id = p_id
     AND pe.deleted_at IS NULL
     AND EXISTS (
       SELECT 1
         FROM program_days pd
         JOIN programs     p  ON p.id = pd.program_id
        WHERE pd.id = pe.program_day_id
          AND p.organization_id = caller_org
          AND p.deleted_at IS NULL
     );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'program_exercise % not found in your organization, or already removed', p_id
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.soft_delete_program_exercise(uuid) IS
  'Soft-delete a program_exercise. Post-D-PROG-001 single-hop walk via pd.program_id (program_week_id is nullable on copy/repeat-created days). Replaces the original 3-table walk that broke for orphan-week days.';


CREATE OR REPLACE FUNCTION public.restore_program_exercise(p_id uuid)
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

  UPDATE program_exercises pe
     SET deleted_at = NULL
   WHERE pe.id = p_id
     AND pe.deleted_at IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM program_days pd
         JOIN programs     p  ON p.id = pd.program_id
        WHERE pd.id = pe.program_day_id
          AND p.organization_id = caller_org
          AND p.deleted_at IS NULL
     );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'program_exercise % not found in your organization, or not removed', p_id
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.restore_program_exercise(uuid) IS
  'Restore a soft-deleted program_exercise. Post-D-PROG-001 single-hop walk via pd.program_id; mirrors soft_delete_program_exercise.';
