-- ============================================================================
-- 20260426110000_message_threads_cascade_client_archive
-- ============================================================================
-- Why: Archiving a client used to leave their message_thread row visible with
-- deleted_at = NULL. The clients SELECT RLS filters deleted_at IS NULL, so the
-- inbox embed `clients(...)` came back as null — the thread rendered with a
-- blank name and "?" avatar. The page-level fix uses an inner join to drop
-- those rows from the inbox, but the underlying data is still off: the thread
-- should mirror the client's archive state.
--
-- This trigger keeps message_threads.deleted_at in lockstep with the parent
-- client's deleted_at, in both directions:
--   - client soft-deleted  → thread soft-deleted (same timestamp)
--   - client restored      → thread restored
--
-- SECURITY DEFINER so the cascade can write to message_threads even when the
-- caller's role couldn't (e.g., the soft-delete RLS gotcha — UPDATE on a row
-- whose new state would fail the SELECT policy returns no rows). Search path
-- is pinned to defeat search-path injection.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.client_cascade_thread_archive()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Client just got archived → archive any live thread for them.
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    UPDATE message_threads
       SET deleted_at = NEW.deleted_at,
           updated_at = now()
     WHERE client_id = NEW.id
       AND deleted_at IS NULL;

  -- Client just got restored → un-archive their thread (if it was archived
  -- by us; we don't try to distinguish — there's only ever one thread per
  -- client and the FK + UNIQUE (org, client_id) keeps that invariant).
  ELSIF NEW.deleted_at IS NULL AND OLD.deleted_at IS NOT NULL THEN
    UPDATE message_threads
       SET deleted_at = NULL,
           updated_at = now()
     WHERE client_id = NEW.id
       AND deleted_at IS NOT NULL;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.client_cascade_thread_archive() IS
  'AFTER UPDATE trigger on clients — keeps message_threads.deleted_at in sync with the parent client.deleted_at.';

CREATE TRIGGER clients_cascade_thread_archive
  AFTER UPDATE OF deleted_at ON clients
  FOR EACH ROW
  WHEN (NEW.deleted_at IS DISTINCT FROM OLD.deleted_at)
  EXECUTE FUNCTION public.client_cascade_thread_archive();


-- ----------------------------------------------------------------------------
-- Backfill: any thread whose client is currently archived but whose own
-- deleted_at is null is an orphan from before this trigger existed. Sync it
-- to the client's deleted_at so the audit trail reflects when archival
-- *effectively* happened (when the client was archived), not now.
-- ----------------------------------------------------------------------------
UPDATE message_threads mt
   SET deleted_at = c.deleted_at,
       updated_at = now()
  FROM clients c
 WHERE mt.client_id = c.id
   AND c.deleted_at IS NOT NULL
   AND mt.deleted_at IS NULL;
