-- ============================================================================
-- 20260513140000_client_reschedule_program_day_to_today
-- ============================================================================
-- Why: Phase K of the client-portal polish pass introduces a per-day card
-- view in the portal. One of the six CTA states is "Begin session early" on
-- a future programmed day. The EP-locked confirmation copy reads:
--
--   "Are you sure you want to move this session to today, it will no longer
--    be available to complete on this day?"
--
-- That copy is load-bearing: the future date *literally* no longer holds the
-- session after the client confirms. The implementation that matches the
-- copy (decision Q-K3 α, signed off 2026-05-13) is to UPDATE
-- program_days.scheduled_date to today, then start the session normally.
--
-- This RPC does ONLY the reschedule. The server action that calls it
-- sequences a follow-up `client_start_session` call to begin the session.
-- Reasons for keeping the RPC narrow:
--   1. Single responsibility — easier to reason about, easier to reuse.
--   2. client_start_session already has its own refusals (in-progress,
--      v3 completed-already) that we want to keep stacking on the same
--      program_day_id after reschedule.
--   3. If the reschedule succeeds but the session start fails (shouldn't,
--      since we refuse in-progress here too — defensive belt + braces),
--      the program_day is moved but no session row is created. Recoverable.
--
-- Refusals (decision Q-K3.i — refuse rather than silently stack):
--   a) Caller is not authenticated.
--   b) No active program day matching p_program_day_id for this caller.
--   c) The day's scheduled_date is not in the future (today or past).
--      "Begin session early" only makes sense for future days.
--   d) Today already has a programmed day for this client (any
--      non-soft-deleted program_day in any program belonging to this
--      client, with scheduled_date = CURRENT_DATE and id <> the one
--      being moved). Refusing avoids silently stacking two same-date
--      rows — the schema doesn't enforce uniqueness, so we do it here.
--   e) Any in-progress session exists for this client. Same shape as
--      client_start_session v3 — resume or finish before starting another.
--   f) THIS program_day already has a completed session for this client.
--      Belt + braces with v3 — shouldn't be reachable via the UI because
--      the future-day card wouldn't render "Begin early" on a completed
--      day, but defence in depth.
--
-- NOTE — refusal (c) was later relaxed to "must not already be today"
-- per EP request 2026-05-13 (past-skipped recovery). That change lives
-- in the body-only follow-up migration
-- 20260513150000_client_reschedule_program_day_to_today_v2.sql — keeping
-- it as a separate migration rather than editing this file in place
-- because this file was already applied to remote Supabase before the
-- relaxation was requested. Per `supabase db push`'s filename-based
-- migration tracking, editing this file would not re-run; the follow-up
-- migration is the only path that lands the new function body.
--
-- Audit: the UPDATE triggers the existing program_days audit row write
-- via audit_resolve_org_id (CASE branch at line 75 of
-- 20260428120900_audit_register_testing_module.sql). The diff JSON
-- captures the before/after scheduled_date — no new audit register
-- needed.
--
-- Posture mirrors the existing portal RPC family:
--   - SECURITY DEFINER + SET search_path = public, pg_temp
--   - auth.uid() pin in the join chain (no RLS bypass via the client_id)
--   - REVOKE FROM PUBLIC + GRANT EXECUTE TO authenticated
--   - LANGUAGE plpgsql (refusal logic needs control flow)
--   - Local variables v_ prefixed per the plpgsql variable-column shadow
--     project memory (column name shadowing a local raises ambiguous-
--     column at runtime).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.client_reschedule_program_day_to_today(
  p_program_day_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id        uuid := auth.uid();
  v_client_id        uuid;
  v_program_id       uuid;
  v_scheduled_date   date;
  v_today            date := CURRENT_DATE;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Resolve client_id + program_id + the day's current scheduled_date.
  -- Walks via pd.program_id direct (post-D-PROG-001) so copy/repeat-
  -- created days with NULL program_week_id work unchanged.
  SELECT c.id, p.id, pd.scheduled_date
    INTO v_client_id, v_program_id, v_scheduled_date
    FROM program_days pd
    JOIN programs p ON p.id = pd.program_id
    JOIN clients c  ON c.id = p.client_id
   WHERE pd.id           = p_program_day_id
     AND c.user_id       = v_caller_id
     AND c.deleted_at    IS NULL
     AND p.status        = 'active'
     AND p.deleted_at    IS NULL
     AND pd.deleted_at   IS NULL;

  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'No active program day for this caller';
  END IF;

  -- Refusal (c): the day must be in the future. "Begin session early"
  -- doesn't apply to today (no move needed) or past (different fix).
  IF v_scheduled_date <= v_today THEN
    RAISE EXCEPTION 'This session is not in the future'
      USING HINT = 'Use Begin session on today''s card, or message your EP about a past day.';
  END IF;

  -- Refusal (d): today already holds a programmed day for this client.
  -- Stacking two same-date rows is technically allowed by the schema
  -- (no UNIQUE on program_id, scheduled_date) but would confuse both
  -- the portal week strip and the staff calendar.
  IF EXISTS (
    SELECT 1 FROM program_days pd2
      JOIN programs p2 ON p2.id = pd2.program_id
     WHERE p2.client_id        = v_client_id
       AND p2.deleted_at       IS NULL
       AND p2.status           = 'active'
       AND pd2.deleted_at      IS NULL
       AND pd2.scheduled_date  = v_today
       AND pd2.id              <> p_program_day_id
  ) THEN
    RAISE EXCEPTION 'Today already has a session'
      USING HINT = 'Finish or skip today''s session before moving this one.';
  END IF;

  -- Refusal (e): any in-progress session for this client. Matches
  -- client_start_session v3's refusal — same hint copy so the user-facing
  -- error message is consistent regardless of which entry point hit the
  -- refusal first.
  IF EXISTS (
    SELECT 1 FROM sessions
     WHERE client_id    = v_client_id
       AND completed_at IS NULL
       AND deleted_at   IS NULL
  ) THEN
    RAISE EXCEPTION 'A session is already in progress'
      USING HINT = 'Resume or complete the in-progress session before starting a new one.';
  END IF;

  -- Refusal (f): this program_day already has a completed session.
  -- Shouldn't be reachable via Phase K's UI (the future-day card won't
  -- render "Begin early" on a completed day), but defence in depth.
  IF EXISTS (
    SELECT 1 FROM sessions
     WHERE client_id      = v_client_id
       AND program_day_id = p_program_day_id
       AND completed_at   IS NOT NULL
       AND deleted_at     IS NULL
  ) THEN
    RAISE EXCEPTION 'This session has already been completed'
      USING HINT = 'View the summary, or message your EP if you need to redo it.';
  END IF;

  -- The move. Audit trigger captures before/after scheduled_date via
  -- audit_resolve_org_id's direct-column fast path for program_days.
  UPDATE program_days
     SET scheduled_date = v_today
   WHERE id = p_program_day_id;

  RETURN p_program_day_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.client_reschedule_program_day_to_today(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.client_reschedule_program_day_to_today(uuid) TO authenticated;

COMMENT ON FUNCTION public.client_reschedule_program_day_to_today(uuid) IS
  'Phase K (2026-05-13). Moves a future program_day''s scheduled_date to CURRENT_DATE for the caller''s own active program. Refuses if the day is not in the future, if today already holds a programmed day, if any session is in progress, or if THIS program_day already has a completed session. Server action sequences a client_start_session call after this RPC returns. NOTE: past-skipped recovery relaxation lives in the v2 follow-up migration.';
