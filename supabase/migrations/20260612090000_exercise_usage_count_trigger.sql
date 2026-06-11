-- ============================================================================
-- 20260612090000_exercise_usage_count_trigger
-- ============================================================================
-- Why: Exercise library re-audit pass, gap G-1 / failure mode FM-1 in
-- /docs/polish/exercise-library.md (re-audit 2026-06-12, Q-A sign-off:
-- trigger mechanism).
--
-- exercises.usage_count has been a dead column since 20260420101500: the
-- column comment promised "incremented by application when adding to
-- program_exercises/template_exercises" and no application code or trigger
-- ever wrote it. Consequences (all live until this migration):
--   - the library card's "used N×" line never rendered,
--   - brief §5.1's "surfaces most-used exercises" was unimplemented,
--   - the delete-confirm's "Used in N program days" safety warning could
--     never fire — the EP deleted in-use exercises on a bare "Delete?".
--
-- Mechanism: AFTER INSERT row trigger on program_exercises (and
-- template_exercises, which carries the same exercise_id FK — zero rows
-- today, covered now so the templates feature inherits counting for free).
-- A DB trigger rather than application code because prescriptions are
-- inserted from multiple paths — addExerciseToDayAction (TS append),
-- insert_program_exercise_at, duplicate_program_day, copy/repeat RPCs —
-- and a trigger covers every current and future path identically.
--
-- Semantics: "times prescribed", monotonic. Soft-deleting a
-- program_exercise does NOT decrement — it was still prescribed. The
-- backfill below counts all program_exercises rows including soft-deleted
-- ones, matching the trigger's count-on-INSERT semantics.
--
-- Accepted trade-offs (documented in the polish doc §8):
--   - Each prescription insert now also writes one exercises audit row
--     (changed_fields: usage_count, updated_at). Low volume at
--     friends-and-family scale, and arguably a feature — the exercise's
--     audit trail gains its prescription events.
--   - touch_updated_at moves exercises.updated_at on every bump. Nothing
--     in the UI renders exercise updated_at today.
--
-- SECURITY DEFINER on the trigger function: the bump must succeed
-- regardless of caller context (staff RLS, SECURITY DEFINER RPC, future
-- client-context inserts). The function body is a single narrow UPDATE
-- keyed on NEW.exercise_id — no caller-controlled SQL surface.
-- exercises does not carry FORCE RLS, so the definer (table owner)
-- bypasses policies cleanly.
--
-- Trigger names deliberately do NOT start with "audit_" — the
-- assert_audit_resolver_coverage() guard (20260513160000) enumerates
-- audit_% triggers and must not pick these up.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1. Trigger function.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bump_exercise_usage_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE exercises
     SET usage_count = usage_count + 1
   WHERE id = NEW.exercise_id;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.bump_exercise_usage_count() IS
  'AFTER INSERT trigger on program_exercises / template_exercises: increments exercises.usage_count ("times prescribed", monotonic — soft-delete does not decrement). SECURITY DEFINER so the bump succeeds from any caller context.';

REVOKE EXECUTE ON FUNCTION public.bump_exercise_usage_count() FROM PUBLIC, anon, authenticated;


-- ----------------------------------------------------------------------------
-- §2. Attach to both prescription tables.
-- ----------------------------------------------------------------------------
CREATE TRIGGER program_exercises_bump_usage_count
  AFTER INSERT ON program_exercises
  FOR EACH ROW EXECUTE FUNCTION public.bump_exercise_usage_count();

CREATE TRIGGER template_exercises_bump_usage_count
  AFTER INSERT ON template_exercises
  FOR EACH ROW EXECUTE FUNCTION public.bump_exercise_usage_count();


-- ----------------------------------------------------------------------------
-- §3. Backfill. Counts every program_exercises row ever inserted
-- (soft-deleted included — see semantics above). template_exercises has
-- zero rows as of 2026-06-12 (templates feature not live); included in the
-- expression anyway so a re-run after templates ship stays correct.
-- Pre-flight (scripts/library-preflight-check.mjs, 2026-06-12): 168
-- program_exercises rows across 18 distinct exercises, all stored counts 0.
-- ----------------------------------------------------------------------------
UPDATE exercises e
   SET usage_count = sub.cnt
  FROM (
    SELECT exercise_id, count(*)::int AS cnt
      FROM (
        SELECT exercise_id FROM program_exercises
        UNION ALL
        SELECT exercise_id FROM template_exercises
      ) all_prescriptions
     GROUP BY exercise_id
  ) sub
 WHERE sub.exercise_id = e.id
   AND e.usage_count IS DISTINCT FROM sub.cnt;


-- ----------------------------------------------------------------------------
-- §4. Correct the stale column comment (previously promised application-
-- side increments that were never built).
-- ----------------------------------------------------------------------------
COMMENT ON COLUMN exercises.usage_count IS
  'How many times this exercise has been prescribed (program_exercises + template_exercises inserts). Maintained by the bump_exercise_usage_count() trigger since 20260612090000; monotonic — soft-deleting a prescription does not decrement.';
