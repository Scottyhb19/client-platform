# Message-attachments orphan sweep

**What an orphan is.** A blob in the `message-attachments` bucket with no
`message_attachments` row referencing it. Created when an upload succeeded but
the send RPC then failed (validation, connection drop) and the browser's
best-effort rollback also failed. Orphans are inert — the send RPC will never
reference them retroactively, clients can only read their own thread's paths,
and only the uploader can delete one — but they are health-adjacent bytes with
no DB record, so sweep them periodically (and always before a storage-cost
question turns into a mystery).

**Find orphans** (SQL Editor or `supabase db query --linked`):

```sql
SELECT o.name, o.created_at,
       (o.metadata ->> 'size')::bigint AS bytes,
       o.owner_id
  FROM storage.objects o
 WHERE o.bucket_id = 'message-attachments'
   AND NOT EXISTS (
     SELECT 1 FROM public.message_attachments ma
      WHERE ma.storage_path = o.name
   )
   -- Grace window: an upload mid-send looks like an orphan for a few seconds.
   AND o.created_at < now() - interval '1 hour'
 ORDER BY o.created_at;
```

Success signal: zero rows, or only rows you can explain (a send that failed
while you watched).

**Remove them.** Storage deletion is an API operation, not SQL — delete via
Dashboard → Storage → message-attachments (navigate to the listed paths), or
with the service-role key through `supabase.storage.from('message-attachments').remove([...paths])`.
Do NOT delete rows from `storage.objects` directly.

**The immutability escape hatch.** If the operator must remove a *referenced*
attachment (someone sent something they deeply regret), that is a deliberate
two-step service-role action, in this order:

```sql
-- 1. Capture then remove the DB row (service role; audit trigger snapshots it)
DELETE FROM public.message_attachments WHERE id = '<attachment-id>';
```

then remove the blob via the Dashboard/service-role API as above. The parent
message row stays (its `has_attachments` flag is frozen — the bubble simply
renders without the image). Record the action and reason in
`docs/incident-response.md` if it involved another person's content.
