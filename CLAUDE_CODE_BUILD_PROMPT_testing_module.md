# Build Brief — Testing & Reports Module

## ⚠ READ THIS FIRST — work mode

**A version of this module already exists in the repo.** It was built before this brief was written. This brief is the **target state** the existing module is being polished toward. It is **not** a greenfield build spec.

Before changing any code, follow this protocol:

1. **Read this brief in full** — Sections 0 through 10. Understand the target state.
2. **Audit the existing testing module in the repo.** Specifically check:
   - The database tables that exist for tests, results, sessions, settings, batteries, publications.
   - How the module reads test schema data (file? hardcoded? database?).
   - Whether a settings UI exists, and what it allows the EP to change.
   - Whether a publish gate exists, and how it routes results to the client portal.
   - Whether the staff Reports tab and the client Reports tab are different views or the same view.
   - Whether RLS policies enforce client-portal visibility, or whether the UI does the filtering.
3. **Produce a gap document** at `/docs/polish/testing-module.md` with three sections:
   - **What's already correct** — alignment between existing code and the brief.
   - **Gaps to close** — bullet-pointed, grouped by severity:
     - **P0 architectural**: anything that breaks the runtime-config rule (Section 0), the publish gate (Section 4.2), or the RLS-enforced visibility (Section 6.1). These are non-negotiable.
     - **P1 functional**: missing features specified in the brief — settings UI for overrides, custom tests, batteries, framing text on publication, etc.
     - **P2 polish**: design system alignment, copy tone, chart rendering, micro-interactions.
   - **Migration plan** — the order in which gaps should be closed, with dependencies. Architecture before features, features before polish.
4. **Stop and wait for review** of the gap document. Do not begin code changes.
5. After approval, **address gaps in dependency order**. Each closed gap gets a brief note in the polish doc.
6. **Run the acceptance tests** in Section 8 at the end of the pass. They are the gate, not "looks fine."

The system is **pre-launch with seed data only** — schema migrations are still cheap. Use that window. Anything load-bearing should be hardened before a real client logs in.

If the existing implementation already does something the brief specifies, **keep it**. The brief describes the destination, not the route. If a current decision is good but expressed differently from the brief, leave it alone or harmonise gently — do not rewrite for parity's sake.

If during the audit you find something the existing code does well that this brief is silent on, note it and ask. Useful behaviour that pre-dates the brief should not be lost in the polish pass.

---


**Owner:** Scotty (solo Exercise Physiologist)
**Module:** Physical markers, test capture, reports, settings UI
**Belongs to:** EP Platform (the unified Cliniko + TrainHeroic replacement)
**Phase:** This brief covers Phase 1 foundation work for the testing module + Phase 3 reporting work where the architecture decisions are inseparable. Do not build VALD CSV ingestion or the AI assistant in this scope — they are separate briefs.

---

## 0. The single most important rule

Schema defaults are read at **runtime** from `physical_markers_schema_v1.1.json`. Per-EP overrides live in the `practice_test_settings` table keyed on `(organization_id, test_id, metric_id)`. The rendering engine resolves every field as `override OR default`. **Application code must never query the schema JSON for a hard-coded value.** If a developer wants to know whether jump height is "higher is better," they ask the resolver, never the file.

The reason: the EP must be able to change every audit decision in settings without a code change or redeploy. The architecture either supports that or it doesn't. Test it explicitly — see Acceptance Test 4 below.

---

## 1. The clinical model

### 1.1 What gets stored
The unit of clinical record is a **test session**: one timestamp, one clinician, one client, optionally linked to an appointment. A test session contains one or more **test results**. Each result is one numeric value for one metric, on one side (`left`, `right`, or `null`), at one moment in time. Schema for the result record is already defined in `physical_markers_schema_v1.1.json` under `result_record`. Use that schema verbatim — do not invent your own.

### 1.2 Three entry points to the same data
All three write to the same `test_sessions` + `test_results` tables. The Reports tab is a *view*, not a storage location.

1. **Inside a clinical note template.** Initial Assessment and Reassessment templates contain a "Run test battery" section. The clinician picks tests (or applies a saved battery — see §3.4). Submitting the note creates the test session and writes the results. The note record links to the test session via `test_session_id`. Note narrative ≠ test data. They are separate records joined by foreign key.

2. **Stand-alone, from the Reports tab.** A `+ Record test` button on the client's Reports tab opens a modal that walks Category → Subcategory → Test → Metrics. Saves as a test session. Optionally links to an existing note.

3. **Bulk import from VALD (Phase 3 — out of scope here).** Build the test session + result records such that an importer can populate them with `source: "vald"` later. Don't build the importer; just don't paint the schema into a corner.

### 1.3 Baseline tracking
The first test session per `(client_id, test_id)` combination is automatically `is_baseline = true`. Every subsequent session for that test has `is_baseline = false`. Comparison mode `vs_baseline` resolves to "this session vs. the baseline session." The schema enforces this — there is no UI to flip the baseline flag manually in v1. (If a clinician wants to discard a bad first measurement, they soft-delete the session; the next chronological session inherits the baseline flag. Document this in code.)

### 1.4 Publish gate
Default behaviour for any metric with `client_portal_visibility = on_publish`: result is invisible to client until clinician explicitly publishes. Publishing produces a `client_publication` record with: `test_session_id`, `published_at`, `published_by`, optional `framing_text` (clinician's one-sentence interpretation, max 280 chars).

For `auto` visibility metrics, results appear immediately client-side without a publication record.
For `never` visibility metrics, results are never queryable from the client API. RLS policy enforces this at the database level — not just in the UI layer.

---

## 2. Database schema

Use the existing convention from `claude_code_backend_scale_prompt.md`. Migration files in `/supabase/migrations/`. pgTAP tests in `/supabase/tests/`. RLS policies on every table. Document every table in `/docs/schema.md`.

Tables this module adds:

```
test_sessions
  id, organization_id, client_id, conducted_by (user_id), conducted_at,
  appointment_id (nullable), source (manual | vald | imported),
  notes (free text), created_at, updated_at, deleted_at

test_results
  id, organization_id, test_session_id, test_id, metric_id, side,
  value (numeric), unit, is_baseline (computed), created_at

practice_test_settings
  id, organization_id, test_id, metric_id,
  direction_of_good (nullable — NULL = use schema default),
  default_chart (nullable),
  comparison_mode (nullable),
  client_portal_visibility (nullable),
  client_view_chart (nullable),
  enabled (boolean — false = hide from this practice's UI entirely),
  created_at, updated_at

practice_custom_tests
  id, organization_id, category_id, subcategory_id, test_id, name,
  metrics (jsonb — same shape as schema metrics), created_at, updated_at, deleted_at

test_batteries
  id, organization_id, name, description, is_active,
  test_metric_keys (jsonb array of {test_id, metric_id, side?}),
  created_at, updated_at, deleted_at

client_publications
  id, organization_id, test_session_id, published_at, published_by,
  framing_text, created_at
```

Notes:
- `is_baseline` is **computed**, not stored — derive it from "first non-deleted session per (client_id, test_id)." Write a database function and a view. Do not allow application code to write `is_baseline` directly.
- `practice_custom_tests.metrics` is jsonb because the shape is variable per custom test. The standard schema's metrics are columns in the schema file, not in the database — only custom tests live in the DB.
- Justify every jsonb column in `/docs/schema.md` per the standing rule.

### RLS policies (mandatory)
- Staff can read/write everything within their organization.
- Clients can read **only** their own `test_sessions` and `test_results` where the corresponding metric has `client_portal_visibility != 'never'` AND (`visibility == 'auto'` OR a `client_publications` record exists for the session).
- Clients cannot read `practice_test_settings`, `practice_custom_tests`, `test_batteries`, or any aggregated organization data.
- Test the `never` path with a pgTAP test that confirms a Tampa Scale result is not returned to the client even when the test session is otherwise published.

---

## 3. Settings UI

Three sections under **Settings → Tests**.

### 3.1 Per-metric overrides
A list view grouped by category → subcategory → test → metric. Each metric row shows the current effective values (resolved from override-or-default), with dropdowns to change any of the five fields. A "Reset to default" link clears the override.

Visual treatment: an override should be visually distinct from a default. A small dot or badge that shows `Custom` when an override is active. Hovering the field shows the schema default value beneath the current value.

### 3.2 Custom tests
A "+ Add test" button opens a builder. The clinician picks a category and subcategory (or creates a new subcategory), names the test, and adds metrics one at a time. Each metric requires the same five rendering hint fields the standard schema has. Custom tests appear in test capture flows alongside the standard ones, marked `Custom` in the picker.

### 3.3 Disable tests
Each test in the standard schema can be disabled per-practice (`enabled = false`). Disabled tests do not appear in capture flows or templates for this organization. Past results for disabled tests remain queryable; only forward capture is hidden.

### 3.4 Saved test batteries
A "+ New battery" button opens a builder. The clinician names the battery (e.g., "ACL Phase 2 reassessment", "Osteoporosis baseline") and ticks the metrics that belong. Saved batteries appear in note templates and the stand-alone capture modal as one-click sets.

---

## 4. Test capture UX

### 4.1 The capture modal
Opens from any of the three entry points (§1.2). Three states:

**State 1 — Pick what to capture.** Show category accordions, with subcategories underneath, with tests inside. A test is a tappable row that expands to show its metrics. Or: pick a saved battery from a dropdown at the top, which selects a pre-defined set. Search bar at top filters across all tests by name.

**State 2 — Enter values.** Each selected metric is a row. Bilateral metrics show two inputs side by side (Left / Right). Unit label is displayed but not editable (it comes from the schema). Validation: numeric, within the schema's `input_type` (decimal vs integer), within reasonable bounds (negative values flagged, extreme outliers flagged with a confirm dialog — define the bounds per metric in a separate `validation_bounds.json` so they can be tuned without code changes).

**State 3 — Confirm & save.** A summary screen showing what's about to be written, with a "Save and publish later" button (writes the session, no `client_publications` record yet) and a "Save and review for publishing" button (writes the session and immediately drops the clinician into the publish flow — see §4.2).

### 4.2 The publish flow
For metrics with `client_portal_visibility = on_publish`, the clinician sees a "Ready to publish" panel after saving. For each test session that has unpublished `on_publish` results, the panel shows:
- The numeric result(s)
- The chart (rendered as the client would see it — `client_view_chart` type, not the clinician chart)
- An optional framing text input ("How would you like to introduce this to the client?", max 280 chars)
- A "Publish" / "Hold back" toggle per session

Publishing writes the `client_publications` record. Holding back keeps the session in the unpublished queue, surfaced in the dashboard's needs-attention panel until acted on.

`auto`-visibility metrics skip this flow entirely; `never`-visibility metrics never reach this flow.

---

## 5. The Reports tab (client profile, staff view)

The Reports tab is a render of the test results table for one client. Layout:

### 5.1 Filter bar
Category filter chips. Date range picker. "Hide unpublished" toggle (default off — staff sees everything).

### 5.2 Test cards
One card per test, sorted by most recent session. Each card shows:
- Test name + subcategory
- Current value(s) — most recent session's result, with side breakdown if bilateral
- Delta from baseline (computed: current − baseline, with arrow and direction-of-good colouring)
- Chart inline — type determined by `default_chart`, populated with all sessions for that test
- "Record again" button → opens capture modal pre-filled with this test selected
- "View all sessions" link → expanded chronological table with notes per session
- For unpublished results: a "Publish" / "Held back" indicator + button

Direction-of-good colouring:
- `higher`: green when current > baseline, red when current < baseline
- `lower`: green when current < baseline, red when current > baseline
- `target_range`: green inside the band, amber in caution zone, red outside
- `context_dependent`: neutral grey — no good/bad colouring applied

### 5.3 Comparison view
A "Compare sessions" mode lets the clinician select 2+ sessions and view a side-by-side delta table across all metrics in those sessions. Useful for "Initial vs. 12-week" reassessment write-ups.

---

## 6. The Reports tab (client portal, client view)

This is the part that is most likely to be built wrong. **It is not a copy of the staff Reports tab.** It is filtered, simplified, and motivational. The same data, a different lens.

### 6.1 What the client sees
Only metrics where:
- `client_portal_visibility = 'auto'`, OR
- `client_portal_visibility = 'on_publish'` AND a `client_publications` record exists for that session

Plus: never any metric with `client_portal_visibility = 'never'`. This is enforced at the RLS layer, not the UI layer — the client API must not return the data even if the UI requests it.

### 6.2 How the client sees it
Each visible metric is rendered using its `client_view_chart` type, **not** the clinician's `default_chart`:
- `line` — full chart over time (rare; used for sprint times, jump heights)
- `milestone` — only baseline and most recent value, with delta. No middle data points. Strong default.
- `bar` — subscale comparison at one timepoint (KOOS/HOOS)
- `narrative_only` — clinician's `framing_text` is shown, no chart
- `hidden` — never rendered

When `framing_text` exists for a publication, it appears above the chart for that metric.

### 6.3 What the client never sees
- The list of tests they haven't done
- Settings, batteries, schema configuration
- Other clients' anything
- Unpublished sessions
- Metrics with `client_portal_visibility = 'never'` regardless of publication state

### 6.4 Tone
The Reports tab in the client portal is not a clinical instrument. It is a behaviour change instrument. Copy reflects this — "Your jump height has improved by 12% since you started" not "Δ = +12.4%, vs. EPL 50th = 87th percentile." The data is the same; the framing is for the audience.

---

## 7. What you read at runtime

`/data/physical_markers_schema_v1.1.json` is committed to the repo. It is **not** treated as a database; it is loaded at server startup into memory. The resolver function `resolve_metric_settings(organization_id, test_id, metric_id)` returns an object with the five rendering fields, computed as override-OR-default. The resolver is the **only** path application code uses to read these values. No file reads from the schema JSON elsewhere in the app. No copy-paste of values into other configs.

When the schema file is updated (new tests added, metric ranges expanded), it ships in a code release. Existing per-EP overrides survive — they're keyed on `(test_id, metric_id)`, not on schema version. Document the upgrade path in `/docs/schema-upgrades.md`.

---

## 8. Acceptance tests

Before this module is considered complete, all of the following must pass.

### Test 1 — Schema-driven rendering
Set Hip IR / ER (supine) `direction_of_good` to `higher` via the settings UI. Verify the staff Reports chart paints +5° as green. Reset via the "Reset to default" link. Verify it reverts to neutral grey (the schema default is `context_dependent`). Do this without a code deploy. **No code change permitted during the test.**

### Test 2 — Three entry points, one record
Capture a Hip flexion result via (a) an Initial Assessment note template, (b) the stand-alone Reports tab modal, and (c) a direct API call simulating a future VALD import. All three must produce identically-structured `test_results` rows distinguishable only by the `source` column on `test_sessions`.

### Test 3 — Publish gate
Capture a KOOS subscale result. Verify it does not appear in the client portal. Publish it with a framing text. Verify it now appears with the framing text above the chart. Soft-delete the publication. Verify it disappears from the client portal again.

### Test 4 — `never` visibility hard wall
Capture a Tampa Scale result. Forge a client API request asking for that test session by ID. The API must not return the Tampa metric in the response payload, even though the session is otherwise published. The pgTAP test for this RLS policy is the load-bearing security control.

### Test 5 — Baseline immutability
Capture three sessions for the same test on the same client across three months. Verify the first one carries `is_baseline = true` in the materialised view. Soft-delete it. Verify the second session now carries `is_baseline = true`. Restore the first session. Verify it re-claims baseline.

### Test 6 — Custom test parity
Add a custom test through the settings UI. Capture a result. Verify it appears in the Reports tab and in the publish flow with full feature parity to standard tests. Disable a standard test. Verify it disappears from capture flows but historical results remain queryable.

### Test 7 — Battery one-click
Define a battery containing 8 metrics across 3 tests. Apply it inside an Initial Assessment note. Verify all 8 metric inputs appear pre-selected in the capture modal.

---

## 9. What is explicitly out of scope here

- **VALD CSV ingestion / API integration.** Build the data layer such that it can accept VALD-sourced sessions later. Do not build the importer.
- **Reports rendered as PDF / HTML attachments.** The current Cowork-skill report flow continues to work in parallel; this module does not replace it. Phase 3+ work.
- **AI-drafted framing text.** The `framing_text` field is manual in this scope. AI assistance is a Phase 2 add.
- **Cross-client analytics.** No "average KOOS across all my clients" view. Single-client only in v1.
- **Mobile capture by client.** Clients do not log test results from the portal. Only clinicians capture.

---

## 10. Operating principles (carry-over from the backend brief)

- If you are unsure, ask before you build.
- Every irreversible decision flagged in `/docs/decisions.md` with a "Reversibility: cheap | moderate | painful" tag.
- This is production healthcare software. Privacy Act 1988 + Australian Privacy Principles compliance is non-negotiable.
- Simplicity is sophistication. Every screen earns its existence.

Begin with `/docs/testing-module-schema.md`. Migrations and pgTAP tests come after schema review. Application code comes after migrations are applied to staging.
