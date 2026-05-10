-- ============================================================================
-- 20260510140000_client_get_week_overview
-- ============================================================================
-- Why: The portal Today screen renders a per-day card with exercise names
-- visible in the preview list. The original page query embedded
-- exercise:exercises(name) inside a SELECT against program_days, but the
-- exercises table is staff-only at the RLS layer (see
-- 20260420102600_rls_enable_and_policies.sql lines 445-465). PostgREST
-- silently drops the embedded join under RLS, the page falls back to a
-- literal "Exercise" placeholder, and the screen becomes unreadable.
--
-- The fix follows the same contract noted at the top of
-- 20260420102500_client_portal_functions.sql: the only paths a client takes
-- to data their role cannot read directly under RLS are SECURITY DEFINER
-- RPCs pinned to auth.uid(). This adds one such RPC tailored to the Today
-- screen's needs:
--
--   client_get_week_overview(week_start_date)
--     → all PUBLISHED program_days with scheduled_date in
--       [week_start_date, week_start_date + 7 days), for the caller's own
--       active program. For each day, returns a jsonb array of exercise
--       summaries (name, sort_order, sets, reps, optional_value, rpe,
--       superset_group_id) — exactly what the Today preview renders.
--
-- Posture mirrors the existing RPC family:
--   - SECURITY DEFINER + SET search_path = public, pg_temp
--   - auth.uid() pin in the join
--   - REVOKE FROM PUBLIC + GRANT EXECUTE TO authenticated
--   - No anon access
--
-- Why a per-week RPC and not per-day in a loop:
--   - The Today page renders once per visit; one round trip beats up to 7.
--   - The return shape is tailored to the preview line — just the columns
--     the page consumes — so the wire payload is smaller than the existing
--     client_get_program_day_exercises (which carries prescription_sets
--     jsonb for the in-session logger).
--
-- Why scheduled_date + interval and not week_number:
--   - Post-D-PROG-001 the addressing field is scheduled_date, not
--     week_number (see docs/schema.md line 141). Calendar-week queries
--     are direct date-range filters; copy/repeat-created days work
--     unchanged.
-- ============================================================================
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
                   'rpe',                 COALESCE(pe.rpe,          e.default_rpe)
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
  'Returns published program_days in the calling client''s active program for the calendar week starting on p_week_start_date, with a jsonb summary of each day''s exercises (name + prescription scalars). Single-trip read for the portal Today screen — replaces the broken PostgREST embed exercise:exercises(name) which fails under the staff-only exercises RLS.';
