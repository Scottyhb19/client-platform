-- ============================================================================
-- 20260612090100_drop_exercises_default_rpe
-- ============================================================================
-- Why: Exercise library re-audit pass, gap G-3 / failure mode FM-3 in
-- /docs/polish/exercise-library.md (re-audit 2026-06-12). Q-B sign-off
-- (operator, 2026-06-12): remove the RPE default from the library exercise
-- entirely — not options (a)/(b)/(c) from the gap entry.
--
-- Rationale, recorded as a deliberate deviation from brief §5.1 (which
-- lists "RPE target" inside the default prescription):
--
--   1. The Q6 per-set model (20260507100000, session-builder Phase C)
--      gives a prescribed set ONE optional column — it carries load OR
--      RPE, never both. A dedicated default_rpe therefore cannot inherit
--      alongside a load default, and neither default-application path
--      (addExerciseToDayAction, insert_program_exercise_at) ever read it.
--      A stored default that never inherits is a lie in the schema.
--   2. An RPE-target default remains fully expressible: 'rpe' is a seeded
--      exercise_metric_unit, so the EP sets Unit = "RPE (1-10)" and
--      Load = "8" in the library form — and THAT default inherits into
--      set rows through the existing pipeline, exactly like kg.
--   3. Bonus closure: client_get_week_overview carried a READ-TIME
--      fallback COALESCE(pe.rpe, e.default_rpe) — editing a library
--      default would retroactively change what a client sees on already-
--      published prescriptions, the exact retroactivity brief §5.2 calls
--      clinically dangerous. Removing the column removes the leak.
--
-- Live-data check (scripts/library-preflight-check.mjs, 2026-06-12):
-- exactly one row carries default_rpe (value 8) and it is soft-deleted
-- seed data ("Barbell Back Squat", deleted 2026-05-05). Nothing live is
-- discarded.
--
-- SQL-function consumers of e.default_rpe, verified by grep on 2026-06-12:
--   - client_get_program_day_exercises: the LIVE body (20260507100100)
--     does not reference it; only the superseded 20260420102500 text did.
--   - client_get_week_overview (20260510140000): LIVE consumer — replaced
--     below BEFORE the column drop, body otherwise verbatim.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1. client_get_week_overview without the default_rpe fallback.
-- Body verbatim from 20260510140000 except 'rpe' now reads pe.rpe alone.
-- (pe.rpe is the legacy parent-level prescription column — untouched here;
-- its convergence with the per-set model is a section-5 rider.)
-- Same signature — CREATE OR REPLACE is safe, no DROP needed.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.client_get_week_overview(p_week_start_date date)
RETURNS TABLE (
  program_day_id    uuid,
  scheduled_date    date,
  day_label         text,
  sort_order        int,
  exercises         jsonb
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    pd.id              AS program_day_id,
    pd.scheduled_date,
    pd.day_label,
    pd.sort_order,
    COALESCE(
      (
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'program_exercise_id', pe.id,
                   'sort_order',          pe.sort_order,
                   'section_title',       pe.section_title,
                   'superset_group_id',   pe.superset_group_id,
                   'name',                e.name,
                   'sets',                COALESCE(pe.sets,         e.default_sets),
                   'reps',                COALESCE(pe.reps,         e.default_reps),
                   'optional_value',      COALESCE(pe.optional_value, e.default_metric_value),
                   'rpe',                 pe.rpe
                 )
                 ORDER BY pe.sort_order
               )
          FROM program_exercises pe
          JOIN exercises e ON e.id = pe.exercise_id
         WHERE pe.program_day_id = pd.id
           AND pe.deleted_at     IS NULL
           AND e.deleted_at      IS NULL
      ),
      '[]'::jsonb
    )                  AS exercises
  FROM program_days pd
  JOIN programs    p ON p.id = pd.program_id
  JOIN clients     c ON c.id = p.client_id
  WHERE c.user_id           = auth.uid()
    AND c.deleted_at        IS NULL
    AND p.status            = 'active'
    AND p.deleted_at        IS NULL
    AND pd.deleted_at       IS NULL
    AND pd.published_at     IS NOT NULL
    AND pd.scheduled_date  >= p_week_start_date
    AND pd.scheduled_date  <  p_week_start_date + interval '7 days'
  ORDER BY pd.scheduled_date, pd.sort_order;
$$;

REVOKE EXECUTE ON FUNCTION public.client_get_week_overview(date) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.client_get_week_overview(date) TO authenticated;

COMMENT ON FUNCTION public.client_get_week_overview(date) IS
  'Returns published program_days in the calling client''s active program for the calendar week starting on p_week_start_date, with a jsonb summary of each day''s exercises (name + prescription scalars). 2026-06-12: rpe no longer falls back to the (dropped) exercises.default_rpe — prescription-level pe.rpe only, closing a read-time retroactivity leak.';


-- ----------------------------------------------------------------------------
-- §2. Drop the column (its 1–10 CHECK constraint goes with it).
-- ----------------------------------------------------------------------------
ALTER TABLE exercises DROP COLUMN default_rpe;
