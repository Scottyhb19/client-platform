# Messaging attachments — gap analysis (structural re-entry)

**Status: CLOSED (with deferred items) — reviewer sign-off 2026-07-13 (see Sign-off at the very bottom). Shipped across `59e523b` (feature) + `a8e76db` / migration `20260713140000` (security fix), all live on prod. Two returned security findings (a: caller-controlled stored mimetype; b: orphan-DELETE predicate under caller RLS) verified, fixed, pgTAP-locked (suite 59 23/23, suite 34 17/17). Operator browser pass GREEN. Deferred/accepted items carry re-triggers; the boundary marker (first client-write storage + first client PII photo path; velcroed non-prod-target + re-entry liabilities) is under Sign-off and indexed in `go-live-checklist.md` §8.**

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

## §8 Reviewer response — two security findings (2026-07-13, RETURNED → fixed)

The reviewer returned the section on two findings, both weighted at the
notifiable-breach line, and both correctly aimed at the one place the design
was asserted rather than proven. I verified each empirically/by-logic before
touching code (per the standing "verify, don't assert" rule), fixed both, and
locked what can be locked in pgTAP. Fixes shipped in the follow-up commit;
migration `20260713140000_message_attachment_delete_rls_fix.sql` is live.

### Finding (a) — the stored mimetype is caller-controlled (CONFIRMED)

**The claim.** §3/FM-E said "photos-only enforced at the storage boundary";
G-2 conceded the storage policy only checks extension and relocated the
"authoritative" mime check into the RPC reading `metadata->>'mimetype'` from
`storage.objects`, "never trusted from the caller." The reviewer flagged that
last clause as unverified.

**Verification (probe, 2026-07-13).** Uploaded 71 bytes of
`<svg><script>alert(1)</script></svg>` to `message-attachments` with
`Content-Type: image/png`. Read back: `metadata->>'mimetype'` = **`image/png`**
— i.e. the storage service records the uploader's declared Content-Type
verbatim; it does **not** sniff. Fetched a signed URL for it: served
**`Content-Type: image/png` with no `X-Content-Type-Options: nosniff`**. So the
reviewer was exactly right: a client can pass the extension policy and the RPC
mime check with non-image bytes, landing a blob classified `kind='image'`. The
RPC's mime check is **not** authoritative, and pgTAP could never have caught it
(the suite inserts `storage.objects` fixtures directly, choosing the mimetype —
it exercises the predicate, not the storage service's real behaviour).

**Why the DB layer cannot be the fix.** `storage.objects` holds metadata, not
bytes; plpgsql cannot read the blob body, so no RPC/trigger can content-sniff.
The authoritative boundary therefore cannot live in the DB. It has to be the
*render* layer, which the app fully controls and which the client cannot
bypass (they can only ever view what we serve).

**Fix (render-layer guarantee + send-layer defense-in-depth).**
1. **`<img>`-only rendering, no navigation to the raw URL.** `MessageAttachments`
   previously wrapped images in `<a href={signedUrl} target="_blank">` — a
   top-level navigation to a no-`nosniff` response, the one path a browser
   could content-sniff and execute. That anchor is **removed**. Images render
   solely through `<img>`, which browsers load in *secure static mode*: SVG
   scripts never execute, external subresources never load, and bytes that
   aren't a valid image just fail to decode (a broken image, never code).
   "View larger" is now an **in-DOM lightbox** (the same `<img>`, no
   navigation). This is the actual guarantee and it holds even for a blob
   crafted via a direct storage+RPC call that skips our UI entirely.
2. **Serve-type can't execute anyway.** The client RPC allow-list excludes
   `image/svg+xml`, and staff SVGs are classified `kind='file'` (download,
   never inline) — so we never serve an `image/svg+xml` response for an inline
   image; the worst a spoof achieves is SVG bytes under an `image/png` response,
   which `<img>` will not script.
3. **Send-time magic-number sniff (defense-in-depth, not the boundary).**
   `uploadMessageAttachments` now verifies that any file *claiming* a raster
   type (jpeg/png/webp/gif/heic/heif) actually has that magic number, rejecting
   "doesn't look like the image it claims to be" before upload. This stops the
   honest/accidental path and any attacker not hand-crafting the storage call;
   it is explicitly **not** relied on for safety (a direct storage call bypasses
   it — which is why #1 exists).

**FM-A/FM-E re-scoped honestly.** "Authoritative mime at the storage/RPC
boundary" was not achievable and is withdrawn as a claim. The mitigations that
actually hold: `<img>`-only inline rendering (no raw-URL navigation),
svg-never-inline, cross-origin serving (signed URLs are on `*.supabase.co`, a
different origin than the app, so even a hypothetical execution is not
app-origin), and the send-time sniff. Adversarial scenario **ATT-9** added.

### Finding (b) — the orphan-DELETE predicate ran under the caller's RLS (CONFIRMED)

**The claim.** The storage DELETE-orphan policy guarded the blob with an inline
`NOT EXISTS (SELECT 1 FROM message_attachments WHERE storage_path = name)`. That
subquery runs under the *caller's* RLS; the client `message_attachments` SELECT
policy is scoped to their own **non-archived** thread. So once a thread is
archived (e.g. the client is archived → `client_cascade_thread_archive`), the
referencing row is invisible to the client, `NOT EXISTS` flips true, and the
client could delete a *committed* photo's blob — message + audit row persist,
blob vanishes, immutability broken for archived threads.

**Verification.** Confirmed by RLS semantics (subqueries in a policy are
filtered by the referenced table's own RLS for a non-BYPASSRLS role) and locked
by the pgTAP trio below: test 21 proves the archived-thread row is invisible to
the client's own SELECT (the blindspot the inline predicate would have hit).

**Fix.** Migration `20260713140000`: a `SECURITY DEFINER` helper
`message_attachment_path_referenced(text)` resolves "is this path still
referenced?" bypassing RLS, so it sees referencing rows in archived threads
too. The DELETE policy now reads `AND NOT public.message_attachment_path_referenced(name)`.
The helper returns only a boolean (no row data — a negligible oracle, not a
leak), anon EXECUTE revoked. Note: hosted Supabase's `storage.protect_delete()`
blocks raw SQL deletes from `storage.objects`, so the DELETE policy is only
evaluated on the Storage-API path the browser rollback uses; the pgTAP asserts
the decisive predicate rather than a (blocked) raw delete.

**pgTAP 59 extended to 23** (was 20, all green on live): test 21 (archived
thread hides the referencing row from the client's RLS), test 22 (the definer
helper sees it anyway → DELETE denies), test 23 (an unreferenced path resolves
false → uploader-orphan rollback still permitted). Scenario **ATT-10** added.

### Minor (verified in passing)
- **Composite FK target uniqueness:** `messages_id_thread_uidx UNIQUE (id, thread_id)`
  is created in `20260713130000` (id is already PK, so the pair is trivially
  unique; the explicit unique index is what lets `message_attachments`'
  composite FK reference it). Present. ✓
- **Relaxed body CHECK vs NULL:** `messages.body` is `text NOT NULL` (original
  schema `20260425100000`), so the "unknown-is-pass" concern can't arise — a
  NULL body is rejected by NOT NULL before the CHECK. ✓

### Net
G-1, G-3, G-8 and the composer/render work stand as closed on merit. G-2 and
G-4 are re-closed with the finding-(a) render-layer fix + send sniff and the
finding-(b) definer-helper migration, pgTAP 59 at 23/23 live and suite 34 at
17/17. This §8 is written to be pasted back to the reviewer for the re-review;
the browser matrix ATT-1..ATT-10 (now including the two adversarial scenarios)
is the operator's pass.

## §9 Re-review addendum (2026-07-13) — three "name it / confirm it" items

The reviewer accepted both findings as soundly closed and raised three
non-blocking items. Resolutions:

1. **Raw-URL navigation is contained, not eliminated (accepted residual).**
   Removing the `<a>` closes the *app-driven* navigation to the signed URL, but
   a staff user can still right-click → "open image in new tab" / "copy image
   address" and reach the same `image/png`-declared, no-`nosniff` signed URL as
   a top-level navigation. §8's finding-(a) wording implied this path was gone;
   it is **narrowed, not eliminated**. The exploit chain is long (an attacker
   must first land spoofed bytes via a *direct* storage+RPC call that bypasses
   the magic-number sniff, then a staff user must perform the manual gesture),
   and cross-origin serving bounds the blast radius to `*.supabase.co`, never
   app-origin. **Accepted for f&f. Re-trigger:** `nosniff` (or response
   content-type) becomes settable on the signed-URL response — set it and mint
   image URLs with `X-Content-Type-Options: nosniff` — **or** any non-f&f user
   onboards (fold into the same serve-hardening pass as FM-G EXIF). Recorded
   here alongside FM-G / FM-K rather than claimed closed.

2. **Adversarial ATT-9 / ATT-10 vs "views well".** The operator's "views well"
   pass confirms the happy path (photos send + render). The two adversarial
   scenarios are separately evidenced:
   - **ATT-10 (archived-thread delete denied)** is **behaviourally proven by
     pgTAP 59 tests 21-23** — the delete path is *entirely* Storage-API-gated by
     the DELETE policy (hosted `protect_delete` blocks every other path), and
     the suite proves the policy's decisive predicate denies while genuine
     orphans stay deletable. A browser run re-confirms the same policy through
     the UI; it is not additional proof.
   - **ATT-9 (spoofed SVG-as-png)** is proven on the two paths that exist: the
     **normal composer path is mechanically blocked** — the magic-number sniff
     was unit-tested 2026-07-13 and rejects `<svg>`/HTML bytes declared
     `image/png` (13/13 cases, incl. the spoof → reject); the **direct-storage
     bypass path** renders via `<img>` only, whose broken-decode / no-script
     behaviour is an established browser property (secure static mode), and its
     residual new-tab gesture is item 1 above. A live operator run of ATT-9 is
     welcome as belt-and-braces but is not the missing behavioural proof.
3. **HEIC sniff coverage (verified — no regression).** Unit-tested the sniff's
   HEIC branch against the real iOS brand set: `heic`, `heix`, `hevc`, `mif1`,
   `msf1` all **accept** (the branch keys on the `ftyp` box at bytes 4-7, not
   the brand, so all ISO-BMFF brands pass), an untyped HEIC (`file.type === ''`)
   passes through un-sniffed, and the spoof still rejects. The primary
   form-check-photo path is **not** regressed. ✓

## Sign-off

- **Date signed off:** 2026-07-13
- **Reviewer:** claude.ai project chat (challenger role)
- **Decision:** Closed with deferred items

Full approved scope (§1 incl. the GO'd §6 numbers) shipped across `59e523b`
(feature) + `a8e76db` / migration `20260713140000` (security fix), all live on
prod. The two returned security findings — caller-controlled stored mimetype
(a) and the orphan-DELETE predicate under caller RLS in archived threads (b) —
were verified, fixed, and pgTAP-locked (suite 59 23/23, suite 34 17/17). The
three re-review residuals (raw-URL user-gesture navigation, ATT-9/ATT-10
adversarial execution, HEIC magic-number coverage) are handled in §9. Operator
browser pass GREEN.

### Deferred / accepted — each carries a re-trigger
- **Raw-URL user-gesture navigation (finding-a residual).** `<img>`-only
  rendering closes app-driven navigation; a manual right-click "open image in
  new tab" can still reach the no-`nosniff`, `image/png`-declared signed URL.
  Contained (long chain: bypass the sniff via a direct storage call, then a
  human gesture) and cross-origin (`*.supabase.co`, never app-origin).
  **Re-trigger:** `nosniff`/response-content-type becomes settable on the
  signed URL (set it), **or** any non-f&f user — fold into the FM-G serve
  hardening pass.
- **FM-G — EXIF/GPS retained on client photos.** **Re-trigger:** any non-f&f
  user, or the SaaS fork.
- **FM-K — HEIC render quality on staff browsers.** Sniff coverage verified
  (§9.3); the render-quality concern remains. **Re-trigger:** a real report.
- **No client-side image compression.** **Re-trigger:** storage cost or
  upload-failure reports at real usage.
- **1-hour image signed-URL expiry.** A tab left open longer re-renders a
  broken `<img>` until refresh. **Re-trigger:** reported by a user.

### Boundary marker (reviewer, out-the-door — not a condition on this sign-off)
This surface is the platform's **first client-write storage path and first
client-facing PII photo path**, signed off at f&f scope. A form-check photo
**is** identifiable client health data — and this feature is the one that
*manufactures* it. Two standing liabilities stay velcroed here (and are
indexed in `go-live-checklist.md` §8 so they fire, not just filed):
1. **Non-prod pgTAP target.** A staging target exists (`go-live-checklist.md`
   §5, `odyssey-staging`, 2026-07-03), but the default run path — including
   suite 59 this session — is still live prod via `BEGIN … ROLLBACK`. Once
   real photos exist, prefer the staging target for any risky run on this
   surface; the "stand up / use a non-prod target before identifiable client
   health data enters" tripwire is now materially closer *because of this
   feature*.
2. **Re-entry on either re-trigger.** The moment a non-f&f user onboards or the
   SaaS fork is taken, this doc re-enters the polish protocol carrying the
   above residuals — the raw-URL/serve-hardening pass and the EXIF strip are
   the first agenda items.
