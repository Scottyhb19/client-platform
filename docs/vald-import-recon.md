# VALD Import — Recon & Alignment (lay of the land)

**Status:** Recon only. No code changed. Produced for reviewer walkthrough.
**Date:** 2026-06-27
**Author:** Claude Code (lead engineer), at the operator's request.
**Purpose:** Lay out the *current* state of Odyssey's testing module — every metric it stores, how a result is shaped, and the two existing VALD code-paths — so that a decision can be made about importing VALD data such that "the metrics fit." This document is the input to a reviewer conversation, **not** a build spec.

> **Scope note (read first).** Importing VALD data into the *structured* testing module is, per the testing-module brief §9 and "What NOT to build," explicitly **Phase 3 / out of scope** for the original module. So this is a **brief-scope expansion**, not a polish task. Under the CLAUDE.md dogfooding loop, building it would re-enter the **full seven-step polish protocol + section sign-off ritual** (new ingest surface + likely schema expansion + a privacy surface). This doc exists so that decision is made deliberately, with the facts on the table.

---

## 0. The one decision that gates everything

Everything below feeds a single fork the reviewer needs to settle first:

> **Do we want full-fidelity VALD metric parity, or a curated subset?**

- VALD exports **dozens of metrics per test** (a ForceDecks CMJ export alone is ~100+ columns per trial).
- Odyssey's schema currently stores a **deliberately curated handful** per test (CMJ = 6 metrics).
- "Have the exact same metrics as VALD so exports fit" can mean either:
  - **(a) Parity** — expand Odyssey's schema so every VALD metric has a home. Big schema, exact fit, no data lost.
  - **(b) Curated** — keep the small clinical set, map only those VALD columns, ignore the rest. Small schema, lossy, simplest.
  - **(c) Hybrid** — curate the clinically meaningful set as schema tests now; let the EP capture anything else as **custom tests** later.

This choice determines schema size, the mapping layer, the UI, and the import effort. Section 7 lays out the trade-offs. **Recommendation: (c) hybrid**, reasoning in §7.Q2.

---

## 1. The big finding: there are already TWO VALD worlds in the codebase

This is the most important orientation point, and it's easy to miss.

### World A — Legacy "rendered report" path (built, staging exists, parser never written)
Migration [`20260420102200_reports_and_vald.sql`](../supabase/migrations/20260420102200_reports_and_vald.sql) created, back on 2026-04-20:
- **`vald_device_types`** — a tenant lookup table, **already seeded on signup with `forcedecks, nordbord, forceframe, dynamo`** (the four VALD devices).
- **`vald_raw_uploads`** — a staging table for raw VALD CSV/XML files: `source_filename`, `storage_path`, `payload jsonb` (parsed shape), `parsed_at`, `parse_error`, `device_type_id`, `associated_report_id`.
- **`reports` / `report_versions`** — metadata for rendered **HTML reports** stored in Supabase Storage (the Cowork-skill report flow).

Flow as designed: `raw VALD file → vald_raw_uploads → (parser) → reports (HTML in Storage) → client portal "Files"`. **The parser was never built** (`payload` is "NULL until parser runs"). This world produces *rendered documents*, not chartable per-metric data.

### World B — Structured testing module (built, charts + publish gate, but no VALD writer)
The module this recon is really about: `test_sessions` + `test_results` → resolver → the **Reports tab charts** + the **publish gate**. Crucially:
- `test_sessions.source` is an enum **`'manual' | 'vald' | 'imported'`** — **`'vald'` is reserved but nothing writes it.**
- The original schema's `result_record` legend even uses VALD-native language — `athlete_id`, `session_id`, `recorded_at` — so this was designed *with VALD in mind* from day one.

### The likely bridge
The natural architecture for what you want is to **join the two worlds**:

```
VALD export (CSV or API)
      │
      ▼
vald_raw_uploads  ← (World A staging table already exists — reuse it)
      │  parser + mapping layer  (NEW)
      ▼
test_sessions(source='vald') + test_results  ← (World B — feeds the charts + publish gate)
      │
      ▼
Client → Reports tab  (progression charts, comparison, publish to portal)
```

That gives VALD data the per-metric progression charts and the publish gate — which is almost certainly the point (otherwise it stays a flat PDF in World A). **§7.Q1** asks the reviewer to confirm this.

---

## 2. How a result is identified (the matching contract)

For a VALD value to "fit," the importer must resolve it to this 4-part key, which is how every `test_results` row is shaped ([20260428120300_test_results.sql](../supabase/migrations/20260428120300_test_results.sql)):

| Field | Meaning | Constraint |
|---|---|---|
| `test_id` | which test | `^[a-z0-9_]{1,80}$` — must match a schema-seed test **or** a `custom_*` test |
| `metric_id` | which metric within the test | `^[a-z0-9_]{1,80}$` |
| `side` | `left` / `right` / `null` | `null` for non-bilateral |
| `value` + `unit` | the number + its unit | `unit` is **stored on the row** (denormalised on purpose — so a later schema unit change can't silently reinterpret history) |

So **"making the metrics match VALD" = producing a mapping** from each VALD export field → `(test_id, metric_id, side, unit)`. Where Odyssey has no matching `(test_id, metric_id)`, the value has nowhere to land (it's dropped, or it forces a schema addition, or it becomes a custom test).

**Key architectural rule that helps you:** application code never hard-codes a metric's hints — it asks `resolveMetricSettings(org, test, metric)`. So *adding* metrics to the schema JSON + re-seeding is the only change needed to give new VALD metrics a home; no rendering code changes. (See §8 for the re-seed discipline, which is also a documented foot-gun.)

---

## 3. What Odyssey stores today — summary

- **schema_version:** `1.1.0`
- **10 categories · 26 subcategories · 48 tests · 105 metrics**
- **42 of 105 metrics are bilateral (L/R).**
- **Client visibility:** 104 `on_publish`, 1 `never` (Tampa Scale kinesiophobia — the single hard-walled metric).
- **Default charts:** 45 `line`, 39 `asymmetry_bar`, 11 `bar`, 10 `target_zone`.
- **Units in use:** deg(20), N(13), 0–100(11), cm(9), %(5), s(5), mmol/L(4), mm(4), kg(4), ratio(4), mL/kg/min(4), N/s(2), m/s(2), bpm(2), mmHg(2), m(2), level(2), plus singletons (W, N·s, g, g/cm², SD, nmol/L, reps, file, 17–68).

The full 105-row table is **Appendix A**. The VALD-native subset is in §4.

---

## 4. The VALD-native subset (this is where alignment happens)

Two categories map directly onto VALD devices. **These are the tables the import must align.**

### 4.1 `force_plate` → VALD **ForceDecks** (dual force plates)

| test_id | test_name | metric_id | label | unit | side |
|---|---|---|---|---|---|
| `fp_cmj_bilateral` | Countermovement jump | `jump_height` | Jump height | cm | — |
| | | `conc_peak_force` | Concentric peak force | N | — |
| | | `ecc_peak_force` | Eccentric peak force | N | — |
| | | `ecc_dec_rfd` | Eccentric deceleration RFD | N/s | — |
| | | `peak_power` | Peak power | W | — |
| | | `ft_ct` | FT:CT ratio | ratio | — |
| `fp_sj` | Squat jump | `jump_height` | Jump height | cm | — |
| `fp_dj_bilateral` | Drop jump — bilateral | `rsi` | RSI | m/s | — |
| `fp_slcmj` | Single-leg CMJ | `jump_height` | Jump height | cm | **L/R** |
| | | `lsi` | LSI | % | — |
| `fp_sl_dj` | Single-leg drop jump | `rsi` | RSI | m/s | **L/R** |
| | | `contact_time` | Contact time | ms | **L/R** |
| `fp_broad_jump` | Broad jump | `distance` | Distance | cm | — |
| `fp_imtp` | IMTP (isometric mid-thigh pull) | `peak_force` | Peak force | N | — |
| | | `rfd_0_100` | RFD 0–100ms | N/s | — |
| | | `impulse` | Impulse | N·s | — |
| `fp_cop_bilateral` | Bilateral COP sway | `eyes_open` / `eyes_closed` | Eyes open/closed | mm | — |
| `fp_cop_unilateral` | Unilateral COP sway | `sway` | Sway | mm | **L/R** |

### 4.2 `dynamometry` → VALD **NordBord**, **ForceFrame**, **DynaMo**

| test_id | test_name | metric_id | label | unit | side | VALD device |
|---|---|---|---|---|---|---|
| `dyn_nordic` | Nordic hamstring curl | `peak_force` | Peak force | N | **L/R** | NordBord |
| | | `lsi` | LSI | % | — | NordBord |
| | | `force_angle_curve` | Force-angle curve | **file** | — | NordBord |
| `dyn_ff_hip_abd` | Hip abductor peak force | `peak_force` | Peak force | N | **L/R** | ForceFrame |
| `dyn_ff_hip_add` | Hip adductor peak force | `peak_force` | Peak force | N | **L/R** | ForceFrame |
| `dyn_ff_add_abd_ratio` | Adductor:abductor ratio | `ratio` | Ratio | ratio | **L/R** | ForceFrame |
| `dyn_ff_shoulder_er_ir` | Shoulder ER/IR ratio | `er_force` / `ir_force` | ER/IR peak force | N | **L/R** | ForceFrame |
| | | `ratio` | ER:IR ratio | ratio | **L/R** | ForceFrame |
| `dyn_ff_knee_ext` | Knee extension isometric | `peak_force` | Peak force | N | **L/R** | ForceFrame |
| `dyn_ff_knee_flex` | Knee flexion isometric | `peak_force` | Peak force | N | **L/R** | ForceFrame |
| `dyn_hhd_knee_ext` | Knee extension HHD | `peak_force` | Peak force | N | **L/R** | DynaMo |
| `dyn_hhd_knee_flex` | Knee flexion HHD | `peak_force` | Peak force | N | **L/R** | DynaMo |
| `dyn_hhd_shoulder_abd` | Shoulder abduction HHD | `peak_force` | Peak force | N | **L/R** | DynaMo |
| `dyn_hhd_grip` | Wrist grip strength | `peak_force` | Peak force | kg | **L/R** | DynaMo |

> **Note on `force_angle_curve` (unit = `file`).** Odyssey already anticipates that NordBord exports a *curve*, not a scalar — it's typed as a file reference rendered `narrative_only`. `test_results.value` is `numeric NOT NULL`, so a curve cannot live in `test_results` as-is. This is an open modelling question (§7.Q7).

### 4.3 What VALD does NOT cover
The other 8 categories — ROM (manual goniometry), body composition (DEXA/anthropometry), cardiorespiratory, biomarkers, neuromuscular, functional movement, sport timing, and patient-reported outcomes (KOOS/HOOS/ACL-RSI/Tampa/VAS) — are **manual or third-party**, not VALD. They stay manual-entry. The import only ever touches §4.1–§4.2.

---

## 5. The VALD side (what the export actually contains)

> ⚠️ **Confirm against a real export.** Exact field names and units differ by VALD product, export type (Hub CSV vs API), and account configuration. The families below are reliable; the precise column strings must be lifted from one of your actual exports before any mapping is written. This is the reviewer's homework item.

| Device | Measures | Typical exported metric families | Granularity vs Odyssey |
|---|---|---|---|
| **ForceDecks** | Dual force-plate jump/isometric tests | CMJ: Jump Height (Flight Time **and** Imp-Mom), Peak/Mean Power (& /BM), mRSI, Concentric/Eccentric Peak & Mean Force, Concentric Impulse, Eccentric Braking RFD, Countermovement Depth, Force@Zero-Velocity, plus **L/R asymmetry %** on impulse/force; IMTP: Peak Force, RFD windows (0–50/0–100/0–200ms), Net Impulse | VALD ≫ Odyssey (~100+ cols vs 6). **Biggest curate-vs-parity decision.** |
| **NordBord** | Eccentric hamstring (Nordic) | Max/Avg Force **L** and **R** [N], Max Imbalance [%], Torque [Nm], force-time/force-angle curve | Close. Odyssey models peak (L/R), LSI, curve. |
| **ForceFrame** | Isometric strength frame (hip/knee/shoulder/groin) | Per-position L/R Peak/Mean Force [N], computed ratios (ADD:ABD, ER:IR), asymmetry % | Close. Odyssey models the main positions. |
| **DynaMo** | Handheld/fixed dynamometer | Joint-specific Peak Force / Torque, and **ROM** | Partial. Odyssey models a few force metrics; not DynaMo ROM. |

**Cross-cutting VALD realities the importer must handle:**
1. **Multiple trials per test** — VALD records several reps; the export has one row per trial (+ often a "best"/"mean"). Odyssey stores **one value per (session, metric, side)** → must pick best/mean/specific trial (§7.Q6).
2. **Per-limb + computed asymmetry** — VALD gives Left, Right, *and* an asymmetry %. Odyssey models L/R as two rows and (sometimes) a separate `lsi` metric, with its own definition `(involved/uninvolved)×100`. Definitions must be reconciled (§7.Q7).
3. **Units carry suffixes** — "Concentric Peak Force [N]". Mostly aligned to Odyssey (N, W, cm, %, m/s, ms), but **jump height (cm vs m), RSI (m/s vs unitless ratio), and RFD windows** need explicit checks (§7.Q8).
4. **VALD identity** — VALD has its own athlete IDs, test IDs, and timestamps. Athlete → Odyssey `client` matching is a privacy-sensitive join (§7.Q5); the VALD test ID is the natural **dedup key** (§7.Q9).
5. **Two ingest routes** — Hub **CSV/Excel** export (manual, matches `vald_raw_uploads.source_filename`) vs the **VALD API** (OAuth, live sync, but a new external-data/privacy surface). §7.Q3.

---

## 6. Alignment verdict (device by device)

- **NordBord → `dyn_nordic`:** ✅ Strong fit. Peak force L/R + LSI + curve already modelled. Main work: trial selection + the curve (`file`) question.
- **ForceFrame → `dyn_ff_*`:** ✅ Good fit for the modelled positions (hip ABD/ADD, knee ext/flex, shoulder ER/IR). Gap: any ForceFrame position you use that isn't in the 6 modelled tests needs a schema add.
- **DynaMo → `dyn_hhd_*`:** 🟨 Partial. Force metrics map; **DynaMo ROM is unmodelled** (Odyssey ROM lives in the manual `rom_*` category with different test_ids). Decide whether DynaMo ROM feeds `rom_*` or new `dyn_hhd_*_rom` metrics.
- **ForceDecks → `fp_*`:** 🟥 The hard one. Odyssey models a clean clinical 6 for CMJ; VALD emits ~100+. This is where the parity-vs-curate decision (§0) bites hardest. The tests exist (`fp_cmj_bilateral`, `fp_sj`, `fp_dj`, `fp_slcmj`, `fp_sl_dj`, `fp_imtp`, COP); the question is **how many metrics per test** you want to keep.

**Net:** the *structure* is already VALD-shaped and three of four devices align well. The real work is (1) a **field-name mapping layer**, (2) the **ForceDecks granularity decision**, and (3) **trial/asymmetry/identity** reconciliation — not a rebuild.

---

## 7. Open questions for the reviewer

These are the "things to go through." Each is a decision, with a recommendation where I have one.

| # | Question | Options | Recommendation |
|---|---|---|---|
| **Q1** | **Import target** | (a) Structured `test_results` (World B — charts + publish gate). (b) Legacy `reports` HTML (World A). | **(a)** — that's where progression charts, comparison, and the publish gate live. World A stays for narrative PDFs if wanted. |
| **Q2** | **Metric fidelity** | (a) Parity (expand schema to ~VALD set). (b) Curated subset. (c) Hybrid: curate clinical set as schema; custom-tests for extras. | **(c)** — keeps the clinical UI clean, loses nothing permanently, defers the long tail. But see the cost: custom tests use a `custom_` id prefix, so VALD extras would look inconsistent with native `fp_*` tests (Q11). |
| **Q3** | **Ingest mechanism** | (a) CSV/Excel upload → `vald_raw_uploads`. (b) VALD API live sync (OAuth). | **(a) first** — reuses the existing staging table, no new credential/privacy surface, matches the brief's "CSV/XML." API is a strong Phase-later upgrade. |
| **Q4** | **Where the mapping lives** | A new config (e.g. `data/vald_field_map.json`) per device: VALD column → `(test_id, metric_id, side, unit, trial_rule)`. | Yes — and give it the **same runtime-config posture** as the schema JSON (read via a resolver, never hard-coded), so the EP/you can tune mappings without a code change. |
| **Q5** | **Athlete → client identity** | Match on VALD athlete external-id / name+DOB / manual confirm-on-import. | Manual confirm-on-import for f&f scale; store the VALD athlete id on the client for later auto-match. Privacy-sensitive — do not auto-create clients from VALD names. |
| **Q6** | **Trial selection** | Best / mean / specific-trial / store every trial as its own session. | "Best" per VALD's own best-trial flag for v1; record which rule was used. Storing every trial bloats the chart. |
| **Q7** | **Side & asymmetry / the curve** | Store L/R rows and derive LSI vs store VALD's asymmetry directly. And: where does the NordBord force-angle **curve** (`file`) go? | Store L/R rows, derive LSI in-app (consistent with current model). Curve → keep `narrative_only`/file-reference (it can't be a `numeric` value); confirm you actually want it imported. |
| **Q8** | **Units & precision** | Lock unit per metric; on mismatch reject or convert. | Reject-and-flag on unit mismatch (the denormalised `test_results.unit` makes this safe). Pre-verify the 3 risky ones: jump height cm/m, RSI m/s vs ratio, RFD window definitions. |
| **Q9** | **Idempotency / dedup** | `test_results` is **append-only** (no UPDATE). Re-importing the same file double-inserts. | Dedup on VALD test id (store it on `test_sessions`); skip or soft-delete-and-replace on re-import. This is a **must-have**, not a nicety. |
| **Q10** | **Schema growth discipline** | If the schema expands for VALD, the JSON → seed-table → generated-types chain must stay in lock-step. | Treat any schema add as a migration event (regenerate seed via `generate-physical-markers-seed.mjs`, `db push`, `supabase gen types`, verify). This is also a known foot-gun — see §8. |
| **Q11** | **Custom vs schema for VALD extras** | `custom_` prefix is enforced for custom tests, so VALD extras-as-custom would read inconsistently with native `fp_*`. | If you go hybrid (Q2c), accept the `custom_` cosmetic, or promote frequently-used extras into the schema over time. |
| **Q12** | **Publish posture** | VALD data lands `on_publish` (invisible to client until you publish). | Keep it — VALD imports are bulk and noisy; the EP curating what reaches the client is the right default. |

---

## 8. Risks the reviewer should know (condensed premortem)

Weighted per CLAUDE.md: security/infra at production-grade, workflow/UX at f&f scope. These are the items that bear on a VALD import specifically.

1. **Schema/seed/file drift (amplified by VALD growth).** The runtime artifact is `physical_markers_schema_seed` (a DB table), **not** the JSON file. The `never`-wall and the resolver read the *table*. Editing the JSON does nothing until the seed migration re-runs, and the consistency assert (`assertSchemaConsistent`) is opt-in at deploy, not per-request. Every VALD-driven schema addition multiplies the chance of a forgotten re-seed → metrics silently missing or mis-typed. **Mitigation: make re-seed + type-regen a hard step in the import-build checklist.**
2. **Append-only + no dedup = double data on re-import.** As above (Q9). Without a dedup key this *will* bite the first time a file is re-uploaded.
3. **`never`-wall verified only at the policy level, never through the live portal query.** Lower stakes for VALD (force/jump data isn't Tampa-grade), but the wall still gates the portal and should be exercised end-to-end before real client data flows. (General beta-gate item, not VALD-specific.)
4. **Cross-tenant isolation not asserted for the testing tables.** `17_cross_tenant_isolation.sql` covers `clients/clinical_notes/programs` and argues the rest share the policy shape; the testing tables (`test_results`, `test_sessions`, …) aren't directly asserted. A bulk VALD importer writing many rows is exactly when you'd want that net explicit. Cheap to extend.
5. **Region-mismatch perf (Vercel iad1 ↔ DB syd1).** The Reports tab is already query-heavy (`loadTestHistoryForClient` fan-in). A bulk import creating hundreds of `test_results` rows per client will make that screen feel the Pacific round-trip. Worth a pagination/window check before bulk data lands.
6. **Doc drift.** [`docs/polish/testing-module.md`](polish/testing-module.md) progress log stops at Phase M (2026-05-15); ≥3 migrations have landed since (`client_select_test_batteries`, `restore_client_publication_per_test`, `test_helpers_revoke_public`). Anyone (including the reviewer) reasoning from that doc gets a stale picture. Worth a refresh pass alongside this work.

**Reassurances (verified, not assumed):**
- The `never`-wall function is **fail-closed** (unknown metric → `never`), `SECURITY DEFINER`, `search_path` pinned, revoked from `PUBLIC` ([20260501130000:143-152](../supabase/migrations/20260501130000_d6_visibility_simplify.sql)).
- The RLS-bypass fixture helpers (`_test_insert_*`, `_test_make_user`, `_test_grant_membership`) are revoked from `anon` **and** `authenticated` **and** `PUBLIC` ([00_test_helpers.sql:236-321](../supabase/tests/database/00_test_helpers.sql)) — no client can reach them.
- No new RLS *patterns* are needed: VALD rows are just `test_sessions`/`test_results` with `source='vald'`, already covered by existing policies.

---

## 9. Assets you already have (reduces the build)

- ✅ `vald_device_types` lookup, **seeded** with the four devices.
- ✅ `vald_raw_uploads` staging table (file landing pad, `payload jsonb`, parse-state columns).
- ✅ `test_sessions.source = 'vald'` enum value reserved.
- ✅ `practice_custom_tests` escape hatch for any metric the schema lacks.
- ✅ The resolver + runtime-config architecture: new metrics need only schema-JSON + re-seed, no rendering-code change.
- ✅ The Reports tab (charts, comparison, per-test publish) renders any `(test_id, metric_id)` the schema knows — VALD data inherits all of it for free once mapped.

**What's genuinely new to build (when approved):** the parser + the VALD-field→metric **mapping layer** (Q4), the trial/asymmetry/identity reconciliation (Q6/Q7/Q5), dedup (Q9), and — if parity/hybrid — the schema additions (Q2).

---

## Appendix A — Full metric inventory (105)

`category | subcat | test_id | metric_id | label | unit | side | direction | comparison | client_chart`

```
rom | rom_hip | rom_hip_flexion | passive | Passive | deg | L/R | higher | bilateral_lsi | milestone
rom | rom_hip | rom_hip_flexion | active | Active | deg | L/R | higher | bilateral_lsi | milestone
rom | rom_hip | rom_hip_ir_er | ir_supine | IR supine | deg | L/R | higher | bilateral_lsi | milestone
rom | rom_hip | rom_hip_ir_er | er_supine | ER supine | deg | L/R | context_dependent | bilateral_lsi | milestone
rom | rom_hip | rom_hip_ir_er | ir_prone | IR prone | deg | L/R | higher | bilateral_lsi | milestone
rom | rom_hip | rom_hip_ir_er | er_prone | ER prone | deg | L/R | context_dependent | bilateral_lsi | milestone
rom | rom_hip | rom_hip_thomas | angle | Angle | deg | L/R | lower | bilateral_lsi | milestone
rom | rom_knee | rom_knee_flex_ext | flexion_passive | Flexion passive | deg | L/R | higher | bilateral_lsi | milestone
rom | rom_knee | rom_knee_flex_ext | flexion_active | Flexion active | deg | L/R | higher | bilateral_lsi | milestone
rom | rom_knee | rom_knee_flex_ext | extension_passive | Extension passive | deg | L/R | higher | bilateral_lsi | milestone
rom | rom_knee | rom_knee_flex_ext | extension_active | Extension active | deg | L/R | higher | bilateral_lsi | milestone
rom | rom_ankle | rom_ankle_df_lunge | distance_cm | Wall distance | cm | L/R | higher | bilateral_lsi | milestone
rom | rom_ankle | rom_ankle_df_lunge | angle_deg | Angle | deg | L/R | context_dependent | bilateral_lsi | milestone
rom | rom_shoulder | rom_shoulder_flex_ext | flexion | Flexion | deg | L/R | higher | bilateral_lsi | milestone
rom | rom_shoulder | rom_shoulder_flex_ext | extension | Extension | deg | L/R | higher | bilateral_lsi | milestone
rom | rom_shoulder | rom_shoulder_ir_er | ir_0deg | IR at 0° | deg | L/R | higher | bilateral_lsi | milestone
rom | rom_shoulder | rom_shoulder_ir_er | er_0deg | ER at 0° | deg | L/R | higher | bilateral_lsi | milestone
rom | rom_shoulder | rom_shoulder_ir_er | ir_90deg | IR at 90° | deg | L/R | higher | bilateral_lsi | milestone
rom | rom_shoulder | rom_shoulder_ir_er | er_90deg | ER at 90° | deg | L/R | context_dependent | bilateral_lsi | milestone
rom | rom_shoulder | rom_shoulder_abd_add | abduction | Abduction | deg | L/R | higher | bilateral_lsi | milestone
rom | rom_shoulder | rom_shoulder_abd_add | adduction | Adduction | deg | L/R | higher | bilateral_lsi | milestone
force_plate | fp_cmj | fp_cmj_bilateral | jump_height | Jump height | cm | — | higher | vs_baseline | line
force_plate | fp_cmj | fp_cmj_bilateral | conc_peak_force | Concentric peak force | N | — | higher | vs_baseline | line
force_plate | fp_cmj | fp_cmj_bilateral | ecc_peak_force | Eccentric peak force | N | — | higher | vs_baseline | line
force_plate | fp_cmj | fp_cmj_bilateral | ecc_dec_rfd | Eccentric deceleration RFD | N/s | — | higher | vs_baseline | line
force_plate | fp_cmj | fp_cmj_bilateral | peak_power | Peak power | W | — | higher | vs_baseline | line
force_plate | fp_cmj | fp_cmj_bilateral | ft_ct | FT:CT ratio | ratio | — | higher | vs_baseline | line
force_plate | fp_sj | fp_sj | jump_height | Jump height | cm | — | higher | vs_baseline | line
force_plate | fp_dj | fp_dj_bilateral | rsi | RSI | m/s | — | higher | vs_baseline | line
force_plate | fp_unilateral | fp_slcmj | jump_height | Jump height | cm | L/R | higher | bilateral_lsi | milestone
force_plate | fp_unilateral | fp_slcmj | lsi | LSI | % | — | higher | vs_baseline | line
force_plate | fp_unilateral | fp_sl_dj | rsi | RSI | m/s | L/R | higher | bilateral_lsi | milestone
force_plate | fp_unilateral | fp_sl_dj | contact_time | Contact time | ms | L/R | lower | bilateral_lsi | milestone
force_plate | fp_broad | fp_broad_jump | distance | Distance | cm | — | higher | vs_baseline | line
force_plate | fp_isometric | fp_imtp | peak_force | Peak force | N | — | higher | vs_baseline | line
force_plate | fp_isometric | fp_imtp | rfd_0_100 | RFD 0–100ms | N/s | — | higher | vs_baseline | line
force_plate | fp_isometric | fp_imtp | impulse | Impulse | N·s | — | higher | vs_baseline | line
force_plate | fp_balance | fp_cop_bilateral | eyes_open | Eyes open | mm | — | lower | vs_baseline | line
force_plate | fp_balance | fp_cop_bilateral | eyes_closed | Eyes closed | mm | — | lower | vs_baseline | line
force_plate | fp_balance | fp_cop_unilateral | sway | Sway | mm | L/R | lower | bilateral_lsi | milestone
dynamometry | dyn_nordbord | dyn_nordic | peak_force | Peak force | N | L/R | higher | bilateral_lsi | milestone
dynamometry | dyn_nordbord | dyn_nordic | lsi | LSI | % | — | higher | vs_baseline | line
dynamometry | dyn_nordbord | dyn_nordic | force_angle_curve | Force-angle curve | file | — | context_dependent | vs_baseline | narrative_only
dynamometry | dyn_forceframe | dyn_ff_hip_abd | peak_force | Peak force | N | L/R | higher | bilateral_lsi | milestone
dynamometry | dyn_forceframe | dyn_ff_hip_add | peak_force | Peak force | N | L/R | higher | bilateral_lsi | milestone
dynamometry | dyn_forceframe | dyn_ff_add_abd_ratio | ratio | Ratio | ratio | L/R | target_range | vs_normative | narrative_only
dynamometry | dyn_forceframe | dyn_ff_shoulder_er_ir | er_force | ER peak force | N | L/R | higher | bilateral_lsi | milestone
dynamometry | dyn_forceframe | dyn_ff_shoulder_er_ir | ir_force | IR peak force | N | L/R | higher | bilateral_lsi | milestone
dynamometry | dyn_forceframe | dyn_ff_shoulder_er_ir | ratio | ER:IR ratio | ratio | L/R | target_range | vs_normative | narrative_only
dynamometry | dyn_forceframe | dyn_ff_knee_ext | peak_force | Peak force | N | L/R | higher | bilateral_lsi | milestone
dynamometry | dyn_forceframe | dyn_ff_knee_flex | peak_force | Peak force | N | L/R | higher | bilateral_lsi | milestone
dynamometry | dyn_dynamo | dyn_hhd_knee_ext | peak_force | Peak force | N | L/R | higher | bilateral_lsi | milestone
dynamometry | dyn_dynamo | dyn_hhd_knee_flex | peak_force | Peak force | N | L/R | higher | bilateral_lsi | milestone
dynamometry | dyn_dynamo | dyn_hhd_shoulder_abd | peak_force | Peak force | N | L/R | higher | bilateral_lsi | milestone
dynamometry | dyn_dynamo | dyn_hhd_grip | peak_force | Peak force | kg | L/R | higher | bilateral_lsi | milestone
body_composition | bc_dexa | bc_dexa_scan | total_lean_mass | Total lean mass | kg | — | context_dependent | vs_baseline | narrative_only
body_composition | bc_dexa | bc_dexa_scan | body_fat_pct | Body fat % | % | — | context_dependent | vs_baseline | narrative_only
body_composition | bc_dexa | bc_dexa_scan | vat | Visceral adipose tissue | g | — | target_range | vs_normative | narrative_only
body_composition | bc_dexa | bc_dexa_scan | bmd | Bone mineral density (BMD) | g/cm² | — | higher | vs_normative | milestone
body_composition | bc_dexa | bc_dexa_scan | t_score | T-score | SD | — | higher | vs_normative | milestone
body_composition | bc_anthropometry | bc_anthro | body_mass | Body mass | kg | — | context_dependent | vs_baseline | narrative_only
body_composition | bc_anthropometry | bc_anthro | height | Height | cm | — | context_dependent | absolute | narrative_only
body_composition | bc_anthropometry | bc_anthro | waist_circ | Waist circumference | cm | — | target_range | vs_normative | narrative_only
body_composition | bc_anthropometry | bc_anthro | hip_circ | Hip circumference | cm | — | target_range | vs_normative | narrative_only
body_composition | bc_anthropometry | bc_anthro | waist_hip_ratio | Waist-hip ratio | ratio | — | target_range | vs_normative | narrative_only
body_composition | bc_anthropometry | bc_anthro | thigh_circ | Thigh circumference | cm | L/R | context_dependent | vs_baseline | narrative_only
cardiorespiratory | cardio_resting | cardio_resting_vitals | hr | Resting heart rate | bpm | — | context_dependent | vs_baseline | narrative_only
cardiorespiratory | cardio_resting | cardio_resting_vitals | bp_systolic | Systolic BP | mmHg | — | target_range | vs_normative | narrative_only
cardiorespiratory | cardio_resting | cardio_resting_vitals | bp_diastolic | Diastolic BP | mmHg | — | target_range | vs_normative | narrative_only
cardiorespiratory | cardio_resting | cardio_resting_vitals | spo2 | SpO₂ | % | — | target_range | vs_normative | narrative_only
cardiorespiratory | cardio_field | cardio_6mwt | distance | Distance | m | — | higher | vs_baseline | line
cardiorespiratory | cardio_field | cardio_yoyo_ir2 | level | Level reached | level | — | higher | vs_baseline | line
cardiorespiratory | cardio_field | cardio_yoyo_ir2 | total_distance | Total distance | m | — | higher | vs_baseline | line
cardiorespiratory | cardio_field | cardio_beep | level | Level reached | level | — | higher | vs_baseline | line
cardiorespiratory | cardio_field | cardio_beep | vo2max_est | Estimated VO₂max | mL/kg/min | — | higher | vs_baseline | line
cardiorespiratory | cardio_field | cardio_step | hr_recovery | HR at 1min recovery | bpm | — | lower | vs_baseline | line
cardiorespiratory | cardio_field | cardio_step | vo2max_est | Estimated VO₂max | mL/kg/min | — | higher | vs_baseline | line
cardiorespiratory | cardio_max | cardio_vo2max | vo2max_direct | VO₂max direct | mL/kg/min | — | higher | vs_baseline | line
cardiorespiratory | cardio_max | cardio_vo2max | vo2max_estimated | VO₂max estimated | mL/kg/min | — | higher | vs_baseline | line
biomarkers | bio_metabolic | bio_metabolic_panel | vitamin_d | Vitamin D (25-OH) | nmol/L | — | higher | vs_normative | narrative_only
biomarkers | bio_metabolic | bio_metabolic_panel | hba1c | HbA1c | % | — | lower | vs_normative | narrative_only
biomarkers | bio_metabolic | bio_metabolic_panel | glucose | Fasting glucose | mmol/L | — | lower | vs_normative | narrative_only
biomarkers | bio_metabolic | bio_metabolic_panel | cholesterol | Total cholesterol | mmol/L | — | target_range | vs_normative | narrative_only
biomarkers | bio_metabolic | bio_metabolic_panel | ldl | LDL | mmol/L | — | lower | vs_normative | narrative_only
biomarkers | bio_metabolic | bio_metabolic_panel | hdl | HDL | mmol/L | — | higher | vs_normative | narrative_only
neuromuscular | neuro_balance | neuro_sls | eyes_open | Eyes open | s | L/R | higher | bilateral_lsi | milestone
neuromuscular | neuro_balance | neuro_sls | eyes_closed | Eyes closed | s | L/R | higher | bilateral_lsi | milestone
functional_movement | func_upper | func_pushup | max_reps | Max reps | reps | — | higher | vs_baseline | line
sport_performance | sport_speed | sport_sprint_10m | time | Time | s | — | lower | vs_baseline | line
sport_performance | sport_speed | sport_sprint_20m | time | Time | s | — | lower | vs_baseline | line
sport_performance | sport_speed | sport_t_test | time | Time | s | — | lower | vs_baseline | line
sport_performance | sport_generic | sport_grip | peak_force | Peak force | kg | L/R | higher | bilateral_lsi | milestone
patient_reported | pts_pain | pts_vas | score | VAS score | mm | — | lower | vs_baseline | narrative_only
patient_reported | pts_region | pts_koos | pain | Pain subscale | 0–100 | — | higher | vs_baseline | milestone
patient_reported | pts_region | pts_koos | symptoms | Symptoms subscale | 0–100 | — | higher | vs_baseline | milestone
patient_reported | pts_region | pts_koos | adl | ADL subscale | 0–100 | — | higher | vs_baseline | milestone
patient_reported | pts_region | pts_koos | sport_rec | Sport & recreation subscale | 0–100 | — | higher | vs_baseline | milestone
patient_reported | pts_region | pts_koos | qol | QoL subscale | 0–100 | — | higher | vs_baseline | milestone
patient_reported | pts_region | pts_hoos | pain | Pain subscale | 0–100 | — | higher | vs_baseline | milestone
patient_reported | pts_region | pts_hoos | symptoms | Symptoms subscale | 0–100 | — | higher | vs_baseline | milestone
patient_reported | pts_region | pts_hoos | adl | ADL subscale | 0–100 | — | higher | vs_baseline | milestone
patient_reported | pts_region | pts_hoos | sport_rec | Sport & recreation subscale | 0–100 | — | higher | vs_baseline | milestone
patient_reported | pts_region | pts_hoos | qol | QoL subscale | 0–100 | — | higher | vs_baseline | milestone
patient_reported | pts_region | pts_acl_rsi | total_score | Total score | 0–100 | — | higher | vs_baseline | milestone
patient_reported | pts_region | pts_tampa | total_score | Total score | 17–68 | — | lower | vs_baseline | hidden
```

## Appendix B — Enum legends (from the schema JSON)

- **direction_of_good:** `higher` · `lower` · `target_range` · `context_dependent`
- **default_chart (staff):** `line` · `bar` · `radar` · `asymmetry_bar` · `target_zone`
- **comparison_mode:** `absolute` · `bilateral_lsi` (= involved/uninvolved ×100) · `vs_baseline` · `vs_normative`
- **client_portal_visibility:** `auto` (legacy, unused post-D.6) · `on_publish` · `never`
- **client_view_chart:** `line` · `milestone` · `bar` · `narrative_only` · `hidden`
- **test_source:** `manual` · `vald` · `imported`

## Appendix C — Key files & tables

| Concern | Where |
|---|---|
| Metric schema (edit-time source) | [`data/physical_markers_schema_v1.1.json`](../data/physical_markers_schema_v1.1.json) |
| Runtime seed table | `physical_markers_schema_seed` ([20260428120100](../supabase/migrations/20260428120100_physical_markers_schema_seed_table.sql)) |
| Resolver (only path to hints) | `src/lib/testing/resolver.ts`, `schema-loader.ts` |
| Result tables | `test_sessions`, `test_results` ([20260428120200](../supabase/migrations/20260428120200_test_sessions.sql), […0300](../supabase/migrations/20260428120300_test_results.sql)) |
| `never`-wall function | `test_metric_visibility` ([20260501130000](../supabase/migrations/20260501130000_d6_visibility_simplify.sql)) |
| Publish gate | `client_publications` ([20260612140000](../supabase/migrations/20260612140000_restore_client_publication_per_test.sql)) |
| VALD staging (World A) | `vald_device_types`, `vald_raw_uploads` ([20260420102200](../supabase/migrations/20260420102200_reports_and_vald.sql)) |
| Settings → Tests UI | `src/app/(staff)/settings/tests/` |
| Client Reports tab UI | `src/app/(staff)/clients/[id]/_components/reports/` |
| Prior gap doc (stale past Phase M) | [`docs/polish/testing-module.md`](polish/testing-module.md) |
| Source brief (VALD = Phase 3) | [`CLAUDE_CODE_BUILD_PROMPT_testing_module.md`](../CLAUDE_CODE_BUILD_PROMPT_testing_module.md) §9 |
