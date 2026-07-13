-- ============================================================================
-- 20260713140000_message_attachment_delete_rls_fix
-- ============================================================================
-- Reviewer finding (b), 2026-07-13. The uploader-orphan DELETE policy on
-- storage.objects (added in 20260713130000) guarded the blob with an inline
--   AND NOT EXISTS (SELECT 1 FROM message_attachments WHERE storage_path = name)
-- subquery. That subquery runs under the CALLER's RLS, and the
-- message_attachments SELECT policies scope a client to their OWN, NON-ARCHIVED
-- thread. So if a thread is archived (message_threads.deleted_at set — e.g. the
-- client is archived, via client_cascade_thread_archive), the referencing row
-- becomes invisible to the client, NOT EXISTS flips to true, and the client
-- could DELETE a *committed* photo blob: the message row + audit row persist,
-- the blob vanishes, and "immutable, like messages" is quietly broken for
-- archived threads.
--
-- Fix: resolve "is this path still referenced?" through a SECURITY DEFINER
-- helper that bypasses RLS, so the check sees ALL referencing rows regardless
-- of the caller's visibility. The function returns only a boolean about
-- reference existence (no row data), so exposing it to authenticated is a
-- negligible oracle, not a data leak. Locked by pgTAP 59 (archived-thread
-- assertion).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.message_attachment_path_referenced(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.message_attachments WHERE storage_path = p_name
  );
$$;

COMMENT ON FUNCTION public.message_attachment_path_referenced(text) IS
  'True when a message_attachments row references this storage path. SECURITY DEFINER so the storage DELETE policy sees referencing rows in ARCHIVED threads too (the caller''s RLS would hide them — reviewer finding b, 2026-07-13). Returns a boolean only.';

REVOKE EXECUTE ON FUNCTION public.message_attachment_path_referenced(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.message_attachment_path_referenced(text) TO authenticated;

-- Replace the DELETE policy to use the RLS-bypassing helper.
DROP POLICY "uploader delete orphan message-attachment blobs" ON storage.objects;

CREATE POLICY "uploader delete orphan message-attachment blobs"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'message-attachments'
    AND (owner = auth.uid() OR owner_id = auth.uid()::text)
    AND NOT public.message_attachment_path_referenced(name)
  );
