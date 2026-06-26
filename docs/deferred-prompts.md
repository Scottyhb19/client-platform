# Deferred prompts

A working file of tracked-but-not-yet-resolved scope and design decisions. **Not a contract.** Items here are still under consideration; some will be promoted into a phase plan or closed without action.

When an item is closed:
- If it landed in the codebase, link the commit / PR and remove the entry (the change itself is the record).
- If it was rejected, leave a one-line note here so the decision isn't relitigated.

When an item lands as a phase plan, link the relevant section in `docs/polish/<section>.md` and remove the duplicate detail from this file.

---

## Testing module — practice_custom_metrics (metric-on-existing-test)

**Surfaced:** 2026-05-01 during D.2 polish (negative-value bug + missing path to attach a metric to an existing test like CMJ).

**Problem.** The custom-test builder at Settings → Tests → Custom tests creates whole new tests. There's no path for the EP to add a metric *inside* an existing schema test. Workaround today: create a one-metric custom test for the new metric — but that produces a separate tile in the Reports tab when the metric should sit beside the parent test's other metrics.

**Decisions taken (signed off, not yet implemented):**

| Choice | Decision |
|---|---|
| Architecture | New `practice_custom_metrics` table keyed on `(organization_id, test_id, metric_id)`. `test_id` may point to a schema test (`cmj`) OR a custom test (`custom_xxx`). Resolver and catalog loader merge at read time. |
| UI placement | Mode toggle inside the existing Custom Tests section: "Create new test" vs "Add metric to existing test". Same metric form, different first step. |
| Existing data | User will manually delete the standalone "Eccentric peak velocity" custom test and recreate the metric inside CMJ via the new flow once it lands. No in-place migration tool needed. |
| Scope/sequencing | Bundled after Phase D.4 (publish flow) lands. Hotfix for the negative-value bug shipped first as D.2.1. |

**Implementation outline (when it lands):**

1. Migration — `practice_custom_metrics` table, RLS (same shape as `practice_custom_tests`), unique `(organization_id, test_id, metric_id) WHERE deleted_at IS NULL`, FK soft-delete cascading via the existing audit trigger pattern.
2. Audit register — add to `audit_resolve_org_id()` CASE list (per project memory `audit_register_new_tables`).
3. Soft-delete RPC — `soft_delete_practice_custom_metric` (matches existing pattern in migration `20260429120000`).
4. Resolver — `resolveMetricSettings` and `resolveMetricSettingsBulk` walk: schema seed OR custom test (existing), THEN check `practice_custom_metrics` for an org-level addition keyed on the same (test_id, metric_id). Custom metrics on schema tests use the schema test's labels (category, subcategory, test_name) but their own metric label/unit/hints.
5. Catalog loader — `loadCatalog` joins `practice_custom_metrics` and appends to the appropriate test's metric array.
6. Custom-test builder UI — toggle at top of the section. "Add metric" mode shows a parent-test picker (search across schema + custom tests, force-expand on filter, same UX as the saved-batteries picker), then the metric form below.
7. Test history loader — `loadTestHistoryForClient` already groups by test_id; custom-on-existing metrics will appear inside the parent test card automatically once the resolver returns the right test_name.
8. pgTAP — extend `01_visibility_override.sql` (or new test) to assert custom metrics on a schema test_id resolve correctly and inherit RLS visibility from the parent test.

**Why deferred:**
- D.2 polish-pass scope: ship the IA + charts + publish flow before adding new authoring surfaces.
- The negative-value blocker is unblocked by the D.2.1 fallback hotfix; the architectural change isn't urgent.
- Pre-launch advantage: schema migration cost is still low when this lands. No reason to rush.

---

## Calendar copy/repeat: per-set fan-out fix — CLOSED 2026-06-12 (superseded by G-1)

**Resolved:** Migration `20260612100000_clone_rpcs_per_set_fanout` (G-1 of the
program-engine/session-builder polish pass, `docs/polish/program-engine-session-builder.md`).
The audit found this entry under-scoped: not two but **four** clone paths skipped the
fan-out — `copy_program_day`, `repeat_program_day_weekly`, *and* `_clone_program`
(serving `copy_program` / `repeat_program`, migration `20260503130000`, which also
predates per-set storage). All four fixed in the one migration. The fix also closed a
latent Cartesian bug in `repeat_program_day_weekly`'s superset remap (one-pass
`SELECT DISTINCT … gen_random_uuid()` never deduplicates — repeating a superset day
inserted duplicate exercises with mismatched group ids). pgTAP tests 10/11 extended
with set fan-out, pairing, exercise-count, and group-cohesion assertions. No backfill,
per the recommendation below (pre-launch, no real client data). Entry retained for
the historical fix outline.

**Surfaced:** 2026-05-08 during session-builder Phase I sign-off (Q5).

**Problem.** `copy_program_day` (migration `20260503120000`) and `repeat_program_day_weekly` (same migration) were written before per-set storage landed in session-builder Phase C (`20260507100000_program_exercise_sets`). Both RPCs:

1. Insert into the legacy scalar columns on `program_exercises` (`sets`, `reps`, `optional_metric`, `optional_value`, `rpe`) — fine in itself, those columns are still present.
2. **Do NOT fan out `program_exercise_sets`.** Any day created via the calendar's day-level copy or weekly repeat flow comes out with zero per-set rows in the new shape.

The page loader for the session builder reads `prescription_sets` (the new shape) and ignores the legacy scalars, so the duplicated day renders with **empty set rows** even though the source had non-empty prescriptions. The portal RPC `client_get_program_day_exercises` (v2 from `20260507100100`) returns `prescription_sets jsonb` from the new table, so the client portal also sees an empty day.

The session-builder Phase I duplicate flow (`duplicate_program_day` migration `20260508100000`) does fan out per-set rows correctly — it was a new RPC built on top of the per-set shape. The two calendar RPCs are the gap.

**Fix outline.**

1. New migration that updates `copy_program_day` and `repeat_program_day_weekly` (CREATE OR REPLACE — function signatures don't change). After the existing `INSERT INTO program_exercises ... RETURNING id, sort_order` step in each, add the same per-set fan-out CTE pattern from `duplicate_program_day`'s migration §2:
   ```sql
   INSERT INTO program_exercise_sets (
     program_exercise_id, set_number, reps, optional_metric, optional_value
   )
   SELECT cloned.id, src_set.set_number, src_set.reps,
          src_set.optional_metric, src_set.optional_value
     FROM <cloned-CTE> AS cloned
     JOIN program_exercises src_pe
       ON src_pe.program_day_id = p_source_day_id
      AND src_pe.deleted_at IS NULL
      AND src_pe.sort_order = cloned.sort_order
     JOIN program_exercise_sets src_set
       ON src_set.program_exercise_id = src_pe.id
      AND src_set.deleted_at IS NULL;
   ```
   `repeat_program_day_weekly` runs the loop body once per target date, so the fan-out has to land inside the WHILE loop after each per-date insert.
2. No types regen needed (function signatures unchanged).
3. Backfill consideration: any days already created by these RPCs since per-set storage landed (2026-05-07) currently have zero per-set rows. Pre-launch the practical impact is zero (no real client data yet) — recommend NOT backfilling. The next time the EP opens such a day in the session builder, they'll see empty sets and add the correct prescription, which becomes the new source of truth.
4. pgTAP — add a test that calls `copy_program_day` and `repeat_program_day_weekly` against a fixture with multi-set exercises, then asserts `program_exercise_sets` rows on the cloned day match the source 1:1 (count, set_number, reps, optional_metric, optional_value).

**Why deferred from Phase I.** Phase I was scoped to the session builder's Duplicate button (a new RPC). Touching the calendar's RPCs is out of scope for the session-builder polish pass — it belongs in the programs polish pass (`docs/polish/programs.md`). It's a one-migration fix, ~30 minutes once started.

**Self-contained prompt for a fresh chat:**

> Fix per-set fan-out in `copy_program_day` and `repeat_program_day_weekly`. Both RPCs (defined in `supabase/migrations/20260503120000_program_days_copy_repeat.sql`) clone the day + program_exercises but don't fan out `program_exercise_sets` — so calendar copies/repeats land with empty set rows in the post-Phase-C per-set shape. The session-builder `duplicate_program_day` RPC (migration `20260508100000_duplicate_program_day.sql`) shows the correct pattern: a CTE-with-RETURNING `cloned`, then `INSERT INTO program_exercise_sets SELECT … FROM cloned JOIN program_exercises src_pe ON sort_order JOIN program_exercise_sets src_set ON program_exercise_id`. Apply the same pattern inside `copy_program_day`'s body and inside the per-iteration block of `repeat_program_day_weekly`'s WHILE loop. CREATE OR REPLACE — signatures don't change. No types regen needed. Add a pgTAP test asserting per-set rows clone 1:1. Don't backfill existing data (pre-launch — no real client data). Reference: `docs/deferred-prompts.md` "Calendar copy/repeat: per-set fan-out fix".

---

## VALD import — parked decision (2026-06-27)

**Status:** Parked. Phase 3 / brief-scope expansion. Deferred-with-trigger. Not started; gated behind the beta-entry hardening gate and current in-flight work.

**Decision in one line.** Build a curated CSV importer for ForceDecks and DynaMo only, landing VALD numbers into the existing structured testing module (`test_sessions(source='vald')` → `test_results` → Reports tab + publish gate). Validate the value by hand before writing any code.

**Why this exists at all.** Not "everything in one place" for its own sake — that sentence justifies any scope creep. The two things VALD Hub genuinely cannot do: (1) publish a clean, readable result to the client portal; (2) put the testing data in front of the EP at the moment they build the program. Both are the cross-domain view, which is the platform's differentiator. A screen that only re-renders VALD's own data in isolation does not earn its place and is cut.

**Scope locked.**

- **In, v1:** ForceDecks + DynaMo.
- **Later (architect, don't build):** ForceFrame — slots into the same field-map by adding rows, no rebuild.
- **Out entirely:** NordBord — not owned, and it drags in the force-angle curve problem (a file, not a number; cannot live in `test_results.value`, which is `numeric NOT NULL`). Dropping NordBord removes the only genuinely ugly modelling problem in the recon.

**Situation — what already exists** (verify against the live schema before building; do not assume). Per the VALD recon (2026-06-27): the schema already holds the FD/DynaMo tests with metrics, units, sides and chart hints; the curated clinical set (CMJ = 6, IMTP = 3, DynaMo force set) is already the right curation — no parity expansion wanted. `test_sessions.source = 'vald'` enum reserved. `vald_raw_uploads` staging table exists, device lookup seeded. Reports tab renders any `(test_id, metric_id)` the schema knows; publish gate already curates what reaches the client. None of "the tests and metrics" needs building. The gap is a parser + field-map and three reconciliation calls.

**The actual build (when triggered).**

- **Parser + field-map:** VALD column → `(test_id, metric_id, side, unit, trial_rule)`. Same runtime-config posture as the schema JSON — read via resolver, never hard-coded, tunable without a redeploy.
- Reuse `vald_raw_uploads` (World A staging) → parse/map → `test_sessions(source='vald')` + `test_results` (World B). Charts + publish gate inherited for free.
- **Three reconciliation calls:** best-trial (take VALD's flagged best trial for v1; record the rule used); identity (manual confirm-on-import, never auto-create a client from a VALD name; store the VALD athlete id for later auto-match); dedup (append-only `test_results` double-counts on re-upload — dedup on the VALD test id is a must-have, in place before the first import, not after).
- **Thin slice first:** CMJ end-to-end on one real athlete → published to a test portal → before fanning out to the rest of FD and DynaMo.

**Validation-first step (do this before any code).** The tests already accept manual entry. Next real ForceDecks athlete: type the six CMJ numbers into Odyssey by hand, publish to a test portal, use that Reports tab when building their program. Proves the one thing reasoning can't — whether the cross-domain view changes how the work actually goes. Two or three athletes is the sample. The manual cost is paid a few times as a validation, not as steady state, and is far cheaper than building a pipeline for an assumed value. This is the dogfooding loop applied honestly.

**Rejected alternatives.**

- All four devices at once — two not owned; NordBord reintroduces the curve problem.
- VALD API (live OAuth sync) first — a new external-data/credential/privacy surface, unnecessary at this volume. CSV-first; API is a much-later upgrade if athlete volume makes manual export annoying.
- Parity (import all ~100+ FD columns) — rejected on evidence, not taste. Force-plate metric reliability varies widely; the primaries (jump height, mRSI, peak power, concentric impulse, IMTP peak force) are robust between sessions, many derived/phase metrics are not. Importing the noisy tail produces progression charts that move on measurement error and a cluttered portal. Curated is the clinically correct call, not the lossy compromise.

**Re-triggers (build when ALL hold).**

- Validation-first step done and the cross-domain view earned its keep across 2–3 real athletes.
- Beta-entry hardening gate closed — secrets rotated. The importer is a low-friction path to real athlete health data; do not stand it up in front of an open gate, since the service-role key bypasses RLS until rotated.
- In-flight work cleared — logging-flow Changes 1–3, the loaded-carry exercise fix, exercise-library seed.

When triggered, this runs as a full Phase-3 section: seven-step polish protocol + section sign-off ritual (new ingest surface + a parser + a privacy-sensitive identity join; likely no schema change for FD/DynaMo).

**Parked verification items** (confirm against a real export + the live codebase; do not assert).

- Lift exact VALD column strings and units from a real FD and DynaMo export before writing any map. Field names differ by product, export type (Hub CSV vs API) and account config.
- DynaMo also exports ROM; the schema does not model DynaMo ROM under the `dyn_hhd_*` tests. Ignore DynaMo ROM in v1 — force only.
- Grip unit: schema says kg; DynaMo can emit N depending on config. Confirm against the export; reject-and-flag on unit mismatch (the denormalised `test_results.unit` makes that safe).
- Risk checks the recon flagged for FD: jump height cm vs m, RSI m/s vs ratio, RFD-window definitions.
- The recon's codebase claims (tests exist, enum reserved, staging present) are claims, not verified ground truth — confirm against the live schema as the cheap first build step.

**Source:** VALD recon doc (2026-06-27); testing-module brief §9 (VALD = Phase 3); CLAUDE.md "What NOT to build" + beta-entry hardening gate.
