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

### Phase B.1 — Capture-flow foundation (closed)

- **P1-8 validation_bounds.json** — closed. `data/validation_bounds.json` + `src/lib/testing/validation-bounds.ts`. `validateMetricValue()` returns hard-bound errors and soft-bound warnings; the modal calls this before any RPC fires.
- **clinical_notes.test_session_id FK** — closed. Migration `20260428130000`. Single nullable FK per Q2 sign-off; ON DELETE SET NULL preserves narrative if the session is removed.
- **create_test_session RPC + server action** — closed. Migration `20260428130100` (atomic SECURITY INVOKER RPC) + `src/app/(staff)/clients/[id]/test-actions.ts` (`createTestSessionAction`, `softDeleteTestSessionAction`). RPC respects RLS — staff can write, clients cannot.

### Phase B.2 — Capture modal + Reports tab (closed)

- **P1-1 capture modal** — closed in [ba5687c](https://github.com/Scottyhb19/client-platform/commit/ba5687c). `TestCaptureModal` walks pick → enter → confirm; bilateral metrics show side-by-side L/R inputs; soft-bound warnings raise a confirm sheet before save.
- **P1-3 staff Reports tab** — closed in [ba5687c](https://github.com/Scottyhb19/client-platform/commit/ba5687c). New `ReportsTab.tsx` lists captured sessions with date / metric count / battery / notes preview. "+ Record test" opens the modal. Charts and per-test cards arrive in Phase D.
- **`applied_battery_id` per-client last-used hint** — closed in [9b941b3](https://github.com/Scottyhb19/client-platform/commit/9b941b3). Migration `20260428140000` adds the column + ON DELETE SET NULL FK to test_batteries; `create_test_session` RPC accepts the optional id; modal surfaces the hint above the dropdown when the client has prior captures.
- **RLS recursion fix** — closed in [ba5687c](https://github.com/Scottyhb19/client-platform/commit/ba5687c). Migration `20260428150000` replaces cross-table EXISTS sub-queries in the test_sessions/test_results/client_publications policies with SECURITY DEFINER helpers (`client_owns_test_session`, `test_session_in_org`, `test_session_has_active_publication`, `test_session_has_auto_visible_metric`). Same security model — the helpers do exactly the checks the inline EXISTS would have. Phase-A pgTAP tests still pass; Phase-A had a latent recursion bug that only fired under PostgREST's planner.

### Phase B.4 — Note-template capture hook (closed)

- **P1-2 Run-battery hook in note templates** — closed in [435aedb](https://github.com/Scottyhb19/client-platform/commit/435aedb). `clinical_notes.test_session_id` FK lands in B.1; the v1 UI is a "+ Capture test session" panel inside the create-note form (mode = 'create' only — edit preserves whatever link is already on the row). Captures via TestCaptureModal with an `onCaptured` callback that returns the new session_id; clicking Save submits both the note and the link in a single server-action call. The brief's richer "test_battery field type inside note templates" framing is deferred to Phase C polish — v1 delivers the data outcome (note ↔ session) without a template-editor change.
- **Server action surface**: `createClinicalNoteAction` and `updateClinicalNoteAction` now accept an optional `testSessionId`. `undefined` keeps the existing value on update; explicit `null` clears it.

### Phase B.5 — Three-entry-points pgTAP (closed)

- **Brief §8 Test 2** — closed in [435aedb](https://github.com/Scottyhb19/client-platform/commit/435aedb). `supabase/tests/database/04_three_entry_points.sql` asserts that note-template capture, Reports-modal capture, and a simulated VALD import all produce structurally-identical test_results rows distinguishable only by `test_sessions.source` (and the FK on the path-a clinical_note). Confirms the data layer is ready for the future VALD parser without a separate RPC.

### Phase B.6 — pgTAP test 03 stabilisation (closed)

- **Test 03 (baseline immutability)** — verified 8/8 green on 2026-04-30 after the test-04-pattern refactor sequence ([0714145](https://github.com/Scottyhb19/client-platform/commit/0714145), [2530356](https://github.com/Scottyhb19/client-platform/commit/2530356), [588b2c7](https://github.com/Scottyhb19/client-platform/commit/588b2c7), [b904470](https://github.com/Scottyhb19/client-platform/commit/b904470), [a23be95](https://github.com/Scottyhb19/client-platform/commit/a23be95)). Phase A pgTAP suite (01, 02, 03, 04) all passing on staging.

### Phase C — Settings UI (closed)

- **P1-4 §3.1 per-metric override editor** — closed in [7b1d4b5](https://github.com/Scottyhb19/client-platform/commit/7b1d4b5). New route `/settings/tests` with multi-open category accordions (last-opened state in localStorage, multi-open per Q1 sign-off so the EP can compare across categories). 5-column dense rows per metric (per Q5); native `<select>` per cell with the schema default in the placeholder option; green border + dot on overridden fields; row-level Reset DELETEs the practice_test_settings row entirely. Optimistic state updates with rollback on server-action error. Action layer handles UPSERT, single-field clear-to-NULL UPDATE, and the all-NULL hygiene case (DELETE rather than leaving a ghost row). Three new bulk loaders: `loadAllOverridesForOrg`, `loadAllDisabledTests`, `loadCustomTestsForOrg`.
- **P1-4 §3.2 custom test builder** — closed in [e83eed0](https://github.com/Scottyhb19/client-platform/commit/e83eed0). Auto-slugify test_id from name with Edit-ID escape hatch and collision suffixing (per Q2 sign-off). Auto-slugify metric_id from each metric's label, collision-checked within the test. CategoryPicker primitive — styled `<select>` populated from the schema with an "＋ Type a new id…" sentinel that morphs the control into a free-text input (replacing an initial `<input list>+<datalist>` that rendered the browser's native autofill popup). 1–30 metrics per test (DB CHECK), decimal/integer input types only (test_results.value is `numeric NOT NULL`), bilateral toggle, 5 rendering hints. Edit locks test_id and existing metric_ids — past test_results FK them by string. Archive routes through `soft_delete_practice_custom_test` RPC.
- **P1-4 §3.3 disable-tests toggle** — closed in [4d2a1ed](https://github.com/Scottyhb19/client-platform/commit/4d2a1ed). Hard-DELETE-on-enable / hard-INSERT-on-disable on `practice_disabled_tests` dodges the `deleted_at IS NULL` SELECT-policy trap entirely. Schema tests only — server-side guard rejects `custom_…` ids per Q4 sign-off (custom tests are archived via §3.2). Same accordion shape as §3.1 with a separate localStorage key. `loadCatalog` gains `{ includeCustom?, includeDisabled? }` options; defaults preserve existing capture-flow behaviour, `/settings/tests` opts into `{ includeDisabled: true }` so the override editor can still adjust hints on disabled tests.
- **P1-4 §3.4 saved batteries builder** — closed in [6998d9a](https://github.com/Scottyhb19/client-platform/commit/6998d9a). Cross-category by design (Q3 sign-off) — picker walks the merged catalog, search filters by metric label / test name / id and force-expands all categories while filtering. Selected-pills strip lets the EP remove a metric without re-finding it in the tree. v1 picks at the metric level with `side: null` (side-specific picks remain available in the data shape for a later iteration). Active flag is separate from soft-delete (suspend without losing). `loadAllBatteriesForOrg` returns active + inactive for the editor; `loadActiveBatteries` (existing) keeps the capture-modal filter. Archive routes through `soft_delete_test_battery` RPC.

### Phase C acceptance gates

- **pgTAP** — `supabase/tests/database/07_phase_c_settings_round_trip.sql` covers the data-layer halves of brief §8 Tests 6 and 7: custom-test INSERT round-trips through the metrics jsonb intact and `soft_delete_practice_custom_test` removes it from the active view; `practice_disabled_tests` INSERT works and pre-existing test_results for the disabled test_id stay queryable (the load-bearing assertion behind "past results remain queryable; only forward capture is hidden"); `test_batteries` INSERT with metric_keys spanning 8 metrics across 3 distinct test_ids round-trips intact and `soft_delete_test_battery` removes it. Test 1's data half is already covered by `01_visibility_override.sql`.
- **Manual UI checklist** — see §8 below for the items to walk through against `/settings/tests` on a real authenticated session before declaring Phase C done. Items marked `[Phase D]` are the visual halves of brief §8 Tests 1, 6 — they are gated on the Reports rendering work and not testable until Phase D lands.

### Phase D — Reports rendering (in progress)

- **D.1 — Decisions locked.** Q1–Q9 signed off ([docs/decisions.md](../decisions.md) D-001 to D-005). Headlines: Recharts as the chart library; folder-model IA (category tiles → drill in to per-test cards); per-test card with per-metric charts inside (KOOS-style same-shape metrics combined); baseline + %-change as a numeric badge above each chart with direction-of-good colouring; dedicated `?tab=publish` surface; full-page comparison overlay defaulting to all sessions checked. Recharts 2.15+ installed (React 19 compatible).
- **D.2 — Staff Reports tab full build (closed, pending manual UI walkthrough).**
  - **Data layer:** `resolveMetricSettingsBulk` added to the resolver — three-query bulk merge (seed + custom-tests + overrides) for the Reports tab's many-metrics-at-once need. New loader `loadTestHistoryForClient` returns `ClientTestHistory` (per-test history grouped by category → test → metric → time-series + per-test totals + per-category summaries). Loader-result types extracted to `src/lib/testing/loader-types.ts` so client components can import the type surface without dragging the `'server-only'` module graph into the client bundle.
  - **Direction-of-good helper:** `src/lib/testing/direction.ts` — pure functions `verdictFor`, `colourFor`, `formatPctChange`, `formatDelta`. Tokens reference the design-system CSS variables (`--color-accent` good, `--color-alert` bad, `--color-warning` caution, `--color-muted` neutral). `target_range` returns neutral until clinical bands are encoded in the schema (current schema does not carry them per metric; see Phase E follow-up).
  - **IA (per Q5/Q6):** `_components/reports/` — `CategoryGrid` (default view) → `CategoryDetail` (drilled in, subcategory chips + per-test cards) with breadcrumb back. `TimeWindowSelector` (Q8) lives globally at the top of the category-detail view; `TestCard` per test, `MetricBadge` per metric (baseline + %-change with direction-of-good colour, no horizontal baseline line per Q7). Combined-metric detection in `helpers.ts` (`groupMetricsByShape`) collapses KOOS-style same-shape metrics into one chart with multiple series.
  - **Charts (Recharts):** `_components/reports/charts/` — `LineChartCard`, `BarChartCard`, `AsymmetryBarChartCard`, `TargetZoneChartCard`, dispatched by `ChartFactory` on `default_chart`. Hover-to-emphasize on bilateral L/R fades the opposing side per Q1 follow-up. Tooltips show value + unit + side / metric label + formatted date. `radar` is reserved (no metric uses it) — degrades to line with a console warning if encountered. `target_zone` degrades to plain line until clinical bands land.
  - **Wiring:** `loadTestHistoryForClient` called in the parallel block in [page.tsx](../../src/app/\(staff\)/clients/[id]/page.tsx). `ClientProfile` forwards `testHistory` to `ReportsTab`. The capture modal's `onCaptured` triggers `router.refresh()` so a new session lands in the right card without a manual reload.
  - **Type-check:** clean. Dev server compiles staff route bundle with no `server-only` violations after the loader-types extraction.
  - **Manual UI walkthrough required:** Test 1 visual half (override metric → chart paints green for +5°), Test 6 visual halves (custom test parity in Reports + past results for disabled tests still render). Walkthrough deferred to authenticated dev session — see §8 [Phase D] items.
- **D.2.1 — Negative-value capture hotfix.** `getMetricBounds` now skips `defaults_by_unit` for custom-test metrics (test_id starting `custom_`) and the final fallback is permissive (`{}` instead of `{ min: 0 }`). Schema metrics that need non-negative bounds still reject — they carry their bounds explicitly via `by_metric` or `defaults_by_unit`. Authors who want explicit bounds on a custom metric can pin via `by_metric` (`custom_xxx::metric_id`); the per-metric bounds field in the custom-test builder UI is deferred to Phase E. Architectural follow-up `practice_custom_metrics` (metric-on-existing-test) tracked in [docs/deferred-prompts.md](../deferred-prompts.md), bundled after D.4.
- **D.3 — Comparison overlay (closed, pending manual UI walkthrough).**
  - Loader extension: `loadTestHistoryForClient` now also returns `SessionInfo[]` (sorted ascending) — session_id + conducted_at + battery_name + result_count — for the comparison-overlay session picker. Same single round-trip; `result_count` is computed from the joined rows so no extra query.
  - Helpers: `buildComparisonRows(history, selectedSessionIds)` pivots history into `ComparisonRow[]` (one per `(test, metric, side)`, bilateral metrics produce two rows). Empty rows (no value across all selected sessions) are filtered out so the table stays tight as the selection narrows. `rowBaselineLatest(row, sessions)` picks earliest/latest non-undefined values.
  - `ComparisonSessionPicker` — checkbox list with "Select all" / "Clear" buttons; defaults to all sessions checked per Q9 sign-off.
  - `ComparisonTable` — pivot of metrics × selected sessions. Rows grouped by test; bilateral metrics get separate L/R rows. Last column shows total %-change from baseline (earliest selected) to latest (latest selected) with direction-of-good colouring + arrow icon. Cells with no value render an em-dash. Custom-test rows carry the Custom badge.
  - `ComparisonOverlay` — full-viewport surface (z-index 200, body-scroll locked while open). Escape key dismisses, plus a Close button in the header. Header shows "Compare sessions · {client name} · N sessions captured".
  - Trigger: "Compare sessions" button added to `ReportsTab` header, visible only when ≥2 sessions exist. Opens overlay; client name threaded through `ClientProfile`.
  - Type-check clean; dev server compiles staff routes with no new warnings.
  - Manual UI walkthrough required: open the comparison overlay against a client with multiple sessions; confirm all sessions pre-selected; confirm metrics-with-no-value cells render em-dash; confirm direction-of-good colouring on the rightmost column matches per-metric MetricBadge; confirm Escape and the Close button both dismiss.
- **D.5 — Per-test publish redesign (closed, gated on migration apply + types regen).**
  - **Why this exists.** D.4 shipped a dedicated `?tab=publish` surface with per-session publication semantics — one publication per session, one framing covering all on_publish metrics in that session. Polish-pass review concluded the UX should be inline-with-data: each test card on the Reports tab carries its own Publish button, and each test gets its own publication row + framing. Q1/Q2/Q3 sign-off resolved the redesign details.
  - **Schema migration** `20260501120000_per_test_publications.sql`:
    - Pre-launch flush of `client_publications` (rows pre-date this redesign and can't be auto-expanded from per-session to per-test).
    - `ADD COLUMN test_id text NOT NULL` — discriminates which test inside a session this publication targets. No FK; test_id may point to schema seed or `practice_custom_tests`.
    - Replace unique-active partial index with `(test_session_id, test_id) WHERE deleted_at IS NULL`. A session may now host multiple live publications — one per test.
    - **LOAD-BEARING RLS update**: the `select test_results via session and visibility` policy gains `AND cp.test_id = test_results.test_id` inside the publication-existence check. Without this, a CMJ publication would still leak KOOS results in the same session. pgTAP 08 verifies the isolation explicitly.
  - **Test helpers** updated: `_test_insert_client_publication` signature is now `(uuid, uuid, uuid, text, text)` with `p_test_id` required. Old signature dropped to avoid arity overload (per project memory). `02_never_hard_wall.sql` updated to pass `'pts_koos'` as the published test.
  - **Server actions**: `publishSessionAction` renamed to `publishTestAction(clientId, sessionId, testId, framingText)`. Insert includes `test_id`. 23505 message rewritten ("This test is already published for this session"). `unpublishPublicationAction` unchanged — it operates on a publication by id, agnostic to schema shape. Pending types regen, the insert object goes through a contained `as any` cast — comment in the file points at the cleanup once `npm run supabase:types` runs.
  - **Loader + types**: `PublicationRow.test_id` field added. `loadPublicationsForClient` selects it.
  - **Helpers (replaces D.4 `buildPublishView`)**:
    - `testHasOnPublishMetrics(test)` — gate for showing the Publish UI on a test card at all.
    - `latestUnpublishedSessionForTest(test, history, publications)` — the session the Publish button targets (newest unpublished, per Q2). Returns null when all on_publish sessions for this test are published.
    - `latestLivePublicationForTest(test, publications)` — newest live publication for the badge.
    - `onPublishMetricsForTestInSession(test, sessionId)` — drives the dialog's chart preview.
    - `hasPendingPublishWorkflow(history, publications)` — kept for the future dashboard attention panel.
  - **IA changes**: `'publish'` removed from `Tab` union, `VALID_TABS`, `TABS`. `PublishTab.tsx` and `PublishCard.tsx` deleted. `ClientProfile` no longer computes `showPublishTab` / `pendingPublishCount`. `publications` now flow `page → ClientProfile → ReportsTab → CategoryDetail → TestCard`.
  - **Per-test publish UI**:
    - `TestPublishButton` — top-right of each TestCard. Hidden if the test has no on_publish metrics. "Publish" pill (warning tone) when there's a pending session; "Published" pill (accent tone, with count if >1) when all on_publish sessions are published. Click opens the dialog.
    - `TestPublishDialog` — modal with two sections: "Publish next session" (latest unpublished, with chart preview via `ClientChartFactory` + framing input + Publish button) and "Currently published" (one row per live publication for this test, latest first, each with framing read-only + Unpublish action). Editing framing on a live publication is intentionally not supported (per schema: no `updated_at`); EP unpublishes then re-publishes to change framing. Escape + click-outside dismiss; body scroll locked.
  - **pgTAP `08_publish_gate.sql` rewritten** (13 assertions across 3 scenarios):
    - Scenario A — single-test lifecycle: capture → no publication (0 visible) → publish + framing (1 visible, framing round-trip) → unpublish via RPC (0 visible).
    - Scenario B — per-test isolation (LOAD-BEARING): one session captures KOOS + Tampa. Publishing KOOS visible while Tampa stays hidden (publication doesn't leak across test_id). Then publish KOOS on a SECOND session — client sees BOTH KOOS sessions in the time series (Q2 progression).
    - Scenario C — re-publish after unpublish + audit-trail spot check: unique-active index allows fresh insert on same (session, test) pair after soft-delete; final row count proves both events preserved.
  - **Pre-merge checklist for the user** (this is gated on these three steps because the DB doesn't have `test_id` until the migration applies):
    1. `cd "C:\Users\scott\Desktop\Client Software Platform"` then `npx supabase db push` — applies the migration.
    2. Apply `00_test_helpers.sql` via the Supabase SQL Editor — drops the old helper overload and installs the new signature.
    3. `npm run supabase:types` — regenerates `src/types/database.ts` with the new `test_id` column. After this, the contained `as any` cast in `publish-actions.ts` can come out (left in for now so type-check passes pre-migration).
  - **Manual UI walkthrough** (after the three steps above):
    - Open a client with on_publish captures → Reports tab → drill into a category → see Publish pills on each test card.
    - Click "Publish" on a card with an unpublished on_publish session → modal shows the latest unpublished session's metrics + chart preview + framing input → type framing → Publish → modal closes, badge becomes "Published".
    - Re-open the same card's button → modal now shows "Currently published" section with framing read-only + Unpublish.
    - **Per-test isolation**: capture KOOS + CMJ (both on_publish) in one session, publish CMJ. KOOS card still shows "Publish". Confirm KOOS isn't leaked to client portal (eventual Phase E test).
- **D.4 — Publish flow (closed, pending manual UI walkthrough).**
  - Server actions: `publish-actions.ts` adds `publishSessionAction(clientId, sessionId, framingText)` (raw INSERT into client_publications, RLS enforces `published_by = auth.uid()` and the unique-active partial index ensures one live publication per session) and `unpublishPublicationAction(clientId, publicationId)` (routes through the `soft_delete_client_publication` RPC). Both call `revalidatePath` so the staff client page picks up the new state.
  - Loader: `loadPublicationsForClient(supabase, clientId)` returns the live `client_publications` rows for this client (joined to test_sessions for the client_id filter; live-only filter applied). New `PublicationRow` type in `loader-types.ts`, exported via the index.
  - Helpers: `buildPublishView(history, publications)` pivots into `PublishView { pending, published }` — sessions with `on_publish` metrics that lack a live publication go to `pending`, sessions with a live publication go to `published`. Sorting: pending by conducted_at desc (freshest at top), published by published_at desc. `hasPublishWorkflow(view)` is the visibility gate.
  - Client chart components in `_components/reports/client-charts/`:
    - `MilestoneChart` (custom HTML — not a Recharts wrapper). Renders "baseline → latest with delta + framing-aware colour". Bilateral metrics produce two side-by-side milestones (Left + Right). For first captures, just the value + date.
    - `NarrativeOnly` — clinician's framing text + value, no chart. Used for biomarkers, body composition, pain scales.
    - `ClientChartFactory` dispatches on `client_view_chart`: `milestone` → MilestoneChart; `narrative_only` → NarrativeOnly; `line` → reuse staff `LineChartCard` (Phase E will specialise); `bar` → reuse staff `BarChartCard`; `hidden` → null.
  - `PublishCard` (per-session): header with date + Held back / Published badge, one chart per `on_publish` metric in the session, framing-text textarea (280 char counter, error state past max), Publish or Unpublish button, error surface. Editing framing on a published session is intentionally not supported (per schema: no `updated_at` on the publication; UI prompts the EP to unpublish then re-publish to change framing).
  - `PublishTab`: two sections — "Needs review" and "Published" — with a yellow / green dot to differentiate at a glance. Empty states per section. Top-level empty state when nothing to publish.
  - Wiring: `'publish'` added to `Tab` union and `VALID_TABS` in both `page.tsx` and `ClientProfile.tsx`. `loadPublicationsForClient` joins the parallel `Promise.all` block. `ClientProfile` computes `showPublishTab` via `hasPublishWorkflow` and threads `pendingPublishCount` to the header — pending count surfaces as a small warning-coloured pill on the tab. The tab button is hidden for clients with only `auto`-visibility data.
  - Defensive: `buildPublishView` accepts `null | undefined` for both args (caught a real HMR-transient `TypeError` during the build).
  - pgTAP: `supabase/tests/database/08_publish_gate.sql` walks the full Test 3 lifecycle in 11 assertions — captured-but-no-publication (client sees 0 rows), publish with framing (client sees 1 row + framing round-trip), soft-delete via the RPC (client sees 0 again), re-publish with new framing (client sees 1 row with new framing), and an audit-trail spot-check (both publish events preserved on the table).
  - Type-check clean; dev server compiles staff routes with no `'server-only'` violations.
  - Manual UI walkthrough required: capture a KOOS or other on_publish metric, confirm the Publish tab appears with the warning-pill count, type framing text, click Publish, confirm card moves to "Published" section, click Unpublish, confirm card moves back to "Needs review", confirm framing field is empty after unpublish (since it lives on the publication row, not the session).
- **D.5.1 — Post-migration cleanups (closed).** `as any` cast in `publish-actions.ts` removed after `npm run supabase:types` regenerated `client_publications.test_id` into the typed insert. pgTAP 08 plan bumped from `plan(13)` to `plan(14)` to silence the "planned 13 ran 14" miscount warning — purely cosmetic, no behaviour change. Committed as [1622475](https://github.com/Scottyhb19/client-platform/commit/1622475).
- **D.6 — Visibility model simplification (closed; pgTAP 01/02/04/08 green on staging 2026-05-02).**
  - **Why this exists.** Pre-D.6 the schema's `auto | on_publish | never` enum drove three different behaviours per metric. The user's framing — "all card tiles should have the publish button, but per-metric overrides would be overkill" — pushed the model down to per-test publish only, with the `never` wall preserved for clinical safety. See [docs/decisions.md D-006](../decisions.md) for the full reasoning.
  - **Schema seed flip** (`data/physical_markers_schema_v1.1.json`): 47 `auto` metrics → `on_publish`; two `never` metrics (NordBord force_angle_curve, body composition height) → `on_publish` with `client_view_chart` raised from `hidden` to `narrative_only` so the EP's framing reaches the client. Tampa Scale `total_score` keeps `never` — the only hard-walled clinical-safety case. Final counts: 0 `auto`, 104 `on_publish`, 1 `never`. Seed migration `20260428121000` regenerated via `node scripts/generate-physical-markers-seed.mjs` so a fresh DB setup carries the new defaults.
  - **DB migration** `20260501130000_d6_visibility_simplify.sql`:
    - Three targeted UPDATEs to bring an existing seed table in line with the new JSON (no-op on a fresh DB).
    - `ALTER TABLE practice_test_settings DROP COLUMN client_portal_visibility` — pre-launch advantage applies, no override data to lose.
    - `DROP FUNCTION test_metric_visibility(uuid, text, text)` and `CREATE OR REPLACE` without the override-table read step. New resolution path: custom (for `custom_*` test_ids) → schema → never. STABLE/SECURITY DEFINER preserved.
    - The `auto` enum value stays in `client_portal_visibility_t` — Postgres `ALTER TYPE … DROP VALUE` is unsupported and recreating the enum is high-risk. No metric uses `auto` post-D.6 so the value is dead but harmless.
  - **App resolver**: `OverrideRow` interface drops `client_portal_visibility`. `loadAllOverridesBulk` and `loadOverride` SELECTs drop the column. `merge()` no longer reads `o.client_portal_visibility` — the resolved value comes straight from `base.client_portal_visibility`. `ResolvedMetricSettings.overrides` no longer carries a `client_portal_visibility: boolean` flag (would always be `false` after the column drop).
  - **Loaders + types**: `OverrideMapEntry` in `loader-types.ts` drops the visibility field. `loadAllOverridesForOrg` SELECT and result mapping drop the column. Custom-test loading paths still surface `client_portal_visibility` because the metrics jsonb retains it (the field is just hardcoded to `'on_publish'` server-side at write time).
  - **Settings → Tests override editor**: the per-metric override grid drops the Visibility column. Layout shifts from `repeat(5, 1fr)` to `repeat(4, 1fr)`. `OverrideField` union drops `'client_portal_visibility'`. `setOverrideFieldAction`, `buildUpsertPayload`, `buildSingleFieldUpdate`, and the all-NULL-row hygiene check all drop the visibility branch.
  - **Custom-test builder**: the Visibility `<Field>` block in `CustomTestForm.tsx` is removed. `MetricRow.clientPortalVisibility`, `DEFAULT_METRIC_HINTS.clientPortalVisibility`, and the `client_portal_visibility` key in the `metricInputs` build are gone. `CustomTestMetricInput` interface drops the field. `buildMetricsJson` server-side hardcodes `'on_publish'` for every custom metric. Editing an existing custom test that had `'never'` or `'auto'` on a metric will silently flip it to `'on_publish'` on the next save — pre-launch this is fine; documented in the migration comment.
  - **Helper rename**: `testHasOnPublishMetrics` → `testIsPublishable` in `helpers.ts`. Predicate body unchanged (still `test.metrics.some(isOnPublishMetric)`) but the name now describes the UI semantic ("does this test get a publish button?"). Callers updated in `TestPublishButton.tsx` and the internal call inside `hasPendingPublishWorkflow`.
  - **pgTAP `01_visibility_override.sql` rewritten in place** (filename preserved for continuity; content now asserts the new resolver semantics). Plan(5): schema-seed pre-condition, schema-resolver result, Tampa wall preserved, custom-test jsonb resolution, fail-closed for unknown tuples. The override-via-`practice_test_settings` assertions are gone — that path no longer exists.
  - **Type-check clean** post-edits. Migration applied to staging (`npx supabase db push`) + types regenerated (`npm run supabase:types`) + pgTAP 01 (5/5), 02 (Tampa wall), 04 (three entry points), 08 (14/14 publish lifecycle + per-test isolation) all green on 2026-05-02. Manual UI walkthrough still pending: confirm publish buttons appear on every non-Tampa test card, settings → tests no longer shows the Visibility column, custom-test builder no longer shows the Visibility field.
- **D.6.1 — Migration fix (closed).** Initial `npx supabase db push` of D.6 failed: `DROP FUNCTION IF EXISTS test_metric_visibility(...)` blocked by SQLSTATE 2BP01 because the test_results RLS policy depended on it. Whole migration rolled back (transactional). Fix: drop the DROP statement; `CREATE OR REPLACE FUNCTION` alone replaces the body in place because the signature `(uuid, text, text) → client_portal_visibility_t` is unchanged. Committed as [5be444f](https://github.com/Scottyhb19/client-platform/commit/5be444f). Lesson logged: prefer CREATE OR REPLACE over DROP+CREATE for body-only function changes; only DROP when the signature itself changes.

### Phase E — Client portal redesign (in progress)

**Audit date:** 2026-05-02. Phase D manual UI walkthroughs completed by user same day; checklists ticked in §8 above.

#### Sign-offs (locked before code changes)

| Q | Decision | Reason |
|---|---|---|
| Q1 | Legacy HTML reports → **sub-tabs at the top of `/portal/reports/`** ("Your data" + "Files"). | Smallest IA change; no BottomNav reshuffle; preserves both surfaces in one URL. Brief §9 says the Cowork-skill HTML flow continues in parallel — sub-tab respects that. |
| Q2 | Inside the per-metric view: **flat list of test cards, sorted by `most_recent_conducted_at` descending**. | Behavioural framing — "what's new about your data" first. Avoids clinical-density category folders; the staff side has those. |
| Q3 | Framing text: **once at the top of each test card, drawn from the most recent live publication for that test**. | Clean visual hierarchy: framing → charts. KOOS publication carries one framing covering 5 subscales — repeating it per chart would clutter. |

Plus three suggestions accepted without dispute:
- No time-window selector on the client side (analytics surface, not a behaviour-change surface).
- No comparison overlay (clinical analysis tool).
- Defer specialised client `line`/`bar` charts; v1 reuses staff Recharts components inside `ClientChartFactory`.

#### Plan

The implementation is one focused commit:

1. **Replace `/portal/reports/page.tsx`.** Server component reads `?tab=` (default `data`), resolves `clients.id` + `clients.organization_id`, parallel-loads either the new structured view OR the legacy HTML report list, dispatches.
2. **New components in `src/app/portal/reports/_components/`:**
   - `ReportsTabs.tsx` — sub-tab navigation. Server-rendered Link pattern; no client state.
   - `DataView.tsx` — receives `ClientTestHistory` + `PublicationRow[]`, renders the per-test cards.
   - `LegacyView.tsx` — lifts the existing HTML-reports list from the current page body unchanged.
   - `PortalTestCard.tsx` — per-test card. Header (test name + most-recent date). `PortalFramingBlock` if a live publication exists for this test. One chart per metric via `ClientChartFactory`, with `thisSessionValues` and `thisSessionDate` derived from each metric's latest published point.
   - `PortalFramingBlock.tsx` — clinician's framing text styled per design-system §02 voice.
3. **Tone-pass copy** — empty-state and any chart wrappers get §6.4 voice ("Your jump height has improved" not "Δ = +12.4%"). No data-layer changes here, just labels.
4. **Re-run pgTAP 02** (`02_never_hard_wall.sql`) post-commit. Brief §3 Phase E gate. Tampa wall must still pass — the new portal queries are fresh chances to leak.

#### Open follow-ups (deferred)

- Specialised client variants of `LineChartCard` / `BarChartCard` — defer until visual fit on a 480px column proves wrong.
- Tone-pass on chart tooltips and date formatters — bundled into the existing component-copy pass.

---

## 8. Phase C manual UI acceptance checklist

Per Q6 sign-off (acceptance test runner: pgTAP for the data assertions, manual checklist for the UI workflows). Walk through each item against `/settings/tests` on a real authenticated session. Items marked `[Phase D]` are the visual halves that depend on the reports rendering work and are not testable until Phase D lands — they're listed here so they're not forgotten.

### Test 1 — Schema-driven rendering

- [ ] Settings → Tests → Per-metric overrides. Expand Range of motion → Hip → Hip IR / ER (supine and prone). Override `er_supine` direction-of-good from "context" to "higher = good". Cell border turns green; small dot appears.
- [ ] Reload the page. Override persists. Category header reads "1 override".
- [x] Click the Reset icon at the row's right end. All four fields (direction, chart, compare, client view) revert to their "Default (...)" placeholder. Category header reads "no overrides". Visibility is no longer overrideable post-D.6.
- [x] **[Phase D]** Capture a `+5°` result against the metric and view in the staff Reports tab. Chart paints positive deltas green when the override is set, neutral grey on reset. **No code change permitted during the test.**

### Test 6 — Custom test parity

- [x] Settings → Tests → Custom tests → + Add custom test. Name "Test 6 isokinetic", category "custom_isok", subcategory "custom_knee". Add 2 metrics with full rendering hints (e.g., Peak torque · Nm · decimal · bilateral; H/Q ratio · ratio · decimal · unilateral). Save.
- [x] On a client → Reports tab → + Record test. The custom test appears in the catalog tree under custom_isok / custom_knee with a Custom badge.
- [x] Capture a result and save. Session appears in the Reports list.
- [x] **[Phase D]** Custom-test results render in the Reports tab with full feature parity to schema tests (delta, chart, etc.). They surface in the publish-flow panel like any other on_publish metric.
- [x] Settings → Tests → Disable schema tests. Disable `rom_hip_flexion`. Toggle reads "Disabled" with red dot; category header updates.
- [x] On a client → + Record test. `rom_hip_flexion` does NOT appear in the catalog tree.
- [x] **[Phase D]** Past test_results captured against `rom_hip_flexion` before the disable still render in the Reports tab.
- [x] Re-enable. The test reappears in the capture flow.

### Test 7 — Battery one-click

- [x] Settings → Tests → Saved batteries → + New battery. Name "Test 7 cross-category". Pick 8 metrics across at least 3 different test_ids (suggested: 2 from rom_hip_flexion + 4 from rom_hip_ir_er + 2 from pts_koos). Save.
- [x] On a client → + Record test. Battery dropdown shows "Test 7 cross-category".
- [x] Pick the battery. The capture modal pre-ticks all 8 metric inputs across their respective category accordions.
- [x] Capture a result and save. Session has `applied_battery_id` set; the per-client "last used" hint surfaces above the dropdown on the next capture for the same client.

### D.6 — Visibility model walkthrough (closed 2026-05-02)

- [x] Reports tab on a client: every non-Tampa test card shows a Publish button. Tampa Scale shows none.
- [x] Settings → Tests → Overrides: 4-column grid (direction, chart, compare, client view). No Visibility column.
- [x] Settings → Tests → + Add custom test: no Visibility field in the per-metric editor.
