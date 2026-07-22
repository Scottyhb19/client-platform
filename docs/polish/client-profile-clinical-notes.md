# Client profile and clinical notes — gap list

**Polish-pass section:** 3 of the locked polish-pass order (clinical-record layer — note template, flag banners, medical history, history rendering).
**Active step:** Complete (7 of 7). Section signed off **Closed with deferred items** 2026-06-11 — see the Sign-off at the very bottom. Fifteen of sixteen gaps closed; CN-7 deferred with its trigger indexed in `go-live-checklist.md`.
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

**CN-16 — Details tab reads as a form at rest.** *Added at operator direction 2026-06-11, after the P1/P2 build — post-premortem; closes no ranked failure mode (UX refinement).*

The Details tab renders as a narrow 560px single column — plain label/value text rows stacked vertically, most of the 1200px container unused, vertical scrolling where horizontal space should carry the load. Operator-specified shape (clarified by Q&A at intake): **read view only** (the CN-5 edit dialog stays as-is); each value sits in an **input-style read-only box** with a small label above, so read and edit feel like the same surface; layout is a **two-column 2:1 grid** mirroring the Programs tab — Contact (field boxes flowing in two columns) left, Medical history + Goals stacked right.

**Recommendation** (operator-directed; design-system data-density principle).

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

### CN-5 — closed 2026-06-11

Migration `20260611130000_cn5_sync_client_profile_name.sql`. The pre-build recon found the gap text's "one extra UPDATE in the action" cannot work as written: the `user_profiles` UPDATE policy is **self-only** (`update own profile`, `user_id = auth.uid()`), so a staff-session UPDATE against a client's profile row is silently filtered to zero rows — the same trap class as the soft-delete family. The name sync therefore routes through a narrow SECURITY DEFINER RPC (`sync_client_profile_name`), which re-reads the canonical clients row *inside* the function — a caller cannot use it to write arbitrary names, only to re-assert what the clinical record already says — and no-ops for pre-onboarding clients. C-12's standing constraint (guard this overwrite if Phase-2 self-editing ever ships) is restated in the migration header.

Code: `updateClientDetailsAction` (`actions.ts`) — staff-only, RLS-scoped UPDATE, OCC via `clients.version` (pre-check plus version-scoped UPDATE so a second-tab save refuses rather than clobbers; factual conflict copy per the A-4 posture). Names validated 1–100 and DOB validated 1900–today, mirroring the DB CHECKs; optional fields trim to NULL consistent with `/clients/new`. A name change on an onboarded client calls the sync RPC; a sync failure reports honestly ("Details saved, but the portal profile name could not be updated… Save again to retry") rather than pretending the save failed. Email is excluded from the form per the approved semantics — rendered read-only with no edit control and no hint copy.

Read path (recon finding, same change): the profile loader and `ProfileClient` did not carry `referred_by`, `emergency_contact_name`, `emergency_contact_phone` — all named in the approved gap text — nor `category_id`/`version`. All five now load; the Contact panel renders Referred by and a single combined Emergency line; `client_categories` loads for the edit form's category select.

UI: `EditClientDetailsDialog` (`EditClientDetails.tsx`) — one dialog covers everything the Contact and Goals panels render, opened from now-live Edit buttons on both panels. The permanently-disabled Contact Edit button (F-14's first dead affordance) is gone by becoming real.

Verification: `npm run type-check` passes at this checkpoint; full `npm run build` + browser walk-through run at the end of the P1 batch.

### CN-6 — closed 2026-06-11 (CN-11 bundled per the approved dependency order)

Migration `20260611130100_cn6_cmh_soft_delete_rpcs.sql` — the `soft_delete_client_medical_history` / `restore_client_medical_history` pair, approved at sign-off (open question 7: build now). Family pattern exactly (SECURITY DEFINER, auth check first, org+role replicating the UPDATE policy, REVOKE/GRANT); no author lock — medical history is practice-maintained, not authored; no unique-active index, so restore has no conflict path.

Actions (`medical-actions.ts`): `createMedicalConditionAction`, `updateMedicalConditionAction`, `setMedicalConditionActiveAction`, `archiveMedicalConditionAction`. All staff-only, RLS-scoped, validation mirroring the DB CHECKs (condition 1–500, severity 1–5, diagnosis date per `cmh_diagnosis_date_sane`). A shared RLS-gated lookup humanises not-found/cross-org/archived before any write, same posture as the flag actions. **Mark resolved (`is_active = false`) is the primary remove verb** per the gap text — plain UPDATE, no trap exposure; Archive routes through the RPC with confirm copy steering genuine resolutions to Mark resolved.

**Concurrency decision (recon finding, recorded; rationale corrected 2026-06-11).** `client_medical_history` carries no OCC `version` column — the gap doc didn't surface this. Closed as **last-write-wins** for the build: condition rows are short structured facts that are rarely co-edited. **Correction (reviewer finding):** the original note said "maintained by one practitioner" — that is wrong; the friends-and-family beta runs two staff (operator + EP collaborator), and the UPDATE policy admits both with no author lock, so the clobber window is live now, not contingent on future growth. The honest framing of the accepted risk is "rarely co-edited, short structured facts," not "single practitioner." The mitigation — an additive `version` column + the existing `bump_version_and_touch()` trigger (mirroring `clients`/`clinical_notes`) plus a version check in `updateMedicalConditionAction` — is cheap while pre-launch advantages hold and is now indexed as a now-active item in `go-live-checklist.md` §8. Recorded in the `medical-actions.ts` header.

UI (`MedicalHistory.tsx`): a Medical history panel on the Details tab — active conditions first (previously they rendered *nowhere* except the truncated header tags — recon finding), Resolved / historical group beneath (subsuming the old read-only panel), per-row Edit · Mark resolved/Reactivate · Archive, add/edit dialog matching the FlagForm pattern. The second F-14 dead affordance class (no way to maintain the table) is gone.

CN-11: the header's two condition tags gain a "+N more" tag-button on overflow that lands on the Details tab where the full list now lives. Silent truncation (F-11) closed.

Verification: `npm run type-check` passes at this checkpoint; build + walk-through at the end of the batch.

### CN-7 — closed as deferred-with-trigger 2026-06-11 (per the approval record)

The rider is now indexed in `docs/go-live-checklist.md` §8 (Deferred hardening) with the approved trigger — *before the first real client archive, or before any paying clinical client, whichever comes first* — per the technical gate index rule (a re-trigger recorded only in this doc does not fire). The checklist entry also records the recon finding that sharpens the trigger: **the archive affordance is already live** (client profile header → `archiveClientAction` → `soft_delete_client` RPC), so the gap doc's "no archive has ever happened" framing understated proximity — the trigger is one staff click away, not hypothetical. No code change; deferral is a scheduling decision, not a severity downgrade (brief §7.2 remains the requirement).

### CN-8 — closed 2026-06-11

`docs/schema.md`: §8.5 rewritten to current DDL — `template_id` / `appointment_id` / `content_json` (`20260427100000`), `test_session_id` (`20260428130000`), the widened content-present CHECK (legacy SOAP **or** `content_json`), and the CN-1-widened flag-fields CHECK (`20260611120200`). The trigram-index truth (A-5) is recorded in place: legacy columns only, covers nothing for template-era notes, search is application-side. New §8.5.1 documents `note_templates` / `note_template_fields` (previously absent from §8 entirely), including the CN-3 `note_type` column and the hard-delete convention with its rationale. §3.2's table inventory updated; `assessment_templates` / `assessments` marked **dormant** with the CN-3 decision pointer, completing the CN-3 closure's hand-off.

`docs/rls-policies.md`: new §4.6.1 for `note_templates` / `note_template_fields` (Pattern A with deliberate hard-DELETE deviation; Pattern C via parent — these tables had no section in the file). §4.6 now tells the whole truth about `clinical_notes` UPDATE: author-locked since `20260427110000`, soft-delete via the author-locked RPC — previously documented as plain staff-org UPDATE. §4.7/§4.8 carry the dormant notation. CN-2's §4.5 rewrite was already landed at CN-2 closure — verified current, no further change.

**Artifact noted during the sync, documented rather than changed:** `clinical_notes_active_flags_idx` covers `note_type = 'injury_flag'` only, while the CN-4 dashboard query filters both flag types — the partial index does not cover contraindication rows. Harmless at current scale; recorded in §8.5 with a widen-if-slow trigger rather than a migration (an index change is outside CN-8's documentation scope and wasn't in the approved gap text).

### CN-10 — closed 2026-06-11

`NotesPanel.tsx`: the five hardcoded constants (INK/MUTED/FAINT/BORDER/ALERT) are gone — every usage site now references the token directly (`var(--color-text)`, `var(--color-muted)`, `var(--color-text-faint)`, `var(--color-border-hairline)`, `var(--color-alert)`), so the three visibly-wrong greys are corrected and future drift back to hex is impossible. Recon scope addition, same pass: two `#EDE8E2` template-badge backgrounds replaced with `var(--color-surface-2)` (exact token-value match). `MonthCalendar.tsx`: the `#D64045` literal on the day-popover delete icon is now `var(--color-alert)`.

**Deliberately left as literals, recorded:** the alert alpha washes — `rgba(214,64,69,0.05)` banner wash and `rgba(214,64,69,.08)` badge wash (NotesPanel, ClientFlags, MedicalHistory) and MonthCalendar's `0.4`/`0.06` delete-button variants. The design system specifies the banner wash as that exact rgba, `globals.css` itself hardcodes the `.08` wash in `.tag.flag`, and CSS `var()` cannot carry an alpha-varied token without `color-mix()` cleverness the restraint rules don't want. If a wash token family (`--color-alert-wash`) is ever added to `globals.css`, sweep these in the same change. Non-alert literals found and left untouched as out of scope: MonthCalendar's `#f5f0ea` month-grid parchment (not a token value — changing it would alter the design, not align it) and the copy-target green tint.

NotesPanel is the shared component — this lands in the session builder right rail and the calendar side panel automatically; visual confirmation there is part of the operator walk-through.

### CN-16 — closed 2026-06-11 (operator-directed addition)

The Details tab is now a form at rest. The 560px single column is gone: a 2:1 grid (mirroring the Programs tab) puts the Contact panel left with every value in an input-style read-only `FieldBox` — small eyebrow label over a bordered input-radius box with a surface wash, so the read view and the CN-5 edit dialog read as the same surface — flowing two boxes per row (Address spans both; emergency contact and phone are now separate labelled boxes, replacing the combined line). Medical history and Goals stack in the right column. The orphaned `DetailRow` helper (its last consumer was this layout) is removed. Empty values render a muted em dash. Vertical height of the tab roughly halves at desktop width; the operator-specified shape (read view only, input-style boxes, 2:1 grid) was confirmed by Q&A at intake and is recorded in the gap entry.

### CN-12 — closed 2026-06-11

Migration `20260611130200_cn12_audit_wide_content_json.sql`: one row — `('clinical_notes', 'content_json')` — in `audit_wide_column_config`, so `audit_trim_row()` replaces >4KB `content_json` snapshots with the truncated preview + SHA-256 + byte size, same as the legacy SOAP columns it replaced. No trigger change needed: `audit_trim_row` extracts the column as text (`->>`), which serialises jsonb cleanly. The compliance trade already accepted for the SOAP columns applies equally and is restated here: truncated bodies are not reconstructable from `audit_log` alone — the note row itself is the record.

**Process note, recorded honestly:** the P2 recon omitted CN-12 and the build proceeded on a "no migrations in P2" claim that was therefore wrong. Caught during the closing-commit sweep against the gap list — which is the sweep working as intended — but it should have been caught at recon. The gap list is the contract; recon must enumerate it, not reconstruct it from memory.

### CN-9 — closed 2026-06-11

New `_lib/note-draft.ts`: sessionStorage draft persistence per the approved shape (no DB-backed drafts; the standing `practice_preferences` option stays unexercised). Keys follow the ReportsPanel `odyssey:` convention — `odyssey:note-draft:{clientId}:create` / `:edit:{noteId}`; load/save/clear are SSR-safe and fail silent. The draft carries exactly the five user-state values: `templateId`, per-field `values`, `appointmentId`, `testSessionId`, `testCaptureSummary` (a captured test session's DB rows exist from capture time, so a drafted link references durable data, and discarding a draft never deletes the session).

NoteForm wiring:
- **Restore** happens in the state initializers on mount. A deep-link appointment prefill (`?new=1&appointment=…`) is explicit intent and wins — the draft is ignored, not deleted. A drafted template that has since been deleted falls back to the default template (the draft's field values, keyed by the old field ids, simply don't render). `seededTemplateRef` initialises to the *resolved* template — seeding from the default would have wiped restored values on mount whenever the draft's template differed (caught during the build).
- **Persist** is a 600ms-debounced effect that starts only once the user has typed (`dirtyRef`) or captured a test session — an untouched form writes no draft, so stale drafts can't shadow later template-default changes. Appointment-only selection deliberately doesn't trigger a persist (cheap to redo; recorded).
- **Clear** on successful save (both `performSave` branches — covering the Save button and the create→edit auto-save handoff) and on explicit Cancel, which is the deliberate-discard verb. Accidental loss paths (tab switch unmounting NotesTab, navigation, reload, crash-with-session-restore) never pass through Cancel, so the draft survives them — which is the entire point (F-8). The recon found the loss surface was wider than the gap text implied: every profile-tab switch unmounts the form, not just crashes.

### CN-15 — closed 2026-06-11

New `src/lib/format-date.ts` exporting `formatShortDate` ("12 Jan 2026", en-AU, design-system convention). The five in-section duplicates collapsed onto it: NotesTab `formatDate`, NotesPanel `formatNoteDate`, ClientFlags `formatFlagDate`, MedicalHistory `formatConditionDate`, ClientProfile `formatDate` (and `formatDob` now wraps the shared formatter, keeping only its age suffix).

**Correction to the gap text, found during the build:** `formatSessionDate` is *not* a duplicate — ground truth shows it renders date **+ start time** (no year) for linked-appointment rows, a deliberately distinct shape. The recon agent had misquoted it as year-bearing; verified first-hand before flattening it would have silently dropped session times from note rows. It stays local to NotesTab with a comment, alongside `formatAppointmentLabel` (also a distinct date+time shape). Consolidation collapses duplicates; it does not flatten distinct shapes.

Left for their own sections, recorded in the util header: TestCaptureModal/ReportsPanel/BatterySessionsView duplicates (testing module, closed section — not for re-polishing) and FilesTab (the Files tab is out of this section's scope per the tab-divergence note).

Empty-state copy aligned: NotesTab's rail now opens "No notes for this client yet…" matching NotesPanel's opener, both using the "appear here" phrasing; the remaining tail copy stays surface-specific by design (the rail mentions quick reference; the builder panel mentions adding from the profile).

---

## Closing commit (step 7) — 2026-06-11

**What changed, by gap number.** All sixteen gaps from the approved list are closed; fourteen commits carry the work (`e3a55cd` through `3c67dbf`).

- **P0.** CN-2 tightened `client_medical_history` SELECT to staff-only (Pattern A) per the operator visibility rule. CN-3 made the note-template system the canonical standardised-assessment mechanism — templates carry a `note_type`, the hardcode is gone, an Initial assessment template is seeded per org, and the dormant `assessments` model is documented as such. CN-1 gave flags an inlet (ten-second composer), the design-system banner on the profile and the shared NotesPanel (so the session builder and calendar inherit it), and decoupled flag visibility from pinning; the flag-fields CHECK widened so contraindications can carry and resolve flag state. CN-4 (pulled forward at operator direction) added the lifecycle — mark reviewed, edit, resolve, archive — and implemented the brief §6.8.2 14-day rule in the dashboard needs-attention query, dropping the `is_pinned` coupling.
- **P1.** CN-5: the client details edit flow — one dialog over Contact + Goals, OCC via `clients.version`, email excluded as the login identity, and renames on onboarded clients propagating to `user_profiles` via a narrow SECURITY DEFINER RPC (the planned bare UPDATE was impossible: that table's UPDATE policy is self-only). The read path gained the three columns the page never loaded (`referred_by`, emergency contacts). CN-6: medical-history CRUD — add/edit, Mark resolved as the primary remove verb, archive via a new soft-delete RPC pair closing the table's known 42501 trap; concurrency is deliberate last-write-wins (the table has no OCC column — recon finding, recorded). CN-11 (bundled): "+N more" overflow on the header condition tags. CN-7: deferred with trigger and **indexed in `docs/go-live-checklist.md` §8**, including the finding that the archive affordance is already live, so the trigger is one click away. CN-8: schema.md §8.5 rewritten to current DDL (four template-era/testing columns, both widened CHECKs, the trigram-index truth), new §8.5.1 for the template tables, dormant markings, and the rls-policies.md author-lock truth in §4.6 plus a new §4.6.1.
- **P2.** CN-9: sessionStorage draft preservation for in-progress notes (five user-state values, debounced, deep-link prefill wins, cleared on save and explicit Cancel). CN-10: NotesPanel's five off-system colour constants and MonthCalendar's alert literal replaced with tokens at every usage site; three of the greys were visibly wrong. CN-12: `content_json` registered in `audit_wide_column_config`, restoring the 4KB audit-snapshot bound for the column all template-era note content lives in. CN-13: a reusable on-system `ConfirmDialog` plus persistent error lines replace all eight browser `alert()`/`confirm()` sites in the section's clinical flows. CN-14: the stubbed Invoices tab removed end to end. CN-15: the duplicated "12 Jan 2026" formatter consolidated to `src/lib/format-date.ts` across the five in-section components; `formatSessionDate` was found to be a distinct date+time shape misdescribed by the gap text and deliberately kept local. CN-16 (operator-directed addition, intake Q&A recorded in the gap entry): the Details tab re-laid as a form at rest — 2:1 grid, input-style read-only field boxes matching the edit dialog's shape.

**Migrations:** six, all applied to the live project via `supabase db push` with clean applies and type-regen verification — `20260611120000` (CN-2 policy), `20260611120100` (CN-3 template types + seed), `20260611120200` (CN-1 CHECK widening), `20260611130000` (CN-5 name-sync RPC), `20260611130100` (CN-6 RPC pair), `20260611130200` (CN-12 config row). All additive or tightening; none reshape rows; pre-launch advantages applied (operator-confirmed no real data).

**Acceptance tests run and results.**

- `npm run type-check` — pass after every gap closure.
- `npm run build` — pass at the P1 close, the P2 close, and the final tree.
- Dev server on :3000 — boots and serves cleanly at the final tree; zero console/server errors on fresh load.
- Live read-backs — every migration confirmed by clean `db push` apply + regenerated types showing the new RPCs/columns (CN-12's regen was zero-diff, as expected for a config row).
- Operator browser verification — P0 confirmed working end to end 2026-06-11 (recorded at CN-1/CN-4). P1 + P2 confirmed by the operator in the same session ("everything looks good"), with the Details-tab UX the one exception raised — closed as CN-16. CN-16 and CN-12 themselves await a final browser glance; the dev server is left running.
- `npm run lint` — fails on pre-existing debt unrelated to this section (recorded at CN-1; tracked separately).
- **CN-2 acceptance gate — MET (2026-06-11).** The within-org client-deny property CN-2 introduced is verified by `supabase/tests/database/19_cmh_client_select_denied.sql`, run in the Supabase SQL Editor with three `ok` results: a client-role session sees zero `client_medical_history` rows (load-bearing), staff in the same org sees the row, and the client session is confirmed live by reading its own clients row. The grid's `ok`-number ordering (`ok 1`, then `ok 3` on the staff line, then `ok 2` on the client line) is the documented pgTAP execution-counter artifact noted in the file header, not a failure.
- **Suite 17 scope (clarified at sign-off).** `supabase/tests/database/17_cross_tenant_isolation.sql` is the `go-live-checklist.md` §6 **cross-tenant org-isolation** check (org A cannot read org B) — **not** CN-2 verification. CN-2's change is within-org role gating, which 17 does not exercise (that is test 19's job). 17's §6 re-run cadence on RLS-touching migrations is tracked in the checklist, separate from this section's close.

**Deferred, with triggers.**

- **CN-7** — archived-client record access. Deferred per the approval record; trigger (*before the first real client archive, or before any paying clinical client, whichever comes first*) indexed in `go-live-checklist.md` §8 per the technical gate index rule. The archive button is live today, so the trigger is behavioural, not hypothetical.
- Within-gap deferrals, each recorded in its closure note: a proper email-change flow (CN-5); an `--color-alert-wash` token family for the sanctioned rgba literals (CN-10); widening `clinical_notes_active_flags_idx` to cover contraindications if the dashboard query ever slows (CN-8 — documented in schema.md §8.5); flag un-resolve UI (CN-4, awaits a real need); ~21 `alert()`/`confirm()` sites outside clinical flows (CN-13 — their sections inherit the ConfirmDialog precedent); four out-of-section date-formatter duplicates (CN-15 — named in the util header).

**Premortem accounting.** Mitigated: F-1 (CN-1+CN-4), F-2 (CN-5), F-3 (CN-6), F-4 (CN-4), F-5 (CN-2), F-6 (CN-3), F-7 (CN-8), F-8 (CN-9), F-10 (CN-10), F-11 (CN-11), F-12 (CN-12), F-13 (CN-13), F-14 (CN-14 plus CN-5/CN-6 converting the dead affordances). Deferred: F-9 (CN-7, trigger indexed at the checklist that fires). Accepted as planned, unchanged: A-1 (author lock, no owner override), A-2 (portal exposure verified clean), A-3 (30-note adjacency window — now supplemented by CN-1's unbounded active-flags merge so flags can't age out), A-4 (blunt OCC copy), A-5 (trigram index dead weight — now recorded truthfully in schema.md per CN-8). Newly accepted during the build, with rationale in the closure notes: last-write-wins on `client_medical_history` edits (no OCC column — **rationale corrected 2026-06-11 on reviewer finding: the original "single-practitioner facts" framing was wrong; the friends-and-family beta runs two staff, operator + EP collaborator, so concurrent-edit clobber is a live exposure, not hypothetical. The honest accepted risk is "rarely co-edited, short structured facts." The additive `version` + `bump_version_and_touch()` mitigation is now indexed as a now-active item in `go-live-checklist.md` §8**) and the `active_flags_idx` predicate gap (harmless at scale; widen-if-slow trigger documented).

**Process note.** The P2 recon omitted CN-12 from its enumeration and the build initially proceeded on a wrong "no migrations in P2" claim; the closing-commit sweep against the gap list caught it and CN-12 closed before this commit. Recorded so the next section's recon enumerates the contract rather than reconstructing it.

### CN-13 — closed 2026-06-11

New `ConfirmDialog` (`_components/ConfirmDialog.tsx`) — the on-system confirm for clinical flows, shaped on the ArchiveConfirm precedent (scrim, 440px card, display heading, factual body, persistent error block, Cancel + tonal confirm; `tone` picks alert-red for destructive verbs or primary for content-replacing ones). All eight browser-native sites in the section are gone:

- **Note archive** (NotesTab `ArchiveButton`): `confirm()` + `alert(res.error)` → dialog with busy state; a failed archive keeps the dialog open with the error rendered, instead of a vanishing alert.
- **Flag archive** (ClientFlags) and **condition archive** (MedicalHistory): `confirm()` → dialog; action errors land in each surface's existing persistent error block via `run()`, unchanged. The recovery-steering copy ("use Resolve / Mark resolved…") is preserved verbatim in the dialog body.
- **Copy-previous-note guards** (both the side-rail copy icon and the most-recent shortcut): `confirm()` → primary-tone dialog ("Replace what you've typed?"). Declining the rail variant still exits copy mode, as before.
- **Auto-save failure on create→edit handoff**: the `alert()` was redundant — `performSave` already renders the failure as the form's persistent in-form error line, and navigation stays blocked. The alert is simply removed.
- **Pin/unpin failure**: `alert()` → a persistent error line hosted by the previous-notes list (FlagList pattern), fed by an `onError` callback from `PinToggle`; cleared when the next attempt starts. The optimistic revert is unchanged.

Out-of-scope, recorded: the wider staff app carries ~21 more `alert()`/`confirm()` sites (session builder, settings, schedule, library). CN-13's approved text scopes to clinical flows; those surfaces' own polish-pass sections inherit the `ConfirmDialog` precedent.

### CN-14 — closed 2026-06-11

The Invoices tab is gone: `Tab` union member, `TABS` entry, both `VALID_TABS` arrays (component + page), the conditional render, the `InvoicesTab` function (including the Funding placeholder panel, referenced by nothing else), and the now-unused `CreditCard` import. The P2 recon confirmed zero deep links to `?tab=invoices` anywhere in `src/`; an existing deep link would now safely fall back to the details tab via `pickTab`. Two consequential cleanups in the same cut: the `EmptyBlock` helper existed solely for the Invoices placeholder and was removed as dead code, and ProgramTab's grid comment no longer describes its layout by reference to a tab that doesn't exist. Reintroduce the tab when billing is real (Phase 4 at the earliest, per "What NOT to build").

---

*Per the section sign-off ritual: Claude Code's work ended at the Closing commit above; the section closes when the operator's claude.ai project chat reviews it and records the decision here. On this Closed-with-deferred-items decision, CLAUDE.md's "Active section" advances to polish-pass order item 4 — Exercise library.*

---

## Sign-off

**Date:** 2026-06-11
**Reviewer:** claude.ai project chat; reviewer model Claude Opus 4.8 (1M context)
**Decision:** Closed with deferred items.

Fifteen of sixteen gaps closed; CN-7 deferred with its trigger indexed in `go-live-checklist.md`. The **CN-2 acceptance gate is met**: `supabase/tests/database/19_cmh_client_select_denied.sql` was run in the Supabase SQL Editor and returned three `ok` results — a client-role session sees zero `client_medical_history` rows (load-bearing), staff in the same org sees the row, and the client session is confirmed live by reading its own clients row. The grid's `ok`-number ordering (`ok 1`, then `ok 3` on the staff line, then `ok 2` on the client line) is the documented pgTAP execution-counter artifact noted in the file header, not a failure. **Suite 17 is recorded as the §6 cross-tenant org-isolation check only, not as CN-2 verification.** The four post-review record items are confirmed complete and operator-verified.

**Deferred items, with rationale and re-trigger:**

1. **CN-7 — archived-client record access.** Master brief §7.2 requires archived records to stay queryable; archiving a client today makes the record UI-unreachable for the retention window. Deferred at friends-and-family scope (no archive performed), but the archive affordance is already live, so the trigger is behavioural. **Re-trigger: before the first real client archive, or before any paying clinical client, whichever comes first.** Indexed in `go-live-checklist.md` §8.

2. **Anon-EXECUTE grant sweep across the SECURITY DEFINER RPC family.** Source revokes from `PUBLIC` and grants only `authenticated`, but runtime anon-EXECUTE is unverified for the whole family (REVOKE-FROM-PUBLIC does not strip a role-specific anon grant); each function's in-body auth guard is the load-bearing protection meanwhile. **Re-trigger: once a live SQL query path exists — read `information_schema.role_routine_grants` and confirm anon absent.** Tracked in `go-live-checklist.md` §4.

3. **`client_medical_history` last-write-wins (now-active).** No OCC column and no author lock on the UPDATE policy; the beta runs two staff, so the clobber window is live now, not hypothetical (the earlier "single-practitioner" rationale was corrected). Fix is additive: a `version` column + the existing `bump_version_and_touch()` trigger plus a version check in `updateMedicalConditionAction`. **Re-trigger: before any sustained two-practitioner editing of medical history.** Indexed in `go-live-checklist.md` §8; bounded harm (one re-enterable short fact).

4. **`clinical_notes` client-deny coverage gap.** The prescribed `rls_clinical_notes_select_client_denied` test does not exist; the policy is believed correct from source (Pattern A, staff-only) but is **unverified by automated test**. **Re-trigger: generalise `19_cmh_client_select_denied.sql` to assert client-deny across all staff-only clinical tables.** Logged as a `rls-policies.md` §4.6 finding; §4.6 must not be represented as test-verified until then.

5. **`clients.user_id` column-restriction indirection.** The staff UPDATE policy has no column-level restriction, so a compromised staff session could repoint `user_id` and use `sync_client_profile_name` to overwrite another user's display name. Pre-existing property; bounded harm. **Re-trigger: if a column-level policy or a `user_id`-mutation guard trigger is ever warranted.** Logged in `rls-policies.md` §4.4, not represented as closed.

---

## Deferred-item closures (post-sign-off)

### Sign-off deferred item 3 — `client_medical_history` last-write-wins — CLOSED 2026-07-02

The now-active trigger (two-staff beta) fired the item; closed exactly as prescribed in the deferral text, as pre-Pro-upgrade work while the pre-launch advantages still hold.

- **Migration `20260702120000_cmh_occ_version.sql`** — additive `version integer NOT NULL DEFAULT 1` + the shared `bump_version_and_touch()` trigger (`cmh_bump_version`), replacing the plain `cmh_touch_updated_at` touch trigger (the bump function also touches `updated_at`, so keeping both would double-fire). Mirrors `clients`/`clinical_notes`; schema.md §12 table list updated. Applied to the live project via `supabase db push`, clean; types regenerated (3-line diff, the new column).
- **`updateMedicalConditionAction`** now includes the last-read version in its UPDATE WHERE clause (`.eq('version', input.version).select('id')`); zero rows returns the same conflict copy as clinical notes ("Someone else edited this condition while you were typing…"). `version` threads loader → `ProfileCondition` → edit dialog.
- **Scope decision:** the `is_active` toggle (Mark resolved / Reactivate) and archive stay versionless deliberately — both write a single field whose intent is unambiguous, so refusing them on an unrelated concurrent edit would be friction without protection. This matches the deferral text, which named `updateMedicalConditionAction` only.
- **Verification:** pgTAP `supabase/tests/database/51_cmh_occ_version.sql` — 4/4 green on live under a real staff JWT session (current-version UPDATE matches 1 row; trigger bumps to 2; stale-version UPDATE matches 0 rows; first writer's value survives). `tsc --noEmit` green. Render tier accepted at F&F per go-live-checklist §5b; the conflict-copy paint rides the operator's next browser pass.
- **Adjacent finding, NOT absorbed (scope discipline):** `client_medications` (added 2026-06-29) carries the identical last-write-wins property, documented in its action header as accepted at f&f scale. Left as-is; its header now points at the §12 pattern if co-editing surfaces in practice.

Gate pointer updated in `docs/go-live-checklist.md` §8 (CN-6 entry marked closed, pointing here). Scenario CP-OCC-1 added to `test_scenarios_template.md`.

**Client profile and clinical notes is formally closed (with deferred items).** CLAUDE.md's Active section advances to polish-pass order item 4 — Exercise library.


---

## Ledger reconciliation — 2026-07-22 (platform drift audit)

Appended by the ten-doc ledger drift audit. Two of the five Sign-off deferred items closed on 2026-07-02 and were never written back here: **item 1, CN-7 archived-client record access — CLOSED 2026-07-02** under its own signed-off section doc (`polish/archived-client-access.md`; indexed `go-live-checklist.md` §8), and **item 2, the SECURITY DEFINER anon-EXECUTE family sweep — CLOSED** (the 2026-06-23 platform-wide enumeration explicitly closed the "Section-3 RPC family" item; gate CLOSED 2026-07-02, checklist §4, pgTAP `52`). Item 3 (CN-6 OCC) was already closed in-doc the same day. **Items 4 and 5** (`clinical_notes` client-deny automated-test coverage; `clients.user_id` column-restriction indirection) were indexed only in `rls-policies.md` §4.6/§4.4 — a ledger hole under the single-ledger rule, since a re-trigger recorded outside the checklist does not fire; both now carry a `go-live-checklist.md` §8 entry (added 2026-07-22). This doc is a historical record per the single-ledger rule; current state lives on the checklist.
