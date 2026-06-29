-- ============================================================================
-- 20260629130000_fix_unavailable_block_cancelled_status
-- ============================================================================
-- Data correction. An unavailable block (admin / meeting / note time,
-- kind='unavailable') is the EP's own time-blocking. Its only lifecycle is
-- create (status='confirmed') → remove (soft-delete, deleted_at). It is NEVER
-- legitimately "cancelled" / "no_show" / "completed" — those are client-
-- appointment states.
--
-- BEFORE section 9 (P2-8, 20260616120000) the "Remove" action on an unavailable
-- block called the cancel path, leaving the row at status='cancelled' instead of
-- soft-deleting it. Such rows are corrupt: they render with the cancelled grey
-- style, get swept up by the schedule's "Hide cancelled" toggle, and would count
-- toward the Analytics cancellation rate — none of which should ever happen to an
-- admin block.
--
-- This resets any live unavailable block sitting in a client-only status back to
-- 'confirmed', satisfying appointments_confirmed_fields (confirmed_at NOT NULL)
-- and clearing the stale cancellation/no-show bookkeeping. Idempotent — re-runs
-- match nothing. (A genuinely removed block is already soft-deleted, so the
-- deleted_at IS NULL guard leaves those alone.)
--
-- The companion UI guard (the "Hide cancelled" filter is scoped to
-- kind='appointment') keeps the toggle correct going forward; this migration
-- cleans the existing artifact.
-- ============================================================================

UPDATE appointments
   SET status              = 'confirmed',
       confirmed_at        = COALESCE(confirmed_at, created_at),
       cancelled_at        = NULL,
       cancellation_reason = NULL,
       cancelled_by_role   = NULL,
       no_show_marked_at   = NULL
 WHERE kind         = 'unavailable'
   AND deleted_at   IS NULL
   AND status NOT IN ('pending', 'confirmed');
