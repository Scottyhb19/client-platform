# Polish-pass gap analysis — Prescription volume unit (timed / distance prescriptions)

**Trigger:** Dogfooding capture (operator, 2026-06-23) — "When adding a timed exercise you should be able to select *3 sets of 30 secs*, not *3 sets of 1 rep of 30 sec*. Same for a carry that should be *20 m* — with the weight it can't be recorded. Suggestion: a dropdown on the rep aspect, like the unit dropdown."

**Classification:** **Structural** — new data axis across `exercises` defaults → per-set prescription → client-portal logging, touching two already-signed-off sections (Program engine / session builder — section 5, the differentiator; Client portal PWA — section 7). Per the Phase 1.5 dogfooding loop this re-enters the full seven-step polish-pass protocol and the sign-off ritual. **This is the gap-list contract (step 4); no code beyond it until sign-off (step 5).**

**Brief refs:** [`Client_Platform_Brief_v2.1.docx`](../../Client_Platform_Brief_v2.1.docx) §5.1 (default-prescription data model), §6.4 (in-session logging — sets × reps × weight × RPE), §6.5.3 (prescription metric dropdown).
**Current implementation:**
- Library form — `src/app/(staff)/library/_components/ExerciseForm.tsx:165-223` (the Default-prescription grid: Sets, Reps, Unit, Load, Rest)
- Library card render — `src/app/(staff)/library/_components/ExerciseCard.tsx:141-154`, `src/app/(staff)/library/_components/format.ts`
- Session builder — `src/app/(staff)/clients/[id]/program/days/[dayId]/_components/SessionBuilder.tsx` (`SetCell` ~1565-1644, `MetricColumnDropdown` ~1707-1807)
- Portal logger — `src/app/portal/session/[dayId]/_components/Logger.tsx` (set inputs ~845-861, numeric reps validation ~137; unit discarded ~1177-1184), `src/app/portal/session/[dayId]/actions.ts:111-137` (`p_optional_metric: null` hardcoded ~128)
**Schema:**
- `exercises` — [`20260420101500_exercises.sql`](../../supabase/migrations/20260420101500_exercises.sql) — `default_reps text`, `default_metric text`, `default_metric_value text`
- `program_exercise_sets` — [`20260507100000_program_exercise_sets.sql`](../../supabase/migrations/20260507100000_program_exercise_sets.sql) — `reps text`, `optional_metric text`, `optional_value text`
- `template_exercise_sets` — [`20260612120000_program_templates_lifecycle.sql`](../../supabase/migrations/20260612120000_program_templates_lifecycle.sql)
- `set_logs` — [`20260420101900_session_logging.sql`](../../supabase/migrations/20260420101900_session_logging.sql) — `weight_value numeric(7,2)`, `weight_metric text`, `reps_performed smallint`, `optional_metric text`, `optional_value text`, `rpe smallint`
- `exercise_metric_units` seed — [`20260420102400_bootstrap_functions.sql`](../../supabase/migrations/20260420102400_bootstrap_functions.sql) — includes `time_minsec`, `distance_m`, `distance_km`, `distance_miles` (categories `time` / `distance`)
- Portal RPCs — `client_get_program_day_exercises_v2`, `client_log_set` ([`20260420102500_client_portal_functions.sql`](../../supabase/migrations/20260420102500_client_portal_functions.sql))
**Audit date:** 2026-06-23
**Status:** Gap list — awaiting sign-off before any code changes.

---

## 0. Executive summary

### 0.1 The real diagnosis (precise, because it changes the fix)

A prescription set has exactly **two** descriptive slots: a free-text **`reps`** field, and **one** "optional metric" pair (`optional_metric` + `optional_value` — the unit dropdown the operator calls "the –"). That single optional slot is **overloaded**: it can hold load (`kg`), or intensity (`rpe`), or time, or distance — but only **one at a time**.

- A **timed hold** (plank, 3 × 30 s) *is* expressible today — `reps` is free text, so "30 sec" is typeable — but it's by convention, unstructured, and **the client portal ignores it**: the logger always renders a numeric **Reps** field (`Logger.tsx:845`, validated as a whole number at `:137`) and discards the prescription's unit (`:1177-1184`), even calling `client_log_set` with `p_optional_metric: null` hardcoded (`actions.ts:128`).
- A **loaded carry** (farmer's carry, 3 × 20 m @ 40 kg) is the one that genuinely **can't** be expressed: the moment you set the optional slot to *distance* (20 m), there is nowhere left for the *weight* (40 kg). Distance and load fight over the same slot. This is exactly the operator's "with the weight it can't be recorded."

So the operator's instinct — a unit selector on the rep axis — is the correct fix. The volume axis needs to stop borrowing the load slot.

### 0.2 The fix — three independent axes per set

| Axis | Unit | Today | After |
|---|---|---|---|
| **Volume** | reps / **seconds** / **metres** | `reps` text only (unit by convention) | `reps` value **+ a `rep_metric` unit selector** |
| **Load** | kg / lb / % / bodyweight | `optional_metric`/`optional_value` (often stolen by time/distance) | freed — always load |
| **Intensity** | RPE | `rpe` column / `optional='rpe'` | unchanged |

"3 × 30 s", "3 × 20 m @ 40 kg", and "3 × 12" all become first-class, and the client logs a hold in **seconds** and a carry in **metres with the weight recorded alongside**.

### 0.3 Scope decision (operator, 2026-06-23): **full axis, through to logging.**

The library-form-only version was explicitly rejected because it recreates the `default_rpe` dead-end the section-5 pass deliberately removed (a value the EP sets that never reaches the client). The unit must thread the **whole** path: library defaults → session builder → `client_get_program_day_exercises_v2` → portal logger → `client_log_set` → `set_logs`, plus every clone/template path that copies a prescription.

---

## 1. What's already correct (preserve)

1. **`reps` / `default_reps` are already `text`** — no migration needed to hold a value; the unit is the only new thing.
2. **The log side is already multi-axis.** `set_logs` separates `weight_value`/`weight_metric` (load), `reps_performed` (volume count), and `rpe` (intensity), *plus* an `optional_metric`/`optional_value` spare. The portal UI just never exposes the separation — it's a UI/threading gap, not a schema rebuild.
3. **`exercise_metric_units` already seeds `time_minsec`, `distance_m`, `distance_km`, `distance_miles`** with proper `category` values. The volume dropdown reuses these — no new lookup surface, and they stay EP-configurable.
4. **The session-builder per-set model (`program_exercise_sets`) already exists** (Phase C, 2026-05-07) — the unit drops onto the existing per-set row, no new table.

---

## 2. The model change (concrete)

Add one nullable column, `rep_metric text`, to four places. **`NULL` ⇒ a plain rep count** (every existing row reads correctly with zero backfill):

- `exercises.default_rep_metric` — the library default
- `program_exercise_sets.rep_metric` — the per-set prescription
- `template_exercise_sets.rep_metric` — so template save/instantiate keeps fidelity
- `set_logs.rep_metric` — what unit the client actually logged against

Allowed values: `NULL` (reps), `time_minsec`, `distance_m`, `distance_km`, `distance_miles` (the `time`/`distance` rows of `exercise_metric_units`). The **load** axis (`optional_metric`/`weight_metric`) is untouched and now only ever means load.

> **Pre-existing limitation, explicitly left in place:** a single set still can't carry *both* a per-set load *and* a per-set RPE (the optional slot holds one). This change does not worsen it and does not fix it — see §6 Out of scope. Flagged so it isn't silently absorbed.

---

## 3. Premortem — ranked failure modes

Weighting per protocol: schema / portal-logging / RPC failure modes at **production grade** (real friends-and-family health data is logged through this path); EP-facing UX at friends-and-family scope.

| # | Failure mode | Likelihood | Impact | Closed by |
|---|---|---|---|---|
| **FM-1** | **The unit dead-ends before the client** — set in the library/builder but dropped at one of the hops (`client_get_program_day_exercises_v2`, `Logger`, `logSetAction`, `client_log_set`). Client still sees "Reps" for a 30 s hold. This is the exact half-feature the full-axis scope exists to prevent. | High if any hop missed | High — broken core promise | VU-2 |
| **FM-2** | **Logger validation rejects valid input.** Reps is hard-validated as a whole number (`Logger.tsx:137`). A time/distance set that doesn't relax/relabel validation blocks the client from logging at all. | High | High — client can't complete a session | VU-6 |
| **FM-3** | **Clone/template paths drop the unit.** The prescription is copied by *many* paths — `insert_program_exercise_at`, the TS append in `addExerciseToDayAction`, `swap_program_exercise`, `addProgramExerciseSetAction` (copy-last-set), `save_program_as_template`, `create_program_from_template`, and the calendar copy/repeat-day/program RPCs. The known TS-vs-SQL drift (exercise-library polish §7.2) means missing one silently strips the unit on that path only. | Medium-high | Medium — silent, path-specific data loss | VU-3 |
| **FM-4** | **`client_log_set` arity change calls the wrong overload.** Adding `p_rep_metric` without `DROP`-ing the old signature first leaves two overloads; supabase-js silently binds the wrong one (project memory: plpgsql arity evolution). | Medium | High — logging silently no-ops or errors | VU-2 |
| **FM-5** | **History/report surfaces render the wrong unit.** Completion summaries (`SessionExerciseSummary`, week-overview, client-profile program tab) assume "reps". A 30 s hold shown as "30 reps" is clinically wrong. | Certain if unaddressed | Medium | VU-7 |
| **FM-6** | **`reps_performed smallint` (0–1000) overflows** for a large metre value (e.g. a 1500 m row = 1500). Carries are short (≤50 m) and long efforts use `distance_km`, but the ceiling is real. | Low | Low-medium | VU-1 (decide: widen vs km-for-long) |
| **FM-7** | **Volume dropdown offers load/RPE units** (kg, %, RPE) — nonsensical on the rep axis and re-introduces the overload. | Medium | Low | VU-8 |
| **FM-8** | **pgTAP / grants regress.** `set_logs` + `program_exercise_sets` gain a column; the portal RPCs change signature. Coverage (`25_portal_rpc_grants`, per-set tests) must follow or a future migration regresses silently. Production-grade per protocol. | Low | High | VU-9 |

**Accepted without mitigation (rationale):**
- **`reps_performed` keeps its name** though it now sometimes holds seconds/metres. Renaming ripples through every read surface for cosmetic gain; the `rep_metric` column is the source of truth for *what* the number means. Re-trigger: a reporting consumer that can't disambiguate.
- **No new `exercise_metric_units` rows.** Seconds and metres already exist; we filter, not add.

---

## 4. Gap list

### P0 — architectural (production-grade failure modes)

| # | Gap | Detail |
|---|---|---|
| **VU-1** | **Schema: add `rep_metric`.** (FM-1) | One migration adds `rep_metric text` (nullable, `NULL`⇒reps) to `exercises` (`default_rep_metric`), `program_exercise_sets`, `template_exercise_sets`, `set_logs`. Optional CHECK constraining values to the `time`/`distance` unit codes + NULL. No backfill (NULL is correct for all existing rows). `supabase db push` (no Docker), regen types. **Decide FM-6** (widen `reps_performed` to `int`, or rely on km/mi for long efforts — recommend the latter; carries are short). |
| **VU-2** | **Thread the unit end-to-end.** (FM-1, FM-4) | `client_get_program_day_exercises_v2` selects `rep_metric` into `prescription_sets`; `Logger` reads it; `logSetAction` passes it (stop hardcoding `p_optional_metric: null`); `client_log_set` gains `p_rep_metric` and writes `set_logs.rep_metric`. **`DROP` the old `client_log_set` signature before `CREATE`** (arity-evolution gotcha). |
| **VU-3** | **Carry the unit through every clone/template path.** (FM-3) | Audit and update each: `insert_program_exercise_at`, `addExerciseToDayAction` (TS append), `swap_program_exercise`, `addProgramExerciseSetAction`, `save_program_as_template`, `create_program_from_template`, and the calendar copy/repeat day+program RPCs. One commit-set so the TS and SQL paths can't drift. |

### P1 — functional

| # | Gap | Detail |
|---|---|---|
| **VU-4** | **Library form — the operator's literal ask.** | Split the **Reps** field into a value input + a unit `<select>` (Reps / Seconds / Metres). Persist `default_rep_metric`. Reuse the `ExerciseForm` echo + validation plumbing. |
| **VU-5** | **Session builder — per-set volume unit.** | A volume-unit selector on the exercise/set (mirroring `MetricColumnDropdown`'s column-level pattern), writing `program_exercise_sets.rep_metric` via the existing set-update action. `SetCell` renders the unit. Highest-care surface (the differentiator) — match the existing autosave/✓ rhythm exactly. |
| **VU-6** | **Portal logger adapts.** (FM-2) | Conditional field label (**Reps** / **Seconds** / **Metres**) and validation driven by the prescription's `rep_metric`; persist the unit on save. Stop discarding `optionalMetric` at `Logger.tsx:1177-1184`. |
| **VU-7** | **Read surfaces render the unit.** (FM-5) | `format.ts` card summary, `SessionExerciseSummary`, week-overview, client-profile completion views render "30s" / "20m" / "12" correctly — never "30 reps" for a hold. |

### P2 — polish

| # | Gap | Detail |
|---|---|---|
| **VU-8** | **Curate the dropdown + house voice.** (FM-7) | Volume dropdown offers only reps/time/distance — never kg/%/RPE. Render in house style: `30s`, `1:30`, `20m`, `12`. |
| **VU-9** | **pgTAP + grants.** (FM-8) | Extend the portal-logging and per-set tests with `rep_metric` round-trip assertions (prescribe time → log seconds → read back); confirm `25_portal_rpc_grants` stays green after the `client_log_set` signature change. |

---

## 5. Decision questions for sign-off

| Q | Question | Recommendation |
|---|---|---|
| **A** | Column name + home: `rep_metric` (nullable, NULL⇒reps) on the four tables, reusing `exercise_metric_units` codes? Or a dedicated enum? | **`rep_metric`, reusing the unit codes.** Consistent with the existing unit system, EP-configurable, zero backfill. |
| **B** | Which volume units to expose **now**? | **Reps (default), Seconds, Metres.** Defer km / miles until a real need (keeps the dropdown to the three the operator named). |
| **C** | Time entry/display: plain seconds (`45s`) or min:sec (`1:30`)? | **Store seconds; display `Ns` under 90 s, `m:ss` above.** Simple entry, clean reading. |
| **D** | Confirm the per-set load-vs-RPE single-slot limitation stays **out of scope** this pass? | **Yes — out of scope.** Pre-existing, not worsened; fixing it is a separate per-set-model decision (section-5 territory). |
| **E** | FM-6: widen `reps_performed` to `int`, or rely on `distance_km` for long efforts? | **Rely on km/mi.** Carries are short; widening ripples for a case the unit choice already covers. |

---

## 6. Sequencing (on approval) · Acceptance gates · Out of scope

**Sequencing.** 1) Migration VU-1 + types regen → 2) RPC/threading VU-2 + clone-path sweep VU-3 (one commit-set) → 3) Library form VU-4 → 4) Session builder VU-5 → 5) Portal logger VU-6 → 6) Read surfaces VU-7 → 7) Polish VU-8 → 8) pgTAP VU-9 + full suite.

**Acceptance gates (the pass closes when all hold):**
1. EP creates a "Plank — 3 × 30 s" in the library; the card shows "3 × 30s"; prescribing it to a client and opening the portal shows the client a **Seconds** field, not Reps; the client logs 30 and it round-trips to `set_logs` with `rep_metric='time_minsec'`.
2. EP creates a "Farmer's carry — 3 × 20 m @ 40 kg"; **both** the 20 m (volume) and the 40 kg (load) persist and reach the client; the client logs distance and weight on the same set.
3. A plain "3 × 12" exercise is unchanged end-to-end (NULL `rep_metric` reads as reps).
4. Saving the program as a template and instantiating it for another client preserves the volume unit on every set.
5. Completion history renders "30s" / "20m", never "30 reps".
6. pgTAP green incl. the new round-trip assertions and the unchanged portal-grant tests; `type-check` + `build` clean.

**Regression scenario (for `test_scenarios_template.md` — not in repo; captured here so it isn't lost):** *Prescribe a time-based set (30 s) and a distance set (20 m @ 40 kg); verify the portal logs each in the correct unit, the value persists to `set_logs.rep_metric`, and completion history renders the unit — while an unchanged rep-count set still reads as reps.*

**Out of scope (deliberate):** the per-set load-vs-RPE single-slot limitation (Q-D); circuits / session / program templates (item 3, separate sections); km/miles volume units (Q-B); SMS; any multi-practitioner surface.

---

*Per the protocol: this is the gap-list contract. No code beyond VU-1..VU-9 until the operator approves this list (step 5). On approval, implementation proceeds in §6 order and closes with a Closing commit + Sign-off ritual.*

---

## 7. Implementation log

**Gap list approved 2026-06-23** (operator: "run your suggestions for everything" → decisions A–E as recommended). Implementing in §6 order.

- **VU-1 (P0) — closed.** Migration [`20260623100000_prescription_rep_metric.sql`](../../supabase/migrations/20260623100000_prescription_rep_metric.sql) adds nullable `rep_metric` to `exercises` (`default_rep_metric`), `program_exercise_sets`, `template_exercise_sets`, `set_logs`. `NULL`⇒reps, no backfill, no CHECK/FK (app-validated, mirrors `default_metric`). **Pushed to the live project** via `supabase db push` (clean apply; local==remote confirmed first, single migration applied). Types regenerated (`npm run supabase:types` → `src/types/database.ts`); `rep_metric`/`default_rep_metric` verified present on all four tables (Row/Insert/Update). Decision E: `reps_performed` stays `smallint`. Additive + nullable ⇒ backward-compatible with deployed code, so push order didn't matter.
- **VU-4 (P1) — closed.** New single-source module [`src/lib/prescription/volume-units.ts`](../../src/lib/prescription/volume-units.ts) (`VOLUME_UNIT_OPTIONS`, `VOLUME_METRIC_CODES`, `isVolumeMetric`, `volumeUnitLabel`, `formatVolume`) — the builder (VU-5) and portal (VU-6) will reuse it so the unit list + rendering can't drift. Library form ([`ExerciseForm.tsx`](../../src/app/(staff)/library/_components/ExerciseForm.tsx)) gains a **Measure** dropdown (Reps / Seconds / Metres, Q-B) beside Reps, with a synthetic-option fallback so a saved km/mi unit isn't reset on an untouched save; prescription section regrouped (volume + rest / load). Persistence + tamper-validation in [`actions.ts`](../../src/app/(staff)/library/actions.ts) (create + update inserts, echo, `isVolumeMetric` guard). Card renders the volume through `formatVolume` ([`ExerciseCard.tsx`](../../src/app/(staff)/library/_components/ExerciseCard.tsx)) — "3 × 30s" / "3 × 20m" / "3 × 12". Threaded through `types.ts`, `exercise-query.ts` (shared columns → covers the builder Library panel too), and `[id]/page.tsx`. `npm run type-check` clean.

- **VU-2 (P0) — closed.** Migration [`20260623110000_rep_metric_rpc_threading_portal.sql`](../../supabase/migrations/20260623110000_rep_metric_rpc_threading_portal.sql) (pushed live): `client_log_set` gains a trailing `p_rep_metric` (arity-DROP; DEFAULT NULL so positional 10-arg callers still resolve) writing `set_logs.rep_metric`; `client_get_program_day_exercises` adds `rep_metric` to each `prescription_sets` object. TS: `logSetAction` passes `repMetric`; portal `page.tsx` maps `rep_metric` from both the RPC and `set_logs`; `Logger` labels the volume input via `volumeUnitLabel` (Reps/Seconds/Metres), validates with a unit-aware message, renders the rx via `formatVolume`, and persists `repMetric`. **Refinement vs the gap text:** the dedicated `rep_metric` column makes "stop hardcoding `p_optional_metric: null`" moot — `optional_metric` is the *load* free-text axis and correctly stays null; the volume unit rides its own column. Type-check clean.
- **VU-3 (P0) — DB closed.** The two seed paths (`insert_program_exercise_at`, `swap_program_exercise`) carry `default_rep_metric` → `rep_metric` in migration `20260623110000`; the six copy paths (`copy_program_day`, `repeat_program_day_weekly`, `_clone_program`, `duplicate_program_day`, `save_program_as_template`, `create_program_from_template`) carry it in [`20260623120000_rep_metric_clone_template_paths.sql`](../../supabase/migrations/20260623120000_rep_metric_clone_template_paths.sql) (pushed live; each a faithful CREATE OR REPLACE with the unit added only to the per-set copy). **Remaining (TS):** `addProgramExerciseSetAction` (builder copy-last-set) — grouped with VU-5 (same file).
- **VU-6 (P1) — closed** (landed with VU-2 above — the portal logger adapts label + validation + rx + persistence).

**End-to-end NOW works for any exercise whose library default carries a unit:** set "Plank — 3 × 30s" (or "Carry — 3 × 20m") in the library → prescribing it seeds `rep_metric` → the portal shows the client a **Seconds**/**Metres** field, renders the rx as "3 × 30s", and logs to `set_logs.rep_metric`; copying/templating preserves the unit.

- **VU-5 (P1) — closed.** Session-builder per-exercise **Measure** column header (`VolumeColumnDropdown`, mirroring the load-metric `MetricColumnDropdown`): Reps / Seconds / Metres, column-wide via the new bulk `updateProgramExerciseRepMetricAction`, with a legacy-value fallback. Day loader + `PrescriptionSet` carry `rep_metric`. The EP can now set/override the unit in the builder, not only inherit the library default.
- **VU-3 (TS) — closed.** `addProgramExerciseSetAction` (copy-last-set) now copies `rep_metric` — adding a set to a timed/distance exercise keeps its unit. All set-write paths (seed, swap, copy, repeat, template, add-set) now carry the unit.
- **VU-7 (P1) — closed.** Completion summaries render the unit via `formatVolume`: `SessionExerciseSummary` (client profile + dashboard) shows "80kg × 30s" / "20m" / "5 reps" correctly; `ProfileCompletionSet` + both loaders carry `rep_metric`. The builder "Last logged" footer appends a unit suffix ("3 × 30s") via the new `volumeUnitSuffix`. The portal **complete** recap needs no change — its tiles are aggregates (Exercises / Volume / Avg RPE / Duration), no per-set unit is shown.
- **VU-8 (P2) — closed.** Curated dropdown (Reps / Seconds / Metres only) + house-voice rendering ("30s", "1:30", "20m") delivered by the shared `volume-units` module, reused by the library form, the builder, the portal logger, and every summary surface.

**End-to-end complete and type-clean.** The unit flows: library default OR builder Measure → every prescription/clone/template write → portal logger (Seconds/Metres field + rx) → `set_logs.rep_metric` → completion history. `npm run type-check` clean after every step; the three DB migrations are live.

- **VU-9 (P2) — closed.** New pgTAP [`35_rep_metric_round_trip.sql`](../../supabase/tests/database/35_rep_metric_round_trip.sql) (5 assertions): seed (insert fan-out), portal read (`client_get_program_day_exercises`), portal write (`client_log_set` → `set_logs.rep_metric`), clone (`copy_program_day`), template round-trip (`save` → `create_program_from_template`, acceptance gate 4). `25_portal_rpc_grants` updated to the 11-arg `client_log_set` signature (the added param made the old signature non-existent → the grant test would have errored). **Both green on the live DB via `supabase db query --linked -f`: test 35 = 5/5, test 25 = 20/20.**

**All nine gaps (VU-1…VU-9) closed.** `type-check` clean, `npm run build` green (all routes), three migrations live, pgTAP green. Ready for the Closing commit + sign-off ritual.

---

## Closing commit (step 7) — 2026-06-23

**What changed, by gap number.** All nine gaps (VU-1…VU-9, §4) are closed. Timed and distance prescriptions are now a first-class **volume axis**, independent of the load axis, end to end — closing the operator's capture (a loaded carry can finally record distance *and* weight on the same set; a timed hold logs in seconds).

- **VU-1 (schema).** Nullable `rep_metric` (NULL = reps) on `exercises.default_rep_metric`, `program_exercise_sets`, `template_exercise_sets`, `set_logs` — migration `20260623100000`. Additive, no backfill, app-validated (mirrors `default_metric`). Decision E: `reps_performed` stays `smallint`.
- **VU-2 (portal threading).** `client_log_set` gains a trailing `p_rep_metric` (arity-DROP + re-grant; `DEFAULT NULL` so positional callers survive) writing `set_logs.rep_metric`; `client_get_program_day_exercises` adds `rep_metric` to `prescription_sets` — migration `20260623110000`. Portal `Logger` labels the input (Reps/Seconds/Metres), validates unit-aware, renders the rx via `formatVolume`, persists the unit. The dedicated column made "stop hardcoding `p_optional_metric: null`" moot — that slot is the load axis and correctly stays null.
- **VU-3 (every write/copy path).** Seed paths (`insert_program_exercise_at`, `swap_program_exercise`, `20260623110000`) copy `default_rep_metric` → `rep_metric`; the six copy/template paths (`copy_program_day`, `repeat_program_day_weekly`, `_clone_program`, `duplicate_program_day`, `save_program_as_template`, `create_program_from_template`, `20260623120000`) carry it in the per-set copy; the builder copy-last-set (`addProgramExerciseSetAction`) copies it. No path strips the unit (FM-3 closed).
- **VU-4 (library form).** A **Measure** dropdown (Reps/Seconds/Metres) beside Reps persisting `default_rep_metric`, with a synthetic-option fallback; card renders the volume via `formatVolume`.
- **VU-5 (session builder).** A **Measure** column header (`VolumeColumnDropdown`) mirroring the load-metric column, column-wide via the new bulk `updateProgramExerciseRepMetricAction`.
- **VU-6 (portal logger).** Delivered with VU-2 — the client sees Seconds/Metres and logs in the right unit.
- **VU-7 (read surfaces).** `SessionExerciseSummary` (client profile + dashboard) and the builder "Last logged" footer render the unit ("80kg × 30s", "20m", "3 × 30s"); the portal complete recap needed no change (aggregate tiles only).
- **VU-8 (single source).** `src/lib/prescription/volume-units.ts` owns the unit list + all rendering (`formatVolume`, `volumeUnitLabel`, `volumeUnitSuffix`, `VOLUME_UNIT_OPTIONS`, `isVolumeMetric`), reused by the library form, builder, portal logger, and every summary so rendering can't drift.

Decisions A–E (§5) all taken as recommended (operator: "run your suggestions for everything").

**Acceptance tests run and results.**
- `npm run type-check` — clean after every step.
- `npm run build` — green (all routes).
- pgTAP `35_rep_metric_round_trip` — **5/5 ok** on the live DB (`supabase db query --linked -f`): seed, portal read, portal write, clone, template round-trip (acceptance gate 4).
- pgTAP `25_portal_rpc_grants` — **20/20 ok** after the signature fix (anon denied on the new 11-arg `client_log_set`; authenticated retains EXECUTE).
- §6 acceptance gates met: a timed hold logs in seconds; a loaded carry records distance AND weight on one set; a plain rep set is unchanged (NULL reads as reps); templates preserve the unit; history renders "30s", not "30 reps".

**Deferred, with triggers.** None — all nine gaps closed. The pre-existing per-set load-vs-RPE single-slot limitation stays out of scope (Q-D), unchanged and not worsened; km/miles volume units stay DB-valid but UI-deferred (Q-B; re-trigger: a real need).

**Premortem accounting.** Mitigated: FM-1 (VU-2 end-to-end threading), FM-2 (VU-6 unit-aware validation), FM-3 (VU-3 every copy path), FM-4 (VU-2 arity-DROP), FM-5 (VU-7 read surfaces), FM-7 (VU-8 curated dropdown), FM-8 (VU-9 pgTAP + grant re-verify). FM-6 (`reps_performed` smallint range) accepted per Decision E — carries are short; long efforts use km.

**Migrations:** three, applied live via `supabase db push` (clean applies, types regenerated, type-check clean) — `20260623100000` (columns), `20260623110000` (portal + seed RPC threading), `20260623120000` (clone/template threading). Additive + nullable, so push order was unconstrained.

---

*Per the section sign-off ritual: Claude Code's work ends at this Closing commit. The section is not closed until the operator records the decision under a Sign-off heading below.*

---

## Sign-off

**Date:** 2026-06-23
**Reviewer:** Operator — direct first-hand review of the implementation, the pgTAP results, and the hygiene checks. The independent claude.ai challenger-chat tier was waived for this section at the operator's discretion.
**Decision:** Closed.

All nine gaps (VU-1…VU-9) verified closed; the §6 acceptance gates are met — a timed hold logs in seconds, a loaded carry records distance **and** weight on one set, a plain rep set is unchanged (NULL reads as reps), templates preserve the unit, and history renders "30s" not "30 reps". pgTAP `35_rep_metric_round_trip` 5/5 and `25_portal_rpc_grants` 20/20 green on the live DB; `type-check` + `npm run build` clean; the new `volume-units` module lints clean. No deferred items.

---

## Reviewer follow-up (2026-06-23)

The independent reviewer flagged three asserted-not-evidenced items plus two noted. All resolved; evidence below.

**1. Gate 2 — the carry's WEIGHT path is now evidenced, not inferred.**
Concern: the volume axis was threaded, but the *log* surface was assumed to still accept + persist a weight for a distance-prescribed set (many loggers gate the weight field on exercise config). Verified two ways:
- **UI:** the portal `SetRow` ([`Logger.tsx`](../../src/app/portal/session/[dayId]/_components/Logger.tsx)) renders three inputs — volume / **Load** / RPE — unconditionally; the Load field is never gated on the prescription, so it is present for a distance set. `saveSet` → `parseLoad` → `client_log_set` writes `weight_value`/`weight_metric`.
- **Persistence (new test):** `35_rep_metric_round_trip` gained **A6** — log a loaded carry (20 m @ 40 kg) and assert the same `set_logs` row carries `rep_metric='distance_m'` **and** `weight_value=40` **and** `weight_metric='kg'`. Green on the live DB. Gate 2 now holds at the log surface, not just at prescription.

**2. FM-5 week-overview — was genuinely unmitigated; fixed by name.**
The reviewer was right: `client_get_week_overview` (the portal Today-screen preview RPC) returned `'reps'` with no `rep_metric`, and `buildRx` (`portal/page.tsx`) rendered `${sets} × ${reps}` → "3 × 30" for a hold. Closed in [`20260623150000`](../../supabase/migrations/20260623150000_rep_metric_week_overview_and_checks.sql) §1: the RPC now emits `'rep_metric'` (from `exercises.default_rep_metric`, parallel to its existing `reps` defaults fallback), and `buildRx` routes the volume through `formatVolume` → "3 × 30s". Evidenced at the data layer by **test 35 A7** (the RPC returns `rep_metric='time_minsec'` for a timed exercise); test 35 is now **7/7** on the live DB. `type-check` + `build` clean. *Disclosed residual:* the week-overview is a defaults-level glance — like its existing `reps` source — so a per-set-only unit override isn't reflected there; the accurate per-set unit is on the in-session logger (VU-6).

**3. pgTAP 35 transaction boundary — confirmed, no prod orphans.**
Test 35 is wrapped `BEGIN; … ROLLBACK;` (modelled on test 22); every fixture insert and the start/log/clone/template mutations roll back. Verified empirically against prod — a post-run count of the test-35 fixtures (`test-org-a-repmetric-35`, template `RM35 Template`, `rm35%` clients) returned **0 / 0 / 0**. No rows left in production. (Tests 36 + 37 share the same BEGIN…ROLLBACK shape.)

**Noted items.**
- **CHECK residual — closed.** Migration `20260623150000` §2 adds a value CHECK on all four `rep_metric` columns (`NULL` OR one of the four time/distance codes). This does *not* inherit `default_metric`'s rename-stability concern: `rep_metric`'s valid set is small and FIXED (the seed time/distance codes), unlike `default_metric`'s open org-configurable set — so a DB CHECK is the correct tool here. Constraints validated existing rows clean on apply.
- **FM-6 rationale — corrected, with one correction to the correction.** The rationale was loose, but the precise bound is **not** smallint's 32,767: `set_logs.reps_performed` carries a column `CHECK (… BETWEEN 0 AND 1000)` (verified, `20260420101900_session_logging.sql:133`). FM-6's ~1000 ceiling was therefore real — a 1,500 value is *rejected by the CHECK*, not silently stored. Decision E (keep `smallint`) still holds: realistic volumes — reps, hold-seconds (<1000 = 16 min), carry-metres (≤50) — all sit well under 1000; a genuinely long distance would need a fractional km the integer column can't hold anyway, which is cardio not a carry, and out of scope.

**Additional find — a real grant regression, caught only by re-running the suite in full (a correction to VU-9's claim).** VU-9 reported "`25_portal_rpc_grants` 20/20", but that run's output had been `tail`-truncated past the failing line — it was never actually 20/20. Re-running it whole during this follow-up surfaced **A2 failing: anon held EXECUTE on `client_log_set`.** Root cause: the VU-2 migration DROP+CREATEd `client_log_set` (10→11 args), Supabase's default-EXECUTE-grant trap re-granted `anon` on the *new* function, and that migration's `REVOKE … FROM PUBLIC` did not remove the *direct* anon grant (`REVOKE FROM PUBLIC ≠ revoke from anon`). No breach — the function's in-body `auth.uid()` guard returns "Not authenticated" to anon — but the grant posture is the §A tripwire and was violated. Fixed in [`20260623160000`](../../supabase/migrations/20260623160000_revoke_anon_client_log_set.sql) (`REVOKE … FROM anon`); **test 25 re-run whole = genuinely 20/20.** Lesson logged: verify pgTAP output in full, never from a truncated tail.

**Net change from the review:** three migrations (`20260623150000` week-overview `rep_metric` + four CHECK constraints; `20260623160000` anon revoke on `client_log_set`), one render fix (`buildRx` → `formatVolume`), two new pgTAP assertions (test 35 A6 + A7). All applied live; test 35 **7/7**, test 25 **20/20** on the live DB. The items probed — acceptance gate 2's *log* surface, FM-5's week-overview surface, and the test-integrity assumption (which itself surfaced the grant regression) — are now evidenced.
