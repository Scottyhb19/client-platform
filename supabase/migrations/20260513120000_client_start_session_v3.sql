-- ============================================================================
-- 20260513120000_client_start_session_v3
-- ============================================================================
-- Why: Phase I polish-pass diagnostic surfaced two distinct bugs on the
-- portal Today card. The week-strip date misalignment is fixed entirely
-- in TypeScript (single weekdayIndex helper now used on both sides of the
-- programmedByWeekday map). The second bug — a completed session staying
-- repeatable from the "Begin session" CTA — needs both a UI fix and a
-- defence-in-depth backstop here at the RPC level.
--
-- The UI side: TodayScreen now reads today's completion state and renders
-- "Session complete · view summary" pointing at /complete when today's
-- program_day already has a completed session. Without this RPC change,
-- the week-strip cell (or a deep-link) would still route through
-- startOrResumeSessionAction → client_start_session, and pre-v3 the only
-- refusal check filters on completed_at IS NULL — which by definition
-- excludes the completed row. The RPC would happily insert a fresh
-- session each time.
--
-- v3 adds one IF EXISTS block: refuse if THIS program_day already has a
-- completed (non-soft-deleted) session for the calling client. Semantic
-- is per-program_day, not per-date — every program_day_id is a single
-- occurrence of training and completing it is the final state. The rare
-- AM/PM split-session case is not addressed here; if it ever becomes a
-- real requirement, an explicit client_restart_session RPC opens that
-- door deliberately, rather than leaving the front door open.
--
-- Body-only change; signature + return type unchanged → CREATE OR REPLACE
-- without DROP (per project memory: only DROP+CREATE when the signature
-- itself shifts).
-- ============================================================================

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
  new_session_id   uuid;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Resolve client_id + program org. Walks via pd.program_id (post-D-PROG-001),
  -- so copy/repeat-created days with NULL program_week_id are not dropped.
  SELECT c.id, p.organization_id
    INTO found_client_id, program_org_id
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

  -- Refuse if an in-progress session already exists for this client
  -- anywhere (resume or complete it before starting another).
  IF EXISTS (
    SELECT 1 FROM sessions
     WHERE client_id    = found_client_id
       AND completed_at IS NULL
       AND deleted_at   IS NULL
  ) THEN
    RAISE EXCEPTION 'A session is already in progress'
      USING HINT = 'Resume or complete the in-progress session before starting a new one.';
  END IF;

  -- v3: refuse if THIS program_day already has a completed session for
  -- this client. Defence-in-depth backstop for the portal Today card's
  -- CTA change in Phase I — if the UI ever fails open or someone
  -- deep-links to /portal/session/<dayId>, the DB still refuses.
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
  'Begin a training session for the caller against their own active program day. Refuses if (a) another session is in progress anywhere for this client, or (b) THIS program_day already has a completed session for this client. v3 (2026-05-13) added the (b) defence-in-depth check, paired with the portal Today card''s "Session complete · view summary" CTA.';
