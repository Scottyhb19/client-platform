-- ============================================================================
-- 20260503110000_drop_unique_active_program
-- ============================================================================
-- Why: Phase A of the programs polish pass. Decision D-PROG-002 in
-- /docs/decisions.md.
--
-- Drop the partial unique index that limits a client to one active
-- program at a time. Replace with a date-range non-overlap EXCLUDE
-- constraint so multiple consecutive blocks (created by the upcoming
-- "Repeat current block" toolbar action) can coexist with status='active'
-- as long as their date ranges don't overlap.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1. Ensure btree_gist is available so we can mix the equality match on
-- client_id with the range-overlap match on the daterange expression.
-- Idempotent — likely already installed for other features.
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;


-- ----------------------------------------------------------------------------
-- §2. Drop the existing single-active constraint.
-- ----------------------------------------------------------------------------
DROP INDEX IF EXISTS programs_one_active_per_client_idx;


-- ----------------------------------------------------------------------------
-- §3. Add the new EXCLUDE constraint. Two active programs for the same
-- client cannot have overlapping [start_date, start_date + duration_weeks*7)
-- date ranges. Inactive (draft / archived) programs are ignored — the
-- constraint only fires on active rows with both date and duration set.
--
-- The half-open interval '[start, end)' matches the Phase D "Repeat
-- current block" math: new_start = source.start_date + duration_weeks*7,
-- which is exactly the day after the last day of the source. Half-open
-- means start = previous end is allowed (no overlap at the boundary).
--
-- Soft-deleted rows are excluded. Programs without a start_date or
-- duration_weeks are excluded — those are still in the draft authoring
-- flow and can't be checked yet.
-- ----------------------------------------------------------------------------
ALTER TABLE programs
  ADD CONSTRAINT programs_no_active_overlap
  EXCLUDE USING gist (
    client_id WITH =,
    daterange(start_date, start_date + (duration_weeks * 7), '[)') WITH &&
  ) WHERE (
    status = 'active'
    AND deleted_at IS NULL
    AND start_date IS NOT NULL
    AND duration_weeks IS NOT NULL
  );

COMMENT ON CONSTRAINT programs_no_active_overlap ON programs IS
  'Two active programs for the same client cannot have overlapping date ranges. Replaces the legacy single-active-per-client unique index dropped 2026-05-03 (D-PROG-002).';
