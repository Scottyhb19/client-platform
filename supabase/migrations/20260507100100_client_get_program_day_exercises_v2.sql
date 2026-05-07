-- ============================================================================
-- 20260507100100_client_get_program_day_exercises_v2
-- ============================================================================
-- Why: Phase C of the session-builder polish pass — the portal RPC's
-- prescription readout has to switch from flat scalars (sets, reps, rpe,
-- optional_metric, optional_value) to a per-set JSON array sourced from
-- the new program_exercise_sets table.
--
-- Shape change: the function's RETURNS TABLE drops five columns and adds
-- one (prescription_sets jsonb). That's a return-type change, so per the
-- project memory note `plpgsql function arity evolution`, DROP the old
-- signature before CREATE OR REPLACE — otherwise PostgREST sees both
-- shapes (rare given identical input args, but the safer pattern across
-- driver versions). The function name + uuid input arg are unchanged, so
-- supabase-js call sites don't change.
--
-- Other clean-up:
--   - Drop the program_weeks join (post-D-PROG-001, program_days carries
--     program_id directly — see 20260503100000_program_days_scheduled_date.sql).
--     The original RPC pre-dates that and still walks the four-table chain;
--     no behavioural difference today, but the shorter walk is canonical
--     and avoids confusing future readers.
--   - Drop the corresponding pw.deleted_at filter.
--
-- prescription_sets is built via a correlated subquery aggregating per-set
-- rows into a jsonb array, ordered by set_number. COALESCE wraps an empty
-- array sentinel for the (defensive) case where a program_exercise has no
-- live sets — shouldn't happen post-Phase-C since addExerciseToDayAction
-- inserts N default rows, but the RPC stays robust.
--
-- Q6 sign-off (chat 2026-05-07): the per-set object carries set_number,
-- reps, optional_metric, optional_value. NO rpe field — prescription RPE
-- folds into optional_metric='rpe' / optional_value='8' once Phase F lands
-- the metric dropdown. Until then the Phase C UI keeps Load/Notes freetext;
-- the EP can type 'RPE 8' inline and it lands in optional_value as a
-- string. The Logger reads optional_value as a hint for the active set's
-- prescribed load, and the client logs their actual RPE separately into
-- set_logs.rpe (unchanged).
-- ============================================================================


-- DROP first because the return shape changes (per project memory:
-- function arity evolution requires DROP before CREATE OR REPLACE when
-- the signature itself shifts).
DROP FUNCTION IF EXISTS public.client_get_program_day_exercises(uuid);


CREATE OR REPLACE FUNCTION public.client_get_program_day_exercises(p_program_day_id uuid)
RETURNS TABLE (
  program_exercise_id   uuid,
  sort_order            int,
  section_title         text,
  superset_group_id     uuid,
  exercise_id           uuid,
  exercise_name         text,
  exercise_video_url    text,
  instructions          text,
  rest_seconds          int,
  tempo                 text,
  prescription_sets     jsonb
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    pe.id                                                  AS program_exercise_id,
    pe.sort_order,
    pe.section_title,
    pe.superset_group_id,
    e.id                                                   AS exercise_id,
    e.name                                                 AS exercise_name,
    e.video_url                                            AS exercise_video_url,
    COALESCE(pe.instructions, e.instructions)              AS instructions,
    COALESCE(pe.rest_seconds, e.default_rest_seconds)      AS rest_seconds,
    pe.tempo                                               AS tempo,
    COALESCE(
      (
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'set_number',      pes.set_number,
                   'reps',            pes.reps,
                   'optional_metric', pes.optional_metric,
                   'optional_value',  pes.optional_value
                 )
                 ORDER BY pes.set_number
               )
          FROM program_exercise_sets pes
         WHERE pes.program_exercise_id = pe.id
           AND pes.deleted_at IS NULL
      ),
      '[]'::jsonb
    )                                                      AS prescription_sets
  FROM program_exercises pe
  JOIN exercises          e  ON e.id  = pe.exercise_id
  JOIN program_days       pd ON pd.id = pe.program_day_id
  JOIN programs           p  ON p.id  = pd.program_id
  JOIN clients            c  ON c.id  = p.client_id
  WHERE pd.id             = p_program_day_id
    AND c.user_id         = auth.uid()
    AND c.deleted_at      IS NULL
    AND p.status          IN ('active', 'archived')
    AND p.deleted_at      IS NULL
    AND pd.deleted_at     IS NULL
    AND pe.deleted_at     IS NULL
    AND e.deleted_at      IS NULL
  ORDER BY pe.sort_order;
$$;

REVOKE EXECUTE ON FUNCTION public.client_get_program_day_exercises(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.client_get_program_day_exercises(uuid) TO authenticated;

COMMENT ON FUNCTION public.client_get_program_day_exercises(uuid) IS
  'Returns exercise prescriptions + library details for a program day belonging to the caller. Phase C (2026-05-07): per-set prescription returned as a JSON array (prescription_sets) sourced from program_exercise_sets, replacing the prior flat scalars. Walks via program_days.program_id (post-D-PROG-001) — no longer joins program_weeks.';
