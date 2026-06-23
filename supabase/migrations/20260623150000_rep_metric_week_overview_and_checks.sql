-- ============================================================================
-- 20260623150000_rep_metric_week_overview_and_checks
-- ============================================================================
-- Why: reviewer follow-up on the prescription-volume-unit pass
-- (docs/polish/prescription-volume-unit.md sign-off review).
--
-- §1 closes FM-5 on the portal Today-screen preview. client_get_week_overview
-- returned each exercise's 'reps' without 'rep_metric', so the preview's
-- buildRx() rendered a hold as "3 × 30" instead of "3 × 30s" (the one FM-5
-- read surface VU-7 didn't close by name). Add rep_metric to the per-exercise
-- summary, sourced from exercises.default_rep_metric — parallel to how reps
-- already falls back to e.default_reps (the preview is a defaults-level glance;
-- the accurate per-set unit is on the in-session logger, VU-6). Base body is
-- the LATEST replacement (20260612090100, which dropped the default_rpe
-- fallback) — NOT the original 20260510140000, which would resurrect the
-- dropped column. Same signature → CREATE OR REPLACE, no DROP.
--
-- §2 hardens the rep_metric columns with a value CHECK (the reviewer's noted
-- residual: VU-1 left rep_metric app-validated only, so a direct write could
-- store garbage). rep_metric's valid set is small and FIXED — the time/
-- distance unit codes — unlike default_metric's open, org-configurable set,
-- so a DB CHECK is the correct tool here and does not inherit default_metric's
-- rename-stability concern (these are stable seed codes). NULL stays valid
-- (= a plain rep count). Existing rows are all NULL or curated-UI values, so
-- the constraints validate clean.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1. client_get_week_overview — add rep_metric to the exercise summary.
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
                   'rep_metric',          e.default_rep_metric,
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
  'Returns published program_days in the calling client''s active program for the calendar week starting on p_week_start_date, with a jsonb summary of each day''s exercises (name + prescription scalars). 2026-06-23: each exercise carries rep_metric (the volume unit from exercises.default_rep_metric) so the portal preview renders "3 × 30s" for a timed exercise, not "3 × 30" (FM-5).';


-- ----------------------------------------------------------------------------
-- §2. Value CHECK on the rep_metric columns (reviewer-noted residual).
-- ----------------------------------------------------------------------------
ALTER TABLE exercises
  ADD CONSTRAINT exercises_default_rep_metric_valid
  CHECK (default_rep_metric IS NULL
    OR default_rep_metric IN ('time_minsec','distance_m','distance_km','distance_miles'));

ALTER TABLE program_exercise_sets
  ADD CONSTRAINT program_exercise_sets_rep_metric_valid
  CHECK (rep_metric IS NULL
    OR rep_metric IN ('time_minsec','distance_m','distance_km','distance_miles'));

ALTER TABLE template_exercise_sets
  ADD CONSTRAINT template_exercise_sets_rep_metric_valid
  CHECK (rep_metric IS NULL
    OR rep_metric IN ('time_minsec','distance_m','distance_km','distance_miles'));

ALTER TABLE set_logs
  ADD CONSTRAINT set_logs_rep_metric_valid
  CHECK (rep_metric IS NULL
    OR rep_metric IN ('time_minsec','distance_m','distance_km','distance_miles'));
