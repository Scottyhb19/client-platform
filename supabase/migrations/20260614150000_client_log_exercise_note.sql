-- ============================================================================
-- 20260614150000_client_log_exercise_note
-- ============================================================================
-- Section 7 / P1-4 (§6.3.1 "Optional notes field per group"). The in-session
-- screen gets a per-group notes field; this RPC persists it.
--
-- Storage: a per-group note attaches to the group's FIRST exercise's
-- exercise_logs.notes (for a standalone exercise that is simply per-exercise;
-- for a superset the EP sees the note under the lead movement). exercise_logs
-- already has a `notes text` column.
--
-- Mirrors client_log_set's find-or-create of the exercise_logs parent
-- (20260511130000): resolve the exercise_id, find the (session,
-- program_exercise) log, INSERT it with the note if absent (the client may
-- write a note before logging any set in the group), else UPDATE its notes.
-- Local var prefixed v_ per project memory (plpgsql variable-column shadow).
--
-- Additive — new function, no signature change to anything deployed, so no
-- prod/DB skew (backward-compatible). SECURITY DEFINER + auth.uid() pin +
-- in-progress-session check; anon revoked (auto-grant trap); authenticated
-- granted. pgTAP 25 covers the grant posture.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.client_log_exercise_note(
  p_session_id          uuid,
  p_program_exercise_id uuid,
  p_notes               text
)
RETURNS uuid  -- the exercise_logs.id the note was written to
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id        uuid := auth.uid();
  v_session_id       uuid;
  v_exercise_id      uuid;
  v_exercise_log_id  uuid;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Caller owns the session and it is in-progress.
  SELECT s.id INTO v_session_id
    FROM sessions s
    JOIN clients c ON c.id = s.client_id
   WHERE s.id           = p_session_id
     AND c.user_id      = v_caller_id
     AND c.deleted_at   IS NULL
     AND s.completed_at IS NULL
     AND s.deleted_at   IS NULL;

  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'Session not found or not owned by caller or already completed';
  END IF;

  -- exercise_logs.exercise_id is NOT NULL — resolve it from the prescription.
  SELECT exercise_id INTO v_exercise_id
    FROM program_exercises
   WHERE id = p_program_exercise_id AND deleted_at IS NULL;

  IF v_exercise_id IS NULL THEN
    RAISE EXCEPTION 'Program exercise not found';
  END IF;

  -- Find or create the exercise_logs row, then set its notes.
  SELECT id INTO v_exercise_log_id
    FROM exercise_logs
   WHERE session_id          = p_session_id
     AND program_exercise_id = p_program_exercise_id
     AND deleted_at IS NULL;

  IF v_exercise_log_id IS NULL THEN
    INSERT INTO exercise_logs (
      session_id, program_exercise_id, exercise_id, sort_order, notes
    )
    VALUES (
      p_session_id,
      p_program_exercise_id,
      v_exercise_id,
      COALESCE(
        (SELECT pe.sort_order FROM program_exercises pe WHERE pe.id = p_program_exercise_id),
        0
      ),
      p_notes
    )
    RETURNING id INTO v_exercise_log_id;
  ELSE
    UPDATE exercise_logs SET notes = p_notes WHERE id = v_exercise_log_id;
  END IF;

  RETURN v_exercise_log_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.client_log_exercise_note(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.client_log_exercise_note(uuid, uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.client_log_exercise_note(uuid, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.client_log_exercise_note(uuid, uuid, text) IS
  'Section 7 P1-4 (2026-06-14). Saves an optional per-group note to the group''s first exercise''s exercise_logs.notes for the caller''s own in-progress session. Find-or-creates the exercise_log (mirrors client_log_set). Called on blur from the in-session notes field.';
