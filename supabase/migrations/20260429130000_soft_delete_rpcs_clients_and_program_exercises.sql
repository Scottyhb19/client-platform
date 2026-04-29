-- ============================================================================
-- 20260429130000_soft_delete_rpcs_clients_and_program_exercises
-- ============================================================================
-- Why: Continuation of 20260429120000_soft_delete_rpcs.sql — extends the
-- SECURITY DEFINER soft-delete + restore RPC pattern to the two
-- remaining tables on the deleted_at-IS-NULL UPDATE trap that were
-- flagged out-of-scope in that migration:
--
--   - clients          — actions.ts archiveClientAction routes through
--                        service-role today to dodge the trap. Replacing
--                        with an RPC removes a service-role bypass and
--                        moves the auth check into the database.
--   - program_exercises — actions.ts removeProgramExerciseAction does a
--                        direct UPDATE that fails 42501 under FORCE RLS
--                        for the authenticated role. (Currently silently
--                        broken; no production data lost only because no
--                        real client has logged in yet — pre-launch
--                        advantage applies.)
--
-- Both follow the same shape as 20260429120000 — narrow function, fixed
-- table, fixed columns, no SQL composition; auth check is the FIRST
-- statement in every body. SECURITY DEFINER bypasses RLS for the UPDATE;
-- the auth check inside replicates each table's UPDATE-policy USING
-- clause exactly.
--
-- Differences from the testing-module set:
--   1. clients carries an archived_at column alongside deleted_at. The
--      existing archiveClientAction sets BOTH to the same now()
--      timestamp; this migration's RPC pair preserves that — soft-delete
--      sets both, restore clears both. archived_at has no foreign
--      semantics to other tables (unlike programs.archived_at which is
--      load-bearing for status='archived'); clearing on restore yields a
--      cleaner row state and the audit log retains the archive event for
--      history.
--   2. program_exercises does NOT carry organization_id directly. RLS
--      walks up program_days → program_weeks → programs to resolve org.
--      The RPC's WHERE clause replicates that walk so a cross-org soft-
--      delete attempt finds no row and returns no_data_found.
--   3. clients has a unique-active index on (organization_id,
--      lower(email)) that releases the email on archive and would
--      surface as 23505 on restore if a different live client now claims
--      that address. The restore RPC catches this case explicitly and
--      raises a clearer message.
--
-- See:
--   - memory/project_postgrest_soft_delete_rls.md — the bug note (now
--     updated to reference both migrations).
--   - supabase/migrations/20260429120000_soft_delete_rpcs.sql — the
--     prior migration this one extends.
--   - src/app/(staff)/clients/[id]/actions.ts — archiveClientAction
--     call site (currently service-role workaround).
--   - src/app/(staff)/clients/[id]/program/days/[dayId]/actions.ts —
--     removeProgramExerciseAction call site (currently broken under
--     FORCE RLS).
-- ============================================================================


-- ============================================================================
-- §1. clients — archive (= soft-delete) and restore
--
-- Two columns mutate together: deleted_at and archived_at. Mirrors the
-- semantics of archiveClientAction (actions.ts:62) which writes both to
-- the same now() timestamp under service-role to dodge the SELECT-policy
-- trap. Routing through this RPC removes the service-role bypass.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.soft_delete_client(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org  uuid := public.user_organization_id();
  caller_role text := public.user_role();
  ts          timestamptz := now();
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  UPDATE clients
     SET deleted_at  = ts,
         archived_at = ts
   WHERE id = p_id
     AND organization_id = caller_org
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'client % not found in your organization, or already archived', p_id
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.soft_delete_client(uuid) IS
  'Archive a client: set deleted_at and archived_at to now(). Releases the (org, lower(email)) unique-active slot so the same email can be re-invited later. Replaces the service-role workaround in archiveClientAction.';

REVOKE EXECUTE ON FUNCTION public.soft_delete_client(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.soft_delete_client(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.restore_client(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org  uuid := public.user_organization_id();
  caller_role text := public.user_role();
  target_email text;
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Look up email so we can detect the conflict before the unique-active
  -- index would raise an opaque 23505. lower(email) matches the index.
  SELECT email INTO target_email
    FROM clients
   WHERE id = p_id
     AND organization_id = caller_org
     AND deleted_at IS NOT NULL;

  IF target_email IS NULL THEN
    RAISE EXCEPTION 'client % not found in your organization, or not archived', p_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM clients
     WHERE organization_id = caller_org
       AND lower(email) = lower(target_email)
       AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION
      'cannot restore: another active client already uses the email %', target_email
      USING ERRCODE = 'unique_violation';
  END IF;

  UPDATE clients
     SET deleted_at  = NULL,
         archived_at = NULL
   WHERE id = p_id
     AND organization_id = caller_org;
END;
$$;

COMMENT ON FUNCTION public.restore_client(uuid) IS
  'Un-archive a client: clear deleted_at and archived_at. Refuses if the email is now claimed by a different live client in the same org — explicit error rather than 23505 from the unique-active index.';

REVOKE EXECUTE ON FUNCTION public.restore_client(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.restore_client(uuid) TO authenticated;


-- ============================================================================
-- §2. program_exercises — remove (= soft-delete) and restore
--
-- program_exercises does not carry organization_id directly. RLS walks
-- up program_days → program_weeks → programs to gate access. The RPC
-- replicates that walk explicitly inside the WHERE clause so cross-org
-- attempts find no row.
--
-- The bump_version + cross-org trigger and the touch_updated_at semantic
-- still fire (SECURITY DEFINER does not bypass triggers), so the
-- prescription's `version` column ticks on remove/restore — same as a
-- staff edit.
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
         JOIN program_weeks pw ON pw.id = pd.program_week_id
         JOIN programs       p  ON p.id = pw.program_id
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
  'Soft-delete a program_exercise (the EP "remove exercise" action). Walks up program_days → program_weeks → programs to verify the row belongs to the caller''s org without storing organization_id on program_exercises directly.';

REVOKE EXECUTE ON FUNCTION public.soft_delete_program_exercise(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.soft_delete_program_exercise(uuid) TO authenticated;


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
         JOIN program_weeks pw ON pw.id = pd.program_week_id
         JOIN programs       p  ON p.id = pw.program_id
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
  'Restore a soft-deleted program_exercise. No unique-active index on the table, so no conflict path; the parent-walk org check is the only gate beyond the auth check.';

REVOKE EXECUTE ON FUNCTION public.restore_program_exercise(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.restore_program_exercise(uuid) TO authenticated;
