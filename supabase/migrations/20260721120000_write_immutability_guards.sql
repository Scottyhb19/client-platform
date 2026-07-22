-- ============================================================================
-- 20260721120000_write_immutability_guards.sql
-- ============================================================================
-- DB-level write immutability (go-live-checklist §8 → pulled forward 2026-07-21;
-- contract: docs/polish/db-write-immutability.md). Two enforcement families:
--
--   1. CN-7 archived-client immutability — closes the three named residuals
--      (raw-PostgREST staff write, schedule force-book, program stale-tab)
--      uniformly: BEFORE INSERT/UPDATE/DELETE guards on the direct client_id
--      tables, the program family (parent-walk), and the clients row itself
--      (UPDATE + DELETE). Predicate = clients.deleted_at IS NOT NULL —
--      identical to the app-layer assertClientLive (archive-guard.ts).
--
--   2. Completed-and-assigned session edit-lock — DB enforcement of the
--      builder's UI-only lock: refuse program_exercises /
--      program_exercise_sets writes when the target row's program_day has
--      published_at IS NOT NULL and a live completed session. Mirrors the
--      day page's `locked` predicate exactly; unassign (published_at → NULL)
--      remains the unlock. NOTE (accepted, reviewer 2026-07-22): unassign is a
--      raw UPDATE on program_days and stays the sanctioned unlock at every
--      layer, so a staff credential can unassign→edit→reassign. That path is
--      audit-logged (audit_program_days) and never touches the performed
--      record (set_logs/sessions). The hard gate (an RPC-only unassign) is
--      deferred to the paying-client tier — docs/polish/db-write-immutability.md
--      §5/§7.
--
-- Exemptions:
--   - session_user = 'postgres' — owner-level maintenance (migrations, pgTAP
--     fixtures, seed/wipe scripts). API traffic always arrives via
--     `authenticator`, so no API role is ever exempt — including
--     service_role (SECURITY DEFINER changes current_user, not session_user).
--   - transaction-local GUC odyssey.archive_cascade = '1' — set ONLY by
--     restore_client (v3 below) and honoured by ONLY clients_row_write_guard,
--     which the un-archive UPDATE (writing an already-archived row) needs. The
--     OTHER guards do NOT consult it: soft_delete_client (v4) cancels its
--     future appointments WHILE THE CLIENT IS STILL LIVE, so those writes pass
--     on the merits, not by exemption. Narrowing the GUC to a single low-impact
--     guard shrinks the single point of trust the whole family used to share
--     (reviewer 2026-07-22). It is not settable through PostgREST (no exposed
--     setter RPC, and PostgREST namespaces its injected GUCs under `request.`);
--     pgTAP 60 tripwires that the family guards ignore a forged value.
--   - odyssey.test_enforce_guards = '1' — pgTAP-only. The test channel connects
--     as session_user = postgres, which the maintenance exemption would exempt;
--     this transaction-local GUC DISABLES the postgres exemption so the suite
--     exercises the real API-path behaviour. Strictness-only — it can make the
--     guards stricter, never looser; it cannot bypass anything. Never set in
--     production paths. Recorded as a deviation in the contract's Approval note.
--
-- The trigger functions are SECURITY DEFINER so their truth lookups
-- (clients.deleted_at, the program parent-walk, the session probe) never
-- depend on the WRITER's RLS view — e.g. an archived client's own session
-- cannot see its own clients row, and must not thereby slip the guard.
-- search_path is `public, pg_temp` on all three — the documented SECURITY
-- DEFINER idiom. Postgres implicitly searches pg_temp FIRST for relation/type
-- names when it is not named in the path; naming it explicitly LAST forces it
-- out of first position so a temp relation cannot shadow the guards' lookups
-- (clients / sessions / program_days). A bare `= public` was tried and REVERTED
-- 2026-07-22 (reviewer): dropping pg_temp re-opened the vector — the pgTAP
-- channel populates pg_temp (pg_temp._try), so a temp relation could silently
-- shadow a guard's lookup and never be seen.
--
-- Error copy reuses the app's user-facing strings (archive-guard.ts /
-- the builder lock) so a raw 400 reads identically to the app's refusal.
-- pgTAP tripwire: supabase/tests/database/60_write_immutability.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §1. client_record_write_guard — direct client_id tables
--     (programs, appointments, clinical_notes, client_medical_history,
--      client_medications). Does NOT consult odyssey.archive_cascade — no
--      definer cascade writes these tables on an archived client
--      (soft_delete_client v4 cancels appointments while the client is live).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.client_record_write_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ids uuid[];
BEGIN
  IF session_user = 'postgres'
     AND COALESCE(current_setting('odyssey.test_enforce_guards', true), '') <> '1' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- NEW is unassigned in DELETE triggers and OLD in INSERT — branch, never
  -- touch the missing record. An UPDATE checks BOTH sides so a row can be
  -- neither moved onto nor off an archived client.
  IF TG_OP = 'INSERT' THEN
    v_ids := ARRAY[NEW.client_id];
  ELSIF TG_OP = 'UPDATE' THEN
    v_ids := ARRAY[NEW.client_id, OLD.client_id];
  ELSE
    v_ids := ARRAY[OLD.client_id];
  END IF;

  -- appointments: client_id NULL = staff-only unavailable block; nothing to guard.
  IF EXISTS (
    SELECT 1 FROM clients c
     WHERE c.id = ANY(v_ids)
       AND c.deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'This client is archived — their record is read-only. Restore the client to make changes.'
      USING ERRCODE = 'P0001',
            HINT = 'write_immutability: archived client (CN-7 DB guard)';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.client_record_write_guard() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- §2. program_write_guard — program_days / program_exercises /
--     program_exercise_sets: archived-client walk + the completed-and-
--     assigned lock (program_exercises + program_exercise_sets only; the
--     day-ROW question is accepted-deferred — contract §5/§7). Does NOT consult
--     odyssey.archive_cascade — no definer cascade writes these tables.
-- ----------------------------------------------------------------------------
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

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.program_write_guard() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- §3. clients_row_write_guard — the clients row itself. UPDATE + DELETE: the
--     archive transition (OLD.deleted_at IS NULL) always passes; edits OR hard
--     deletes of an already-archived row are refused. restore_client passes via
--     the odyssey.archive_cascade GUC (the ONE guard that still consults it).
--     DELETE coverage closes the §4 "DELETE included everywhere" contradiction
--     (reviewer 2026-07-22, blocker 3): a hard-DELETE of an archived clients
--     row is refused BY DESIGN, not merely by collateral child-guard/RLS luck.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clients_row_write_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (session_user = 'postgres'
      AND COALESCE(current_setting('odyssey.test_enforce_guards', true), '') <> '1')
     OR COALESCE(current_setting('odyssey.archive_cascade', true), '') = '1' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'This client is archived — their record is read-only. Restore the client to make changes.'
      USING ERRCODE = 'P0001',
            HINT = 'write_immutability: archived client row (CN-7 DB guard)';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.clients_row_write_guard() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- §4. Triggers. Uniform name so the family is greppable; BEFORE row triggers —
--     a raise aborts the statement before OCC/touch/audit triggers matter.
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS write_immutability_guard ON public.programs;
CREATE TRIGGER write_immutability_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.programs
  FOR EACH ROW EXECUTE FUNCTION public.client_record_write_guard();

DROP TRIGGER IF EXISTS write_immutability_guard ON public.appointments;
CREATE TRIGGER write_immutability_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.client_record_write_guard();

DROP TRIGGER IF EXISTS write_immutability_guard ON public.clinical_notes;
CREATE TRIGGER write_immutability_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.clinical_notes
  FOR EACH ROW EXECUTE FUNCTION public.client_record_write_guard();

DROP TRIGGER IF EXISTS write_immutability_guard ON public.client_medical_history;
CREATE TRIGGER write_immutability_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.client_medical_history
  FOR EACH ROW EXECUTE FUNCTION public.client_record_write_guard();

DROP TRIGGER IF EXISTS write_immutability_guard ON public.client_medications;
CREATE TRIGGER write_immutability_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.client_medications
  FOR EACH ROW EXECUTE FUNCTION public.client_record_write_guard();

DROP TRIGGER IF EXISTS write_immutability_guard ON public.program_days;
CREATE TRIGGER write_immutability_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.program_days
  FOR EACH ROW EXECUTE FUNCTION public.program_write_guard();

DROP TRIGGER IF EXISTS write_immutability_guard ON public.program_exercises;
CREATE TRIGGER write_immutability_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.program_exercises
  FOR EACH ROW EXECUTE FUNCTION public.program_write_guard();

DROP TRIGGER IF EXISTS write_immutability_guard ON public.program_exercise_sets;
CREATE TRIGGER write_immutability_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.program_exercise_sets
  FOR EACH ROW EXECUTE FUNCTION public.program_write_guard();

-- clients: UPDATE + DELETE (see §3). INSERT is unguarded — a brand-new client
-- cannot already be archived.
DROP TRIGGER IF EXISTS write_immutability_guard ON public.clients;
CREATE TRIGGER write_immutability_guard
  BEFORE UPDATE OR DELETE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.clients_row_write_guard();

-- ----------------------------------------------------------------------------
-- §5. soft_delete_client v4 + restore_client v3 — CREATE OR REPLACE, same
--     signatures, no drop (deployed-function rule). Bodies diffed against their
--     last defining migrations before this replace (reviewer 2026-07-22):
--       - soft_delete_client: 20260702190000 (the actual latest) — reordered
--         here so it needs no exemption GUC (see below).
--       - restore_client:     20260429130000 (bare fn; 20260623180000 was
--         REVOKE-only, not a body change) — unchanged except the GUC line.
-- ----------------------------------------------------------------------------

-- v4: reordered vs 20260702190000. Old order archived the client FIRST, then
-- cancelled future appointments — which, under the new appointments guard,
-- would need an exemption. New order verifies-live, cancels appointments WHILE
-- THE CLIENT IS STILL LIVE (guard passes on the merits), then archives (the
-- archive transition passes clients_row_write_guard on its own). No
-- archive_cascade GUC set here — the narrowing (reviewer 2026-07-22).
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

  -- Verify the client is live & in-org up front (preserves the prior
  -- 'not found / already archived' semantics now that the archive UPDATE is
  -- no longer the first statement).
  PERFORM 1 FROM clients
   WHERE id = p_id AND organization_id = caller_org AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'client % not found in your organization, or already archived', p_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- P1-5: an archived client keeps no future bookings. Cancel BEFORE archiving
  -- (client still live) so client_record_write_guard passes without an
  -- exemption; the reminder-lifecycle trigger fires on this status change and
  -- cancels each queued reminder, so no reminder email can reach the
  -- (about-to-be-)archived client. Past/completed/no-show rows are untouched —
  -- they are the record.
  UPDATE appointments
     SET status              = 'cancelled',
         cancelled_at        = ts,
         cancelled_by_role   = 'staff',
         cancellation_reason = 'Client archived'
   WHERE client_id = p_id
     AND organization_id = caller_org
     AND start_at > ts
     AND status IN ('pending', 'confirmed')
     AND deleted_at IS NULL;

  -- Archive last. clients_row_write_guard passes this because it is the archive
  -- TRANSITION (OLD.deleted_at IS NULL), not an edit of an already-archived row.
  UPDATE clients
     SET deleted_at  = ts,
         archived_at = ts
   WHERE id = p_id
     AND organization_id = caller_org
     AND deleted_at IS NULL;
END;
$$;

COMMENT ON FUNCTION public.soft_delete_client(uuid) IS
  'Archive a client: cancel their future live appointments (reminders cascade-cancel via appointment_manage_reminder) THEN set deleted_at + archived_at. v4 reorders vs 20260702190000 so the cancel runs while the client is still live — the write-immutability appointments guard passes on the merits, no archive_cascade GUC needed (the GUC now exempts only clients_row_write_guard, for restore). Releases the (org, lower(email)) unique-active slot for re-invites. CN-7 P1-5; restore_client deliberately does not resurrect cancelled bookings.';

-- restore_client: body identical to 20260429130000 plus the archive_cascade
-- GUC, which clients_row_write_guard (the only guard that still consults it)
-- needs so the un-archive UPDATE — writing an already-archived row — passes.
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

  -- The un-archive UPDATE below writes an archived row — exactly what
  -- clients_row_write_guard refuses for everyone else.
  PERFORM set_config('odyssey.archive_cascade', '1', true);

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
  'Un-archive a client: clear deleted_at and archived_at. Sets the odyssey.archive_cascade GUC so clients_row_write_guard (the only guard that consults it) passes the un-archive UPDATE. Refuses if the email is now claimed by a different live client in the same org — explicit error rather than 23505 from the unique-active index.';
