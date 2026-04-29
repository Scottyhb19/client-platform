-- ============================================================================
-- 20260429120000_soft_delete_rpcs
-- ============================================================================
-- Why: Closes the production half of the soft-delete-via-UPDATE bug
-- documented in memory/project_postgrest_soft_delete_rls.md. The bug:
--
--   On every tenant table whose SELECT RLS USING clause filters
--   `deleted_at IS NULL` (i.e. the project's standard pattern), running
--
--     UPDATE <table> SET deleted_at = now() WHERE id = ...
--
--   fails with `42501: new row violates row-level security policy`.
--
-- Cause: PostgreSQL's UPDATE re-evaluates the SELECT policy on the
-- post-UPDATE row to verify it is still visible. After SET deleted_at =
-- now(), the row no longer satisfies `deleted_at IS NULL`, so the SELECT
-- policy rejects it; the UPDATE policy's WITH CHECK clause never gets to
-- weigh in. This fires for every authenticated path — supabase-js,
-- direct SQL, even pgTAP under SET LOCAL ROLE authenticated. It is NOT
-- specific to PostgREST's RETURNING.
--
-- Fix: a narrow SECURITY DEFINER RPC per affected table. The function
-- runs as its owner (postgres), bypassing RLS for the UPDATE itself; the
-- function body re-implements the org+role check using the JWT helpers
-- so the security model is unchanged. This is the same pattern the
-- existing testing-module helpers in 20260428150000 use.
--
-- Constraints (per the brief that landed this migration):
--   - One RPC per table. No generic `soft_delete(table, id)` — string-
--     substituted SQL is an injection risk and bypasses the RLS posture
--     external review will expect.
--   - Auth check is the FIRST statement in every body. No "trust the
--     policy" assumption — these functions ARE the security boundary.
--   - Fixed table, fixed column set, no SQL composition. The function
--     body does exactly one statement of mutation against exactly one
--     row.
--   - The SELECT policy `deleted_at IS NULL` filter stays untouched —
--     it is load-bearing for the visibility model (hides soft-deleted
--     sessions from the client portal).
--   - FORCE ROW LEVEL SECURITY stays on for production. The NO-FORCE
--     toggle in pgTAP test 03 stays inside that test only.
--
-- External-review note: this migration is healthcare-software security
-- surface (Privacy Act 1988). The Open Gates in CLAUDE.md require
-- external IT-advisor review of auth.md and rls-policies.md before
-- production launch. These RPCs are part of that surface. Reviewer
-- attention recommended on:
--   1. The org+role check replicates each table's UPDATE RLS USING
--      clause exactly (cross-checked against
--      20260428120800_testing_module_rls.sql,
--      20260420102600_rls_enable_and_policies.sql, and
--      20260427110000_note_defaults_and_author_lock.sql).
--   2. clinical_notes RPCs additionally enforce author-only — the
--      practice owner has no override, mirroring the
--      "author updates own clinical_notes" policy.
--   3. SECURITY DEFINER + SET search_path = public, pg_temp on every
--      function (no schema-shadowing attack surface).
--   4. REVOKE FROM PUBLIC + GRANT TO authenticated on every function
--      (so the anon role cannot call them).
--   5. Audit triggers on test_sessions / test_results /
--      client_publications still fire — the RPCs UPDATE the tables
--      directly, not via service-role, so AFTER UPDATE triggers run.
--
-- Affected tables this migration covers (audited list):
--   - test_sessions
--   - test_results
--   - client_publications
--   - clinical_notes               (author-locked)
--   - practice_custom_tests
--   - test_batteries
--
-- Out of scope, flagged separately:
--   - clients           — uses service-role workaround in actions.ts;
--                         archive semantics include archived_at, needs
--                         its own RPC pair.
--   - program_exercises — broken in actions.ts but no current incident;
--                         same bug class, separate follow-up.
--
-- See:
--   - memory/project_postgrest_soft_delete_rls.md — the bug note.
--   - docs/rls-policies.md §5 — the soft-delete-via-UPDATE design intent.
--   - supabase/migrations/20260428150000_fix_testing_rls_recursion.sql —
--     the existing SECURITY DEFINER helper pattern this migration follows.
-- ============================================================================


-- ============================================================================
-- §1. test_sessions
--
-- Soft-delete and restore. Restore re-claims baseline if applicable;
-- pgTAP test 03 (baseline_immutability) is the canonical assertion.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.soft_delete_test_session(p_id uuid)
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

  UPDATE test_sessions
     SET deleted_at = now()
   WHERE id = p_id
     AND organization_id = caller_org
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'test_session % not found in your organization, or already deleted', p_id
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.soft_delete_test_session(uuid) IS
  'Set deleted_at = now() on a test_session in the caller''s org. Bypasses the deleted_at-IS-NULL SELECT-policy trap via SECURITY DEFINER. Auth: org match + role IN (owner,staff) checked inside.';

REVOKE EXECUTE ON FUNCTION public.soft_delete_test_session(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.soft_delete_test_session(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.restore_test_session(p_id uuid)
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

  UPDATE test_sessions
     SET deleted_at = NULL
   WHERE id = p_id
     AND organization_id = caller_org
     AND deleted_at IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'test_session % not found in your organization, or not deleted', p_id
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.restore_test_session(uuid) IS
  'Clear deleted_at on a previously soft-deleted test_session in the caller''s org. Same SECURITY DEFINER + auth check pattern as soft_delete_test_session.';

REVOKE EXECUTE ON FUNCTION public.restore_test_session(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.restore_test_session(uuid) TO authenticated;


-- ============================================================================
-- §2. test_results
--
-- The field-lockdown trigger test_results_lock_immutable_fields_trg
-- permits ONLY deleted_at to change on UPDATE. SECURITY DEFINER does not
-- bypass triggers — the trigger sees only deleted_at differing and
-- accepts. This RPC pair therefore reuses the same restorable-amendment
-- semantics described in 20260428120300_test_results.sql.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.soft_delete_test_result(p_id uuid)
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

  UPDATE test_results
     SET deleted_at = now()
   WHERE id = p_id
     AND organization_id = caller_org
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'test_result % not found in your organization, or already deleted', p_id
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.soft_delete_test_result(uuid) IS
  'Soft-delete a single test_result row. The field-lockdown trigger sees only deleted_at change and accepts. Used to "amend" a wrong reading via soft-delete + re-insert.';

REVOKE EXECUTE ON FUNCTION public.soft_delete_test_result(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.soft_delete_test_result(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.restore_test_result(p_id uuid)
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

  UPDATE test_results
     SET deleted_at = NULL
   WHERE id = p_id
     AND organization_id = caller_org
     AND deleted_at IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'test_result % not found in your organization, or not deleted', p_id
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.restore_test_result(uuid) IS
  'Clear deleted_at on a previously soft-deleted test_result. The lockdown trigger accepts the deleted_at-only change.';

REVOKE EXECUTE ON FUNCTION public.restore_test_result(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.restore_test_result(uuid) TO authenticated;


-- ============================================================================
-- §3. client_publications
--
-- soft_delete = unpublish. The unique-active index
-- client_publications_session_unique_active ON (test_session_id) WHERE
-- deleted_at IS NULL guarantees at most one live publication per
-- session, so soft-delete is unambiguous.
--
-- restore is the inverse. If a NEW publication has been issued for the
-- same session since this one was unpublished, restore would violate
-- the unique-active index — Postgres raises 23505 (unique_violation).
-- The RPC surfaces a clearer error in that case.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.soft_delete_client_publication(p_id uuid)
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

  UPDATE client_publications
     SET deleted_at = now()
   WHERE id = p_id
     AND organization_id = caller_org
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'client_publication % not found in your organization, or already unpublished', p_id
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.soft_delete_client_publication(uuid) IS
  'Unpublish a client_publication: set deleted_at = now(). The session disappears from the client portal''s published list immediately.';

REVOKE EXECUTE ON FUNCTION public.soft_delete_client_publication(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.soft_delete_client_publication(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.restore_client_publication(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org  uuid := public.user_organization_id();
  caller_role text := public.user_role();
  target_session uuid;
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Look up the row first so we can give a clear "already a live pub"
  -- error before the unique-active index would raise an opaque 23505.
  SELECT test_session_id INTO target_session
    FROM client_publications
   WHERE id = p_id
     AND organization_id = caller_org
     AND deleted_at IS NOT NULL;

  IF target_session IS NULL THEN
    RAISE EXCEPTION 'client_publication % not found in your organization, or not unpublished', p_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM client_publications
     WHERE test_session_id = target_session
       AND organization_id = caller_org
       AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION
      'cannot restore: a different live publication already exists for that session — unpublish it first or leave the new one in place'
      USING ERRCODE = 'unique_violation';
  END IF;

  UPDATE client_publications
     SET deleted_at = NULL
   WHERE id = p_id
     AND organization_id = caller_org;
END;
$$;

COMMENT ON FUNCTION public.restore_client_publication(uuid) IS
  'Re-activate a previously unpublished client_publication. Refuses if another live publication exists for the same session — explicit error rather than a 23505 from the unique-active index.';

REVOKE EXECUTE ON FUNCTION public.restore_client_publication(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.restore_client_publication(uuid) TO authenticated;


-- ============================================================================
-- §4. clinical_notes — author-locked
--
-- The "author updates own clinical_notes" policy
-- (20260427110000_note_defaults_and_author_lock.sql) restricts UPDATE
-- to the row's author_user_id = auth.uid(). Practice owner has no
-- override — clinical-record integrity is the explicit reason. The
-- soft-delete and restore RPCs replicate that gate inside.
--
-- The current production code (notes-actions.ts archiveClinicalNoteAction)
-- routes through the service-role client to dodge the soft-delete-RLS
-- trap and re-implements the author check in TypeScript. Switching to
-- the RPC keeps the check inside the database — one fewer place to
-- get the gate wrong.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.soft_delete_clinical_note(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org  uuid := public.user_organization_id();
  caller_role text := public.user_role();
  caller_uid  uuid := auth.uid();
  row_author  uuid;
BEGIN
  IF caller_org IS NULL OR caller_uid IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Look up the row so we can distinguish "not found" from "not author".
  SELECT author_user_id INTO row_author
    FROM clinical_notes
   WHERE id = p_id
     AND organization_id = caller_org
     AND deleted_at IS NULL;

  IF row_author IS NULL THEN
    RAISE EXCEPTION 'clinical_note % not found in your organization, or already archived', p_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF row_author <> caller_uid THEN
    RAISE EXCEPTION 'Only the practitioner who wrote this note can archive it'
      USING ERRCODE = '42501';
  END IF;

  UPDATE clinical_notes
     SET deleted_at = now()
   WHERE id = p_id
     AND organization_id = caller_org
     AND author_user_id = caller_uid
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    -- Should be unreachable given the look-up above, but defensive:
    -- a concurrent archive between the SELECT and UPDATE would land here.
    RAISE EXCEPTION 'clinical_note % could not be archived (concurrent change)', p_id
      USING ERRCODE = 'serialization_failure';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.soft_delete_clinical_note(uuid) IS
  'Archive a clinical_note. Author-locked: only the practitioner who wrote the note may archive it. Practice owner has no override.';

REVOKE EXECUTE ON FUNCTION public.soft_delete_clinical_note(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.soft_delete_clinical_note(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.restore_clinical_note(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org  uuid := public.user_organization_id();
  caller_role text := public.user_role();
  caller_uid  uuid := auth.uid();
  row_author  uuid;
BEGIN
  IF caller_org IS NULL OR caller_uid IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT author_user_id INTO row_author
    FROM clinical_notes
   WHERE id = p_id
     AND organization_id = caller_org
     AND deleted_at IS NOT NULL;

  IF row_author IS NULL THEN
    RAISE EXCEPTION 'clinical_note % not found in your organization, or not archived', p_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF row_author <> caller_uid THEN
    RAISE EXCEPTION 'Only the practitioner who wrote this note can restore it'
      USING ERRCODE = '42501';
  END IF;

  UPDATE clinical_notes
     SET deleted_at = NULL
   WHERE id = p_id
     AND organization_id = caller_org
     AND author_user_id = caller_uid;
END;
$$;

COMMENT ON FUNCTION public.restore_clinical_note(uuid) IS
  'Un-archive a clinical_note. Author-locked, mirroring soft_delete_clinical_note.';

REVOKE EXECUTE ON FUNCTION public.restore_clinical_note(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.restore_clinical_note(uuid) TO authenticated;


-- ============================================================================
-- §5. practice_custom_tests
--
-- Settings table — NOT audited via triggers (per
-- 20260428120900_audit_register_testing_module.sql), application logs
-- cover. The unique index practice_custom_tests_org_test_unique on
-- (organization_id, test_id) WHERE deleted_at IS NULL means restore
-- raises 23505 if a different active row claims the same test_id since.
-- The RPC surfaces a clearer message.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.soft_delete_practice_custom_test(p_id uuid)
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

  UPDATE practice_custom_tests
     SET deleted_at = now()
   WHERE id = p_id
     AND organization_id = caller_org
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'practice_custom_test % not found in your organization, or already deleted', p_id
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.soft_delete_practice_custom_test(uuid) IS
  'Soft-delete an EP-defined custom test. Past test_results referencing the custom test_id remain queryable; only the editable definition is hidden.';

REVOKE EXECUTE ON FUNCTION public.soft_delete_practice_custom_test(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.soft_delete_practice_custom_test(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.restore_practice_custom_test(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org  uuid := public.user_organization_id();
  caller_role text := public.user_role();
  target_test_id text;
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT test_id INTO target_test_id
    FROM practice_custom_tests
   WHERE id = p_id
     AND organization_id = caller_org
     AND deleted_at IS NOT NULL;

  IF target_test_id IS NULL THEN
    RAISE EXCEPTION 'practice_custom_test % not found in your organization, or not deleted', p_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM practice_custom_tests
     WHERE organization_id = caller_org
       AND test_id = target_test_id
       AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION
      'cannot restore: another active custom test already uses test_id %', target_test_id
      USING ERRCODE = 'unique_violation';
  END IF;

  UPDATE practice_custom_tests
     SET deleted_at = NULL
   WHERE id = p_id
     AND organization_id = caller_org;
END;
$$;

COMMENT ON FUNCTION public.restore_practice_custom_test(uuid) IS
  'Restore a soft-deleted custom test. Refuses if another live row claims the same test_id — explicit error rather than 23505 from the unique-active index.';

REVOKE EXECUTE ON FUNCTION public.restore_practice_custom_test(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.restore_practice_custom_test(uuid) TO authenticated;


-- ============================================================================
-- §6. test_batteries
--
-- Settings table — same audit posture as practice_custom_tests. The
-- unique-active index test_batteries_org_name_unique on
-- (organization_id, lower(name)) WHERE deleted_at IS NULL means restore
-- collides if a same-named battery has been created since.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.soft_delete_test_battery(p_id uuid)
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

  UPDATE test_batteries
     SET deleted_at = now()
   WHERE id = p_id
     AND organization_id = caller_org
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'test_battery % not found in your organization, or already deleted', p_id
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.soft_delete_test_battery(uuid) IS
  'Soft-delete a saved test battery. Distinct from is_active — soft-delete removes from the picker permanently; is_active = false pauses without losing.';

REVOKE EXECUTE ON FUNCTION public.soft_delete_test_battery(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.soft_delete_test_battery(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.restore_test_battery(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org  uuid := public.user_organization_id();
  caller_role text := public.user_role();
  target_name text;
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT name INTO target_name
    FROM test_batteries
   WHERE id = p_id
     AND organization_id = caller_org
     AND deleted_at IS NOT NULL;

  IF target_name IS NULL THEN
    RAISE EXCEPTION 'test_battery % not found in your organization, or not deleted', p_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM test_batteries
     WHERE organization_id = caller_org
       AND lower(name) = lower(target_name)
       AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION
      'cannot restore: another active battery already uses the name %', target_name
      USING ERRCODE = 'unique_violation';
  END IF;

  UPDATE test_batteries
     SET deleted_at = NULL
   WHERE id = p_id
     AND organization_id = caller_org;
END;
$$;

COMMENT ON FUNCTION public.restore_test_battery(uuid) IS
  'Restore a soft-deleted test battery. Refuses if another live battery already uses the same name.';

REVOKE EXECUTE ON FUNCTION public.restore_test_battery(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.restore_test_battery(uuid) TO authenticated;
