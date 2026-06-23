-- ============================================================================
-- 20260623140000_stale_session_no_block
-- ============================================================================
-- Why: operator-reported portal deadlock (2026-06-23). The portal refused
-- "A session is already in progress" on Begin and on Move-to-today, with no
-- session visibly underway.
--
-- ROOT CAUSE (read from the data + SQL, not inferred). client_start_session
-- (v3, 20260513120000:69) and client_reschedule_program_day_to_today
-- (v3, 20260614120000:127) both refuse when ANY in-progress session exists
-- for the client:
--     EXISTS (sessions WHERE client_id=X AND completed_at IS NULL
--                            AND deleted_at IS NULL)
-- That check is blind to WHICH day the session is for. A client who started a
-- session and never finished it leaves an in-progress row forever. Once that
-- session's program_day falls into the past, the portal renders the day inert
-- ('past-skipped' — deriveDayState's isPast branch ignores inProgress), so
-- there is no Resume CTA anywhere. The orphaned row can never be resolved, yet
-- it blocks every future Begin and every Move — a permanent, invisible
-- deadlock. (Confirmed live: one such row, started 4 days prior, 0 logged
-- sets.)
--
-- THE FIX. Scope the in-progress refusal to sessions that are actually
-- CURRENT: on a live program_day scheduled on/after the reference date.
--   - client_start_session: reference = the started day's scheduled_date
--     (≈ today; a begin-early day has already been moved to today by the
--     reschedule RPC before this is called).
--   - reschedule: reference = p_today (the caller's tz-correct today).
-- A session on a PAST day (scheduled_date < reference) or on a soft-deleted
-- day is treated as abandoned and no longer blocks. Nothing is discarded —
-- the orphaned row simply stops being counted; the same-day resume path
-- (startOrResumeSessionAction) still finds and resumes a genuine current
-- session, so the "one live session at a time" invariant is preserved.
--
-- Body-only changes; both signatures unchanged → CREATE OR REPLACE without
-- DROP (project memory: DROP only when the signature itself shifts). Grants
-- re-stated (Supabase default-EXECUTE-grant hygiene).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1. client_start_session — v4. Refusal (a) scoped to current days.
-- (Based on v3 / 20260513120000, the latest replacement.)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.client_start_session(p_program_day_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_id        uuid := auth.uid();
  found_client_id  uuid;
  program_org_id   uuid;
  v_new_date       date;
  new_session_id   uuid;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Resolve client_id + program org + the started day's date. Walks via
  -- pd.program_id (post-D-PROG-001) so copy/repeat-created days with NULL
  -- program_week_id are not dropped.
  SELECT c.id, p.organization_id, pd.scheduled_date
    INTO found_client_id, program_org_id, v_new_date
    FROM program_days pd
    JOIN programs p ON p.id = pd.program_id
    JOIN clients c  ON c.id = p.client_id
   WHERE pd.id           = p_program_day_id
     AND c.user_id       = caller_id
     AND c.deleted_at    IS NULL
     AND p.status        = 'active'
     AND p.deleted_at    IS NULL
     AND pd.deleted_at   IS NULL;

  IF found_client_id IS NULL THEN
    RAISE EXCEPTION 'No active program day for this caller';
  END IF;

  -- Refuse only if a CURRENT in-progress session exists: one on a live day
  -- scheduled on/after the day being started (≈ today). An in-progress
  -- session for a PAST day — or a soft-deleted day — is abandoned: the portal
  -- renders past days inert (no Resume CTA), so it can never be resolved and
  -- would otherwise deadlock every future start. v4 (2026-06-23) scopes the
  -- check so a stale past session stops being a phantom "already in progress".
  IF EXISTS (
    SELECT 1 FROM sessions s
      JOIN program_days pd2 ON pd2.id = s.program_day_id
     WHERE s.client_id        = found_client_id
       AND s.completed_at     IS NULL
       AND s.deleted_at       IS NULL
       AND pd2.deleted_at     IS NULL
       AND pd2.scheduled_date >= v_new_date
  ) THEN
    RAISE EXCEPTION 'A session is already in progress'
      USING HINT = 'Resume or complete the in-progress session before starting a new one.';
  END IF;

  -- v3: refuse if THIS program_day already has a completed session for this
  -- client. Defence-in-depth backstop for the Today card's CTA.
  IF EXISTS (
    SELECT 1 FROM sessions
     WHERE client_id      = found_client_id
       AND program_day_id = p_program_day_id
       AND completed_at   IS NOT NULL
       AND deleted_at     IS NULL
  ) THEN
    RAISE EXCEPTION 'This session has already been completed'
      USING HINT = 'View the summary, or message your EP if you need to redo it.';
  END IF;

  INSERT INTO sessions (organization_id, client_id, program_day_id, started_at)
  VALUES (program_org_id, found_client_id, p_program_day_id, now())
  RETURNING id INTO new_session_id;

  RETURN new_session_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.client_start_session(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.client_start_session(uuid) TO authenticated;

COMMENT ON FUNCTION public.client_start_session(uuid) IS
  'Begin a training session for the caller against their own active program day. Refuses if (a) a CURRENT in-progress session exists (on a live day scheduled on/after the started day''s date), or (b) THIS program_day already has a completed session. v4 (2026-06-23) scoped (a) to live current/future days so an abandoned past-day session no longer deadlocks new starts.';


-- ----------------------------------------------------------------------------
-- §2. client_reschedule_program_day_to_today — v4. Refusal (e) scoped.
-- (Based on v3 / 20260614120000, the latest replacement.)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.client_reschedule_program_day_to_today(
  p_program_day_id uuid,
  p_today          date
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
  v_today            date := p_today;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Trust boundary: p_today comes from a client-set cookie. A real local date
  -- is within ±1 day of the UTC date for every valid IANA zone.
  IF p_today IS NULL
     OR p_today < CURRENT_DATE - 1
     OR p_today > CURRENT_DATE + 1 THEN
    RAISE EXCEPTION 'Invalid reschedule date'
      USING HINT = 'Reload the portal and try again.';
  END IF;

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

  -- Refusal (c): the day must not already be today.
  IF v_scheduled_date = v_today THEN
    RAISE EXCEPTION 'This session is already today'
      USING HINT = 'Use Begin session on today''s card instead.';
  END IF;

  -- Refusal (d): today already holds a DIFFERENT programmed day.
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

  -- Refusal (e): a CURRENT in-progress session for this client — one on a
  -- live day scheduled on/after today. v4 (2026-06-23): a stale past-day (or
  -- soft-deleted-day) in-progress session is abandoned and no longer blocks
  -- the move (the deadlock this migration fixes).
  IF EXISTS (
    SELECT 1 FROM sessions s
      JOIN program_days pd2 ON pd2.id = s.program_day_id
     WHERE s.client_id        = v_client_id
       AND s.completed_at     IS NULL
       AND s.deleted_at       IS NULL
       AND pd2.deleted_at     IS NULL
       AND pd2.scheduled_date >= v_today
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

  UPDATE program_days
     SET scheduled_date = v_today
   WHERE id = p_program_day_id;

  RETURN p_program_day_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.client_reschedule_program_day_to_today(uuid, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.client_reschedule_program_day_to_today(uuid, date) FROM anon;
GRANT  EXECUTE ON FUNCTION public.client_reschedule_program_day_to_today(uuid, date) TO authenticated;

COMMENT ON FUNCTION public.client_reschedule_program_day_to_today(uuid, date) IS
  'Moves a program_day''s scheduled_date to p_today (the caller''s device/org-tz today, resolved by the server action; clamped to ±1 day of CURRENT_DATE). Refuses if already today, if today holds a different day, if a CURRENT in-progress session exists (live day scheduled on/after today), or if this day already has a completed session. v4 (2026-06-23) scoped the in-progress refusal so a stale past-day session no longer blocks the move.';
