-- ============================================================================
-- 20260626120000_loaded_carry_default_metric_kg
-- ============================================================================
-- Why: Phase 1.5 dogfooding data fix (Change 2 / Decision B audit, 2026-06-26).
-- 13 loaded carries/drags are stored in the exercise library with a NULL load
-- metric (default_metric) while their volume axis is distance. Under the client
-- portal logger's metric-driven layout (Decision B: a load box appears only when
-- kg/lb is the prescribed load metric), these would render distance-only — with
-- no way for the client to log the carry/drag weight. kg IS the correct load
-- metric for every one of them; the NULL was a library-data gap, NOT a deliberate
-- "no load" (genuinely unloaded distance drills — A-Walk, Carioca, Crab walks,
-- Crossover Bound — are correctly left distance-only and are excluded here).
--
-- Audit provenance: docs/polish/client-portal-pwa.md §10 (Change 2 audit). The 13
-- are exactly the loaded entries from "GAP 3" (library distance exercises with no
-- load metric); the 6 unloaded drills in that set are intentionally excluded.
--
-- Surgical predicate: name IN (the 13) AND default_metric IS NULL AND
-- default_rep_metric LIKE 'distance%' — the exact under-specified signature, so
-- the statement cannot touch an unrelated future exercise that happens to share a
-- name, nor a carry an EP later configures deliberately. Global (all orgs): a
-- "Sled Push" with this signature is an under-specified loaded carry in any org.
--
--   §1 — library default_metric -> 'kg' (seeds future inserts/swaps with kg).
--   §2 — re-point existing live prescription sets whose optional_metric is NULL
--        for these exercises -> 'kg'. Dry-run 2026-06-26: 0 such rows; included
--        for completeness + to catch any prescription created before this applies.
--        optional_value is left NULL — the unit is prescribed, the actual weight
--        is the client's to log.
--
-- Data-only (no schema shape change) -> no type regen, no new pgTAP gate.
-- Idempotent: re-applying matches 0 rows (default_metric is no longer NULL); on a
-- fresh DB where this user library doesn't exist it matches 0 rows.
-- ============================================================================

-- §1. Library defaults — future inserts/swaps of these carries seed kg.
UPDATE exercises e
   SET default_metric = 'kg'
 WHERE e.deleted_at IS NULL
   AND e.default_metric IS NULL
   AND e.default_rep_metric LIKE 'distance%'
   AND e.name IN (
     'Backward Sled Drag (quad)','BB Overhead Carry','Bear-Hug Sandbag Carry',
     'DB SA Overhead Carry','Farmer''s Carry (DB)','Farmer''s Carry (handles)',
     'Farmer''s Carry (trap bar)','Forward Sled Drag','SA Bottoms-Up KB Carry',
     'SA Suitcase Carry (DB)','SA Suitcase Carry (KB)','Sled Push',
     'Zercher Carry (BB)'
   );

-- §2. Existing prescriptions of those carries that have no load metric yet.
-- Keyed on name + distance signature (not default_metric, which §1 just changed).
UPDATE program_exercise_sets pes
   SET optional_metric = 'kg'
  FROM program_exercises pe
  JOIN exercises e ON e.id = pe.exercise_id
 WHERE pes.program_exercise_id = pe.id
   AND pe.deleted_at  IS NULL
   AND e.deleted_at   IS NULL
   AND e.default_rep_metric LIKE 'distance%'
   AND e.name IN (
     'Backward Sled Drag (quad)','BB Overhead Carry','Bear-Hug Sandbag Carry',
     'DB SA Overhead Carry','Farmer''s Carry (DB)','Farmer''s Carry (handles)',
     'Farmer''s Carry (trap bar)','Forward Sled Drag','SA Bottoms-Up KB Carry',
     'SA Suitcase Carry (DB)','SA Suitcase Carry (KB)','Sled Push',
     'Zercher Carry (BB)'
   )
   AND pes.optional_metric IS NULL
   AND pes.deleted_at IS NULL;
