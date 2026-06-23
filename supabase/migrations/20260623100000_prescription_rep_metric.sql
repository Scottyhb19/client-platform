-- ============================================================================
-- 20260623100000_prescription_rep_metric
-- ============================================================================
-- Why: Dogfooding capture 2026-06-23 — timed / distance prescriptions.
-- Gap doc: docs/polish/prescription-volume-unit.md (item 1, gap VU-1).
--
-- A prescription set today has a free-text `reps` value plus ONE optional
-- metric slot (load OR rpe OR time OR distance — one at a time). That single
-- slot can't express a loaded carry (distance AND weight at once), and a
-- timed hold is only typeable as unstructured free text that the client
-- portal then mislabels as "reps".
--
-- Fix: give the VOLUME axis its own unit. A new nullable `rep_metric` column
-- on the exercise default, the per-set prescription, the template set, and
-- the logged set. The value still lives in the existing `reps` /
-- `reps_performed` columns; `rep_metric` only says what that number MEANS:
--
--   NULL            -> a plain rep count   (every existing row reads correctly)
--   'time_minsec'   -> seconds  (stored as a number, rendered Ns / m:ss)
--   'distance_m'    -> metres
--   'distance_km' / 'distance_miles' -> longer efforts (DB-allowed; the UI
--                       exposes only Reps / Seconds / Metres for now — Q-B)
--
-- The codes match exercise_metric_units.code. Consistent with the existing
-- `default_metric` column, `rep_metric` is plain text with NO db CHECK and
-- NO FK — it is validated in the application layer (mirrors validateMetricCode
-- for default_metric) so unit renames never ripple into historical rows and
-- the UI owns which subset is offered. The LOAD axis (optional_metric /
-- weight_metric) is untouched and now only ever means load.
--
-- Additive + nullable, so this is backward-compatible with the currently
-- deployed code (which never selects or writes the column). No backfill:
-- NULL is the correct value for every existing prescription and log row.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1. exercises — the library default volume unit.
-- ----------------------------------------------------------------------------
ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS default_rep_metric text;

COMMENT ON COLUMN exercises.default_rep_metric IS
  'Unit for the default volume value in default_reps. NULL = reps; otherwise an exercise_metric_units time/distance code (time_minsec, distance_m, ...). Plain text, app-validated, no FK (mirrors default_metric). Added 2026-06-23 (VU-1).';


-- ----------------------------------------------------------------------------
-- §2. program_exercise_sets — the per-set prescription volume unit.
-- ----------------------------------------------------------------------------
ALTER TABLE program_exercise_sets
  ADD COLUMN IF NOT EXISTS rep_metric text;

COMMENT ON COLUMN program_exercise_sets.rep_metric IS
  'Unit for this set''s volume value in reps. NULL = reps; otherwise an exercise_metric_units time/distance code. Frees the optional_metric slot to always mean load. Added 2026-06-23 (VU-1).';


-- ----------------------------------------------------------------------------
-- §3. template_exercise_sets — so template save/instantiate keeps fidelity.
-- ----------------------------------------------------------------------------
ALTER TABLE template_exercise_sets
  ADD COLUMN IF NOT EXISTS rep_metric text;

COMMENT ON COLUMN template_exercise_sets.rep_metric IS
  'Unit for this template set''s volume value in reps. NULL = reps; otherwise an exercise_metric_units time/distance code. Carried by save_program_as_template / create_program_from_template. Added 2026-06-23 (VU-1).';


-- ----------------------------------------------------------------------------
-- §4. set_logs — what unit the client actually logged against.
-- ----------------------------------------------------------------------------
ALTER TABLE set_logs
  ADD COLUMN IF NOT EXISTS rep_metric text;

COMMENT ON COLUMN set_logs.rep_metric IS
  'Unit for the logged volume value in reps_performed. NULL = reps; otherwise an exercise_metric_units time/distance code (e.g. time_minsec for a 30s hold logged as 30). Added 2026-06-23 (VU-1).';
