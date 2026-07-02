# Archived-client record access (CN-7) — gap analysis

**Status: BUILT + BROWSER-VERIFIED — closing commit at §7, awaiting the reviewer sign-off ritual.** The §4 gap list and all three §5 recommendations (Q1 Option A, Q2 cancel-future in scope, Q3 restore in scope) were operator-approved 2026-07-02 in-session, with one explicit lens on Q1: confirm the additive policy is safe long-term (answer recorded in §5/Q1 — fail-closed by construction, decouples access control from UX filtering, the two named long-term costs are the P0-2 convention and app-layer write immutability). **Operator browser verification of CP-ARC-1..3 is complete (2026-07-02);** the full pgTAP battery (9 suites / 95 assertions), the scoped lint (exit 0), and the live-DB residue census are all green — evidence in §7. All that remains is the documentary reviewer sign-off in the claude.ai chat.

**Provenance.** This is CN-7 — deferred item 1 of the Client profile and clinical notes sign-off (`polish/client-profile-clinical-notes.md`, 2026-06-11) and a standing §8 pointer in `docs/go-live-checklist.md`. Trigger: *before the first real client archive, or before any paying clinical client, whichever comes first.* The trigger is armed behaviourally — the archive action is one click on the live client profile today. Because this adds a **new way to read client health data** (a new security surface), it re-enters the full polish-pass protocol per CLAUDE.md's dogfooding-loop rule rather than shipping as a quick fix. This doc is protocol steps 1–4; step 5 is the operator's approval of §4 below.

---

## 1. Target brief

Master brief §7.2: **archived records must remain queryable.** Clinical records carry retention obligations (Australian Privacy Principles + AHPRA record-keeping — typically 7 years post-last-contact; the platform's own archive action documents exactly this at `src/app/(staff)/clients/[id]/actions.ts:12-14`). "Archive" therefore means *no longer active, still producible* — never *invisible*. The design-philosophy bar: progressive disclosure (archived clients don't clutter the working surfaces) without ever making the record unreachable.

## 2. Audit of the existing implementation (2026-07-02, all file:line verified)

**What archive does today.** `archiveClientAction` (`clients/[id]/actions.ts:27`) calls the `soft_delete_client(uuid)` SECURITY DEFINER RPC (`20260429130000`), which sets **both** `deleted_at` and `archived_at` to the same timestamp. The clients `SELECT` policy (`20260420102600:137-146`, documented `rls-policies.md` §4.4) is a **single policy** whose `USING` bakes in `deleted_at IS NULL` for *every* role — so the moment archive commits, the client row is invisible to every PostgREST read, staff included.

**The block is narrower than it looks.** The child tables are NOT sealed: `clinical_notes`, `client_medical_history`, `client_medications`, `programs`, `client_files`, test data etc. gate on org + role, not on the parent client's `deleted_at` — their rows remain staff-readable. What actually breaks is exactly two things: (a) the profile page's client-row read (`clients/[id]/page.tsx:93` filters `deleted_at IS NULL`, then `:259` hits `notFound()` — the whole record 404s off one missing parent row), and (b) there is no list surface that can find an archived client (`clients/page.tsx:23` filters live-only).

**Already built, currently unreachable — the fix is smaller than feared:**
- `restore_client(uuid)` **exists** (`20260429130000:103-154`), including the email-conflict guard (a re-invited address blocks restore with a clear raise instead of a raw 23505). No UI calls it.
- The profile already computes and renders a three-way status including **'Archived'** (`statusFor` → `clients/[id]/page.tsx:261-265`, `ClientProfile.tsx:240`) — a dead branch today, since an archived client can never load.
- The messaging cascade (`client_cascade_thread_archive`) already keeps the client's thread `deleted_at` in lockstep both ways (archive AND restore).

**Adjacent facts that shape the gap list:**
- **Write policies do not check archive state.** The staff UPDATE policy on clients (`20260420102600:155-161`) has no `deleted_at` filter, and child-table write policies don't check the parent — so "read-only" for archived records is an application-layer property to build, not something RLS gives us.
- **Archive does not cascade to appointments.** Future appointments of an archived client stay live: the reminder Edge Function reads via service role and **would still email an archived client**, and the schedule renders their booking with a null client join (`schedule/page.tsx:140`).
- **The archived client can still authenticate.** `auth.users` and their `user_organization_roles` row are untouched; only the clients self-read policy (filtered `deleted_at IS NULL`) locks them out — the portal fails into an unhandled state rather than a designed "no access" screen.
- **Thread history is doubly hidden.** The staff thread SELECT policy (`20260425100000:155-158`) also filters `deleted_at IS NULL`, and the cascade archives the thread with the client — so an archived profile's message history needs its own read decision, separate from the clients policy.
- **Blast radius of any policy change: 23 files** read `.from('clients')` (staff surfaces: list, profile, dashboard + actions, schedule + actions, library, analytics, new-client/invite; portal surfaces: layout, home, you, session, reports; plus `welcome`, `/i/[id]` (service-role), `lib/clients/invite.ts`). Any widening of staff visibility must be paired with an explicit classification of each read site.
- Retention: `clients_retention_idx (deleted_at, last_activity_at)` anticipates a 7-year purge scan (no purge job exists yet). Archived-visible UI must present archived as *retained*, not *recoverable-forever*.

## 3. Premortem (security at production grade; UX/workflow at f&f scope)

| # | Failure mode | Weight | Closed by |
|---|---|---|---|
| **FM-1** | **New read path leaks archived rows to the wrong role.** A mis-scoped policy lets a client-role session read archived rows (their own, or — worse — via a missing org/role predicate, someone else's). Highest-impact class in the platform. | High × Low (pgTAP-locked) | P0-1 |
| **FM-2** | **Archived rows silently appear in staff surfaces that assume live-only.** With the policy widened, any of the 23 read sites that relies on RLS (not an explicit filter) starts showing archived clients — EP books an appointment for an archived client, counts inflate, invite email-uniqueness checks misfire. The load-bearing risk of the whole change. | High × High (without P0-2) | P0-2 |
| **FM-3** | **"Read-only" isn't.** UI hides the edit affordances but the server actions and RLS still accept writes against an archived record (a stale tab, a crafted request). An archived record silently mutates post-archive. | Med × Med | P1-4 |
| **FM-4** | **Reminders email an archived client.** Future appointments survive archive; the reminder worker (service role) sends regardless. Real-world embarrassment + potential complaint the first time it happens. | Med × Med | P1-5 (or accepted, Q2) |
| **FM-5** | **Cross-tenant isolation not proven for the new policy.** pgTAP 17 exercises live rows only; the archived-row arm needs its own cross-org + role assertions. | High × Low | P0-1 (test) |
| **FM-6** | **Restore surprises.** Restore hits the email-conflict raise and surfaces raw SQL text; or restore resurrects a client whose thread/appointments state has drifted. | Low × Med | P1-3, P2-2 |
| **FM-7** | **Archived client's portal login lands on an error, not a closed door.** They can authenticate; every clients-dependent portal read comes back empty → broken-looking screens rather than a designed end-state. | Low × Low (f&f: no archived real user expected soon) | P2-3 or defer |
| **FM-8** | **Message history invisible on the archived profile** (thread archived in lockstep; staff thread policy filters live-only) — the "queryable record" is incomplete without a comms decision. | Med × Certain (if unaddressed) | P1-2 scope note / P2-4 |

## 4. Gap list (the contract — approve before any code)

### P0 — architectural
- **P0-1 — The archived-read path: one additive RLS policy + its pgTAP.** Recommended architecture (see Q1): a second, additive SELECT policy on `clients` — *"staff select archived clients in own org"*: `USING (organization_id = user_organization_id() AND deleted_at IS NOT NULL AND user_role() IN ('owner','staff'))`. Policies OR, so staff sessions gain archived visibility; the existing policy is untouched, and the client self-read arm still requires `deleted_at IS NULL` — **archived clients stay locked out of their own row and the portal.** New pgTAP (`56_archived_client_access.sql`): staff-reads-archived (new capability), client-role CANNOT read own archived row, cross-org staff sees zero archived rows (FM-5), anon still 42501 (post-4b posture). Re-run 17 per the §6 rule (this touches RLS). Closes FM-1, FM-5.
- **P0-2 — Read-site blast-radius audit + explicit filters.** Enumerate all 23 `.from('clients')` files; classify each as (i) already live-only-filtered, (ii) needs an explicit `.is('deleted_at', null)` added, or (iii) should see archived (the new list filter + profile loader only). The classification table lands in this doc; the filters ship IN THE SAME release as P0-1 — the policy and the filters are one unit, never split across deploys. Closes FM-2.

### P1 — functional
- **P1-1 — "Archived" filter on the client list.** Default view unchanged (live clients only); an explicit Archived toggle/segment reveals archived rows (name, archived date, category), row click opens the read-only profile. No archived rows in the default search results.
- **P1-2 — Read-only archived profile.** The existing 404 becomes a render: archived banner ("Archived {date} — read-only"), every mutating affordance suppressed (details/goals edit, conditions/medications add-edit, notes composer, flags, program builder links, message composer, booking, files upload), all tabs readable. The dead 'Archived' status branch (`statusFor`) goes live. **Scope note (FM-8):** message history rendering depends on the thread-read decision — either a narrow archived-thread staff SELECT arm rides with P0-1, or the Comms history is explicitly listed as not-rendered-when-archived with a re-trigger (pick at build time, recorded either way).
- **P1-3 — Restore affordance.** Overflow action + ConfirmDialog on the archived profile → `restore_client` RPC (already deployed); the email-conflict raise mapped to humane copy (the mapAcceptInviteError pattern). Closes half of FM-6.
- **P1-4 — Server-side write guards.** A shared guard in the client-scoped server actions (reject writes when the target client is archived) so read-only holds at the action layer, not just the UI. RLS-level enforcement is deliberately NOT attempted (rewriting every child-table policy for parent-archive state is a platform-wide RLS change — out of proportion at f&f scope; the action-layer guard + audit log is the proportionate control). Closes FM-3 to app-layer strength; residual (raw PostgREST write by a staff credential) accepted and named.
- **P1-5 — Archive cancels the future.** On archive: cancel the client's future appointments (which the existing `appointment_manage_reminder` trigger already converts into reminder cancellations) — inside `soft_delete_client` or the action, decided at build. Closes FM-4. *(Struck to accepted-with-retrigger if Q2 answers "defer".)*

### P2 — polish
- **P2-1 — Search stays live-only.** Dashboard sidebar fuzzy search excludes archived (explicitly, per P0-2); an "search archived" affordance is a logged feature-wish, not built.
- **P2-2 — Restore end-state review.** After restore, confirm thread un-archive (cascade already does this) and decide nothing else needs resurrecting; document in the closing note.
- **P2-3 — Archived client's portal end-state.** A designed "Your access has ended — contact your practitioner" screen instead of empty errors. *(Candidate for defer-with-trigger: first real archived f&f user.)*
- **P2-4 — Doc updates.** `rls-policies.md` §4.4 (new policy + the read-model), `schema.md` archive semantics note, `test_scenarios_template.md` scenarios (archive → find in Archived filter → read-only profile → restore), go-live §8 CN-7 closure pointer.

## 5. Open questions for the operator (recommendation first)

- **Q1 — Read-path architecture.** **Recommend Option A (additive archived-only staff SELECT policy, P0-1)** — it makes the data model honestly reflect §7.2 and every future surface inherits it. Rejected: (B) a SECURITY DEFINER "read archived" RPC fork — zero blast radius but forks the read model forever (every future surface must remember two ways to read a client); (C) rewriting the existing policy — same effect as A but destructive rather than additive. A's real cost is P0-2, and pre-launch advantages make that cheap now.
- **Q2 — Should archive cancel future appointments (P1-5)?** **Recommend yes, in scope** — it is small (the reminder lifecycle trigger already handles the reminder half) and FM-4 is the one failure mode here that emails a real person wrongly. Alternative: defer with re-trigger "first archived client who holds a future booking".
- **Q3 — Is restore in scope (P1-3)?** **Recommend yes** — the RPC is already deployed and tested (pgTAP 38), the UI is one dialog, and a mistaken archive otherwise has no exit short of SQL.

---

*Per the polish-pass protocol: steps 1–4 complete above. Step 5 — operator approval of the §4 gap list (with Q1–Q3 answered) — gates any code. Steps 6–7 (build in dependency order; acceptance tests) follow approval. Sign-off ritual applies at close.*

---

## 6. P0-2 read-site classification (built 2026-07-02)

Every `.from(''clients'')` occurrence in `src\` was enumerated and classified before the policy landed. Findings: **almost the entire staff surface already filtered live-only explicitly** — the §11 dashboard pass had even excluded `archived_at` — so the audited blast radius reduced to four action lookups. Portal/client-role reads are untouched by design (the client policy arm did not change), and service-role reads bypass policies entirely.

| Class | Sites | Action taken |
|---|---|---|
| Already explicit live-only (no change) | clients list picker surfaces: schedule grid + pickers, dashboard panels + sidebar (incl. `archived_at` excl.), library picker, analytics, program pages ×3, files upload lookup, dashboard ack update; all portal/welcome self-reads | none — verified |
| Relied on RLS, now guarded (P1-4) | `clients/[id]/actions.ts` — details update, goals update, resend invite (+ archive lookup, already archive-aware by design) | explicit `deleted_at` check + `ARCHIVED_CLIENT_MESSAGE`; UPDATE chains add `.is('deleted_at', null)` |
| Deliberately archived-INCLUSIVE (the two CN-7 surfaces) | `clients/page.tsx` (list + Archived chip), `clients/[id]/page.tsx` (profile loader) | filter removed with an intent comment; header counts stay live-only |
| Embedded joins (name resolution) | schedule/dashboard `client:clients(...)` embeds | parent queries filter their own rows; archived names now RESOLVE where the parent row is live — fixes the null-client rendering for historical rows |

## 7. Closing commit (protocol step 7) — 2026-07-02

**What changed, by gap number.**

- **P0-1** — migration `20260702190000_archived_client_access.sql`: the additive `"staff select archived clients in own org"` SELECT policy (org + role + `deleted_at IS NOT NULL`; client self-read arm untouched → portal lockout preserved). *(Numbering note: originally authored as `…180000` and renumbered after a live timestamp collision with the parallel `cmed_occ_version` session — the memory-documented silent-skip failure mode, caught by `migration list` + a live probe before any drift; the foreign migration file was adopted into master so local matches remote.)*
- **P0-2** — the classification above; four action lookups gained explicit guards; two surfaces made deliberately archived-inclusive.
- **P1-1** — Clientele list: `Archived` filter chip (default views exclude archived; archived rows show their archive date; empty-state copy).
- **P1-2** — read-only profile: the 404 became a render. Quiet `ArchivedBanner` (muted card, NOT the red clinical-flag pattern) with archive date + Restore; header action icons withdrawn; `statusFor`''s dead ''Archived'' branch is live; every mutating affordance suppressed across Details (contact/goals edits, condition + medication add/menus via `ProfileRow` empty-menu support), Notes (composer, rail edit/archive/pin — Export PDF kept), Program (calendar/builder links; honest empty-state copy), Reports (Record test withdrawn; history + Compare kept), Files (upload zone/picker/drag + delete withdrawn; Download kept). Bookings tab was already display-only.
- **P1-3** — Restore: `restoreClientAction` → the existing `restore_client` RPC; the email-conflict raise mapped to humane copy; ConfirmDialog notes that cancelled bookings stay cancelled.
- **P1-4** — `src/lib/clients/archive-guard.ts` (`assertClientLive` + `ARCHIVED_CLIENT_MESSAGE`) wired into: client details/goals/resend-invite, medical-history ×4 (create + the shared lookup), medications ×4 (same), clinical notes ×8 (create, update, archive, pin, flag create + the shared flag lookup covering resolve/review/edit), staff `getOrCreateThreadAction` (which would otherwise mint a duplicate live thread past the archived one).
- **P1-5** — `soft_delete_client` v2 (same migration): archiving cancels the client''s future `pending/confirmed` appointments (`cancelled_by_role=''staff''`, reason recorded); the `appointment_manage_reminder` trigger cascade-cancels each queued reminder. Restore deliberately does NOT resurrect bookings.
- **P2-1** — satisfied by P0-2 (dashboard sidebar/search sources are explicitly live-only).
- **P2-4** — `rls-policies.md` §4.4 updated; scenarios CP-ARC-1..3 added; go-live §8 pointer updated.

**Acceptance tests run and results (all on live, 2026-07-02).**

- **pgTAP — full merged-tree battery, 9 suites / 95 assertions, 0 failures.** Run after the rebase composed this section with the parallel `client_medications` OCC session, so this is the whole day''s DB surface proven together, not just the CN-7 slice:
  - `56_archived_client_access` **8/8** (staff-reads-archived; archived client''s own login sees zero rows; foreign-org staff zero; live-policy control; anon 42501; archive cancels appointment `cancelled/staff`; reminder cascade `cancelled`; restore round-trip with booking staying cancelled).
  - Regression canaries green: `17_cross_tenant_isolation` **8/8** (§6 rule — RLS touched), `38_soft_delete_restore_grants` **38/38** (load-bearing here — proves the `CREATE OR REPLACE` of `soft_delete_client` v2 did NOT disturb the soft-delete/restore family''s anon-revoked / authenticated-retained grant posture), `46_clients_update_role_anon_denial` **3/3**, `54_anon_table_grants` **8/8**.
  - Same-day batch also re-confirmed green: `51_cmh_occ_version` 4/4, `52_onboarding_audit_rpc_grants` 14/14, `53_message_notification_queue` 8/8, `55_cmed_occ_version` 4/4.
- **SQL-editor / live-DB hygiene.** Every pgTAP file runs `BEGIN … ROLLBACK`, so no fixtures persist; the ephemeral probes (synthetic send-check, realtime two-session) had explicit leaf→root teardown. Post-work residue census on live: **6 live clients + 1 pre-existing archived** (the operator''s real keeper accounts, unchanged from the morning pre-flight), **0 test auth users, 0 orphan `message_notifications` rows**, and the only `test/verify`-slugged org is `[VERIFY] auth-config probe org` — the by-design persistent inert memberless verification org (Variant 3, `verify-auth-config.mjs`), not residue.
- **Code hygiene.** All 16 CN-7-touched files swept: **no** `console.log/warn/debug`, `any`/`as any`, `@ts-ignore`/`@ts-expect-error`, `debugger`, `TODO`/`FIXME`, or newly-introduced `eslint-disable`. The only added `console.*` is the `[restore]` audit-trail line in `actions.ts`, which mirrors the pre-existing `[archive]` / `[resend-invite]` convention verbatim (intentional, not debug). `npx eslint` scoped to the 16 files **exit 0**; `tsc --noEmit` clean; `next build` green.
- **Browser verification — COMPLETE (operator, 2026-07-02).** Scenarios **CP-ARC-1, CP-ARC-2, CP-ARC-3 all confirmed passing** on a live authenticated staff session: archiving hides the client from working views (present only under the Archived chip) and cancels their future booking; the archived profile renders fully readable and truly read-only with the banner + Restore; Restore returns the client to the live list with cancelled bookings staying cancelled. This discharges the render tier directly for this section (stronger than the §5b `type-check`+`build`+pgTAP acceptance) — the operator *is* the smoke test and ran the matrix.

**Deferred, with re-triggers.**
- **Message history on the archived profile (FM-8)** — NOT rendered: the thread is archived in lockstep and the staff thread policy stays live-only (an archived-thread read arm would surface archived threads in the inbox without its own filter pass). Messages remain in the DB, audit-logged, SQL-producible. *Re-trigger: the operator needs an archived client''s comms history in-app.*
- **Publish/unpublish affordances inside ReportsTab''s deeper views** — the Record-test entry is withdrawn but publication toggles inside BatteryView/CategoryDetail are not individually gated (server actions for publications are testing-module-owned and not archive-guarded). *Re-trigger: first real archived client with test history, or the testing-module''s next pass.*
- **P2-3 — archived client''s portal end-state** — still the pre-existing behaviour (auth succeeds, clients-dependent reads come back empty). *Re-trigger: the first real archived f&f user.*
- **DB-level write immutability for archived records** — the guard is app-layer by design (P1-4 rationale); the raw-PostgREST-write residual by a staff credential is accepted and named. *Re-trigger: paying-client era (a BEFORE UPDATE trigger is the upgrade path).*

**Premortem accounting.** Mitigated: FM-1/FM-5 (P0-1 + pgTAP 56), FM-2 (P0-2 — found largely pre-mitigated by prior sections'' explicit filters), FM-3 (P1-4, app-layer strength with named residual), FM-4 (P1-5 + test 56 #6/#7), FM-6 (P1-3 humane copy; P2-2 verified — the thread cascade un-archives on restore, bookings stay cancelled by design). Accepted: FM-7 (P2-3 deferred), FM-8 (comms history deferred, above).

*Per the sign-off ritual: Claude Code''s work ends here. The section closes when this closing commit is reviewed in the operator''s claude.ai project chat and the sign-off is recorded below.*

**Numbering note.** The suite file was authored as `55_archived_client_access.sql`; the parallel client_medications OCC session claimed `55_cmed_occ_version.sql` on master in the same window, so this section's test is **`56_archived_client_access.sql`** (renumbered at rebase, re-run 8/8 on live post-rename). Same-day collision class as the migration-timestamp note in P0-1.
