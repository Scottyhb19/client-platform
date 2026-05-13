-- ============================================================================
-- 20260513150000_client_reschedule_program_day_to_today_v2
-- ============================================================================
-- Why: Phase K addendum (chat 2026-05-13, post initial sign-off). The
-- v1 RPC at 20260513140000 enforced "scheduled_date must be in the
-- future" — the original Q-K3 (α) scope was just the future-scheduled
-- "Begin session early" CTA. After Phase K landed, the EP raised that
-- past-skipped sessions should also be recoverable to today: "If someone
-- misses their session and wants it to be completed today, they can
-- only take a future session away. Therefore the 'skipped' title, when
-- clicked should come up with a 'Move to today' message when clicked."
--
-- Without this relaxation, the only recovery path for a missed session
-- is to surrender a future day — asymmetric and slightly hostile UX.
--
-- The relaxation: refusal (c) becomes "must not already be today"
-- instead of "must be future." Past and future both reschedule freely.
-- All other refusals stay identical (auth, no-active-day, same-date
-- collision, in-progress anywhere, this-day-already-completed).
--
-- Why a follow-up migration rather than editing v1 in place:
--   v1 was applied to remote Supabase before this relaxation was
--   requested. `supabase db push` tracks migrations by filename and
--   silently skips already-applied files (project memory:
--   `project_supabase_migration_timestamp_collision`). An in-place
--   edit would never re-run; a follow-up migration is the only path
--   that lands the new function body.
--
-- Body-only change; signature + return type unchanged → CREATE OR REPLACE
-- without DROP (per project memory `plpgsql function arity evolution`:
-- DROP only when the signature itself shifts, otherwise overloads
-- coexist and supabase-js silently calls the wrong one).
--
-- Same posture as v1: SECURITY DEFINER + SET search_path + auth.uid()
-- pin + REVOKE FROM PUBLIC + GRANT EXECUTE TO authenticated.
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

  -- Refusal (c) — RELAXED in v2. The day must not already be today.
  -- Both directions (past-skipped recovery, future "begin early") are
  -- valid; only today → today is a no-op.
  IF v_scheduled_date = v_today THEN
    RAISE EXCEPTION 'This session is already today'
      USING HINT = 'Use Begin session on today''s card instead.';
  END IF;

  -- Refusal (d): today already holds a programmed day for this client.
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

  -- Refusal (e): any in-progress session for this client.
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

-- GRANT + REVOKE are idempotent and already set by v1, but restating
-- them here so this migration stands alone and a fresh-database
-- replay (v1 then v2 in sequence) lands the same final state.
REVOKE EXECUTE ON FUNCTION public.client_reschedule_program_day_to_today(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.client_reschedule_program_day_to_today(uuid) TO authenticated;

COMMENT ON FUNCTION public.client_reschedule_program_day_to_today(uuid) IS
  'Phase K v2 (2026-05-13). Moves a program_day''s scheduled_date to CURRENT_DATE for the caller''s own active program. Used by both the future "Begin session early" CTA and the past-skipped "Move to today" CTA. Refuses if the day is already today, if today already holds a different programmed day, if any session is in progress, or if THIS program_day already has a completed session. Server action sequences a client_start_session call after this RPC returns.';
