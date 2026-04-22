-- ============================================================================
-- 20260421120000_program_day_published
-- ============================================================================
-- Why: The Session Builder's "Assign to {client}" button needs somewhere to
-- record publication intent. Without this gate, every program_day on an
-- active program would surface in the client portal the moment the EP
-- creates it — even half-built. Adding published_at lets the EP keep a
-- mesocycle's future days out of sight until prescription is finalised.
--
-- Semantics:
--   - published_at IS NULL        → day is draft; portal hides it.
--   - published_at IS NOT NULL    → day is visible on /portal (subject to
--                                   existing RLS visibility rules).
--   - Further edits stay live — re-publish is not required to push updates.
-- ============================================================================

ALTER TABLE program_days
  ADD COLUMN published_at timestamptz;

COMMENT ON COLUMN program_days.published_at IS
  'Set when the EP taps "Assign to {client}" on the Session Builder. '
  'Portal-visible days are only those with published_at IS NOT NULL. '
  'Subsequent edits to the day or its exercises take effect immediately; '
  'no re-publish needed.';

CREATE INDEX program_days_published_at_idx
  ON program_days (published_at)
  WHERE published_at IS NOT NULL AND deleted_at IS NULL;
