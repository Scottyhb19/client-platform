-- ============================================================================
-- 20260624120000_circuit_editor_rpcs
-- ============================================================================
-- Why: #3 of the Library Circuits workbench
-- (docs/polish/library-circuits-sessions.md) — the dedicated in-Library circuit
-- editor (author from scratch + edit add/remove exercises). The editor's
-- remove-exercise and remove-set paths need SECURITY DEFINER soft-deletes: a
-- direct UPDATE setting deleted_at fails 42501 against the deleted_at-IS-NULL
-- SELECT policy (project_postgrest_soft_delete_rls). Everything else the editor
-- does (create circuit, add exercise + fan-out sets, edit/add a set, rename /
-- retype) is a plain RLS-guarded write — no RPC, done in server actions.
--
-- Both mirror soft_delete_circuit (20260624110000): org/role guarded via the
-- parent walk, anon EXECUTE revoked AT CREATION + authenticated granted. pgTAP
-- 40 is the tripwire.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- soft_delete_circuit_exercise — remove an exercise from a circuit (editor).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.soft_delete_circuit_exercise(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_org  uuid := public.user_organization_id();
  v_caller_role text := public.user_role();
BEGIN
  IF v_caller_org IS NULL OR v_caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  UPDATE circuit_exercises ce
     SET deleted_at = now()
   WHERE ce.id = p_id
     AND ce.deleted_at IS NULL
     AND EXISTS (
       SELECT 1 FROM circuits c
        WHERE c.id = ce.circuit_id
          AND c.organization_id = v_caller_org
          AND c.deleted_at IS NULL
     );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'circuit_exercise % not found in your organization, or already deleted', p_id
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.soft_delete_circuit_exercise(uuid) IS
  'Editor: remove an exercise from a circuit (soft-delete via parent-org walk). #3 circuit workbench.';

REVOKE EXECUTE ON FUNCTION public.soft_delete_circuit_exercise(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.soft_delete_circuit_exercise(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- soft_delete_circuit_exercise_set — remove one set from a circuit exercise.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.soft_delete_circuit_exercise_set(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_org  uuid := public.user_organization_id();
  v_caller_role text := public.user_role();
BEGIN
  IF v_caller_org IS NULL OR v_caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  UPDATE circuit_exercise_sets ces
     SET deleted_at = now()
   WHERE ces.id = p_id
     AND ces.deleted_at IS NULL
     AND EXISTS (
       SELECT 1 FROM circuit_exercises ce
         JOIN circuits c ON c.id = ce.circuit_id
        WHERE ce.id = ces.circuit_exercise_id
          AND c.organization_id = v_caller_org
          AND c.deleted_at IS NULL
     );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'circuit_exercise_set % not found in your organization, or already deleted', p_id
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.soft_delete_circuit_exercise_set(uuid) IS
  'Editor: remove one set from a circuit exercise (soft-delete via parent-org walk). #3 circuit workbench.';

REVOKE EXECUTE ON FUNCTION public.soft_delete_circuit_exercise_set(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.soft_delete_circuit_exercise_set(uuid) TO authenticated;
