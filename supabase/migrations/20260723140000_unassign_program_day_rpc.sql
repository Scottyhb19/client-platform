-- ============================================================================
-- 20260723140000_unassign_program_day_rpc.sql
-- ============================================================================
-- Completed-session edit-lock: the HARD GATE (RPC-only unassign).
--
-- The accepted residual (reviewer 2026-07-22, blocker 1; go-live-checklist §8;
-- polish/db-write-immutability.md §5/§7): unassign (published_at → NULL) was a
-- raw program_days UPDATE and the sanctioned unlock at every layer, so a staff
-- credential could unassign→edit→reassign a completed prescription via raw
-- PostgREST with nothing but the audit log noticing. Its re-trigger was
-- "before any paying clinical client" — closed here by the 2026-07-23 parity
-- pass.
--
--   1. program_write_guard v2 refuses a raw published_at → NULL transition on
--      a day that has a completed live session, UNLESS the transaction-local
--      GUC odyssey.day_unassign = '1'.
--   2. unassign_program_day(uuid) — SECURITY DEFINER, org/role-guarded — is
--      the only path that sets that GUC. The app's Unassign action calls it.
--      Unassigning a NOT-completed day stays a plain UPDATE (no lock exists
--      to bypass; the app routes through the RPC uniformly anyway).
--
-- GUC posture: odyssey.day_unassign joins odyssey.archive_cascade in the
-- single-guard-consults-it class — not settable through PostgREST (no exposed
-- setter; PostgREST namespaces its GUCs under `request.`), tripwired in
-- pgTAP 60, and indexed as the same §8 GUC residual (go-live-checklist).
--
-- Deploy-skew note: between this migration landing and the frontend deploy,
-- the OLD frontend's raw unassign of a COMPLETED day fails with the guard's
-- message (a clear refusal, not corruption); non-completed days are
-- unaffected. Window is minutes; accepted.
--
-- program_write_guard body is based on its LATEST definition (20260721120000)
-- per the function-rewrite rule; the only change is block (c).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.program_write_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_day_ids    uuid[];
  v_client_ids uuid[];
  v_locked     uuid;
BEGIN
  IF session_user = 'postgres'
     AND COALESCE(current_setting('odyssey.test_enforce_guards', true), '') <> '1' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_TABLE_NAME = 'program_days' THEN
    IF TG_OP = 'INSERT' THEN
      SELECT array_agg(DISTINCT p.client_id) INTO v_client_ids
        FROM programs p WHERE p.id = NEW.program_id;
    ELSIF TG_OP = 'UPDATE' THEN
      SELECT array_agg(DISTINCT p.client_id) INTO v_client_ids
        FROM programs p WHERE p.id IN (NEW.program_id, OLD.program_id);
    ELSE
      SELECT array_agg(DISTINCT p.client_id) INTO v_client_ids
        FROM programs p WHERE p.id = OLD.program_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'program_exercises' THEN
    IF TG_OP = 'INSERT' THEN
      v_day_ids := ARRAY[NEW.program_day_id];
    ELSIF TG_OP = 'UPDATE' THEN
      v_day_ids := ARRAY[NEW.program_day_id, OLD.program_day_id];
    ELSE
      v_day_ids := ARRAY[OLD.program_day_id];
    END IF;
  ELSIF TG_TABLE_NAME = 'program_exercise_sets' THEN
    IF TG_OP = 'INSERT' THEN
      SELECT array_agg(pe.program_day_id) INTO v_day_ids
        FROM program_exercises pe WHERE pe.id = NEW.program_exercise_id;
    ELSIF TG_OP = 'UPDATE' THEN
      SELECT array_agg(DISTINCT pe.program_day_id) INTO v_day_ids
        FROM program_exercises pe
       WHERE pe.id IN (NEW.program_exercise_id, OLD.program_exercise_id);
    ELSE
      SELECT array_agg(pe.program_day_id) INTO v_day_ids
        FROM program_exercises pe WHERE pe.id = OLD.program_exercise_id;
    END IF;
  END IF;

  IF v_day_ids IS NOT NULL THEN
    SELECT array_agg(DISTINCT p.client_id) INTO v_client_ids
      FROM program_days pd
      JOIN programs p ON p.id = pd.program_id
     WHERE pd.id = ANY(v_day_ids);
  END IF;

  -- (a) archived-client refusal — identical semantics to §1.
  IF EXISTS (
    SELECT 1 FROM clients c
     WHERE c.id = ANY(v_client_ids)
       AND c.deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'This client is archived — their record is read-only. Restore the client to make changes.'
      USING ERRCODE = 'P0001',
            HINT = 'write_immutability: archived client (CN-7 DB guard)';
  END IF;

  -- (b) completed-and-assigned lock. Mirrors the day page exactly:
  -- locked = completed live session on the day AND day still assigned
  -- (published_at IS NOT NULL). Checked for every affected day (an UPDATE
  -- moving a row between days is an edit of both).
  IF TG_TABLE_NAME IN ('program_exercises', 'program_exercise_sets')
     AND v_day_ids IS NOT NULL THEN
    SELECT pd.id INTO v_locked
      FROM program_days pd
     WHERE pd.id = ANY(v_day_ids)
       AND pd.published_at IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM sessions s
          WHERE s.program_day_id = pd.id
            AND s.completed_at IS NOT NULL
            AND s.deleted_at IS NULL
       )
     LIMIT 1;
    IF v_locked IS NOT NULL THEN
      RAISE EXCEPTION 'This session is completed and still assigned — unassign it to edit the prescription.'
        USING ERRCODE = 'P0001',
              HINT = 'write_immutability: completed-and-assigned session lock';
    END IF;
  END IF;

  -- (c) RPC-only unassign hard gate (2026-07-23): a raw API write may not
  -- unassign (published_at → NULL) a day that has a completed live session —
  -- that unlock now goes through unassign_program_day(), the only setter of
  -- the transaction-local odyssey.day_unassign GUC. Unassigning a day with
  -- no completed session remains a plain UPDATE (nothing is locked).
  -- NESTED IF on purpose: OLD.published_at only exists on program_days rows,
  -- and SQL AND does not guarantee short-circuit — a single flat expression
  -- here blew up program_exercise_sets UPDATEs ("record has no field") on
  -- the first staging run. Statement-level branching guarantees the field
  -- access is never evaluated for the other two tables.
  IF TG_TABLE_NAME = 'program_days' AND TG_OP = 'UPDATE' THEN
    IF OLD.published_at IS NOT NULL AND NEW.published_at IS NULL
       AND COALESCE(current_setting('odyssey.day_unassign', true), '') <> '1'
       AND EXISTS (
         SELECT 1 FROM sessions s
          WHERE s.program_day_id = OLD.id
            AND s.completed_at IS NOT NULL
            AND s.deleted_at IS NULL
       ) THEN
      RAISE EXCEPTION 'Completed sessions are unassigned through the app — use the Unassign action.'
        USING ERRCODE = 'P0001',
              HINT = 'write_immutability: RPC-only unassign (completed-session hard gate)';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.program_write_guard() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- The sanctioned unlock. Same guard/idiom family as soft_delete_client /
-- restore_client: in-body org+role guard, SECURITY DEFINER, pinned
-- search_path, transaction-local GUC consumed by exactly one guard branch.
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.unassign_program_day(p_day_id uuid)
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

  PERFORM 1
    FROM program_days pd
    JOIN programs p ON p.id = pd.program_id
   WHERE pd.id = p_day_id
     AND p.organization_id = caller_org
     AND pd.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'program day % not found in your organization', p_day_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- The one sanctioned path past guard branch (c). Transaction-local.
  PERFORM set_config('odyssey.day_unassign', '1', true);

  -- Idempotent: unassigning an already-unassigned day matches 0 rows.
  -- The archived-client branch (a) still applies inside this RPC — an
  -- archived client's day cannot be unassigned without restoring first.
  UPDATE program_days
     SET published_at = NULL
   WHERE id = p_day_id;
END;
$$;

COMMENT ON FUNCTION public.unassign_program_day(uuid) IS
  'The sanctioned unassign (published_at → NULL) for program days. Sets the transaction-local odyssey.day_unassign GUC that program_write_guard branch (c) requires when the day has a completed live session — raw API unassign of a completed session is refused (RPC-only hard gate, 2026-07-23). Org/role-guarded in-body; archived-client immutability still applies.';

REVOKE EXECUTE ON FUNCTION public.unassign_program_day(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unassign_program_day(uuid) TO authenticated;
