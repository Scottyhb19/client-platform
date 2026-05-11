-- ============================================================================
-- 20260511130000_client_log_set_fix_variable_shadow
-- ============================================================================
-- Why: client_log_set declared a plpgsql local variable named
-- `exercise_log_id` (20260420102500_client_portal_functions.sql:227),
-- which shadows the column of the same name on `set_logs`. PostgreSQL's
-- default `plpgsql.variable_conflict = error` setting raises
--
--   ERROR: column reference "exercise_log_id" is ambiguous
--
-- when the parser reaches `ON CONFLICT (exercise_log_id, set_number)` on
-- line 291. Postgres can't tell whether the identifier names the local
-- variable or the target table's column.
--
-- Latent since 2026-04-20. Phase C testing only exercised the completion
-- path (skip-to-complete sessions with no sets logged — see Scott
-- Browning's three completed `sessions` rows on the live DB, all with
-- `exercise_logs: []`). The first real per-set INSERT triggered today
-- 2026-05-11 from the portal Logger and surfaced the bug.
--
-- Fix: rename the local variable to `v_exercise_log_id` and re-deploy via
-- `CREATE OR REPLACE`. Same function signature, same return type, same
-- security posture, same body logic — only the identifier changes.
-- No DROP needed (per `project_plpgsql_function_arity_evolution` — arity
-- is unchanged so the existing signature is preserved). No type regen
-- needed (no public types changed).
--
-- The existing REVOKE/GRANT pattern (lines 306-307 of the original
-- migration) is preserved by `CREATE OR REPLACE`; no re-issue required.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.client_log_set(
  p_session_id          uuid,
  p_program_exercise_id uuid,
  p_set_number          smallint,
  p_weight_value        numeric,
  p_weight_metric       text,
  p_reps_performed      smallint,
  p_optional_metric     text,
  p_optional_value      text,
  p_rpe                 smallint,
  p_notes               text
)
RETURNS uuid  -- the new set_logs.id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_id         uuid := auth.uid();
  v_exercise_log_id uuid;       -- renamed from `exercise_log_id` to avoid
                                -- shadowing set_logs.exercise_log_id; the
                                -- shadow caused "column reference is
                                -- ambiguous" under plpgsql.variable_conflict
                                -- = error (Supabase default).
  session_row       sessions%ROWTYPE;
  program_exercise_exercise_id uuid;
  new_set_log_id    uuid;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Resolve the session + confirm caller owns it + confirm it is in-progress
  SELECT s.* INTO session_row
    FROM sessions s
    JOIN clients  c ON c.id = s.client_id
   WHERE s.id           = p_session_id
     AND c.user_id      = caller_id
     AND c.deleted_at   IS NULL
     AND s.completed_at IS NULL
     AND s.deleted_at   IS NULL;

  IF session_row.id IS NULL THEN
    RAISE EXCEPTION 'Session not found or not owned by caller or already completed';
  END IF;

  -- Resolve the exercise_id of the prescription (for denormalized log linkage)
  SELECT exercise_id INTO program_exercise_exercise_id
    FROM program_exercises
   WHERE id = p_program_exercise_id AND deleted_at IS NULL;

  IF program_exercise_exercise_id IS NULL THEN
    RAISE EXCEPTION 'Program exercise not found';
  END IF;

  -- Find or create the exercise_logs row for this (session, program_exercise)
  SELECT id INTO v_exercise_log_id
    FROM exercise_logs
   WHERE session_id          = p_session_id
     AND program_exercise_id = p_program_exercise_id
     AND deleted_at IS NULL;

  IF v_exercise_log_id IS NULL THEN
    INSERT INTO exercise_logs (session_id, program_exercise_id, exercise_id, sort_order)
    VALUES (
      p_session_id,
      p_program_exercise_id,
      program_exercise_exercise_id,
      COALESCE(
        (SELECT pe.sort_order FROM program_exercises pe WHERE pe.id = p_program_exercise_id),
        0
      )
    )
    RETURNING id INTO v_exercise_log_id;
  END IF;

  -- Insert or upsert the set log. ON CONFLICT target references the
  -- columns of set_logs by name — now unambiguous because the local
  -- variable is `v_exercise_log_id`, not `exercise_log_id`.
  INSERT INTO set_logs (
    exercise_log_id, set_number,
    weight_value, weight_metric, reps_performed,
    optional_metric, optional_value, rpe, notes, completed_at
  )
  VALUES (
    v_exercise_log_id, p_set_number,
    p_weight_value, p_weight_metric, p_reps_performed,
    p_optional_metric, p_optional_value, p_rpe, p_notes, now()
  )
  ON CONFLICT (exercise_log_id, set_number) DO UPDATE
    SET weight_value    = EXCLUDED.weight_value,
        weight_metric   = EXCLUDED.weight_metric,
        reps_performed  = EXCLUDED.reps_performed,
        optional_metric = EXCLUDED.optional_metric,
        optional_value  = EXCLUDED.optional_value,
        rpe             = EXCLUDED.rpe,
        notes           = EXCLUDED.notes,
        completed_at    = EXCLUDED.completed_at
  RETURNING id INTO new_set_log_id;

  RETURN new_set_log_id;
END;
$$;

COMMENT ON FUNCTION public.client_log_set(uuid, uuid, smallint, numeric, text, smallint, text, text, smallint, text) IS
  'Caller logs or updates a set within their own in-progress session. Auto-creates the exercise_logs parent on first set. 2026-05-11: local variable renamed to v_exercise_log_id to dodge column-name shadow that raised "ambiguous column reference" on first real per-set INSERT.';
