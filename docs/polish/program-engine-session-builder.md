# Polish-pass gap analysis — Program engine and session builder

**Brief:** Client_Platform_Brief_v2.1 §5.2 (program templates), §5.3 (client programs), §5.4 (session logs), §6.5 (session builder), §6.5.1 (section titles), §6.5.2 (shared right panel), §6.5.3 (prescription); §6.2 engine-level requirements only (calendar UI itself is section 6).
**Reference prototype:** `session-builder.html` (design intent, not code to port).
**Current implementation:** [SessionBuilder.tsx](../../src/app/(staff)/clients/[id]/program/days/[dayId]/_components/SessionBuilder.tsx) (2,952 lines), [days/[dayId]/actions.ts](../../src/app/(staff)/clients/[id]/program/days/[dayId]/actions.ts), [days/[dayId]/page.tsx](../../src/app/(staff)/clients/[id]/program/days/[dayId]/page.tsx), [program-actions.ts](../../src/app/(staff)/clients/[id]/program/program-actions.ts), [day-actions.ts](../../src/app/(staff)/clients/[id]/program/day-actions.ts), [new/](../../src/app/(staff)/clients/[id]/program/new/).
**Schema:** migrations 20260420101700/101800 (templates, programs), 20260503100000–140000 (D-PROG-001/002, copy/repeat, soft delete), 20260504100000/110000, 20260507100000–100500 (per-set model, insert-at, reorder, swap), 20260508100000 (duplicate day).
**Predecessor docs:** `session-builder.md` (build Phases A–J, closed 2026-05-07 → 2026-06-11) and `programs.md` (build Phases A–F) — this pass consolidates both surfaces against the brief at the differentiator bar.
**Audit date:** 2026-06-12
**Status:** Gap document — awaiting sign-off before any code changes.

---

## 0. Executive summary

This is the differentiator pass. The build-phase work left the interaction core in genuinely strong shape: the per-set prescription model, the atomic RPC family for reorder/insert/swap, the sanctioned grouping semantics (Q1/Q2/Q3 sign-offs), and the Notes/Reports/Library adjacency are all live and correct. The audit found no rot in the things that are hardest to build.

What it did find: **one certain-likelihood data-integrity hole** — all four calendar clone paths (`copy_program_day`, `repeat_program_day_weekly`, `copy_program`, `repeat_program`) predate the per-set table and silently produce days whose exercises have **zero set rows**, which the portal then renders as empty prescriptions. The deferred-prompts entry for this under-records the blast radius (it names two RPCs; four are affected). And **one specified feature with no UI at all**: brief §5.2 program templates have a complete, RLS'd data layer that no application code touches — `program_templates` appears only in generated types. There is no cross-client program reuse anywhere in the product.

Two riders from the closed Exercise library section land here and are carried as gaps: the §6.5.2 Library tab composing the shared atoms with `onPick`, and the convergence of the two default-application paths on the RPC.

Pre-launch advantages apply to all of it: the fan-out fix is a four-function migration with no production data to repair, and the template decision can still be made cheaply.

### 0.1 Sign-off log (2026-06-12)

Gap list approved by the operator 2026-06-12. Decision questions resolved:

| # | Question | Decision |
|---|---|---|
| Q-A | G-1 scope — all four clone RPCs in one migration, supersede the two-RPC deferred-prompts entry | **Yes — as recommended.** |
| Q-B | G-2 template scope | **Option (a)** — minimal lifecycle: "Save as template" + template picker in NewProgramForm via `create_program_from_template` RPC; no management screen (deferred, trigger: >~5 templates or a template needs correcting). |
| Q-C | G-7 chip selection model | **As recommended** — atoms gain a `multiSelect` prop; library page keeps single-select; builder keeps multi-select. |
| Q-D | Concurrent-reorder race | **Accept with re-trigger as listed** (multi-practitioner UI work, or any observed reorder anomaly). No `program_days.version` OCC this pass. |

The list below is the contract. Work proceeds in §5 sequence.

### 0.2 Audit-correction note

The component audit initially flagged "consecutive section-title deduplication missing." That finding is **wrong** and is recorded here so it doesn't resurface: the list walker renders a `SectionStrip` only when the title changes from the previous exercise ([SessionBuilder.tsx:611-615](../../src/app/(staff)/clients/[id]/program/days/[dayId]/_components/SessionBuilder.tsx)), which satisfies §6.5.1's "only the first shows it." The same mechanism means the Q1/Q2 group-adopts-upper-title rule renders correctly (one strip per group), so §6.5's "second exercise's title auto-clears" is met at the rendered level even though the column value is converged rather than nulled.

---

## 1. What's already correct

### 1.1 Engine schema and invariants
- `programs` carries OCC (`version` + bump trigger), the D-PROG-002 EXCLUDE constraint preventing overlapping active programs, and cross-org enforcement triggers. `program_exercises` carries its own `version`. (20260420101800, 20260503110000.)
- `program_exercise_sets` (20260507100000) is fully dressed: partial unique index on `(program_exercise_id, set_number)`, RLS via parent walk, audit trigger, **registered in `audit_resolve_org_id()`**, soft-delete RPC with REVOKE/GRANT pattern. The Phase C work did this properly.
- The soft-delete RPC family (`soft_delete_program_day`, `soft_delete_program_exercise`, `soft_delete_program_exercise_set`) all use SECURITY DEFINER with in-body org/role guards — the documented workaround for the UPDATE-vs-SELECT-policy trap.
- Template data layer matches brief §5.2 exactly where it exists: clone-divergence is structural (`programs.template_id` SET NULL, no propagation triggers), superset group ids are remapped through a fresh-UUID CTE on every clone path. Intentionally unaudited per schema.md §11.2 ("template library, not a patient record").
- RLS policies on all eight program/template tables verified against `rls-policies.md` §4.12–4.15 — docs and migrations agree, including the post-D-PROG-001 single-hop walks.

### 1.2 Builder interaction core
- Two-column TrainHeroic card layout per §6.5: sequence badge, name, instructions, video thumbnail left; Sets/Reps/Optional table, stepper, "Last" footer right.
- Flat rows by default; always-visible `BetweenCardsBar` with Superset and + Add exercise between every pair, plus a top bar arming an at-start slot.
- Grouping: all four adjacency cases handled in `groupAcrossActionBarAction` per the Q1-A/Q2-Yes/Q3 sign-offs; ungroup reversible; sequence letters recalculate live in the walker; defensive rendering of legacy non-contiguous groups avoids React key crashes and self-heals on next reorder.
- Drag-and-drop via @dnd-kit with pointer, touch, and keyboard sensors; arrow-button fallback routes through the same `reorder_program_exercises` RPC — single-statement sort_order rewrite, group re-derivation on the moved card, singleton cleanup.

### 1.3 Prescription layer
- Per-set rows render the §6.5.3 table; metric column dropdown reads the org's `exercise_metric_units`; +/− stepper; "Last" footer surfaces prior logged performance with explicit time-ago.
- Library defaults auto-populate on add (both paths) and on swap (`swap_program_exercise` re-fans-out fresh set rows), carrying the section-4 G-3 RPE precedence rule.

### 1.4 Shared right panel
- Three tabs always visible, Notes default — the protected adjacency is intact and load-bearing.
- Swap flow: armed target, "Replacing: [name]" banner with cancel, prescription stays visible; insert-slot flow has matching "Inserting at top / after [name]" banners.
- Library tab has search plus multi-select pattern and tag chips.

### 1.5 Server actions and bootstrap
- Every mutating action opens with `requireRole(['owner','staff'])`; clone/copy actions branch on structured status enums (`created|overlap|conflict|invalid_source`) rather than try/catch; revalidation paths are consistent.
- The ten §6.5.1 default section titles are seeded at org bootstrap (20260420102400); the builder can append new titles to the org list inline.

---

## 2. Premortem — ranked failure modes

Weighting per protocol: infrastructure/security at production grade; operational/UX at friends-and-family scope.

| # | Failure mode | Likelihood | Impact | Closed by |
|---|---|---|---|---|
| FM-1 | **Cloned days and blocks have empty prescriptions.** `copy_program_day` and `repeat_program_day_weekly` (20260503120000) and `copy_program`/`repeat_program` (20260503130000) all INSERT `program_days` + `program_exercises` and **never fan out `program_exercise_sets`** — they predate the per-set table; only `duplicate_program_day` (20260508100000:190) was built after it. The portal RPC's own comment calls the empty-sets case "defensive… shouldn't happen post-Phase-C", yet every calendar copy/repeat produces it routinely. A beta client opens a copied session and sees exercises with no set rows; the builder shows an empty table; the EP's prescription silently vanished. This is the differentiator failing in front of the first real user. `docs/deferred-prompts.md` records only the two day-level RPCs — the blast radius is four. | Certain — copy/repeat is the primary programming workflow | High | G-1 |
| FM-2 | **The brief's template promise is unmet — no cross-client reuse exists.** `program_templates` and children have a complete schema, RLS, and clone-divergence semantics, but zero application code references them (generated types only). `NewProgramForm` builds from scratch only; `copy_program` always targets the source's own client (20260503130000:74-98). The first time the EP programs a standard protocol ("ACL Rehab Phase 2") for a second client, the only path is manual re-entry — the 60-second adjustment bar dies at program creation. | Certain once a second client needs a standard protocol | Medium-high — core EP workflow, brief §5.2 | G-2 |
| FM-3 | **The two default-application paths drift.** TS append path ([days/[dayId]/actions.ts:65-135](../../src/app/(staff)/clients/[id]/program/days/[dayId]/actions.ts)) vs `insert_program_exercise_at` RPC. Identical today (exercise-library §7 drift note); any future change to defaults logic that touches one and not the other produces prescriptions that differ by insert position — invisible in review, visible to clients. The append path is also three sequential statements with manual soft-delete compensation, not a transaction. | Medium over the section's lifetime | Medium | G-3 |
| FM-4 | **A builder-RPC regression ships unnoticed.** No pgTAP coverage exists for `reorder_program_exercises`, `swap_program_exercise`, `insert_program_exercise_at`'s ordering/grouping invariants, or the grouping actions (test 20 touches insert-at only for usage-count assertions). Worse: tests 10/11 (day/program copy-repeat) pass green today **without asserting set fan-out** — they would have caught FM-1 and will not catch its regression. Production-grade weighting per protocol: sequence corruption is the differentiator breaking. | Low | High | G-4 |
| FM-5 | **The section-title list accumulates junk it can never shed.** §6.5.1 requires add/remove/reorder/rename in settings; no settings surface exists (verified: no `section_title` reference under `settings/`). The builder's inline add is permanent — a typo'd title lives in every dropdown forever and renders on client-visible section strips. | Medium-high over beta lifetime | Low-medium | G-5 |
| FM-6 | **The swap flow strands the EP outside the Notes adjacency.** §6.5.2: "Select new exercise → panel returns to Notes." Actual: `handleAdd` clears the swap target and refreshes but never switches the tab back ([SessionBuilder.tsx:2658-2671](../../src/app/(staff)/clients/[id]/program/days/[dayId]/_components/SessionBuilder.tsx)). §6.5's "name blanks to 'Select exercise…'" is also unimplemented (dashed underline + banner instead). Every swap ends with the differentiator's clinical context hidden behind a manual tab click. | Certain per swap | Low | G-6 |
| FM-7 | **The Library panel is a fork, not a composition.** `LibraryPanel` ([SessionBuilder.tsx:2574-2887](../../src/app/(staff)/clients/[id]/program/days/[dayId]/_components/SessionBuilder.tsx)) reimplements search, chips, and the exercise list inline; zero imports from `library/_components`, whose atoms (`SearchInput`/`PatternChips`/`TagChips`/`ExerciseGrid` with `onPick`) were refactored in section 4 expressly for this panel. The two surfaces already disagree (multi-select vs single-select chips, 32px vs 38px search). Every future library fix lands in one place and not the other. The bottom-of-list "+ Create New Exercise" (G-11 rider placement) is also absent. | Certain over time | Low-medium | G-7 |
| FM-8 | **A failed autosave leaves silent divergence.** Field saves are blur-triggered; on failure the handler fires one `alert()` (13 sites) and the field keeps its local value with no retry affordance — the EP dismisses the alert and the screen shows a prescription the database doesn't hold. | Low (network blips) | Medium — clinical prescription mismatch | G-8 |
| FM-9 | **Design-token drift in the builder.** Hardcoded radius 12 and a `0 8px 24px` shadow on the drag ghost ([SessionBuilder.tsx:921-923](../../src/app/(staff)/clients/[id]/program/days/[dayId]/_components/SessionBuilder.tsx)) against the system's 8–10px builder-card radii and single-card-shadow rule; assorted colour literals. | Present now | Cosmetic | G-9 |

**Accepted without mitigation (rationale and re-trigger):**

- **Concurrent-reorder group race / two-tab refresh clobber.** `program_days` has no version column, so two simultaneous reorders can leave the moved card's group membership one step stale, and a second tab's `router.refresh()` can clobber in-focus edits in the first. Group re-derivation is position-deterministic, so the state self-heals on the next reorder; the beta is two staff who would have to race each other inside the same client's same day. Re-trigger: multi-practitioner UI work, or any observed reorder anomaly. (Q-D below offers the OCC option if the reviewer wants it promoted.)
- **TOCTOU window in `groupAcrossActionBarAction`.** Adjacency is read, then updated, without a lock; a reorder landing in between could group momentarily non-adjacent cards. Same self-healing and same two-staff rationale as above.
- **`repeat_program_day_weekly` two-pass validate/write loop.** Concurrent deletions between passes are reported in `no_program_dates` rather than failing; FK CASCADE prevents orphans. Document-only — a comment in the action and the migration noting the pattern is intentional.
- **`SessionBuilder.tsx` is a 2,952-line monolith.** G-7 extracts the largest seam (LibraryPanel) as a side effect; a fuller decomposition is refactor risk without behavioural gain mid-polish. Re-trigger: the next section that has to modify the builder.
- **No dirty-state navigation guard.** Blur fires before navigation completes, so the blur-autosave model leaves a negligible loss window; a `beforeunload` guard would be ceremony.
- **Per standing premortem note (view-mode/pin-state persistence):** the localStorage-vs-`practice_preferences` question attaches to the Reports view-mode and calendar rail pinning, which are profile/section-6 surfaces — surfaced here for the record, deferred to the section 6 premortem.

---

## 3. Gaps to close

### P0 — promoted per protocol (certain-likelihood failure modes, engine integrity)

| # | Gap | Detail |
|---|-----|--------|
| **G-1** | **Per-set fan-out in all four clone RPCs.** (FM-1) | One migration replacing the bodies of `copy_program_day`, `repeat_program_day_weekly` (20260503120000), and `_clone_program`'s exercise loop serving `copy_program`/`repeat_program` (20260503130000), mirroring the `INSERT INTO program_exercise_sets … SELECT … FROM source` block already proven in `duplicate_program_day` (20260508100000:190). Keep the REVOKE/GRANT pattern on the replaced functions. Extend pgTAP tests 10 and 11 with set-row count and content assertions so the regression is caught next time (fold of G-4's highest-value case). Supersede the under-scoped `docs/deferred-prompts.md` entry ("Calendar copy/repeat: per-set fan-out fix") — it names two RPCs; four are affected. |
| **G-2** | **Resolve the template gap — decision required.** (FM-2) | Brief §5.2 is specified, data-layer-ready, and UI-absent. **Options:** (a) *recommended* — minimal lifecycle this pass: a "Save as template" action on an existing program, and a template picker step in `NewProgramForm` that clones template → client via a new `create_program_from_template` RPC (same shape as `_clone_program`: fresh superset UUIDs, target client + start date, EXCLUDE-overlap handling). No management screen — rename/delete/archive of templates defers to a settings surface with its own trigger. (b) defer entirely, trigger: "the EP needs the same protocol on a second client" — honest, but that trigger fires almost immediately after launch and re-opens a closed section. (c) full template management screen — rejected at friends-and-family scope. |

### P1 — functional (specified in the brief or carried riders, missing)

| # | Gap | Detail |
|---|-----|--------|
| **G-3** | **Converge default application on the RPC.** (FM-3; exercise-library rider 2) | Retire the TS append path's three-statement insert+fan-out ([days/[dayId]/actions.ts:65-135](../../src/app/(staff)/clients/[id]/program/days/[dayId]/actions.ts)) in favour of `insert_program_exercise_at`, extended to accept an append mode (anchor = day's last live exercise, resolved in-function). Before deletion, verify RPC parity with the TS path on every inherited field including the section-4 G-3 RPE precedence rule — both paths must produce identical rows for the same exercise. Atomicity comes free. |
| **G-4** | **pgTAP coverage for the builder RPC family.** (FM-4) | New test file(s) covering: `reorder_program_exercises` (happy path, cross-org deny, mismatched-id-array raise, group re-derivation on the moved card, singleton cleanup), `insert_program_exercise_at` (sort_order shift, set fan-out, group-inheritance rule, append mode from G-3), `swap_program_exercise` (old sets soft-deleted, fresh fan-out from new exercise's defaults). JWT-spoof fixtures per project convention — no SECURITY DEFINER bypass helpers. Tests 10/11 set-row assertions land with G-1. |
| **G-5** | **Section-titles management in Settings.** (FM-5; §6.5.1) | Add/remove/reorder/rename editor following the established settings precedent (session-types, note-templates editors). Safe by construction: `program_exercises.section_title` is a plain text column, not an FK — removing or renaming a title changes the dropdown only and never touches existing program data. Renames should offer no retroactive rewrite (the program is a living document; historical labels stand). |
| **G-6** | **Complete the §6.5.2 swap contract.** (FM-6) | On successful swap: `setTab('notes')` alongside the existing `setSwapTarget(null)`. While a swap is armed: the target card's name renders "Select exercise…" (brief-literal) in place of the current dashed-underline-only treatment, reverting on cancel. Two small changes; both brief-explicit. |
| **G-7** | **Library tab composes the shared atoms + create CTA.** (FM-7; exercise-library rider 1, G-11 placement) | Replace `LibraryPanel`'s inline search/chips/list with `SearchInput` + `PatternChips` + `TagChips` + `ExerciseGrid` (list layout) wired to `onPick(exerciseId)` → existing add/swap/insert-slot handlers. Selection model per Q-C below. Add "+ Create New Exercise" at the bottom of the list, linking to `/library/new` (new tab or return-path query — implementation's choice, must not lose builder state). Side effect: removes ~370 lines from the monolith. |

### P2 — polish (design system, feedback, affordances)

| # | Gap | Detail |
|---|-----|--------|
| **G-8** | **Save-failure honesty on autosave fields.** (FM-8) | On a failed field save: revert the input to the last-known server value and show the inline error border with a brief message — never leave a local value the database doesn't hold. Field-level failures stop using `alert()`; destructive-action `confirm()`/`alert()` stays (established staff-surface pattern, accepted in the exercise-library pass). |
| **G-9** | **Token sweep on the builder.** (FM-9) | Radius 12 → the sanctioned 8–10px builder-card value; drag-ghost `0 8px 24px` shadow reconciled against the single-card-shadow rule (return to the PDF — if motion affordance during drag is sanctioned nowhere, it goes); colour literals → `globals.css` tokens. |
| **G-10** | **Red ✘ clear affordance for section titles.** (§6.5.1) | Brief-explicit ("click ✘ (always red) to clear"); current implementation is a native `<select>` with a "(— Section —)" none option. Recommend implementing the ✘ beside the title field per brief and prototype; if the reviewer prefers the quieter native-select-only treatment, record the deviation here rather than silently keeping it. |

---

## 4. Decision questions for sign-off

| # | Question | Recommendation |
|---|---|---|
| Q-A | G-1 scope: fix all four clone RPCs in one migration and supersede the two-RPC deferred-prompts entry? | Yes — same migration, same fan-out block, one pgTAP extension; splitting them invents a second deferral for half a bug. |
| Q-B | G-2 template scope: option (a) minimal lifecycle now, or (b) defer with trigger? | **(a).** The data layer is finished and tested by construction; the UI is a form step plus one RPC. Option (b)'s trigger fires almost immediately and re-opens this section post-closure. |
| Q-C | G-7 chip selection model: the builder panel is multi-select, the library page atoms are single-select. | Atoms gain a `multiSelect` prop; the library page keeps single-select (closed section untouched), the builder keeps multi-select. Unifying either way changes a signed-off surface or removes builder capability. |
| Q-D | Concurrency: accept the reorder/group race with re-trigger as listed, or promote to a gap (`program_days.version` + OCC check in `reorder_program_exercises`)? | Accept with re-trigger at two-staff scale; the failure self-heals and the fix is cheap to add later. Reviewer may promote — it is a one-migration change while pre-launch advantages hold. |

---

## 5. Proposed sequencing (on approval)

1. **G-1** — engine integrity first; includes tests 10/11 set-row assertions. Nothing else in the pass is trustworthy while clone paths corrupt prescriptions.
2. **G-3** — converge add paths on the RPC (append mode added), so later work lands on the final path.
3. **G-7** — compose the Library tab atoms (`onPick` wires to the converged path) + create CTA.
4. **G-2** — template lifecycle per Q-B decision (independent of 2–3; sequenced after so the builder surface is stable while the engine grows a new RPC).
5. **G-5** — settings editor for section titles.
6. **G-6** — swap-contract completion.
7. **G-4** — builder-RPC pgTAP family (written alongside 1–4 where natural, finalised after the engine stops moving).
8. **G-8, G-9, G-10** — polish tier.

Architecture before features, features before polish, per protocol step 6.

---

## 6. Acceptance gates

- Full pgTAP suite green, including: extended tests 10/11 asserting set-row fan-out on every clone path; the new builder-RPC test file(s) (G-4).
- Manual matrix on :3000 — copy a day, repeat a day weekly, copy a block, repeat a block: every produced day opens in the builder with full set tables and renders complete prescriptions in the portal session view.
- Add-exercise via append, at-start, after-anchor, and swap produce identical set rows for the same exercise (G-3 parity check, asserted in pgTAP).
- Library tab: search, pattern chips, tag chips, pick-to-add, pick-to-swap, create CTA — all function with the composed atoms; the standalone library page is behaviourally unchanged.
- Swap ends on the Notes tab; armed swap shows "Select exercise…".
- If Q-B (a): create program from template for a *different* client; verify divergence (edit the template afterwards, confirm the client program is untouched) and superset-group remapping.
- Section titles: rename/remove/reorder in settings reflected in the builder dropdown; existing program day labels untouched.

---

## 7. Out of scope (deliberate)

- **Calendar UI (§6.2)** — Copy Week / Repeat Specific toolbar treatment, side-panel pinning, month-view polish: section 6. The engine-level RPCs those buttons call are in scope here (G-1).
- **Portal session rendering (§6.3.1)** — section 7. Rider below for its defensive empty-prescription rendering.
- **Template management screen** (rename/delete/archive templates) — deferred even under Q-B (a); trigger: more than ~5 templates exist, or a template needs correcting.
- **Full SessionBuilder decomposition** — accepted above; G-7 takes the largest seam.
- **`program_weeks` periodisation editor** — D-PROG-003 deferral stands.

---

## 8. Implementation log (2026-06-12)

**G-1 — closed.** Migration `20260612100000_clone_rpcs_per_set_fanout` replaces `copy_program_day`, `repeat_program_day_weekly`, and `_clone_program` with per-set fan-out (the `cloned AS (INSERT … RETURNING)` + sort_order pairing pattern proven in `duplicate_program_day`). Two findings beyond the gap as written:

1. **The `repeat_program_day_weekly` superset remap was Cartesian-broken** — its one-pass `SELECT DISTINCT superset_group_id, gen_random_uuid()` never deduplicated (volatile uuid), so repeating a day holding an N-member superset inserted N copies of every grouped exercise with mismatched fresh group ids, on every target date. The §2 `copy_program_day` comment in the same migration documents this exact trap; §3 fell into it. Fixed with the dedupe-then-uuid subquery. Test 10 previously asserted only the created-day count on this path, which is why it stayed green.
2. **First push failed on a stale base**: the §3 rewrite was initially drafted from `_clone_program`'s original definition (20260503130000), which still references the `program_type` enum dropped in 20260504130000. Rebased onto the 20260504130000 replacement. Lesson recorded in the migration header: diff against the latest replacement of a function, not the file that created it.

Verification: `supabase db push` clean; pgTAP test 10 extended 14 → 20 assertions (fan-out count, pairing guard, exercise-count Cartesian guard, group cohesion per repeated day), test 11 extended 9 → 12 (fan-out on block copy and repeat, pairing guard) — **all 32 green** against the live project via `supabase db query --linked -f` (BEGIN/ROLLBACK batch). Types regenerated, no drift (signatures unchanged). `docs/deferred-prompts.md` entry marked CLOSED/superseded with the four-path correction. No backfill, per the deferred-prompts recommendation (pre-launch, no real data).

**G-3 — closed.** Migration `20260612110000_insert_program_exercise_at_append` extends the RPC with an explicit `p_slot` (`'append' | 'at_start' | 'after'`); the old 3-arg signature is DROPPED first per the arity-evolution rule (CREATE OR REPLACE would have left both overloads live). `p_slot NULL` preserves the legacy contract exactly — pgTAP test 20's positional NULL-anchor call re-run green without edits (assertion 16 exercises the RPC directly). `addExerciseToDayAction` now routes all three slots through the RPC; the TS-side three-call append sequence (read defaults → insert parent → fan out sets, with soft-delete compensation) is deleted — one default-application path remains, atomic. Field parity verified by inspection before deletion: both paths applied `GREATEST(1, default_sets)` fan-out with default reps/metric/value and parent-row rest/instructions; RPE rides `default_metric='rpe'` post-20260612090100, so no special-casing exists to diverge. Types regenerated (`p_after_pe_id`/`p_slot` now optional); `tsc --noEmit` clean. Append slot exercised in the browser in the end-of-pass verification matrix; the G-4 test file adds slot-level pgTAP coverage.

**G-7 — closed.** New `_lib/exercise-query.ts` in the library module holds the shared select (`LIBRARY_EXERCISE_COLUMNS`) and `toLibraryExercises` mapper; both the standalone library page and the session-builder day loader now use it — one query shape, one card mapping. `PatternChips`/`TagChips` gained the Q-C `multiSelect` mode (union props; single-select default untouched, so the closed library section is behaviourally unchanged) plus a `dense` variant for the 320px panel; `SearchInput` gained `dense`. The right-panel Library tab is now its own component ([LibraryPanel.tsx](../../src/app/(staff)/clients/[id]/program/days/[dayId]/_components/LibraryPanel.tsx)) composing SearchInput + PatternChips + TagChips + ExerciseGrid with `onPick` → the existing add/swap/slot handlers; the inline fork and its `FilterChipRow` are deleted (−380 lines from the SessionBuilder monolith). Bottom-of-list "+ Create New Exercise" links to `/library/new` (same-tab; all builder edits are autosaved so nothing is lost — armed slot state is the only reset). Drive-by: removed the stale `loadPublicationsForClient` import in the day page (pre-existing lint warning, unused since the Phase J.2 inline query). Browser-verified on :3000 via the throwaway-staff-user pattern: atoms render (9 pattern chips, 5 tag chips, 28 picker cards, create CTA), multi-select + AND-across/OR-within filtering + reset all work, pick-to-add appends through the G-3 RPC with set fan-out confirmed in the DB.

**G-6 — closed.** Three §6.5.2 contract completions: (1) default right-panel tab is now **Notes** (was `library` since the first scaffold — the audit had missed this; the brief is explicit, and clinical context visible while programming is the differentiator's thesis; the empty-day state still routes to the library in one click and arming any slot/swap force-switches the panel); (2) a successful swap returns the panel to Notes via the new `onSwapComplete` callback; (3) while a swap is armed the target card's name blanks to the brief-literal "Select exercise…" (italic, muted), restoring on cancel. Browser-verified end-to-end: name blanked, "Replacing: [name]" banner shown, panel auto-switched to Library, pick replaced the card in place (sort_order preserved, fresh per-set fan-out from the new exercise's defaults confirmed in the DB), and the panel landed back on Notes.

**G-2 — closed (Q-B option a).** Migration `20260612120000_program_templates_lifecycle` lands the minimal template lifecycle. **One addition beyond the gap as written, flagged per the scope rule:** a `template_exercise_sets` table (mirror of `program_exercise_sets`: partial unique index, touch trigger, Pattern-C RLS via the four-hop template walk, deny-delete; intentionally unaudited per schema.md §11.2). The template tables predate the per-set model exactly as the clone RPCs did (G-1) — without the mirror, saving a pyramid prescription (12/10/8) would collapse to "3 × 12" through the save→instantiate round trip. Fidelity is the point of a template; the table is the cost of correctness, not new scope. Two RPCs: `save_program_as_template` (week derivation from `scheduled_date`; `template_days.sort_order` repurposed as weekday offset 0–6 so instantiation reproduces the weekday rhythm — convention documented in the migration header; case-insensitive `duplicate_name` status) and `create_program_from_template` (any client in org, duration from deepest live week, EXCLUDE-overlap → `overlap` status, `programs.template_id` stamped for provenance only). UI: "Save as template" in the program toolbar (name dialog defaulting to block name; success notice; duplicate/invalid errors) and a "Start from" picker on `/program/new` (template selected → duration/schedule/notes sections drop out, name optional defaulting to template name, action routes through the RPC; blank-block flow untouched). New pgTAP test 21 (15 assertions): save round trip incl. weekday offsets and per-set pairing, duplicate name, cross-client instantiate with rhythm/pairing/fresh-group checks, overlap, **divergence (template edit does not propagate — the brief §5.2 clinical-safety promise)**, cross-org deny, client-role deny — all green. Browser-verified: toolbar dialog → success notice; picker showed the saved template with derived duration; form collapsed to template mode; created a 4-week, 14-day, 29-set-row program for a *different* client with provenance stamped. Verification artifacts soft-deleted. Template management (rename/delete) stays deferred per the gap list — trigger: >~5 templates or a template needs correcting.

---

## 9. Riders to other sections (recorded, not actioned here)

- **Section 6 (Program calendar):** the calendar toolbar's copy/repeat affordances should re-verify against the G-1-fixed RPCs; the view-mode/pin-state persistence question (localStorage vs `practice_preferences`) is surfaced at that section's premortem per the standing note.
- **Section 7 (Client portal):** keep `client_get_program_day_exercises_v2`'s empty-`prescription_sets` defensiveness even after G-1 (defence in depth), and decide what the logging flow renders if it ever occurs.
- **Go-live checklist:** no new entries — the SECURITY DEFINER grant sweep already indexes the program RPC families; G-1/G-2/G-3's new or replaced functions must keep the REVOKE-from-PUBLIC / in-body-guard pattern that sweep verifies.
