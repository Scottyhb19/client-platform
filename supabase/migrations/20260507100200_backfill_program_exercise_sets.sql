-- ============================================================================
-- 20260507100200_backfill_program_exercise_sets
-- ============================================================================
-- Why: Phase C of the session-builder polish pass introduces program_exercise_sets
-- (migration 20260507100000) but doesn't backfill existing rows. Without
-- backfill, every program_exercise that pre-dates the migration appears with
-- an empty SetTable in the staff UI and an empty prescribed_sets array in
-- the portal RPC — broken UX even on seed data.
--
-- Pre-launch advantage applies (CLAUDE.md "Schema migrations are cheap, no
-- production data"), so this is a one-shot SQL backfill rather than a
-- code-level migration helper.
--
-- Rules:
--   - Generate N rows per program_exercise where N = max(sets, 1). NULL or
--     zero sets falls back to 1 so the SetTable is never empty.
--   - Carry reps / optional_metric / optional_value verbatim from the
--     parent legacy row.
--   - Preserve legacy rpe by folding it into optional_metric='rpe' /
--     optional_value=rpe::text when the parent had an rpe but no optional
--     pair (avoid clobbering an existing load+metric). Per Q6 sign-off
--     2026-05-07, prescription RPE lives in optional_metric/value once
--     Phase F lands the metric dropdown — this backfill aligns existing
--     seed rows with that future shape.
--   - Idempotent: WHERE NOT EXISTS guard skips program_exercises that
--     already have any live set row (e.g. created post-Phase-C via the
--     new addExerciseToDayAction).
--   - Soft-deleted program_exercises are skipped — their sets would be
--     immediately invisible via the parent-walk RLS.
-- ============================================================================

INSERT INTO program_exercise_sets (
  program_exercise_id, set_number, reps, optional_metric, optional_value
)
SELECT
  pe.id,
  gs.n::smallint,
  pe.reps,
  COALESCE(
    pe.optional_metric,
    CASE WHEN pe.rpe IS NOT NULL THEN 'rpe' ELSE NULL END
  )                                               AS optional_metric,
  COALESCE(
    pe.optional_value,
    CASE WHEN pe.rpe IS NOT NULL THEN pe.rpe::text ELSE NULL END
  )                                               AS optional_value
FROM program_exercises pe
CROSS JOIN LATERAL generate_series(1, GREATEST(COALESCE(pe.sets, 1), 1)) AS gs(n)
WHERE pe.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM program_exercise_sets pes
     WHERE pes.program_exercise_id = pe.id
       AND pes.deleted_at IS NULL
  );
