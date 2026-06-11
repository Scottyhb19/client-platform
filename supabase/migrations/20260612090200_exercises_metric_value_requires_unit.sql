-- ============================================================================
-- 20260612090200_exercises_metric_value_requires_unit
-- ============================================================================
-- Why: Exercise library re-audit pass, gap G-6 / failure mode FM-6 in
-- /docs/polish/exercise-library.md (re-audit 2026-06-12). This was
-- acceptance gate 2 of the ORIGINAL 2026-05-05 pass ("new exercises cannot
-- be saved with the metric value present and the unit absent") — the gate
-- was written but the validation never was. A default_metric_value with a
-- NULL default_metric flows into program_exercise_sets as an unlabelled
-- number ("60" — of what?) in the session builder and the client portal.
--
-- Defence in depth: the server action (parseFormFields) gains the same
-- rule with a friendly inline error in the same commit-set; this CHECK is
-- the backstop that survives future form rewrites.
--
-- Backfill first — live-data check (scripts/library-preflight-check.mjs,
-- 2026-06-12) found exactly two violating rows, both fake/seed data
-- (operator confirmed no real client data in the live DB, 2026-06-11):
--   - "Kickstand Hinge"      value 'BW'  (active)      → unit 'bodyweight',
--     value cleared — "bodyweight" IS the load statement; the card
--     formatter renders the unit alone as "BW".
--   - "Barbell Back Squat"   value '80kg' (soft-deleted) → unit 'kg',
--     value normalised to '80' (the unit belongs in the unit column).
-- The backfills are pattern-based rather than id-pinned so a drifted
-- environment heals the same shapes; anything else still violating fails
-- the ADD CONSTRAINT loudly — a human decides, the migration never
-- silently discards values it can't classify.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1. Backfill the two known shapes.
-- ----------------------------------------------------------------------------
UPDATE exercises
   SET default_metric       = 'bodyweight',
       default_metric_value = NULL
 WHERE default_metric IS NULL
   AND default_metric_value IS NOT NULL
   AND upper(trim(default_metric_value)) IN ('BW', 'BODYWEIGHT');

UPDATE exercises
   SET default_metric       = 'kg',
       default_metric_value = trim(regexp_replace(default_metric_value, '\s*kg\s*$', '', 'i'))
 WHERE default_metric IS NULL
   AND default_metric_value IS NOT NULL
   AND default_metric_value ~* '^\s*[0-9]+([.,][0-9]+)?\s*kg\s*$';


-- ----------------------------------------------------------------------------
-- §2. The constraint. ALTER TABLE … ADD CONSTRAINT validates existing rows,
-- so any remaining violation aborts the push here — fail-loud by design.
-- ----------------------------------------------------------------------------
ALTER TABLE exercises
  ADD CONSTRAINT exercises_metric_value_requires_unit
  CHECK (default_metric_value IS NULL OR default_metric IS NOT NULL);

COMMENT ON CONSTRAINT exercises_metric_value_requires_unit ON exercises IS
  'A default load/metric value is meaningless without its unit. UI enforces this with an inline field error; this CHECK is the backstop. Unit without value remains legal (e.g. "track kg" with no default load).';
