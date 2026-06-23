-- ============================================================================
-- 20260623130000_soft_delete_program_template
-- ============================================================================
-- Why: LPT-1 of the Library Programs-tab pass
-- (docs/polish/library-program-templates.md, FM-1). The Programs tab gets a
-- delete action; a direct UPDATE setting deleted_at fails 42501 against the
-- deleted_at-IS-NULL SELECT policy (project_postgrest_soft_delete_rls). This
-- adds the SECURITY DEFINER soft-delete RPC, mirroring the library trio
-- (20260505100000_soft_delete_library_rpcs.sql) exactly.
--
-- Children stay: the template_weeks → template_days → template_exercises →
-- template_exercise_sets tree is left intact; the template row's deleted_at
-- hides the whole tree from the list + the program/new picker, both of which
-- already filter program_templates.deleted_at IS NULL.
--
-- FK safety: programs.template_id → program_templates(id) ON DELETE SET NULL.
-- Soft-delete only sets deleted_at, so programs instantiated from the template
-- keep their template_id (pointing at the now-soft-deleted row) — provenance
-- survives and nothing is orphaned (a hard DELETE would null it; we never
-- hard-delete here).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.soft_delete_program_template(p_id uuid)
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

  UPDATE program_templates
     SET deleted_at = now()
   WHERE id = p_id
     AND organization_id = caller_org
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'program_template % not found in your organization, or already deleted', p_id
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.soft_delete_program_template(uuid) IS
  'Soft-delete a program template. Bypasses the deleted_at-IS-NULL SELECT-policy trap via SECURITY DEFINER. Children (weeks/days/exercises/sets) are left intact — the template row''s deleted_at hides the whole tree from the list + program/new picker. programs.template_id (ON DELETE SET NULL) keeps pointing at the soft-deleted row, so instantiated programs are unaffected. LPT-1, Library Programs-tab pass 2026-06-23.';

REVOKE EXECUTE ON FUNCTION public.soft_delete_program_template(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.soft_delete_program_template(uuid) TO authenticated;
