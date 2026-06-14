-- ============================================================================
-- 20260614120000_client_reschedule_program_day_to_today_v3
-- ============================================================================
-- Section 7 (Client portal PWA) — P0-1. Closes the operator-reported bug:
-- "Begin session early" wrongly errors "Today already has a session" when
-- there isn't one.
--
-- ROOT CAUSE (read from the SQL, not inferred). v1/v2 derived "today" as
-- `v_today date := CURRENT_DATE`. On Supabase, CURRENT_DATE evaluates in the
-- UTC database session timezone — NOT the EP's/client's local date. So near
-- the local↔UTC date boundary the RPC's "today" is a different calendar day
-- from the UI's "today":
--   - refusal (d) tests `pd2.scheduled_date = v_today` (UTC today) against
--     the client's days, so it can match a day the client's *local* today
--     does not have → the false "Today already has a session"; and
--   - the UPDATE moves scheduled_date onto the UTC date, not the local one.
-- This is the database-layer face of section 7 FM-1 (the whole portal's
-- "today" was UTC). The client/server fix is in src/lib (device-timezone
-- "today" via the portal_tz cookie, org-timezone fallback per Q2).
--
-- THE FIX. Stop computing "today" from UTC inside the RPC. The server action
-- (rescheduleAndStartSessionAction) resolves the tz-correct today — device
-- timezone (cookie) → organization.timezone → PRACTICE_TIMEZONE — and passes
-- it as `p_today`. The RPC trusts that date for its "today" semantics but
-- keeps every other guard (ownership, not-already-today, same-date collision,
-- in-progress, completed).
--
-- TRUST BOUNDARY. `p_today` originates from a client-set cookie, so it is
-- bounded here: it must be within ±1 day of the server's UTC CURRENT_DATE.
-- Every real IANA zone is within (UTC-12 .. UTC+14), so a genuine local date
-- is at most one calendar day either side of the UTC date — the clamp admits
-- every honest value and rejects nonsense. Even without the clamp the blast
-- radius is small (a client may only reschedule THEIR OWN session to a date
-- they claim is today, which this feature already lets them self-serve), but
-- the clamp keeps the date sane and the audit honest.
--
-- ARITY CHANGE. v3 adds the `p_today date` parameter, so the signature shifts
-- from (uuid) to (uuid, date). Per project memory `plpgsql function arity
-- evolution`, DROP the old signature before CREATE — otherwise both overloads
-- coexist and supabase-js silently calls the wrong one. Body is otherwise
-- based on v2 (the latest applied replacement), per `migration function body
-- parse` (copying an older body could resurrect dropped logic).
--
-- GRANTS. anon is explicitly revoked here (the Supabase default-EXECUTE-grant
-- trap re-grants anon on every CREATE) — this discharges the reschedule slice
-- of the section 7 P0-2 sweep; the rest of the client_* family is swept in
-- its own migration.
--
-- Audit: unchanged — the UPDATE triggers the existing program_days audit row
-- via audit_resolve_org_id's direct-column fast path.
-- ============================================================================

DROP FUNCTION IF EXISTS public.client_reschedule_program_day_to_today(uuid);

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

  -- Trust boundary: p_today comes from a client-set cookie. A real local
  -- date is within ±1 day of the UTC date for every valid IANA zone; reject
  -- anything outside that window.
  IF p_today IS NULL
     OR p_today < CURRENT_DATE - 1
     OR p_today > CURRENT_DATE + 1 THEN
    RAISE EXCEPTION 'Invalid reschedule date'
      USING HINT = 'Reload the portal and try again.';
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

  -- Refusal (c): the day must not already be today (today → today is a no-op).
  -- Past-skipped recovery and future "begin early" both reschedule freely.
  IF v_scheduled_date = v_today THEN
    RAISE EXCEPTION 'This session is already today'
      USING HINT = 'Use Begin session on today''s card instead.';
  END IF;

  -- Refusal (d): today already holds a DIFFERENT programmed day for this
  -- client. Now tested against the tz-correct `v_today`, so it stops firing
  -- on the wrong calendar day (the bug this migration fixes).
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

  -- The move.
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
  'Section 7 P0-1 (2026-06-14). Moves a program_day''s scheduled_date to p_today (the caller''s device/org-timezone "today", resolved by the server action — NOT UTC CURRENT_DATE, which caused the false "Today already has a session" collision). p_today is clamped to ±1 day of CURRENT_DATE. Keeps all v2 refusals. Server action sequences client_start_session after this returns.';
