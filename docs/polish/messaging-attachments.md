# Messaging attachments — gap analysis (structural re-entry)

**Status: GO received 2026-07-13 (operator approved the gap list with the recommended §6 answers: 10 MB client photo cap, 4 attachments per message). Implemented same day — every gap below carries a close note; the Closing commit is at the bottom. Held for the operator's browser pass (ATT-1..ATT-8 in `test_scenarios_template.md`) before commit, per the standing verification gate.**

Date: 2026-07-13
Lineage: this is the documented re-trigger in `docs/polish/messaging.md` §5 firing —
*"Attachments stay stubbed … Re-trigger: a beta tester needs to send a photo (e.g. an
exercise form-check)."* The operator has asked for exactly that. Because it adds a new
schema surface (a table), a new storage bucket, and a genuinely new security surface
(the first client-role **write** access to Supabase Storage anywhere in the platform),
it re-enters the full seven-step polish protocol rather than the four-bucket dogfooding
loop. Steps 1–2 (brief + audit) were completed via read-only recon on 2026-07-13.

## §1 Approved scope (operator decisions, 2026-07-13)

| Decision | Answer |
| --- | --- |
| Staff can attach | Any file (mirrors `client-files` rules: 25 MB, executable extensions blocked) |
| Client can attach | **Photos only** (camera/gallery images) |
| Photo-only message | **Yes** — a message may carry attachments and an empty body |
| Deletion | **Immutable, like messages** — no delete affordance in the beta; operator hard-deletes via SQL if ever needed |
| Client photo size cap | **10 MB** (§6 Q1, confirmed with the GO) |
| Attachments per message | **Up to 4** (§6 Q2, confirmed with the GO) |

Out of scope (not approved, do not build): video upload (YouTube-only rule stands),
attachment editing/replacing, client file (non-image) attachments, galleries/albums,
paste-to-attach, drag-and-drop polish beyond a basic file input.

## §2 Audit summary (what exists today — recon 2026-07-13)

- `messages` / `message_threads` (`20260425100000_messages.sql`): one thread per client
  per org; `messages.body` CHECK `length(trim(body)) BETWEEN 1 AND 1000`; RLS INSERT
  policies pin `sender_role` + `sender_user_id = auth.uid()`; client INSERT keyed on
  thread ownership; UPDATE recipient-only (`20260620120000`), DELETE denied.
- **Immutability trigger** `message_enforce_immutability` (`20260618120100`): column-explicit,
  freezes every `messages` column except `read_at`, raises P0001. Any attachment design
  that UPDATEs `messages` after insert collides with it.
- Audit: `audit_messages` / `audit_message_threads` + resolver registration
  (`20260618120200`); `assert_audit_resolver_coverage()` is the mandated guard.
- pgTAP `34_message_rls.sql`: plan(17), JWT-spoof fixtures, covers isolation,
  immutability, read_at recipient-only, anon-EXECUTE.
- Storage: **one** migration-managed bucket, `client-files` (`20260428100000`) — private,
  25 MB, path `{org_id}/{client_id}/{file_id}.{ext}`, `storage.objects` policies
  **staff-only**. No client anywhere can write to storage today. Reference upload code:
  `src/app/(staff)/clients/[id]/files-actions.ts` (validation, blob rollback on insert
  failure, signed URLs).
- UI: staff composer already has the disabled Paperclip
  (`src/app/(staff)/messages/_components/Inbox.tsx:517–525`); portal composer has none.
  Both sides render `body` as plain React-escaped text; both do optimistic inserts of a
  full `MessageRow`; realtime is `postgres_changes` INSERT on `messages`.

## §3 Proposed shape (for challenge, not yet contract)

- **`message_attachments` table** — INSERT-only child of `messages`:
  `id`, `message_id` (FK RESTRICT), `organization_id` (denormalised, FK RESTRICT),
  `thread_id` (denormalised, FK RESTRICT — feeds the storage path check),
  `storage_path text NOT NULL UNIQUE`, `file_name`, `mime_type`, `byte_size`,
  `kind` CHECK in (`'image'`,`'file'`), `created_at`. No UPDATE policy, DELETE denied,
  plus its own immutability posture (no mutable columns at all). Same-org FK triggers
  as siblings. Registered in `audit_resolve_org_id()` + audit trigger + coverage assert.
- **Messages body relaxation** — photo-only messages need the body CHECK relaxed. A CHECK
  cannot see the child table, so: add `has_attachments boolean NOT NULL DEFAULT false`
  to `messages` (set in the INSERT, frozen thereafter by the immutability trigger —
  compatible), CHECK becomes `(length(trim(body)) BETWEEN 1 AND 1000) OR
  (has_attachments AND length(trim(body)) <= 1000)`. The forge risk (has_attachments
  true, no child row → empty message) is closed by making the atomic send RPC the only
  path that can set it (column-level privilege or WITH CHECK `has_attachments = false`
  on the direct INSERT policies).
- **Atomic send** — `send_message_with_attachments(...)` RPC. *Corrected at
  implementation from the draft's INVOKER preference:* the design pins `has_attachments =
  false` in the direct INSERT policies and gives `message_attachments` no INSERT policy
  at all, so an INVOKER function would be blocked by the very policies it sits behind —
  the RPC is **SECURITY DEFINER with in-body guards** (auth, thread ownership per role,
  path-prefix, blob existence/uploader/mimetype/size read from `storage.objects`, never
  trusted from the caller). This is the messaging surface's own stated pattern
  (20260618120100: "any new mutable path gets its own definer RPC"), and the guards are
  pgTAP-covered. Upload-first, insert-second; on RPC failure the browser removes the
  blobs (uploader-orphan DELETE policy).
- **Bucket** `message-attachments` — private, path `{org_id}/{thread_id}/{attachment_id}.{ext}`.
  `storage.objects` policies: staff SELECT/INSERT org-scoped (copy `client-files`);
  **client SELECT/INSERT keyed on thread ownership** — `(storage.foldername(name))[1]` =
  own org AND `(storage.foldername(name))[2]` resolves to the caller's own thread via
  `message_threads` ⋈ `clients.user_id = auth.uid()`. Client INSERT additionally requires
  `metadata->>'mimetype' LIKE 'image/%'` (photos-only enforced at the storage boundary,
  not just the UI). No UPDATE/DELETE policies for either role (immutability).
- **Serving** — short-lived signed URLs via server action, gated by `message_attachments`
  RLS before minting. Images render as bubbles' `<img>`; staff-sent files render as a
  download chip. **Never** render SVG inline (script-bearing); non-image files are always
  `download:` disposition.
- **Preview/notification** — `message_update_thread_last` currently previews `left(body,140)`;
  photo-only messages must show `[Photo]` (and the new-message email debounce continues to
  carry no content — unchanged posture).

## §4 Premortem — ranked failure modes

Infrastructure/security weighted production-grade; UX at f&f scope.

| # | Failure mode | Likelihood | Impact | Notes |
| --- | --- | --- | --- | --- |
| FM-A | **Storage RLS hole**: a client writes or reads blobs outside their own thread path (cross-tenant or cross-client photo access). This is the first client-write storage policy in the platform — net-new pattern, nothing to copy. | Medium | Critical — health-adjacent photo leak = notifiable breach | pgTAP must exercise storage.objects policies directly, both roles, both directions |
| FM-B | `message_attachments` **table RLS gap** — metadata (file names can carry PII) readable cross-tenant or cross-client | Medium | High | Same fixture pattern as pgTAP 34 |
| FM-C | **Immutability collision** — any post-insert UPDATE to `messages` (e.g. a two-phase "insert then flag attachments") hits P0001 and the send flow breaks in production | High if designed wrong | High | Designed out in §3: `has_attachments` set in the INSERT; attachments are a child table |
| FM-D | **has_attachments forged** — direct PostgREST INSERT with `has_attachments=true`, empty body, no child row → empty messages, defeating the body CHECK | Medium | Medium | WITH CHECK pins `has_attachments=false` on direct INSERT policies; only the RPC sets true |
| FM-E | **Malicious content served** — SVG/HTML uploaded as an "image" executes script when rendered inline; executable disguised as attachment | Medium | High | Image mime allow-list for inline render (jpeg/png/webp/gif/heic), SVG excluded; staff files force download; extension blocklist reused |
| FM-F | **Orphaned blobs** — upload succeeds, message insert fails; PII photo persists in storage with no DB record, invisible to audit | Medium | Medium | Rollback-remove on failure (existing pattern) + a documented SQL sweep query in the runbook |
| FM-G | Photo **EXIF/GPS retained** — client photos carry location metadata, visible to staff and stored indefinitely | High (all phone photos) | Low at f&f (staff already trusted with the photo itself) | Accept for beta, record here; re-trigger: any non-f&f user, or the SaaS fork |
| FM-H | **Audit resolver drift** — new table not registered → coverage assert fails the migration, or worse, silently missing audit rows if the assert is skipped | Low (assert exists) | Medium | Standard registration + `assert_audit_resolver_coverage()` |
| FM-I | **Preview dishonesty** — photo-only message shows an empty thread preview / empty notification line; inbox looks broken | High | Low | `[Photo]` fallback in `message_update_thread_last` (function replacement migration — arity unchanged) |
| FM-J | **Mobile upload failure mid-send** — flaky connection, photo half-sent; optimistic bubble shows a message that never landed | Medium | Medium at f&f | Honest inline error + retry; optimistic row only confirmed on RPC success (existing pattern) |
| FM-K | **HEIC papercut** — iPhone camera photos may land as HEIC; staff browser may not render | Medium | Low | `<input accept="image/*">` lets iOS transcode to JPEG in most flows; accept HEIC mime, note in scenarios; escalate only if seen in practice |
| FM-L | **Realtime shape drift** — `payload.new` now includes `has_attachments` but not the child rows; recipient sees the message bubble without its photo until refresh | High if unhandled | Low–Medium | On INSERT event with `has_attachments`, fetch the attachment rows before rendering |

## §5 Gap list (the contract, pending approval)

### P0 — architectural / security
- **G-1** Migration: `message_attachments` table + RLS (staff org-scoped SELECT/INSERT;
  client SELECT/INSERT keyed on own thread; no UPDATE; DELETE denied) + same-org FK
  triggers + audit trigger + resolver registration + coverage assert. *(FM-B, FM-H)*
- **G-2** Migration: `message-attachments` bucket + `storage.objects` policies per §3,
  including the client image-mime restriction at the policy level. *(FM-A, FM-E)*
- **G-3** Migration: `messages.has_attachments` column + relaxed body CHECK + WITH CHECK
  `has_attachments = false` added to both direct INSERT policies + the
  `send_message_with_attachments` SECURITY INVOKER RPC as the only true-path.
  Immutability trigger untouched (column set at INSERT). *(FM-C, FM-D)*
- **G-4** pgTAP: extend `34_message_rls.sql` (or a sibling `35_message_attachments.sql`):
  cross-tenant + cross-client isolation on the table AND on `storage.objects` rows for
  both roles; client cannot write another thread's path; client cannot insert a non-image
  mime; direct INSERT cannot set `has_attachments=true`; RPC path works; attachment rows
  immutable. *(FM-A, FM-B, FM-D)*

### P1 — functional
- **G-5** Staff composer: enable the Paperclip (`Inbox.tsx`) — file picker, client-files
  validation rules (25 MB, extension blocklist), upload → RPC send, optimistic row,
  inline error on failure, blob rollback on insert failure. *(FM-F, FM-J)*
- **G-6** Portal composer: photo button (`accept="image/*"`), upload → RPC send, same
  error honesty. Photo-only send allowed (empty body). *(FM-J, FM-K)*
- **G-7** Rendering both sides: image bubbles via short-lived signed URLs minted by a
  server action gated on RLS; staff file attachments render as a download chip; SVG never
  inline; non-images always download-disposition. Realtime INSERT handler fetches
  attachment rows when `has_attachments`. *(FM-E, FM-L)*
- **G-8** `message_update_thread_last`: `[Photo]` / `[File]` preview fallback for
  empty-body messages (function replacement, same arity). *(FM-I)*

### P2 — polish
- **G-9** Upload progress affordance (spinner on the send button is acceptable at f&f).
- **G-10** Runbook note: orphaned-blob sweep query + the SQL hard-delete recipe for an
  attachment the operator must remove (the immutability escape hatch). *(FM-F)*
- **G-11** Scenarios in `test_scenarios_template.md` for every behaviour above
  (maintenance rule — lands with the code, listed here for completeness).

### Consciously accepted (recorded, not built)
- FM-G EXIF/GPS retention — accepted at f&f scope. **Re-trigger:** any non-f&f user
  onboards, or the SaaS fork is taken.
- No client-side image compression/resize — original photos up to the size cap.
  **Re-trigger:** storage cost or upload-failure reports at real usage.

## §6 Open questions for the operator (answer with GO)

1. **Client photo size cap** — recommend 10 MB per photo (a phone photo is 2–5 MB;
   25 MB stays the staff file cap). Confirm or set a number.
   **ANSWERED with the GO: 10 MB.**
2. **Attachments per message** — recommend up to 4 (covers a multi-angle form check
   without inviting galleries). Confirm or set a number.
   **ANSWERED with the GO: 4.**

## §7 Gap closes (implementation notes, 2026-07-13)

- **G-1 CLOSED** — migration `20260713130000_message_attachments.sql`: table +
  composite FK `(message_id, thread_id) → messages(id, thread_id)` (thread mismatch
  impossible at the DB), read-only RLS (staff org / client own-thread), deny-DELETE,
  belt-and-braces immutability trigger, audit trigger + resolver registration
  (based on the latest 20260629140000 body) + `assert_audit_resolver_coverage()`
  passing at push.
- **G-2 CLOSED** — same migration: private `message-attachments` bucket (25 MB),
  staff org-scoped read/write, client thread-keyed read/write with an image
  **extension** check in the INSERT policy (deliberate: `metadata->>'mimetype'` is
  populated by the storage service after row insert, so it is not evaluable in a
  WITH CHECK — the authoritative mime check lives in the RPC), and an
  uploader-and-orphan-only DELETE policy as the rollback path.
- **G-3 CLOSED** — `messages.has_attachments` (frozen by the extended immutability
  trigger; both direct INSERT policies pin it false), body CHECK relaxed to allow
  an empty body only when `has_attachments`, and the DEFINER RPC (see §3
  correction) as the sole attachment write path.
- **G-4 CLOSED** — `supabase/tests/database/59_message_attachments.sql`, plan(20),
  **20/20 green on the live project** (BEGIN/ROLLBACK); suite 34 re-run **17/17**
  after the messages-side changes. Storage fixtures are created *through* the
  client upload policy, so the first client-write storage policy is itself
  load-bearing in the suite.
- **G-5 CLOSED** — staff paperclip live (`Inbox.tsx`): picker, 25 MB + blocklist
  checks at pick time, browser-direct upload, RPC send, orphan rollback on
  failure, pending-file chips, Sending… state (no optimistic bubble for
  attachment sends — deliberate honesty over the slow upload path).
- **G-6 CLOSED** — portal photo button (`ClientThread.tsx`): `accept="image/*"`,
  10 MB / 4-photo checks, thumbnail previews (object URLs, revoked), photo-only
  send allowed, same rollback + honesty pattern.
- **G-7 CLOSED** — shared `MessageAttachments` bubble component
  (`src/components/messages/MessageAttachments.tsx`): images inline via
  1-hour signed URLs minted server-side (`attachments-server.ts`), file chips
  minting a 60 s download URL on click (original filename via download
  disposition), SVG can never render inline (RPC classifies it kind='file'),
  URL-less images fall back to the chip. Realtime INSERTs with
  `has_attachments` fetch views via a role-scoped action (FM-L).
- **G-8 CLOSED** — `message_update_thread_last` replaced (same migration):
  empty-body messages preview as `[Attachment]`.
- **G-9 CLOSED** — Sending… state on both composers (accepted f&f-scope form).
- **G-10 CLOSED** — `docs/runbooks/message-attachments-orphan-sweep.md`: orphan
  query + removal recipe + the referenced-attachment escape hatch.
- **G-11 CLOSED** — scenarios ATT-1..ATT-8 in `test_scenarios_template.md`.

## Closing commit

**What changed.** The full approved scope (§1, including the GO'd §6 numbers)
shipped in one pass: migration `20260713130000_message_attachments.sql` (G-1/2/3/8),
pgTAP suite 59 (G-4, 20/20 live; suite 34 regression 17/17), the browser-direct
upload path + both composers + the shared bubble renderer (G-5/6/7), and the
close-out artefacts (G-9/10/11). One design correction against the draft is
recorded in §3: the send RPC is SECURITY DEFINER (with pgTAP-covered in-body
guards), not INVOKER, because the policy pins that make direct writes safe would
have blocked an INVOKER function too.

**Tests.** pgTAP 59: 20/20 on the live project (cross-tenant + within-org
isolation on both the table and storage.objects, client write-policy positive +
negative paths, RPC guards, immutability, audit, anon grants, body-CHECK scope).
Suite 34: 17/17 re-run. `tsc --noEmit` and `next build` green. Browser matrix
ATT-1..ATT-8 **pending the operator's pass** — this build is staged, not
committed, until that pass.

**Deliberately deferred / accepted** (from §4, unchanged by implementation):
FM-G EXIF/GPS retention (re-trigger: any non-f&f user, or the SaaS fork);
no client-side image compression (re-trigger: storage cost or upload-failure
reports); FM-K HEIC render quality on staff browsers (accepted; revisit on a
real report); 1-hour image signed-URL expiry means a tab left open longer
re-renders a broken img until refresh (accepted at f&f scope).

**Premortem outcomes.** FM-A/FM-B mitigated and pgTAP-locked (tests 1-5, 13-16);
FM-C designed out (child table + INSERT-time flag; trigger extended to freeze
it); FM-D closed by the policy pin (test 12); FM-E mitigated (SVG never inline,
extension blocklist both layers, download disposition for files); FM-F mitigated
(rollback on both failure paths + runbook sweep); FM-H closed (resolver +
coverage assert); FM-I closed ([Attachment] preview); FM-J mitigated (honest
inline errors, no lying optimistic bubble); FM-L closed (realtime view fetch).
FM-G and FM-K accepted as above.
