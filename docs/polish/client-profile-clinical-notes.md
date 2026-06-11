# Client profile and clinical notes — gap list

**Polish-pass section:** 3 of the locked polish-pass order (clinical-record layer — note template, flag banners, medical history, history rendering).
**Active step:** 6 of 7. Gap list approved by the claude.ai reviewer 2026-06-11; build in progress in dependency order, starting with P0.
**Date opened:** 2026-06-11.
**Trust-nothing posture:** every claim below was derived from the code at HEAD and the migrations, not from prior section docs. Three audit passes (profile UI, database layer, cross-surface/portal exposure) were run independently and cross-checked; the load-bearing claims (hardcoded `note_type`, disabled edit affordances, constraint widening, token drift, absent write paths) were then re-verified line-by-line first-hand.

**Live-data caveat (affects premortem weighting).** CLAUDE.md "Project state" still says *pre-launch — only fake/seed data, no real client has logged in*. Section 2 (Auth and Onboarding, client) closed 2026-06-11, and the working assumption in session memory is that real friends-and-family beta clients now exist in the shared live DB. **These two positions conflict; the operator must confirm which holds** (open question 1). This doc weights migration cost conservatively — as if real rows exist — because clinical notes and medical history are exactly the tables where retroactive shape changes get expensive. If the pre-launch position still holds, several closing shapes below get cheaper, not different.

---

## Composite target brief — confirmed

- **Functional scope:** master brief §6.1 (client profile as the central hub, inline tab navigation), §9.1 Phase 1 bullets — *"Client profiles — personal details, medical history, referral source, standardised initial assessment template"* and *"Clinical notes — standardised template entry, progress notes, injury flags, contraindications, collapsible side panel"*. §3 practitioner context: *"Clinical documentation: standardised template filled in by EP."*
- **Access contract:** master brief §4 — clients cannot access *"clinical reasoning notes"* or *"raw assessment data (unless published as a report)"*. Schema comment on `clinical_notes` goes further: staff-only, never client-visible (`supabase/migrations/20260420100800_clinical_notes.sql:97-98`).
- **Adjacency contract:** §2.1 (progressive disclosure — notes in a collapsible side panel), §2.3 (contextual reference — notes, flags, assessment data adjacent to the programming calendar). The session-builder Notes tab adjacency is the protected differentiator per CLAUDE.md.
- **Dashboard data contract:** §6.8.2 — *"Active injury flags not reviewed within 14 days → Flag tag (red)."* The dashboard *panel* belongs to section 11; the flag **data lifecycle** that feeds it (created → reviewed → resolved) is owned here.
- **Retention:** §7.2 — soft-delete with archival; *"archived records remain queryable but are separated from active client views."*
- **Design system:** flag banners are the one permitted use of the left-border accent pattern (red `#D64045` 3px solid border-left + `rgba(214,64,69,0.05)` background). Tokens live in `globals.css` / `constants.ts` only. Voice: factual reason codes, sentence case, no emoji.
- **Prototypes (design intent where the brief is silent):** `session-builder.html:255-256` and `program-calendar.html:789-792` both show a dedicated grouped "Flags" / "Active Flags" section at the top of the notes panel — flags as a structured list with body region, date, and status note, distinct from the chronological note rows.
- **Tab divergence noted, mostly not a gap here:** brief §6.1 names Profile / Program / Reports / Bookings / Comms; the implementation has details / notes / program / reports / files / invoices (`ClientProfile.tsx:186-193`). Bookings and Comms tabs belong to sections 9 and 10 of the locked order. Files is an addition the brief is silent on (kept, out of scope here). **Invoices belongs to nobody** — see CN-14.

---

## Audit — what was verified against the target

### Routes and tab navigation

`/clients/[id]` is a force-dynamic server component (`src/app/(staff)/clients/[id]/page.tsx`). Tab state is URL-driven via `?tab=` with shallow replace (`ClientProfile.tsx:238-259`); valid tabs `details | notes | program | reports | files | invoices`, default `details`. Deep-link support: the schedule popover can open `?tab=notes&new=1&appointment=<id>` to pre-fill a note against an appointment, with URL cleanup on mount (`NotesTab.tsx:89-92, 121-134`). Inline navigation per brief §2.4 holds — no popups, no redirects.

### Profile details (the "Profile" of §6.1)

Read path is complete: email, phone, DOB, gender, address, referral source render in the Contact panel (`ClientProfile.tsx:785-862`); goals renders read-only. **There is no write path.** The Contact panel's Edit button is rendered permanently `disabled` (`ClientProfile.tsx:805`); no server action exists to mutate `clients` personal fields. The `clients` table itself is ready for it — OCC `version` column with `bump_version_and_touch()` trigger, audit trigger registered, RLS staff-update policy in place (`20260420100600_clients.sql`, `20260420102600_rls_enable_and_policies.sql:135-164`).

### Medical history

Read path: `client_medical_history` loaded in the page loader (`page.tsx:89-95`), active conditions shown as header tags **sliced to the first two** (`ClientProfile.tsx:512-517`), inactive conditions listed in a Details-tab panel (`ClientProfile.tsx:828-860`). **There is no write path anywhere in `src/`** — the page-loader SELECT is the only reference to the table in application code (verified by repo-wide grep; the only other hits are generated types). No intake capture at `/clients/new` either (grep for medical/condition in that tree: zero). The table is sound (soft-delete column, audit trigger, cross-org FK guard, active-partial indexes — `20260420100700_client_medical_history.sql`) but nothing can populate it except SQL.

**RLS posture worth a deliberate decision:** `client_medical_history` is Pattern B — a client can SELECT their own rows (`rls_enable_and_policies.sql:170-204`), including the `notes` column, which is practitioner commentary on the condition. No portal surface queries the table today (verified — portal audit below), so nothing leaks. But the policy as written declares practitioner condition-notes client-visible, and the brief never made that call. See CN-2.

### Clinical notes — create/edit

The note-template system is the standout of the existing build and is largely right:

- Per-org templates with ordered typed fields (`note_templates` + `note_template_fields`, `20260427100000_note_templates.sql`); settings CRUD exists (`src/app/(staff)/settings/note-templates/actions.ts`). Notes denormalise answers into `content_json` so history survives template edits/deletion. The content-present CHECK was correctly widened to accept `content_json` as an alternative to legacy SOAP columns (`20260427100000:109-114`) — verified first-hand; editing a template note does not trip the constraint.
- Create/edit/pin/archive server actions with `requireRole(['owner','staff'])`, RLS-scoped writes, OCC via `version` (`notes-actions.ts:108-352`). One-note-per-appointment enforced server-side with a humane conflict banner. Copy-previous-note maps fields by label across template evolution (`NotesTab.tsx:583-615`). In-note test-session capture links the testing module (`NotesTab.tsx:475-483, 761-837`).
- Author lock end-to-end: only the authoring practitioner can update or archive a note — RLS policy (`20260427110000_note_defaults_and_author_lock.sql:38-54`) and the SECURITY DEFINER `soft_delete_clinical_note` RPC re-checks it (`20260429120000_soft_delete_rpcs.sql:357-404`). The known soft-delete/RLS 42501 trap is correctly routed through the RPC family for this table.
- Print view exists per note (`notes/[noteId]/print/page.tsx`).

**The gap is at the type layer:** `createClinicalNoteAction` hardcodes `note_type: 'progress_note'` (`notes-actions.ts:156`, verified first-hand). The enum supports `initial_assessment | progress_note | injury_flag | contraindication | discharge | general`; the schema carries flag columns with a CHECK tying them to `injury_flag`; **no UI path can create anything but a progress note.**

### Injury flags and flag banners

The flag pipeline exists at every layer except the inlet and the lifecycle:

- **Schema:** `flag_body_region` (required for `injury_flag`), `flag_severity` 1–5, `flag_reviewed_at`, `flag_resolved_at`, plus a partial index purpose-built for the dashboard rule (`clinical_notes_active_flags_idx`, `20260420100800_clinical_notes.sql`).
- **Display:** `NotesPanel` shows a red body-region badge — but **only on pinned notes** (`NotesPanel.tsx:166-182`). The dashboard needs-attention query requires `is_pinned = true AND flag_resolved_at IS NULL AND note_type IN ('injury_flag','contraindication')` (`dashboard/page.tsx:129-139`).
- **Missing:** no UI to create a flag (the hardcoded note_type above); no UI or action ever writes `flag_reviewed_at` or `flag_resolved_at`; the §6.8.2 14-day review rule is not implemented (the dashboard's `fourteenDaysAgo` constant is used only for new-client detection, `dashboard/page.tsx:54, 77-82`); no flag *banner* in the design-system sense exists anywhere — flags render as note rows with a badge, where both prototypes show a dedicated grouped "Active Flags" section and the design system reserves the left-border banner pattern for exactly this.
- **Coupling defect:** because display and dashboard both require `is_pinned`, unpinning a flag silently removes it from the needs-attention panel and from the session-builder badge — pin is doing double duty as "important" and "clinically active."

### Note history rendering

The Notes tab side rail is in good shape: pinned group on top, `note_date DESC` below, 10-per-page pagination, case-insensitive in-memory search across template fields and legacy SOAP columns, list ↔ reader pattern, optimistic pin toggle, archive with confirm (`NotesTab.tsx:1302-2203`). The profile loader fetches the client's **full** note history with no limit (`page.tsx:96-107`, verified) so search is complete. The session-builder and calendar panels load the 30 most recent (`program/days/[dayId]/page.tsx:139-149`, `program/page.tsx:175-264`) — a reasonable recency window for read-only adjacency panels.

### Cross-surface reuse

One shared component, not three implementations: `NotesPanel` (`src/app/(staff)/clients/[id]/_components/NotesPanel.tsx`) is rendered by the session builder right panel (`SessionBuilder.tsx`) and the program calendar side panel (`CalendarSidePanel.tsx:80`), fed by structurally identical loaders. The full-featured `NotesTab` is profile-only. This is the right architecture; changes here propagate to the differentiator's surface, so CN-1/CN-4/CN-10 must be verified in the session builder, not just the profile.

### Client portal exposure — verified clean

The portal audit found **zero** queries against `clinical_notes`, `client_medical_history`, or clinical columns on `clients`. Portal selects on `clients` are `id` / names / contact only (`portal/layout.tsx:60`, `portal/page.tsx:41`, `portal/you/page.tsx:16`, `portal/reports/page.tsx:34`). No portal-reachable server action touches clinical data. RLS Pattern A independently denies client-role SELECT on `clinical_notes` (`rls_enable_and_policies.sql:211-238`), and rls-policies.md §4.6 records the load-bearing assertion that a client SELECT returns zero rows even for their own `client_id`. The v0.2 decision to *not* have a `visible_to_client` boolean on notes (migration comment, `20260420100800:5-8`) is reaffirmed as correct.

### Database hygiene — verified right

`clients`, `client_medical_history`, and `clinical_notes` all have audit triggers and are present in `audit_resolve_org_id()`'s CASE list (`20260420102300_audit_log_and_triggers.sql:210-284, 375-437`). Cross-org FK guards on `category_id` and `client_id`. OCC on `clients` and `clinical_notes`. Soft-delete columns everywhere; `clinical_notes` has its RPC pair; **`client_medical_history` does not** (relevant to CN-6 — any archive affordance hits the 42501 trap without one; `clients` itself is a known carried item from `20260429120000`'s out-of-scope note).

### Drift found

1. **`docs/schema.md` §8.5 is stale** — `clinical_notes` gained `content_json`, `template_id`, `appointment_id`, `test_session_id` across migrations `20260427100000` / `20260428130000` (+ the appointment link); none are documented. CLAUDE.md names doc drift a contamination risk for every subsequent prompt.
2. **`clinical_notes_search_trgm_idx` indexes only the legacy SOAP columns** — which the update action now actively NULLs out (`notes-actions.ts:322-328`). For template-era notes the index covers nothing; search is in-memory client-side. Misleading artifact, fine at current scale; record it in schema.md rather than rebuild it now.
3. **`audit_wide_column_config` covers the legacy SOAP columns but not `content_json`** — the 4KB-truncation design is silently bypassed for exactly the column all new note content lives in. Every note UPDATE snapshots full old+new `content_json` into `audit_log`.
4. **NotesPanel hardcodes a palette that is not the design system** (`NotesPanel.tsx:29-33`): `INK '#1E1A18'` vs token `--color-text: #1c1917`; `MUTED '#78746F'` vs `--color-muted: #7a7166`; `FAINT '#9C9690'` vs `--color-text-faint: #a09890`; `BORDER`/`ALERT` match token values but are hardcoded (verified against `globals.css:19-36`). The differentiator's Notes tab renders off-system greys. `MonthCalendar.tsx` also hardcodes `#D64045`.

---

## Premortem

### Forward-looking (friends-and-family beta scope)

Ranked by likelihood × impact. Infrastructure/security weighted production-grade; operational/UX/workflow weighted friends-and-family.

| # | Failure mode | Likelihood × Impact | Closed by gap |
|---|---|---|---|
| **F-1** | **An active injury flag is invisible at the moment of programming.** The flag layer has no inlet — `note_type` hardcoded to `progress_note` (`notes-actions.ts:156`) means no `injury_flag` or `contraindication` row can exist via the UI. Even rows seeded by SQL only surface a badge when *pinned* (`NotesPanel.tsx:166-182`) and only reach the dashboard when *pinned* (`dashboard/page.tsx:129-139`). The EP builds a session for a client with an active contraindication and the Notes tab — the differentiator whose entire purpose is this adjacency — shows nothing structurally flagged. This is the clinical-safety failure mode the section exists to prevent. | High × High | **CN-1**, **CN-4** |
| **F-2** | **A typo in a clinical identity field is permanent.** No edit flow for personal details (`ClientProfile.tsx:805` disabled). DOB drives the minor-retention rule (§7.2: under-18 records kept until 25); phone/address are operational contact data; referral source is a §9.1 named field. Wrong-at-intake data can only be fixed via SQL Editor — workable for the operator, invisible-to-fix for the EP collaborator. | High × Medium | **CN-5** |
| **F-3** | **Medical history cannot be maintained at all.** No write path exists (sole reference is the profile read, verified). The brief's §9.1 "medical history" item is a rendering of an unwritable table. First real beta client with an actual condition list → operator hand-writes INSERTs or the platform's clinical-record claim is hollow. | High × Medium | **CN-6** |
| **F-4** | **Flags, once creatable, rot.** No action ever writes `flag_reviewed_at`/`flag_resolved_at`; §6.8.2's 14-day review rule is unimplemented; pin-coupling means unpinning *silences* a flag everywhere without resolving it. Needs-attention either nags forever or goes quiet wrongly — both teach the EP to ignore it. | High × Medium (conditional on CN-1 landing) | **CN-4** |
| **F-5** | **Practitioner condition-commentary is client-readable at the RLS layer.** `client_medical_history` Pattern B exposes the `notes` column to the owning client. Nothing queries it from the portal today (verified), but the policy *declares* it visible, and the next contributor (or Phase 2 AI surface) reading the policy will reasonably treat it as intended. A latent leak by design-ambiguity rather than by bug. Weighted production-grade per protocol. | Low × High | **CN-2** |
| **F-6** | **Initial assessments land untyped, then need data surgery.** Brief §9.1 requires a standardised initial assessment template; the enum has `initial_assessment`; a parallel `assessment_templates`/`assessments` model also exists, unused, staff-only, with no UI. With no decision, assessments get written as ordinary progress notes; retro-typing live clinical rows later is exactly the migration class that stops being cheap once real data exists. | Medium × Medium | **CN-3** |
| **F-7** | **schema.md drift contaminates the next prompt.** §8.5 omits four `clinical_notes` columns that now carry all note content. Every subsequent polish section reasons from the docs per CLAUDE.md source-of-truth order. | High × Medium | **CN-8** |
| **F-8** | **A long clinical note is lost mid-entry.** No draft persistence; browser crash, tab close, or session expiry during a long initial assessment discards everything. Partial mitigation exists (dirty-check + auto-save when switching into edit of another note, `NotesTab.tsx:143-160`) but not for the common loss paths. The operator is the primary author; re-entry pain is real but bounded. | Medium × Medium | **CN-9** |
| **F-9** | **An archived client's record is unreachable.** Brief §7.2: archived records remain queryable. Today archiving a client makes the profile 404 (clients SELECT policy filters `deleted_at IS NULL`) and the notes unreachable through any UI for the 7-year retention window. Compliance posture, not beta-blocking — no archive has ever happened. | Low × Medium | **CN-7** (deferral candidate) |
| **F-10** | **The most-read panel renders off-system colours.** NotesPanel's hardcoded palette diverges from tokens in three of five values (verified against `globals.css`). Violates a CLAUDE.md non-negotiable; visible at every glance at the differentiator. | Certain × Low | **CN-10** |
| **F-11** | **The third active condition is invisible at a glance.** Header tags slice to two (`ClientProfile.tsx:512`); a client with three active conditions shows two with no "+1 more" affordance. Information the EP glances at before a session, silently truncated. | Low × Medium | **CN-11** |
| **F-12** | **Audit snapshots of note content are unbounded.** `content_json` absent from `audit_wide_column_config`; full old+new bodies written to `audit_log` on every note update. Storage growth and a silently-bypassed design intent; no user-facing harm. | Medium × Low | **CN-12** |
| **F-13** | **Browser-native `alert()`/`confirm()` in clinical flows.** Save errors via `alert()` (`NotesTab.tsx:149, 867`), archive via `confirm()` (`NotesTab.tsx:1855-1871`). Functional but off-system; error text is transient and unstyled. | Medium × Low | **CN-13** |
| **F-14** | **Dead affordances erode trust in the record.** A permanently disabled Edit button (`ClientProfile.tsx:805`), a second disabled button at `:1305`, and a stubbed empty Invoices tab (`ClientProfile.tsx:340`) — visible controls that do nothing, on the screen an EP trusts as the clinical record. "Every screen must earn its existence." | Certain × Low | **CN-14** (+ CN-5/CN-6 remove the disabled buttons by making them real) |

### Accepted rather than mitigated (recorded deliberately)

- **A-1 — Author lock with no owner override.** The practice owner cannot edit or archive the EP collaborator's notes (`20260427110000`; RPC re-check `20260429120000:357-404`). Accepted as a record-integrity feature, not a bug — amendments to another practitioner's notes are exactly what a clinical record should refuse. Revisit only if a real workflow (departed collaborator with an erroneous note) forces it; the audit_log amendment trail is the compensating control.
- **A-2 — Portal exposure.** Verified clean; no gap raised. The Pattern A policy plus the no-`visible_to_client`-boolean design is the correct fail-safe shape.
- **A-3 — 30-note recency window on builder/calendar panels.** Accepted; those are adjacency panels, and the profile Notes tab is the complete-record surface with unbounded load + search.
- **A-4 — OCC conflict copy ("Someone else edited…").** With author-locked notes the only realistic conflict is the same person in two tabs; the blunt reload message is acceptable at this scale.
- **A-5 — Trigram search index covers only legacy columns.** Dead weight for template-era notes; current search is in-memory over a complete load and is fine at 40–50 clients. Recorded in CN-8 so schema.md tells the truth about it; no rebuild now.

---

## Gap list

Severity grouping: **P0** architectural and security · **P1** functional · **P2** polish. Each gap names the premortem failure mode(s) it closes and is labelled **Requirement** (traceable to the brief, docs, or design system) or **Recommendation** (beyond them). Per protocol, gaps closing high-likelihood failure modes are promoted — CN-1 is promoted to P0 on F-1's High × High.

### P0 — architectural and security

**CN-1 — Injury flags and contraindications have no inlet and no banner.** Closes F-1 (with CN-4). *Promoted from functional on F-1's ranking.*

Three coordinated pieces, all on existing schema (no migration expected):

1. **Creation.** Expose flag creation in the staff UI. Recommended shape: a dedicated lightweight "Add flag" affordance on the client profile (flags are short structured markers — body region, severity 1–5, optional note — not long-form documents), writing a `clinical_notes` row with `note_type = 'injury_flag'` or `'contraindication'` and `flag_body_region`/`flag_severity` populated. The alternative — a note-type selector inside the note form — couples flag entry to the template flow and is slower than the clinical moment wants. Final surface design at build time; the contract is: an EP can record a flag in under ten seconds.
2. **Banner rendering.** Implement the design-system flag banner (red `#D64045` 3px border-left + `rgba(214,64,69,0.05)` background — the one permitted left-border use) as a grouped "Active flags" section at the top of `NotesPanel` (per both prototypes) and on the client profile header area. Active = `flag_resolved_at IS NULL`, **independent of `is_pinned`** (see CN-4). Because `NotesPanel` is shared, this lands in the session builder and calendar panel automatically — verify there, since that surface is the protected differentiator.
3. **Decouple display from pin.** A flag's visibility as a flag must not depend on `is_pinned` (`NotesPanel.tsx:166-182` today). Pin returns to meaning "keep this note at the top."

**Requirement** (brief §9.1 "injury flags, contraindications"; §2.3 contextual reference; design-system flag-banner pattern; prototypes' Flags sections).

**CN-2 — Decide and enforce the client-visibility posture of `client_medical_history`.** Closes F-5.

The Pattern B SELECT policy (`rls_enable_and_policies.sql:170-204`) makes condition rows — including the practitioner `notes` column — readable by the owning client. The brief never made this call; no portal surface uses it; the schema comment on `clinical_notes` shows the platform's prevailing instinct is fail-closed.

Recommended closing: tighten `client_medical_history` to Pattern A (staff-only) now, in one small migration, and record the decision in `rls-policies.md`. If a portal "your conditions" surface is ever designed, relax it *deliberately* then — ideally with the `notes` column excluded via a view or column split. Tightening is the reversible, fail-safe direction; the opposite drift (a future surface assuming visibility was intended) is the unsafe one. Per the section's known constraints: new policy work must respect the soft-delete trap and the policy must keep filtering `deleted_at IS NULL`.

**Requirement** at production-grade security weighting (brief §4 walls clients off clinical reasoning; the `notes` column is clinical reasoning).

**CN-3 — Declare the canonical model for the standardised initial assessment.** Closes F-6.

Two parallel models exist: the `note_type = 'initial_assessment'` enum value (unused — type is hardcoded) and the dormant `assessment_templates`/`assessments` tables (`20260420100900`, staff-only, no UI, no rows). Brief §9.1 requires a "standardised initial assessment template."

Recommended closing: declare the **note-template system** the standardised-template mechanism — it is built, polished, denormalised for history, and the EP already controls it in settings. Concretely: (a) allow a template to carry a note type (one nullable enum column on `note_templates`, defaulting `progress_note`), so an "Initial assessment" template stamps `note_type = 'initial_assessment'` at write time and the hardcode at `notes-actions.ts:156` becomes template-driven; (b) seed/document an Initial assessment template for the org; (c) mark `assessment_templates`/`assessments` as dormant in `schema.md` with a removal decision deferred to a cleanup pass — do not drop tables in this section. This is the one CN with a (small) migration; the live-data caveat applies, but an additive nullable column is safe either way.

**Requirement** (brief §9.1, §3). Operator confirms the model choice — this is the section's most architectural decision.

### P1 — functional

**CN-4 — Flag lifecycle: review, resolve, and the 14-day rule.** Closes F-4 (and completes F-1's closure). Depends on CN-1.

- "Mark reviewed" and "Resolve" actions on a flag (author-lock applies per A-1 — verify the UPDATE policy permits the authoring EP; these are the first writers of `flag_reviewed_at`/`flag_resolved_at` anywhere).
- Resolved flags leave the banner group and the dashboard; they remain in note history (they are notes).
- Fix the dashboard needs-attention query (`dashboard/page.tsx:129-139`): drop the `is_pinned = true` requirement; implement §6.8.2 — flag is red/urgent when `flag_reviewed_at IS NULL OR flag_reviewed_at < now() - 14 days`. The partial index (`clinical_notes_active_flags_idx`) already matches this access path. *Cross-section touch:* the dashboard panel is section 11's surface; this gap changes only the flag-side of its query to honour the data contract owned here, and is deliberately minimal — full panel polish stays in section 11.

**Requirement** (brief §6.8.2; the lifecycle columns exist precisely for this).

**CN-5 — Edit flow for client personal details and goals.** Closes F-2, and removes the F-14 disabled Edit button by making it real.

Edit affordance on the Contact panel covering: first/last name, phone, DOB, gender, address, referral source, referred-by, emergency contacts, goals, category. Server action with `requireRole(['owner','staff'])`, RLS-scoped UPDATE, OCC via `clients.version` (the trigger and audit log are already in place — this is UI + one action, no migration).

Two fields need explicit semantics:
- **Email is excluded from v1 edit.** It is the invite/login identity (`client_accept_invite` matches on it; section 2's C-12 closure synced names through it). Changing it pre-onboarding means re-invite; post-onboarding it desyncs from `auth.users`. Surface it read-only with a hint ("contact your administrator…" is wrong-voice — just render it without an edit control). A proper email-change flow is its own future gap; record in deferred items if the operator wants it tracked.
- **Name edits on an onboarded client should propagate to `user_profiles`** (section 2's C-12 set names from the `clients` row at accept-time; a later rename would silently desync). One extra UPDATE in the action when `clients.user_id` is set.

**Requirement** (brief §6.1/§9.1 personal details + referral source; a record you cannot correct is not a record).

**CN-6 — Medical history CRUD.** Closes F-3, and removes the second disabled affordance (F-14).

Add / edit / deactivate conditions from the Details tab: `condition`, `diagnosis_date`, `severity` (1–5), `notes`, `is_active`. Server actions, RLS-scoped, staff-only.

- **Deactivate (`is_active = false`) is the primary "remove" verb** — it preserves history and avoids the soft-delete trap entirely.
- True archive (set `deleted_at`) requires a `soft_delete_client_medical_history()` RPC per the established family pattern (`client_medical_history` is **not** in the `20260429120000` family; a bare UPDATE will 42501). Recommended: build the RPC pair alongside, small and formulaic — or explicitly defer archive and ship deactivate-only, recorded as such.
- Header tags then read from live data the EP actually maintains; pair with CN-11.

**Requirement** (brief §9.1 "medical history").

**CN-7 — Archived-client record access.** Closes F-9. **Deferral candidate — operator decides.**

Brief §7.2 requires archived records to remain queryable. Today an archived client's entire record is UI-unreachable for the retention window. Closing properly needs: an additional staff-only SELECT policy on `clients` (and child reads) for `deleted_at IS NOT NULL`, an "Archived" filter on the client list, and a read-only profile rendering. That is real surface area touching the client-list section.

Recommended: **defer with trigger** — *before the first real client archive, or before any paying clinical client (hard rule), whichever comes first* — and index the rider in `docs/go-live-checklist.md` per the technical gate index rule (a re-trigger recorded only here does not fire). At friends-and-family scope with zero archives ever performed, deferral is honest; the gap is recorded so it cannot be forgotten.

**Requirement** (brief §7.2) — deferral is a scheduling decision, not a severity downgrade.

**CN-8 — Documentation sync: schema.md §8.5 and index reality.** Closes F-7.

Update `docs/schema.md` §8.5 for `clinical_notes`: add `content_json`, `template_id`, `appointment_id`, `test_session_id` with their semantics (template denormalisation, SET NULL on template delete, one-note-per-appointment, testing-module link), the widened content-present CHECK, and a truthful note that `clinical_notes_search_trgm_idx` covers legacy columns only and search for template-era notes is application-side (A-5). Also record CN-2's RLS decision in `rls-policies.md` when made. Pure documentation; no code.

**Requirement** (CLAUDE.md: docs are the authoritative position; drift is named a contamination risk).

### P2 — polish

**CN-9 — Draft preservation for in-progress notes.** Closes F-8.

Persist the in-progress note form (template id, field values, appointment link) to `sessionStorage` keyed by client + mode, restored on remount, cleared on successful save. Deliberately *not* DB-backed drafts (no migration, no draft rows in a clinical table, no sync questions) — this covers the actual loss paths (tab close, crash, accidental navigation) at friends-and-family scope. Note the standing premortem memory: surface the DB-backed `practice_preferences` option to the operator if session-scoped feels too weak; recommended answer is sessionStorage now.

**Recommendation** (no spec requirement; protects the EP's longest-form work).

**CN-10 — Token compliance in NotesPanel and MonthCalendar.** Closes F-10.

Replace the hardcoded constants (`NotesPanel.tsx:29-33`) with the real tokens — `var(--color-text)`, `var(--color-muted)`, `var(--color-text-faint)`, `var(--color-border-hairline)`, `var(--color-alert)` — and the `#D64045` literal in `MonthCalendar.tsx` with `var(--color-alert)`. Three of the five current values are *visibly wrong*, not just hardcoded-but-correct. Verify in the session builder after the change (shared component).

**Requirement** (CLAUDE.md non-negotiable: tokens only in `globals.css`/`constants.ts`).

**CN-11 — Active-conditions overflow affordance.** Closes F-11.

Header tags slice to two (`ClientProfile.tsx:512`). Add a "+N more" affordance that reveals the full active list (popover or scroll-to-panel — design-system restraint applies; no new pattern). Trivial alongside CN-6.

**Recommendation** (data-density principle: hidden ≠ truncated-silently).

**CN-12 — Register `content_json` in `audit_wide_column_config`.** Closes F-12.

One config row so >4KB `content_json` snapshots truncate to preview + SHA256 like the legacy columns they replaced. Keeps the audit-log storage bound the original design intended. Note the compliance trade already accepted for SOAP columns applies equally: truncated bodies are not fully reconstructable from audit_log alone — the note row itself is the record.

**Recommendation** (operational hygiene; design-intent restoration).

**CN-13 — Replace `alert()`/`confirm()` with in-form, on-system feedback.** Closes F-13.

Save errors render as a persistent in-form error line (the platform's existing form-error pattern from section 2's `useActionState` work is the precedent); archive confirmation becomes a small on-system confirm consistent with design-system motion/restraint rules. Factual copy per voice rules.

**Recommendation** (design-system conformance; functional behaviour already correct).

**CN-14 — Remove the stubbed Invoices tab.** Closes F-14 (with CN-5/CN-6 converting the disabled buttons).

The Invoices tab (`ClientProfile.tsx:186-193, 340`) renders an empty placeholder. CLAUDE.md "What NOT to build" excludes payment processing; billing is Phase 4 at the earliest. A dead tab on the clinical hub fails "every screen must earn its existence." Remove the tab entry; reintroduce when billing is real. (If the operator wants the tab kept as a deliberate signpost, say so at approval and this becomes a wontfix with rationale.)

**Recommendation** (design philosophy; trivially reversible).

**CN-15 — Consolidate date formatting and empty-state copy.** 

Three separate note-date formatters exist (`formatSessionDate`/`formatDate` in NotesTab, inline `Intl.DateTimeFormat` in NoteReader, `formatNoteDate` in NotesPanel) — consolidate to one util honouring the design-system date convention (`12 Jan 2026`, explicit time-ago). Align empty-state copy across NotesTab/NotesPanel with voice rules. Smallest item; bundle with whatever touches those files last.

**Recommendation** (consistency polish).

---

## Dependency order for the build (step 6, once approved)

1. **CN-2, CN-3** — the two decisions; CN-3's small migration first if approved (everything downstream of note types depends on it).
2. **CN-1 → CN-4** — flag inlet, banner, then lifecycle + dashboard query.
3. **CN-5, CN-6 (+ CN-11)** — profile and medical-history write paths.
4. **CN-8, CN-12** — documentation + audit config (any time after decisions).
5. **CN-9, CN-10, CN-13, CN-14, CN-15** — polish layer.
6. **CN-7** — deferred with trigger (pending operator decision), indexed in `go-live-checklist.md`.

Migrations expected: CN-3 (one additive nullable column on `note_templates`), CN-2 (one policy change), CN-6 (RPC pair, if archive is in scope), CN-12 (one config row). All additive or tightening; none reshape existing rows.

---

## Open questions for the operator (answer at gap-list approval)

1. **Live-data status.** CLAUDE.md still says pre-launch/fake-data-only; section 2 closed 2026-06-11 and session memory believes real beta clients exist in the live DB. Which is true? If beta clients are live, CLAUDE.md "Project state" has drifted and should be updated in the same breath as this section's approval (it changes the stated migration-cost posture for every future section).
2. **CN-2 decision:** tighten `client_medical_history` to staff-only now? (Recommended: yes.)
3. **CN-3 decision:** note-template system as the canonical standardised assessment, `assessments` tables marked dormant? (Recommended: yes.)
4. **CN-1 surface:** dedicated "Add flag" control (recommended) vs note-type selector in the note form?
5. **CN-7:** defer archived-record access with the stated trigger, indexed in `go-live-checklist.md`? (Recommended: yes.)
6. **CN-14:** remove the Invoices tab? (Recommended: yes.)
7. **CN-6 scope:** ship deactivate-only and defer the soft-delete RPC pair, or build the RPC pair now? (Recommended: build now — small and formulaic, and it closes the table's known trap exposure.)

---

## Approval record (step 5 complete)

**2026-06-11 — gap list approved.** Reviewer: claude.ai project chat. Operator answers to the open questions:

1. **Live-data status: there is NO real data in the live DB.** CLAUDE.md's pre-launch position holds; the session-memory claim of real beta clients was wrong and has been corrected in memory. Pre-launch advantages (cheap migrations, reversible RLS) apply to this section's build.
2. **Visibility posture (broader than CN-2):** operator rule — *nothing on the staff side is ever client-viewable except the exercise program, published reports, and upcoming sessions.* CN-2 closes accordingly: `client_medical_history` tightens to staff-only (Pattern A). This rule is also the standing default for any future policy decision.
3.–7. Recommendations accepted as written (CN-3 note-template model; CN-1 dedicated flag control; CN-7 deferred with trigger; CN-14 remove Invoices tab; CN-6 build the RPC pair).

Build order per the dependency section: CN-2 → CN-3 → CN-1, then P1, then P2.

## Gap closures (step 6)

### CN-2 — closed 2026-06-11

Migration `20260611120000_cn2_cmh_staff_only_select.sql` drops the Pattern B SELECT policy on `client_medical_history` and recreates it staff-only (Pattern A). `docs/rls-policies.md` §4.5 rewritten with the rationale, the operator visibility rule, and the deliberate-relax guidance (exclude the `notes` column if a client-facing conditions surface is ever designed). INSERT/UPDATE/DELETE policies unchanged (already staff-only/deny). Applied via `supabase db push` — a wrong policy name would have failed the DROP, so the swap is confirmed by the clean apply. No application code change: no portal surface ever queried the table (per the section audit), so the tighten alters no observable behaviour.

### CN-3 — closed 2026-06-11

Migration `20260611120100_cn3_note_template_types.sql`: `note_templates.note_type` (NOT NULL, default `progress_note`, CHECK `note_templates_type_not_flag` excludes flag types) plus a one-time seed of an "Initial assessment" template (Presenting complaint / History / Objective findings / Assessment / Plan) for every org without one.

Code: `createClinicalNoteAction` stamps `note_type` from the chosen template (the hardcode at the old `notes-actions.ts:156` is gone); `updateClinicalNoteAction` re-stamps from the template for non-flag notes and preserves the type + flag columns for flag notes (editing a flag's text through the template form can no longer demote it — the widened CHECK would otherwise reject the row). Settings → Note templates gained a type select (Progress note / Initial assessment) backed by `setNoteTemplateTypeAction`; the allowed list lives in `template-note-types.ts` — extracted after a build failure taught that a `'use server'` file may only export async functions (runtime consts and even `export type {}` re-exports break the Turbopack server-action transform). The zero-template seeder now seeds both SOAP+ and Initial assessment for brand-new orgs.

Verified by live read-back: every org has an `initial_assessment`-typed template with the five fields — except the operator's org, which already had a template *named* "Initial Assessment", so the migration correctly skipped it (one-time seed, no resurrect-on-delete semantics). **Operator action: flip that template's new type select to "Initial assessment" in Settings — until then it still stamps `progress_note`.** The dormant `assessment_templates`/`assessments` tables are untouched; documenting them as dormant in `schema.md` is CN-8.

### CN-1 — closed 2026-06-11

Migration `20260611120200_cn1_flag_fields_on_contraindications.sql` widens `clinical_notes_injury_flag_fields`: both flag types now require `flag_body_region` and may carry severity/review/resolve columns. The old shape allowed flag columns only on `injury_flag` — a contraindication could never carry a body region **and could never be resolved** (`flag_resolved_at` forced NULL means the dashboard filter would show it forever). Found during the build; within the approved gap text, which specifies both types carry the structured fields. Safe pre-launch — no UI could ever create a contraindication row.

Code, in three pieces per the gap:

1. **Creation** — `createClinicalFlagAction` (`notes-actions.ts`): staff-only, body region required (1–120 chars), severity optional 1–5, optional note stored as a single `content_json` field. Entry point is a Flag icon in the profile header's action cluster → `FlagComposer` modal (`ClientFlags.tsx`): segmented type pair, three fields, save. Ten-second flow.
2. **Banner rendering** — `FlagBanners` (`ClientFlags.tsx`) renders active flags as the design-system banner (3px alert border-left + 5% wash, the one permitted left-border use) above the tab panels on the client profile — visible on every tab. The shared `NotesPanel` gained an "Active flags" banner section at the top, so the session builder right rail and the program calendar side panel show it automatically.
3. **Pin decoupling** — flag badges in `NotesPanel` rows and reader no longer require `is_pinned`; active flags are excluded from the pinned/recent lists (they live in the banner section); resolved flags fall back into the chronological list with their badge.

Loader work: the duplicated note-summary mapping in `program/page.tsx` and `program/days/[dayId]/page.tsx` is now one module (`_lib/note-summaries.ts`). Two behaviours fixed in the consolidation: (a) a second, naturally-bounded active-flags query merges with the 30-note recency window, so an old unresolved flag cannot fall out of the panel — the exact F-1 failure recurring at the surface it matters most; (b) the empty-content filter now keeps flag notes, which may legitimately carry no note text and would previously have been dropped. The profile loader selects the three new flag columns and `ProfileNote` carries them.

**Known interim state, accepted:** a flag created today cannot be marked reviewed or resolved — those actions are CN-4, next in dependency order. The dashboard needs-attention query still requires `is_pinned` and lacks the 14-day rule; that query change is also CN-4's.

Verification: `npm run type-check` and `npm run build` pass; dev server boots with zero console/server errors; live DB read-backs confirm all three migrations. The browser walk-through (composer → profile banner → session-builder Active flags section) requires an authenticated staff session and is handed to the operator — dev server left running on :3000. (`npm run lint` fails on pre-existing debt unrelated to this section — stale Claude-worktree build output swept by bare eslint + a handful of older source findings; spun off as a separate task.)

**Operator verification 2026-06-11: P0 confirmed working end to end in the browser.** The operator's review surfaced the missing remove path (the CN-1 closing note's "known interim state") and directed the CN-4 shape: the header Flag icon reads red while flags are active and opens a manage view with update/remove. Pulled CN-4 forward — closed below.

### CN-4 — closed 2026-06-11 (pulled forward at operator direction)

Lifecycle actions (`notes-actions.ts`), all author-locked via a shared precondition (`lookupFlagForWrite` — the RLS UPDATE policy is author-only, so a blocked write would surface as a silent zero-row no-op; the lookup turns that into a human error, same posture as the archive action):

- `resolveClinicalFlagAction` — stamps `flag_resolved_at`. **Resolve is the correct verb for "the injury recovered", not delete:** the flag leaves the profile banner, the NotesPanel Active-flags section, and the dashboard, but stays in the client's note history with its resolved date (clinical-record integrity; §7.2 retention). Idempotent.
- `markClinicalFlagReviewedAction` — stamps `flag_reviewed_at` = now (always overwrites); clears the flag from the dashboard needs-attention panel for 14 days.
- `updateClinicalFlagAction` — edits body region / severity / note text with the same validation as create, OCC via `version`. Type and dates untouched (a flag's type is fixed at creation).
- True deletion (flag created by mistake) routes through the existing `archiveClinicalNoteAction` (author-locked SECURITY DEFINER RPC), with copy in the confirm steering recovery cases to Resolve.

UI (`ClientFlags.tsx`, operator-directed shape): the profile header Flag icon renders red with a light fill while active flags exist ("Manage flags"); clicking it — or any flag banner — opens `FlagDialog`. With active flags it opens as a manager list (each flag: Mark reviewed · Edit · Resolve · Archive, plus reviewed-date readout and Add flag); with none it opens straight into the create form. Edit reuses the create form prefilled, type fixed.

Dashboard (`dashboard/page.tsx`): the needs-attention flag query drops the `is_pinned` requirement (an unpinned flag could never reach the panel) and implements the §6.8.2 rule — active flags where `flag_reviewed_at IS NULL OR flag_reviewed_at < now() − 14 days`, using the partial index's access path. Reason copy is now type-aware ("Active contraindication — …").

Accepted/known: Resolve fires on one click with no confirm (speed over ceremony — the data is retained and an identical flag can be re-created in ten seconds; no unresolve UI for now, `restore`-style unresolve deferred until a real need). Archive keeps the browser `confirm()` matching NotesTab's current pattern — CN-13 (P2) replaces both with the on-system dialog. Reviewed/resolved state changes by a non-author practitioner are blocked by the author lock per A-1 — revisit only if the two-practitioner workflow surfaces a real case.

Verification: `npm run type-check` + `npm run build` pass. Browser walk-through of the new lifecycle (red icon → manage → resolve/edit/archive → dashboard clearing) handed to the operator on :3000, same as the P0 pass. Not pushed to production pending that verification, per operator instruction.

