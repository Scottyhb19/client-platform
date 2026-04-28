# Polish-pass gap analysis — Testing & Reports Module

**Brief:** [`CLAUDE_CODE_BUILD_PROMPT_testing_module.md`](../../CLAUDE_CODE_BUILD_PROMPT_testing_module.md)
**Schema:** [`data/physical_markers_schema_v1.1.json`](../../data/physical_markers_schema_v1.1.json)
**Audit date:** 2026-04-28
**Status:** Gap document — awaiting sign-off before any code changes.

---

## 0. Executive summary

The brief describes a structured per-metric testing module (`test_sessions` + `test_results` + per-EP overrides + publish gate). **None of those tables, no resolver, no capture UI, no settings UI, and no client-side renderer exist in the repo.** What does exist:

- **Legacy rendered-HTML report flow.** `reports`, `report_versions`, `vald_raw_uploads`, `vald_device_types` tables; `/portal/reports/page.tsx` lists those rows. This is the Cowork-skill report path the brief explicitly keeps in parallel (§9). It is *correctly out of scope* — it stays untouched.
- **A placeholder staff Reports tab.** `ClientProfile.tsx` line 238 wires a `ReportsTab()` that renders three empty panels with disabled buttons. Empty state copy reads "once the assessment module is wired up." The shell exists; the data path does not.
- **A `assessments` + `assessment_templates` table pair.** These are jsonb-form-based intake/reassessment templates, not per-metric structured results. Different model, different purpose. Untouched by this module.

The honest framing: this is a greenfield build for the structured testing module that runs alongside the legacy HTML-report path. The brief's "polish toward target state" framing was correct — the *Reports tab in the staff profile* and the *Reports page in the portal* are existing surfaces the new module must occupy — but the underlying data layer, settings layer, and rendering pipeline need to be built net-new.

Pre-launch advantage applies: schema migrations are still cheap, RLS changes are reversible, no real client data to migrate.

---

## 1. What's already correct

These pieces align with the brief and should be preserved as-is.

### 1.1 RLS pattern library
The existing `20260420102600_rls_enable_and_policies.sql` establishes the patterns the brief's tables will need:
- **Pattern A** (staff-only, no client SELECT) — needed for `practice_test_settings`, `practice_custom_tests`, `test_batteries`. Existing precedent: `clinical_notes`, `assessments`.
- **Pattern B** (staff + client SELECT of own) — needed for `test_sessions`, `test_results`, `client_publications`. Existing precedent: `programs`, `appointments`, `clients`.
- **Field lockdown via BEFORE UPDATE trigger** — `appointments_client_field_lockdown()` is the working precedent for "client may only modify these specific fields." Useful template if the brief ever needs a client-write path on test data.

### 1.2 Cross-org enforcement
`enforce_same_org_fk(table, fk_col, parent_org_col)` trigger function exists ([`20260420100400_shared_trigger_functions.sql`](../../supabase/migrations/20260420100400_shared_trigger_functions.sql) — by inference from existing usage). All new FKs spanning org-owned tables (e.g. `test_results.test_session_id`, `client_publications.test_session_id`) will plug into this trigger directly.

### 1.3 OCC + soft-delete conventions
`bump_version_and_touch()` and `touch_updated_at()` are in place. `deleted_at timestamptz` is the universal soft-delete pattern. The brief's tables follow this without modification.

### 1.4 Storage of rendered legacy reports
The `reports` table's `is_published`/`published_at` semantics, plus the client-portal RLS policy `is_published = true AND client_id IN (own clients)`, is a working precedent for the brief's `client_publications` model — but it lives on the wrong table (rendered HTML, not structured sessions). Keep it for the legacy flow; build a *separate* publication mechanism for `test_sessions` per the brief.

### 1.5 Reports tab is wired into the client profile
`ClientProfile.tsx`:118-133 has `'reports'` in the `Tab` enum and renders `<ReportsTab />` at line 238. URL routing via `useTab()` already handles deep-links to `?tab=reports`. The container is in place — the contents are placeholder.

### 1.6 Schema JSON is now committed at runtime location
`data/physical_markers_schema_v1.1.json` (moved from repo root in this audit pass) is in the right place per the brief §7.

---

## 2. Gaps to close

### P0 — Architectural (non-negotiable)

These either break a load-bearing rule from the brief or block all downstream work.

| # | Gap | Brief reference |
|---|-----|---|
| P0-1 | **Runtime config resolver does not exist.** No `resolve_metric_settings(org, test, metric)` function, no schema loader, no in-memory cache. Application code currently has zero path to schema metadata. The "single most important rule" of the brief is unimplemented. | §0, §7 |
| P0-2 | **None of the brief's tables exist.** Need migrations for `test_sessions`, `test_results`, `practice_test_settings`, `practice_custom_tests`, `test_batteries`, `client_publications`. Each requires `organization_id`, soft-delete, `enforce_same_org_fk` triggers, OCC where mutation-heavy, and registration in `audit_resolve_org_id` (per audit log convention — see [memory: audit register new tables]). | §2 |
| P0-3 | **No RLS policies for the new tables.** The brief's `never`-visibility rule is a database-level security control; if RLS misses it, a client API request can return Tampa Scale data. This is the highest-risk failure mode in the module. Test 4 is the load-bearing pgTAP gate. | §1.4, §6.1, §8 Test 4 |
| P0-4 | **No `is_baseline` computed function/view.** Brief explicitly forbids storing `is_baseline` as a writable column — must be derived. No function, no view, no acceptance test (Test 5) wired up. | §1.3, §2 notes |
| P0-5 | **No publish gate (`client_publications` mechanism).** Brief specifies a separate publication record per test session with framing text + RLS-enforced filtering. None of this exists. The portal currently has *no* concept of a structured publish event. | §1.4, §4.2, §6.1 |
| P0-6 | **No `supabase/tests/` directory.** Zero pgTAP tests exist. Acceptance Tests 1-7 are the gate; without pgTAP scaffolding they cannot pass. | §8 |

### P1 — Functional (features specified in the brief, missing)

| # | Gap | Brief reference |
|---|-----|---|
| P1-1 | **No test capture modal.** Three entry points (note template, Reports tab, future VALD import) all need to write into the same `test_sessions` + `test_results` tables. None of the entry points are wired. | §1.2, §4.1 |
| P1-2 | **No "Run test battery" hook in note templates.** Note template flow exists (`note-templates/` settings + `NotesTab.tsx`), but has no concept of attaching a test session. Need `clinical_notes.test_session_id` FK *or* a separate join table, plus UI to invoke the capture modal from inside a note. | §1.2 |
| P1-3 | **Staff Reports tab is placeholder.** `ReportsTab()` in `ClientProfile.tsx`:904 renders three empty panels and a disabled "Log assessment" button. Brief §5 specifies filter chips, test cards (per test), inline charts (`default_chart`), delta-from-baseline, comparison view. Build out fully. | §5 |
| P1-4 | **Settings → Tests section does not exist.** No per-metric override editor, no custom test builder, no disable-test toggle, no batteries builder. Brief §3 specifies all four. The settings page (`settings/page.tsx`) has Practice info / Notifications / Tags / Categories / Session types / Note templates — Tests is missing. | §3 |
| P1-5 | **Client portal Reports page renders the wrong thing.** `/portal/reports/page.tsx` queries the legacy `reports` table and lists HTML report titles. Brief §6 specifies per-metric chart cards filtered by `client_portal_visibility`, rendered with `client_view_chart` (not `default_chart`), with `framing_text` shown above the chart. The legacy view should be relabelled (e.g. "Files" or moved into the existing portal Files surface) — or kept as a sub-tab — and the new Reports page built. **This is a UX decision to surface before building.** | §6 |
| P1-6 | **Publish flow UI does not exist.** No "Ready to publish" panel, no per-session publish toggle, no framing-text input, no held-back queue, no surfacing in the dashboard's needs-attention panel. | §4.2 |
| P1-7 | **No comparison view.** Brief §5.3 specifies "Compare sessions" mode for side-by-side delta tables across reassessments. Doesn't exist. | §5.3 |
| P1-8 | **`validation_bounds.json` doesn't exist.** Brief §4.1 specifies extreme-outlier validation tuned via a separate JSON config. Need to define the bounds, ship the file, and wire validation into the capture modal. | §4.1 |
| P1-9 | **No `/docs/testing-module-schema.md`, no `/docs/schema-upgrades.md`, no `/docs/decisions.md` entry.** Brief §10 specifies these as deliverables. | §10 |

### P2 — Polish (design system, copy, motion)

These are deferred until the architecture and features land. Listing now so they don't get forgotten.

| # | Gap | Brief reference |
|---|-----|---|
| P2-1 | **Chart library decision pending.** Five chart types (`line`, `bar`, `radar`, `asymmetry_bar`, `target_zone` for staff; `line`, `milestone`, `bar`, `narrative_only`, `hidden` for client). No charting library in package.json (verify during implementation). Need to pick one that respects the design system (no shadows, restrained palette, single accent green for "good direction"). | §5.2, §6.2 |
| P2-2 | **Copy tone for client-portal reports.** "Your jump height has improved by 12% since you started" — not "Δ = +12.4%, vs. EPL 50th". Templating + voice guide application. | §6.4 |
| P2-3 | **Direction-of-good colouring rules.** Specific per direction: green=good for `higher`, green=low for `lower`, target band for `target_range`, neutral grey for `context_dependent`. Must use the design system's accent green only — not generalised "pop." | §5.2 |
| P2-4 | **Override visual treatment.** Brief §3.1 specifies a `Custom` badge / dot when an override is active, with hover-revealed default value. | §3.1 |
| P2-5 | **Capture modal three-state UX.** Brief §4.1 specifies pick → enter → confirm. Each state has its own design considerations (accordion vs. battery dropdown, bilateral input layout, summary screen). | §4.1 |
| P2-6 | **Empty-state copy across the module.** Existing placeholder uses "once the assessment module is wired up" — needs replacement with brief-aligned voice once data flows. | — |

---

## 3. Migration plan (dependency order)

Architecture before features, features before polish. Each step has a clear blast-radius assessment.

### Phase A — Foundations (P0, no UI dependencies)
1. **Schema docs first.** Write `/docs/testing-module-schema.md` — table definitions, FK graph, justification of every jsonb column, RLS pattern per table, the `never`-visibility security argument. Reviewable on its own. *Reversibility: cheap.*
2. **Migrations.** Six new migration files in `supabase/migrations/` — one per table, plus the `is_baseline` view/function, plus registration in `audit_resolve_org_id`. *Reversibility: cheap pre-launch (drop migrations, re-apply).*
3. **RLS policies.** New migration appending policies for each table. Critical: the `never`-visibility rule must be enforced here, not in app code. *Reversibility: cheap.*
4. **pgTAP test scaffolding.** Create `supabase/tests/` and write the pgTAP shell for Tests 1-7. The Tampa Scale `never` test (Test 4) is the load-bearing security gate — write it first, fail-by-default, then make it pass. *Reversibility: tests don't reverse.*
5. **Runtime config layer.** Build `src/lib/testing/schema-loader.ts` (loads `data/physical_markers_schema_v1.1.json` once at server start) and `src/lib/testing/resolver.ts` exposing `resolveMetricSettings(org, test, metric)`. Unit-test the override-OR-default merge. Forbid file reads from the schema JSON anywhere else (lint rule or grep gate). *Reversibility: moderate — once code depends on the resolver, can't easily unwind.*

**Gate:** Phase A ends when Tests 1-5 (the data-layer-only ones) pass. Stop and review.

### Phase B — Capture surface (P1)
6. **Capture modal core.** `src/app/(staff)/clients/[id]/_components/TestCaptureModal.tsx` (or a dedicated route — open question). Wire to `resolveMetricSettings()` for unit display + validation bounds. Three states (pick / enter / confirm). *Reversibility: cheap; new UI only.*
7. **Validation bounds JSON.** Define `data/validation_bounds.json` and load via the resolver pattern (don't hard-code bounds). *Reversibility: cheap.*
8. **Reports tab — capture entry.** Replace the placeholder `ReportsTab()` body with a "+ Record test" button that opens the modal. Even before charts exist, this gives a working capture flow. *Reversibility: cheap.*
9. **Note-template entry point.** Add `clinical_notes.test_session_id` FK migration + UI hook in note templates. *Reversibility: schema change is cheap; UI cheap.*
10. **VALD-import entry shape.** Don't build the importer; ensure `test_sessions.source` enum supports `'vald'` and a server action exists that mocks a "future VALD import" path for Test 2. *Reversibility: cheap.*

**Gate:** Phase B ends when Test 2 (three entry points → one record) passes.

### Phase C — Settings UI (P1)
11. **Settings → Tests page.** New route `src/app/(staff)/settings/tests/`. Four sections: per-metric overrides, custom tests, disable-tests, batteries. Each section is its own component file under `_components/`. *Reversibility: cheap.*
12. **Override editor.** Reads from resolver (so it shows current effective values), writes to `practice_test_settings`. Reset link clears override. *Reversibility: cheap.*
13. **Custom tests + disable-tests + batteries.** Three further editors. *Reversibility: cheap.*

**Gate:** Phase C ends when Tests 1, 6, 7 pass.

### Phase D — Reports rendering (P1+P2)
14. **Chart library decision.** Evaluate options against design-system constraints. Single PR, single decision logged in `/docs/decisions.md`. *Reversibility: painful once charts exist.*
15. **Staff Reports tab — full build.** Filter chips, test cards, inline charts, delta-from-baseline, "Record again" / "View all sessions". *Reversibility: cheap; isolated to the tab.*
16. **Comparison view.** "Compare sessions" mode. *Reversibility: cheap.*
17. **Publish flow.** "Ready to publish" panel after capture; per-session publish toggle; framing-text input; held-back surfacing. *Reversibility: cheap.*

**Gate:** Phase D ends when Test 3 (publish gate) passes.

### Phase E — Client portal (P1+P2)
18. **Client Reports page redesign.** Replace `/portal/reports/page.tsx` body. Decision needed first: does the legacy HTML-report list move elsewhere (Files? a sub-tab?) or does it stay alongside the new per-metric view? *Reversibility: moderate — UX decision.*
19. **Per-metric rendering.** `client_view_chart` types: `line`, `milestone`, `bar`, `narrative_only`, `hidden`. Framing text above chart for `on_publish` metrics. *Reversibility: cheap.*
20. **Tone pass.** Apply §6.4 voice. *Reversibility: cheap.*

**Gate:** Phase E ends when Test 4 (the Tampa Scale `never` hard wall) passes — re-run pgTAP after the new portal API is live, since the failure mode is "API returns data the UI didn't ask for."

### Phase F — Documentation + final acceptance
21. **`/docs/schema-upgrades.md`** — how schema-version bumps work without losing per-EP overrides.
22. **`/docs/decisions.md`** — log each P0/P1 decision with reversibility tag.
23. **Run all 7 acceptance tests end-to-end.** This is the gate; "looks fine" doesn't count.

---

## 4. Open questions to resolve before Phase A starts

1. **Schema discrepancy resolved.** Schema is at `data/physical_markers_schema_v1.1.json` per brief §7 — CLAUDE.md should be updated to match. *(Will surface in the code change PR; not blocking.)*
2. **Where does the legacy HTML-report list go in the client portal?** Today `/portal/reports/` lists rendered reports. New module needs that route. Three options: (a) move legacy to Files, (b) keep both as sub-tabs of /portal/reports/, (c) keep legacy on a different route. **Recommendation: (a)** — the legacy "rendered HTML attachment" is conceptually a file, not a structured report. Move to Files; reclaim `/portal/reports/` for the brief's view.
3. **Note-template attachment shape.** `clinical_notes.test_session_id` is one option. A separate `note_test_sessions` join table is another (allows N test sessions per note). **Recommendation: single FK** — simpler, matches the brief's "the note record links to the test session via `test_session_id`" wording (§1.2). Reversible if N:M turns out to be needed.
4. **Chart library.** Recharts vs. Visx vs. handwritten SVG. **Defer until Phase D.** Surface options + recommendation then.
5. **Test 2 third entry point — how literal does the test need to be?** Brief says "a direct API call simulating a future VALD import." Suggest a server action that takes the same shape a future VALD parser would emit, so the test exercises the data-write path without requiring the parser. **Confirm before Phase B.**
6. **Acceptance test runner.** pgTAP for the SQL-level tests is clear. For Tests 6 and 7 (UI workflow) — Playwright? Manual? **Confirm before Phase C.**

---

## 5. Out of scope for the polish pass

Per brief §9 — flagged here so they don't drift in:
- VALD CSV/XML importer (Phase 3+).
- AI-drafted framing text (Phase 2).
- Cross-client analytics.
- Mobile capture by client.
- PDF/HTML report rendering — the existing Cowork-skill flow continues unchanged.

---

## 6. Stop point

This document is the contract. **No code changes start until it's reviewed and signed off.** Open questions in §4 should be resolved (or explicitly deferred with a stake in the ground) before Phase A begins.

---

## 7. Progress log

Running record of what's closed, in order. Each entry references the commit on master.

### Phase A — Foundations (closed)

- **P0-1 runtime config resolver** — closed in [eb5694c](https://github.com/Scottyhb19/client-platform/commit/eb5694c). `src/lib/testing/{schema-loader,resolver,index}.ts`. `resolveMetricSettings(supabase, org, test, metric)` is the single allowed path; `'server-only'` import enforces it at build time.
- **P0-2 testing-module tables** — closed in [0004222](https://github.com/Scottyhb19/client-platform/commit/0004222). 7 tables, 7 enums, view + function, in migrations `20260428120000…121000`.
- **P0-3 RLS policies** — closed in [0004222](https://github.com/Scottyhb19/client-platform/commit/0004222), migration `20260428120800`. Tampa Scale never-wall verified by pgTAP `02_never_hard_wall.sql`.
- **P0-4 is_baseline view + function** — closed in [0004222](https://github.com/Scottyhb19/client-platform/commit/0004222), migration `20260428120400`. View uses `WITH (security_invoker = on)` so it respects underlying RLS.
- **P0-5 publish gate** — closed in [0004222](https://github.com/Scottyhb19/client-platform/commit/0004222). `client_publications` table + soft-delete-as-unpublish.
- **P0-6 pgTAP scaffolding** — closed in [0004222](https://github.com/Scottyhb19/client-platform/commit/0004222). `supabase/tests/database/{00_test_helpers,01_visibility_override,02_never_hard_wall,03_baseline_immutability}.sql`. All green on staging.

### Phase B.1 — Capture-flow foundation (in progress)

- **P1-8 validation_bounds.json** — closed pending push. `data/validation_bounds.json` + `src/lib/testing/validation-bounds.ts`. `validateMetricValue()` returns hard-bound errors and soft-bound warnings; the modal will call this before any RPC fires.
- **clinical_notes.test_session_id FK** — closed pending push. Migration `20260428130000`. Single nullable FK per Q2 sign-off; ON DELETE SET NULL preserves narrative if the session is removed.
- **create_test_session RPC + server action** — closed pending push. Migration `20260428130100` (atomic SECURITY INVOKER RPC) + `src/app/(staff)/clients/[id]/test-actions.ts` (`createTestSessionAction`, `softDeleteTestSessionAction`). RPC respects RLS — staff can write, clients cannot.

### Phase B.2 — Capture modal UI (next)

- P1-1 capture modal: pick → enter → confirm. Three-state component, opens from the Reports tab + from inside note templates + invocable from a future VALD-shape importer.
