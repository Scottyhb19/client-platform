# Polish-pass gap analysis — Exercise Library

**Brief:** No standalone MD. Target state from [`Client_Platform_Brief_v2.1.docx`](../../Client_Platform_Brief_v2.1.docx) §5.1 (data model), §6.5.2 (Library tab inside session builder), §6.5.3 (prescription metric dropdown), §6.6 (standalone Library screen), §10 (CRUD listed).
**Current implementation:** [`page.tsx`](../../src/app/(staff)/library/page.tsx), [`LibraryView.tsx`](../../src/app/(staff)/library/_components/LibraryView.tsx), [`ExerciseLibrary.tsx`](../../src/app/(staff)/library/_components/ExerciseLibrary.tsx), [`new/page.tsx`](../../src/app/(staff)/library/new/page.tsx), [`new/_components/NewExerciseForm.tsx`](../../src/app/(staff)/library/new/_components/NewExerciseForm.tsx), [`new/actions.ts`](../../src/app/(staff)/library/new/actions.ts), [`new/types.ts`](../../src/app/(staff)/library/new/types.ts)
**Schema:** [`movement_patterns`](../../supabase/migrations/20260420101100_movement_patterns.sql), [`exercise_metric_units`](../../supabase/migrations/20260420101300_exercise_metric_units.sql), [`exercise_tags`](../../supabase/migrations/20260420101400_exercise_tags.sql), [`exercises`](../../supabase/migrations/20260420101500_exercises.sql), [`exercise_tag_assignments`](../../supabase/migrations/20260420101600_exercise_tag_assignments.sql)
**Settings precedent:** [`LookupManager`](../../src/app/(staff)/settings/_components/LookupManager.tsx) (already wired for `exercise_tags` at [settings/page.tsx:163](../../src/app/(staff)/settings/page.tsx))
**Audit date:** 2026-05-05
**Status:** Gap document — awaiting sign-off before any code changes.

---

## 0. Executive summary

The exercise-library schema is well-designed, soft-deleted, indexed and cross-org-trigger-protected — preserve it as-is. The standalone library screen has the right scaffolding (server fetch → client view with tabs → search + chip filters → card grid + create form) but five things are either lying, missing, or violating a load-bearing rule:

1. **No edit, no delete.** The card's `MoreHorizontal` icon and `cursor: pointer` are both lying — they look interactive and do nothing. Brief §10 lists CRUD as v1.
2. **`default_metric` (unit) is silently NULL on every exercise** because the create form has no unit dropdown. Brief §6.5.3 specifies the metric-first picker. This will break the session-builder auto-populate downstream.
3. **No settings UI for movement patterns.** `exercise_tags` are EP-editable via `LookupManager` in Settings; `movement_patterns` are not, even though the brief flags them as customisable.
4. **No audit coverage** on any of the five library tables. Pre-launch this is cheap; post-launch it's a one-way door.
5. **Inline-style numerics violate the design-token rule.** All three components hardcode padding, radius and font-size values that should live in CSS vars. Same project-wide pattern, but the polish pass IS the moment to bring this section to bar.

The four-tab shell (Exercises / Circuits / Sessions / Programs) **stays** — circuits/sessions/programs are imminent features the EP needs (per Q-A sign-off). The placeholder cards stay too, with copy tightened.

The "Import CSV" button is dead UI not in the brief — drop it.

The Library inline-panel mode inside the session builder (brief §6.5.2) is **deferred** to the session-builder polish pass (#5 in the order). Build the standalone screen as composable pieces (search input, chips, card, list) so the session-builder Library tab can import them later without rebuild.

Pre-launch advantages apply throughout: schema migrations are cheap, RLS changes are reversible, no client data to migrate.

### 0.1 Sign-off log (chat 2026-05-05)

| # | Question | Answer | Notes |
|---|----------|--------|-------|
| A | Tab shell scope | **A1** — keep four-tab shell (Exercises / Circuits / Sessions / Programs). Circuits + sessions + programs ship soon; better to keep the shape than churn the IA. | |
| B | Edit + delete | **B1** — include in this pass. Edit page mirrors the new form; delete via soft-delete RPC + confirm dialog. | |
| C | `default_metric` selector | **Yes** — load from `exercise_metric_units` so the choice respects per-org config. | Order per brief §6.5.3: kg, time (min:sec), distance (m), %, RPE, tempo, bodyweight, lb, miles, km. |
| D | Patterns + units settings UI | **D3** — add `LookupManager` for movement patterns now; defer metric units. | EPs realistically customise patterns; metric units are universal and unused as a customisation surface today. |
| E | Audit coverage | **Yes** — register the five library tables in `audit_resolve_org_id()` and attach `log_audit_event` triggers. | |
| F | Inline-style refactor | **F1** — refactor in this pass, pragmatically. Add missing tokens to `globals.css`; replace literal numerics with CSS vars in the three library components. Don't rebuild components into CSS modules. | |
| G | Library inline panel inside session builder | **Defer** to session-builder polish pass (#5). Build standalone screen as composable pieces so the inline panel can import them later. | |
| H | Import CSV button | **Drop it.** Not in the brief; disabled today; "import from what?" undefined. | |

---

## 1. What's already correct

Pieces of the existing implementation that align with the target state and should be preserved.

### 1.1 Schema layer
All five tables are well-shaped:
- `organization_id` on every row; `deleted_at` soft-delete on every table; `updated_at` touched by trigger.
- Cross-org enforcement: [`exercises_enforce_pattern_org`](../../supabase/migrations/20260420101500_exercises.sql) trigger and the bespoke [`enforce_exercise_tag_assignment_same_org`](../../supabase/migrations/20260420101600_exercise_tag_assignments.sql) trigger that walks both parents.
- Index coverage: alphabetical (`exercises_org_name_idx`), pattern filter (`exercises_movement_pattern_idx`), trigram search (`exercises_name_trgm_idx`), usage-sorted ranking (`exercises_usage_idx`).
- `default_metric` stored as text code (not FK) so unit renames don't ripple into historical exercise rows — correct call.

### 1.2 Server fetch shape
[`page.tsx`](../../src/app/(staff)/library/page.tsx) fetches exercises + patterns + tags in parallel with the right joins (`movement_patterns` for the pattern label, `exercise_tag_assignments → exercise_tags` for tag chips). Filters out soft-deleted rows. Server Component with `force-dynamic` + Client Component for state. Architecture is right.

### 1.3 Search + chip filter UX
Client-side filter (`useMemo` over the fetched list) is fine for the brief's "~200 exercises" scale. Pattern chips toggle single-select; tag chips toggle single-select; both compose with the search query. The filter shape itself is correct.

### 1.4 Tag-management settings precedent
[`LookupManager`](../../src/app/(staff)/settings/_components/LookupManager.tsx) at [settings/page.tsx:163](../../src/app/(staff)/settings/page.tsx) already wires `exercise_tags` for create/rename/delete. Movement patterns drop into the same component without rebuild.

### 1.5 Create form sectioning
[`NewExerciseForm`](../../src/app/(staff)/library/new/_components/NewExerciseForm.tsx) splits into Basics / Default prescription / Coaching cues / Tags. The grouping matches how an EP thinks about an exercise. Section structure stays; the missing unit dropdown drops into "Default prescription" (P1-3).

### 1.6 Card content composition
The card surfaces the right facts: name, movement pattern, usage count, prescription summary (`{sets} × {reps} · {load} · RPE {n}`), tag chips, video indicator. The information hierarchy is correct — what's wrong is the inline-style execution and the lying click affordance.

---

## 2. Gaps to close

### P0 — Architectural (non-negotiable)

These either break a load-bearing rule from CLAUDE.md or block downstream UI work.

| # | Gap | Why it matters |
|---|-----|----------------|
| **P0-1** | **No soft-delete RPCs for library tables.** Per project memory, UPDATE setting `deleted_at` fails 42501 against the `deleted_at IS NULL` SELECT policy. Need `soft_delete_exercise()`, `soft_delete_movement_pattern()`, `soft_delete_exercise_tag()`. (`exercise_tag_assignments` cascade-deletes via FK; `exercise_metric_units` has no UI delete in this pass.) | Without RPCs, B1 (edit + delete) cannot ship. Pattern is established in [`20260429120000_soft_delete_rpcs.sql`](../../supabase/migrations/20260429120000_soft_delete_rpcs.sql) and [`20260429130000_soft_delete_rpcs_clients_and_program_exercises.sql`](../../supabase/migrations/20260429130000_soft_delete_rpcs_clients_and_program_exercises.sql); mirror the shape. |
| **P0-2** | **Audit log doesn't cover the library.** `audit_resolve_org_id()` CASE list omits `exercises`, `movement_patterns`, `exercise_tags`, `exercise_metric_units`, `exercise_tag_assignments`. No `log_audit_event` triggers. Per project memory, new tenant tables must be added to the CASE list, not just given a trigger. | Multi-practitioner readiness, regulatory hygiene (Privacy Act 1988), and "who edited the back-squat default?" traceability. Pre-launch is the cheapest moment to add. |
| **P0-3** | **Card click affordance lies.** `cursor: pointer` on the card with no `onClick`; `MoreHorizontal` icon with no menu. Both render an interactive affordance that does nothing. CLAUDE.md "every screen must earn its existence" — UI must not lie about what it does. | Without B1's edit/delete wiring, the only honest fix is to remove the affordances. With B1, both become real targets. Either way, the lying state must end. |

### P1 — Functional (features specified in the brief, missing)

| # | Gap | Brief / decision reference |
|---|-----|---------------------------|
| **P1-1** | **No `/library/[id]` view/edit page.** Click a card → nothing. The page mirrors the new form (same sections, same fields, same validation) but in update mode. Single primary action: "Save changes". Cancel returns to the library list without writes. | §10 (CRUD); B1 sign-off. |
| **P1-2** | **No delete flow.** "Delete" lives behind the `MoreHorizontal` menu on each card (and as a tertiary action on the edit page). Confirm dialog quotes the exercise name and warns if `usage_count > 0` ("Used in N program days. Soft-deleting will hide it from the library; existing prescriptions are unaffected."). On confirm, calls the soft-delete RPC. | B1 sign-off. |
| **P1-3** | **`default_metric` (unit) dropdown missing from the new + edit forms.** Schema field exists; form writes NULL. Brief §6.5.3 specifies the metric-first dropdown. Load options from `exercise_metric_units` server-side; render as a select adjacent to the load value field. Default the value field's placeholder based on the selected metric ("60kg or BW" → "60" with "kg" picked, "3:00" with "time_minsec" picked). | §6.5.3; C sign-off. Order per brief: kg, time (min:sec), distance (m), %, RPE, tempo, bodyweight, lb, miles, km. |
| **P1-4** | **Movement patterns not editable in Settings.** Brief §6.6 says practitioners customise pattern categories. Drop a `LookupManager kind="patterns"` entry into [settings/page.tsx](../../src/app/(staff)/settings/page.tsx) (same shape as `kind="tags"`). Requires extending `LookupManager` to know about `movement_patterns` (a fourth kind alongside tags / categories / session-types) — small surface, well-precedented. | §6.6; D3 sign-off. |
| **P1-5** | **Drop the disabled "Import CSV" button.** Not in the brief. | H sign-off. |
| **P1-6** | **Tighten placeholder copy on the three non-Exercises tabs.** Current copy ("land with Session Builder", "land after Session Builder", "land with Program engine") leaks the build order to the EP. Replace with what each surface will *do* once live, not when it ships. The four-tab shell stays per A1. | A1 sign-off; CLAUDE.md voice rules. |
| **P1-7** | **Composable library list.** Refactor `ExerciseLibrary.tsx` so `<SearchInput>`, `<PatternChips>`, `<TagChips>`, `<ExerciseCard>`, `<ExerciseGrid>` are independently importable. The standalone library screen stays the same; the session-builder Library tab (Phase 5) imports the same pieces with a different layout and an `onPick(exerciseId)` handler instead of card-click → edit page. | G sign-off; CLAUDE.md "component-based architecture". |

### P2 — Polish (design system, copy, motion)

These land after P0 + P1 architecture and features are in.

| # | Gap | Notes |
|---|-----|-------|
| **P2-1** | **Inline-style numerics → CSS vars.** All three library components (`ExerciseLibrary`, `LibraryView`, `NewExerciseForm`) hardcode `padding: 14`, `borderRadius: 7`, `fontSize: '.86rem'` etc. Add missing tokens to [`globals.css`](../../src/app/globals.css) (spacing scale `--space-{1..8}`, font-size scale `--text-{xs,sm,base,lg,xl}`); replace literal numerics with `var(--…)`. Don't rebuild into CSS modules. | F1 sign-off. The card radius should be `var(--radius-card)` (14), input radius `var(--radius-input)` (7), chip radius `var(--radius-chip)` (10) — all already defined. |
| **P2-2** | **Card hover + click motion.** Currently `cursor: pointer` with no hover state. Add 150ms ease (`cubic-bezier(0.4, 0, 0.2, 1)`) hover lift / border tone shift consistent with the design system. Whole-card click → `/library/[id]`; `MoreHorizontal` button is a separate target with `stopPropagation`. | CLAUDE.md motion rules. |
| **P2-3** | **YouTube thumbnail on cards with a `video_url`.** Today: solid green block + Play icon. Better: extract YouTube video ID from the URL and render `https://img.youtube.com/vi/{id}/mqdefault.jpg` as a 100×100 cover with the Play icon overlaid (existing icon style). Fallback to today's solid-green block when URL parsing fails (private videos, non-YouTube URLs). | §6.6 specifies "video indicator"; thumbnail is a polish win without scope creep. |
| **P2-4** | **Voice + casing audit on the create form.** Section headers + button labels are sentence-case ✓. "YouTube URL" stays as proper-noun. Empty-state copy "Add exercises with defaults (sets, reps, load, RPE) + optional YouTube links + tags" reads dense — tighten to brief-voice ("Sets, reps, load, RPE — defaults that auto-populate every prescription. Optional video link and tags."). | CLAUDE.md voice rules. |
| **P2-5** | **`MoreHorizontal` → `MoreVertical`** for the card menu trigger. Vertical dots is the conventional row-action affordance and matches the test card menu in the Reports tab. | Consistency. |
| **P2-6** | **Card prescription summary uses `×` not `x`.** Already correct in the JSX (`{e.default_sets} × {e.default_reps}`); double-check the empty-form placeholder ("4 × 8" not "4 x 8" if shown anywhere) and the upcoming edit-form placeholders. | CLAUDE.md numbers + units. |
| **P2-7** | **Eyebrow copy.** Currently `"05 Exercise Library · New"` on the new page header — leaks the build-order numbering. Drop the leading `05`. The standalone library page eyebrow is the count-based string ("12 exercises · 7 movement patterns") which is correct. | CLAUDE.md voice rules. |

---

## 3. Sequencing

Dependency-ordered. Each milestone is a discrete commit-set.

1. **Migrations** (P0-1 + P0-2 + P1-4-schema):
   - `…_soft_delete_library_rpcs.sql` — `soft_delete_exercise`, `soft_delete_movement_pattern`, `soft_delete_exercise_tag` (mirror existing pattern, SECURITY DEFINER, role check, soft-delete UPDATE).
   - `…_audit_register_library.sql` — five new CASE branches in `audit_resolve_org_id()` plus five `CREATE TRIGGER … log_audit_event` statements. The join-table `exercise_tag_assignments` resolves org via `exercises.organization_id` (one-hop walk).
   - `supabase db push` against the live remote (no Docker).
   - Regen types: `supabase gen types typescript --project-id <id> > src/lib/database.types.ts`.

2. **Settings: movement patterns** (P1-4 — UI):
   - Extend `LookupManager` to know `kind="patterns"` (table name, soft-delete RPC, copy strings).
   - Add the section to [settings/page.tsx](../../src/app/(staff)/settings/page.tsx) below "Exercise tags".

3. **Edit + delete** (P0-3 + P1-1 + P1-2 + P1-3):
   - New route `/library/[id]/page.tsx` — server fetch single exercise + patterns + tags + metric units.
   - `_components/EditExerciseForm.tsx` — mirrors `NewExerciseForm` shape; takes initial values + an `updateExerciseAction`.
   - `actions.ts` for the route — `updateExerciseAction` (UPDATE + tag-assignment diff) and `deleteExerciseAction` (calls `soft_delete_exercise` RPC).
   - `_components/CardMenu.tsx` — `MoreVertical` trigger, popover with "Edit" + "Delete", confirm dialog for delete with usage-count warning.
   - Wire whole-card click to `/library/[id]`; menu button has `stopPropagation`.

4. **`default_metric` dropdown** (P1-3):
   - Server fetch `exercise_metric_units` in both new and edit pages.
   - New `<MetricSelect>` field in the Default prescription section. Fold the existing `default_metric_value` text input under it; placeholder + label adapt to the selected metric.
   - Update `createExerciseAction` and the new `updateExerciseAction` to write `default_metric` (the code) alongside `default_metric_value`.

5. **Composable refactor** (P1-7):
   - Split `ExerciseLibrary.tsx` into `SearchInput.tsx`, `PatternChips.tsx`, `TagChips.tsx`, `ExerciseCard.tsx`, `ExerciseGrid.tsx`. The current `ExerciseLibrary` becomes a thin composer.
   - `ExerciseCard` accepts an `onClick` prop (for the session-builder pick handler later); the standalone screen wires it to `/library/[id]` via a `<Link>`.

6. **Drop dead UI** (P1-5):
   - Remove the disabled "Import CSV" button from `LibraryView.tsx`.

7. **Placeholder copy tighten** (P1-6):
   - Rewrite the three placeholder cards to describe the surface, not the build order.

8. **CSS-vars cleanup** (P2-1 — P2-7):
   - Add spacing + font-size tokens to [`globals.css`](../../src/app/globals.css).
   - Walk each library component, replacing inline-style numerics with `var(--…)` references and converting repeated style objects into CSS classes where it reads cleaner.
   - Card hover + motion (P2-2), YouTube thumbnail (P2-3), voice tightening (P2-4), `MoreVertical` swap (P2-5), `×` audit (P2-6), eyebrow drop (P2-7).

9. **Verification:**
   - Manual smoke: create → edit → delete (with and without `usage_count > 0`) → create with each metric type → filter by pattern + tag + search.
   - Confirm soft-deleted exercises disappear from the list and from settings movement-pattern picker.
   - Audit log: spot-check `audit_log` rows after a create + edit + delete confirm `organization_id`, `actor_user_id`, `changed_fields` populate correctly for each new table.

---

## 4. Acceptance gates

The pass closes when all of these are true:

1. EP can create, edit and soft-delete exercises from the library UI without leaving the page (except to land on `/library/[id]`).
2. Every exercise carries a `default_metric` code matching `exercise_metric_units.code`. New exercises cannot be saved with the metric value present and the unit absent.
3. EP can add / rename / delete movement patterns from Settings, and the changes show up in the library's pattern chips and the new/edit form's pattern dropdown without a refresh.
4. Five new audit-log triggers fire on every INSERT / UPDATE / DELETE against `exercises`, `movement_patterns`, `exercise_tags`, `exercise_metric_units`, `exercise_tag_assignments`. Spot-checked rows show correct `organization_id`, `actor_user_id`, `changed_fields`.
5. Soft-delete an exercise with `usage_count > 0`: the row disappears from the library list and from session-builder-future-pickers, but existing `program_exercises` rows referencing it are unaffected (RESTRICT FK on the exercise FK from `program_exercises` would block hard delete; soft delete is silent).
6. Card click goes to edit page; `MoreVertical` opens a menu without triggering the card click; confirm dialog blocks accidental delete.
7. No literal numeric values for padding, border-radius or font-size in the three library components — every value resolves to a `var(--…)` token defined in `globals.css`.
8. Library renders + searches + filters without console errors at 1440 / 768 / 375.
9. No "Import CSV" button. No "05 Exercise Library · New" eyebrow. No `MoreHorizontal`-as-decorative.

---

## 5. Out of scope (deliberate)

These belong to other passes and are flagged here so they don't get backdoored in.

- **Library inline panel inside the session builder** (brief §6.5.2). Lands with Phase 5 — session builder. The composable refactor in §3 step 5 makes that future work a wiring exercise, not a rebuild.
- **Bulk import of exercises** (e.g. CSV / JSON). Brief is silent; H sign-off drops the placeholder. Re-design properly if it surfaces as a real need.
- **Per-EP tag/pattern customisation across multiple practitioners** in one org. Multi-practitioner UI is brief-deferred; today's `organization_id` scope is correct.
- **Metric units settings UI.** Defer per D3 sign-off.
- **Circuits / Sessions / Programs sub-tabs becoming live.** They each ship with their underlying system (session builder, program engine).
- **Exercise version history / rollback.** Audit log captures it; no UI in v1.
- **Hard delete / undelete UI.** Soft-delete only in v1.

---
---

# Re-audit pass — 2026-06-12

**Context.** The gap document above (2026-05-05) was executed in commit `95bcfd4` plus migrations [`20260505100000_soft_delete_library_rpcs.sql`](../../supabase/migrations/20260505100000_soft_delete_library_rpcs.sql) and [`20260505100100_audit_register_library.sql`](../../supabase/migrations/20260505100100_audit_register_library.sql) — **before** the current seven-step polish-pass protocol (premortem step, sign-off ritual) was in force. The doc was never closed: no premortem, no closing commit, no sign-off. CLAUDE.md activated this section formally on 2026-06-11. This pass therefore re-audits the section under the current protocol: verify what landed, identify drift since (session-builder phases C–G touched the default-prescription pipeline), run the premortem, and produce a fresh gap list.

**Audit date:** 2026-06-12
**Status:** Gap list awaiting approval — no code changed in this pass.

---

## 6. Verification of the 2026-05-05 gap list

| Old gap | Status | Evidence |
|---|---|---|
| P0-1 soft-delete RPCs | ✅ Done | `soft_delete_exercise` / `_movement_pattern` / `_exercise_tag` in [`20260505100000`](../../supabase/migrations/20260505100000_soft_delete_library_rpcs.sql); SECURITY DEFINER, in-body org + role check, `NOT FOUND` raise. |
| P0-2 audit registration | ✅ Done | [`20260505100100`](../../supabase/migrations/20260505100100_audit_register_library.sql); four triggers + five CASE branches. Survived both resolver regressions — present in the latest canonical resolver ([`20260513160000`](../../supabase/migrations/20260513160000_audit_resolver_coverage_guard.sql)) and now protected by `assert_audit_resolver_coverage()` + pgTAP test 14. |
| P0-3 lying affordances | ✅ Done | Card is a real `<Link>` to `/library/[id]` ([ExerciseCard.tsx:209](../../src/app/(staff)/library/_components/ExerciseCard.tsx)); `CardMenu` is a real menu. |
| P1-1 edit page | ✅ Done | [`[id]/page.tsx`](../../src/app/(staff)/library/[id]/page.tsx) — shared `ExerciseForm` in edit mode, `notFound()` on missing row. |
| P1-2 delete flow | ⚠️ Done with a dead limb | [CardMenu.tsx:24-39](../../src/app/(staff)/library/_components/CardMenu.tsx) — confirm + usage-count warning + RPC. **But the usage warning can never fire** — see G-1. |
| P1-3 metric dropdown | ⚠️ Done, gate unmet | Unit select loads from `exercise_metric_units` in both forms; actions write `default_metric`. **Old acceptance gate 2 ("value present, unit absent cannot save") was never implemented** — see G-6. |
| P1-4 patterns in Settings | ✅ Done | `LookupManager kind="patterns"` at [settings/page.tsx:175](../../src/app/(staff)/settings/page.tsx); add + soft-delete actions in [settings/actions.ts:182-240](../../src/app/(staff)/settings/actions.ts). |
| P1-5 drop Import CSV | ✅ Done | No trace in `LibraryView.tsx`. |
| P1-6 placeholder copy | ✅ Done | Placeholders describe the surface, not the build order. |
| P1-7 composable pieces | ✅ Done | `SearchInput` / `PatternChips` / `TagChips` / `ExerciseCard` (with `onPick` picker contract) / `ExerciseGrid` all independently importable. |
| P2-1 tokens | ⚠️ Partial | Radius + some text tokens adopted (`--radius-card`, `--radius-input`, `--radius-chip`, `--text-2xs`, `--text-base`). **Hardcoded colours remain** — see G-8. Spacing/font-size literals remain (project-wide pattern, accepted below). |
| P2-2 card hover | ✅ Done | `.card-link` transition + hover at [globals.css:345-352](../../src/app/globals.css). |
| P2-3 YouTube thumbnail | ✅ Done | [`youtube.ts`](../../src/app/(staff)/library/_components/youtube.ts) ID extraction, `mqdefault.jpg`, solid-block fallback. |
| P2-4 voice | ✅ Done | Empty-state copy matches the approved rewrite. |
| P2-5 MoreVertical | ✅ Done | |
| P2-6 `×` not `x` | ✅ Done | |
| P2-7 eyebrow | ✅ Done | "Exercise library · New" / "· Edit". |

**Old acceptance gates:** 1, 3, 4, 6, 8, 9 pass. Gate 2 **fails** (G-6). Gate 5 is **untestable as written** — the warning copy exists but `usage_count` is permanently 0 (G-1). Gate 7 partial (G-8).

**Infrastructure verified this pass:** RLS on all five tables (staff-only Pattern A on `exercises` with DELETE denied; Pattern C on `exercise_tag_assignments`); bootstrap seeds match brief §6.6 patterns (Push…Isometric) and §6.5.3 metric-unit order exactly; `exercise_tags` are **not** seeded (G-10). Historical note for the record: the 2026-05-05 audit-registration migration itself caused resolver-regression incident #1 (six branches dropped, repaired 2026-05-10/13); the structural guard now makes that class of regression impossible to ship silently.

---

## 7. Drift since 2026-05-05

1. **Per-set prescription model landed** ([`20260507100000_program_exercise_sets.sql`](../../supabase/migrations/20260507100000_program_exercise_sets.sql)). Defaults now fan out per set. Q6 sign-off (2026-05-07): no dedicated RPE column on set rows — prescription RPE rides `optional_metric='rpe'` / `optional_value`. Consequence: a prescribed set carries load **or** RPE in its optional column, not both. This constrains G-3.
2. **Two default-application paths now exist**: the TS append path ([days/[dayId]/actions.ts:65-120](../../src/app/(staff)/clients/[id]/program/days/[dayId]/actions.ts)) and the SQL insert-at-position RPC ([`insert_program_exercise_at`](../../supabase/migrations/20260507100300_insert_program_exercise_at.sql)). They currently apply the same six fields (sets, reps, metric, value, rest, instructions) — and both identically skip `default_rpe` and `usage_count`. Consistent today; a consistency liability tomorrow. Rider for section 5.
3. **The session builder did not import the composable library pieces** — it has its own exercise fetch. Expected: the §6.5.2 Library tab is section-5 scope, and the `onPick` contract sits ready. Not a gap here.
4. **`client_get_program_day_exercises_v2` ships `exercise_video_url` to the portal, and the portal renders nothing for it.** Brief §6.4 specifies an expandable video thumbnail per exercise in the client session flow. Section-7 rider, recorded in §11.

---

## 8. Premortem — ranked failure modes

Weighting per protocol: infrastructure/security at production grade; operational/UX at friends-and-family scope.

| # | Failure mode | Likelihood | Impact | Closed by |
|---|---|---|---|---|
| FM-1 | **`usage_count` is permanently zero.** Schema comment promises application-side increment; no code or trigger anywhere writes it. The card's "used N×" never renders, the brief's "surfaces most-used exercises" (§5.1) is dead, and the delete-confirm's "Used in N program days" safety warning **never fires** — the EP deletes an in-use exercise on the bare "Delete?" prompt. Harm bounded (soft delete + RESTRICT FK keep existing prescriptions resolvable) but the safety copy built for exactly this case is unreachable. | Certain | Medium | G-1 |
| FM-2 | **Editing an exercise whose movement pattern was soft-deleted silently clears the pattern.** The `movement_patterns` SELECT policy filters `deleted_at IS NULL`, so the edit form's dropdown can't contain the current value; the browser falls back to "—" and the next save writes NULL. Deleting patterns in Settings is a supported flow, so this fires on a normal path. Same policy also means the library card shows "Unclassified" for such exercises, and the RPC migration's comment ("continue to resolve the pattern name") is wrong at the app layer. | Medium-high over beta lifetime | Medium — silent data loss | G-2 |
| FM-3 | **`default_rpe` dead-ends.** Stored, edited, rendered on the card — but neither default-application path inherits it. Brief §5.1: the default prescription includes an RPE target and the program "inherits all defaults." EP sets RPE 8 in the library, prescribes the exercise, and the intended intensity silently never reaches the client. Constrained by Q6 (load and RPE can't both ride the optional column). | Certain when the field is used | Low-medium — broken brief promise, missing clinical intent | G-3 |
| FM-4 | **Scheme-less YouTube paste fails ugly.** `youtube.com/watch?v=…` without `https://` violates the DB CHECK; the EP sees a raw constraint-violation string. Hand-typed and some copied URLs commonly arrive scheme-less. | High | Low | G-5 |
| FM-5 | **Library RPC/RLS regression ships unnoticed.** No pgTAP coverage for the three library soft-delete RPCs (tests 05/06 cover the earlier RPC families; test 17's automated matrix doesn't include library tables). The in-body org/role checks are correct *today*; the risk is a future migration regressing them silently. Production-grade weighting per protocol. | Low | High | G-4 |
| FM-6 | **Metric value saved without a unit.** Old gate 2, never implemented. A `default_metric_value` with NULL `default_metric` flows into set rows as an unlabelled "60" in the builder and the portal. | Medium | Low-medium | G-6 |
| FM-7 | **Play affordance lies on cards.** The Play glyph renders on every card — including "No video" cards — and nothing anywhere in the library plays or opens a video. CLAUDE.md names "video preview" in this section's scope; brief §6.6 requires at minimum an honest indicator. | Certain | Low — trust erosion | G-9 |
| FM-8 | **Silent no-op success on update.** If the exercise was deleted (or RLS filters it), the UPDATE matches zero rows, returns no error, and the action redirects as if saved. | Low | Low | G-7 |
| FM-9 | **Design-token drift.** Hardcoded `#C7BEB4`, `#F5F0EA`, `#fff`, `rgba(45,178,76,.1)` in library components violate the "tokens only" rule and will diverge on any future palette change. | Certain (present now) | Cosmetic | G-8 |

**Accepted without mitigation (rationale):**
- **Client-side `includes()` search; trigram index unused.** Correct at the brief's ~200-exercise scale; the index is pre-paid for the session-builder panel and future server-side search. Re-trigger: library exceeds ~1,000 rows or list-payload latency is felt.
- **Native `confirm()` in CardMenu.** Established staff-surface pattern (settings editors, session builder, schedule all use it); the styled `ConfirmDialog` exists only where iOS URL-display corrupted locked copy (portal) and on the client profile. Unifying is a cross-section polish decision, not a library gap.
- **Form's 4-column prescription grid doesn't collapse at 375px.** Staff surface is desktop-first per CLAUDE.md; 768px renders acceptably. Re-trigger: any real EP use of the staff platform on a phone.

---

## 9. Fresh gap list

### P0 — promoted per protocol (certain/high-likelihood failure modes)

| # | Gap | Detail |
|---|---|---|
| **G-1** | **Make `usage_count` real.** (FM-1) | Brief §5.1 requires it; the delete-safety warning depends on it. **Options:** (a) *recommended* — BEFORE/AFTER INSERT trigger on `program_exercises` incrementing `exercises.usage_count` ("times prescribed" is monotonic; no decrement on soft-delete — prescribed is prescribed). One migration; covers both application paths and all copy/duplicate RPCs for free; the existing `exercises_usage_idx` finally earns its keep. (b) computed `COUNT` at library load — always honest, no migration, but a per-load aggregate and the index stays dead. Backfill existing rows either way. |
| **G-2** | **Stop silent pattern loss on edit.** (FM-2) | Minimal fix: in the edit form, when `movement_pattern_id` is not in the active pattern list, render a synthetic selected option (value = current id, label "Current pattern (removed from settings)") so an untouched save preserves it and choosing "—" becomes a deliberate act. Card label "Pattern removed" instead of "Unclassified" is optional honesty on top. Alternative (bigger): drop the `deleted_at IS NULL` filter from the staff SELECT policy so names still resolve — a policy change; cheap pre-launch but wider blast radius. Recommend the synthetic-option fix; policy stays. |

### P1 — functional

| # | Gap | Detail |
|---|---|---|
| **G-3** | **`default_rpe` inheritance under the Q6 model.** (FM-3) | Q6 says prescription RPE rides `optional_metric='rpe'`/`optional_value` — one optional column per set. **Options:** (a) status quo made explicit — load always wins, form hint says RPE target is informational; (b) *recommended* — inherit RPE into the optional column **only when no load default exists** (`default_metric`/`default_metric_value` absent), form hint states the precedence; (c) extend the per-set model with a dedicated RPE column — re-opens Q6, section-5 territory, rejected here. Apply the chosen rule to **both** default-application paths (TS append + SQL RPC) in the same commit-set. |
| **G-4** | **pgTAP coverage for the library RPC trio.** (FM-5) | New test file mirroring 05/06: happy path, cross-org deny, role deny (client JWT), double-delete raise, for `soft_delete_exercise` / `_movement_pattern` / `_exercise_tag`. Use the `create_test_session()`-style JWT-spoof fixtures per project memory (no SECURITY DEFINER bypass helpers). |
| **G-5** | **Friendly `video_url` validation.** (FM-4) | Server-side in `parseFormFields`: auto-prefix `https://` when scheme-less and host-shaped, then validate `^https?://`; inline field error ("Paste a full URL — https://…") instead of the raw constraint message. DB CHECK stays as backstop. No YouTube-host restriction — non-YouTube `https` URLs legitimately fall back to the no-thumbnail block. |
| **G-6** | **Close old gate 2: value requires unit.** (FM-6) | Server-side validation: `default_metric_value` present + `default_metric` absent → inline field error on the Unit select. Optional belt-and-braces DB CHECK (cheap pre-launch). Also validate the submitted `default_metric` code against `exercise_metric_units` server-side. |
| **G-9** | **Honest video preview.** (FM-7) | **Options:** (a) *recommended* — thumbnail zone becomes a real target: click opens `video_url` in a new tab (`stopPropagation`; card body still routes to edit); Play glyph renders **only** when a video exists; "No video" block keeps the caption, loses the glyph. (b) inline embed lightbox — rejected: heavier surface, and the restraint posture plus "no video hosting, YouTube links only" make a tab-out the honest shape (mirrors brief §6.4's portal behaviour: expand, then open YouTube). |

### P2 — polish

| # | Gap | Detail |
|---|---|---|
| **G-7** | **Update/delete honesty.** (FM-8) | `updateExerciseAction`: append `.select('id')` and error when zero rows ("This exercise no longer exists — it may have been deleted in another tab."). |
| **G-8** | **Colour literals → tokens.** (FM-9) | `#C7BEB4` (dot separators), `#F5F0EA` (tag chip bg), `#fff` (inputs/chips), `rgba(45,178,76,.1)` (selected chip tint) across the library components. Map to existing `globals.css` tokens or add the missing ones there — never inline. |
| **G-10** | **Seed the brief's five default tags at bootstrap?** | Brief §6.6 names DGR, PRI, Plyometrics, Rehab, Prehab. Bootstrap seeds patterns, section titles, units, and categories — but not tags, so a new org's tag chips and form section are simply hidden. Decision Q-D below; recommend seeding (matches the `client_categories` precedent; tags stay fully editable in Settings). Operator's existing org gets a one-off backfill only if desired. |
| **G-11** | **Create-CTA placement disagreement — surfaced per the source-of-truth rule.** | Brief §6.6: "'+ Create New Exercise' at the **bottom of the library list**." Current: "New exercise" top-right in the page header. Reading: bottom-of-list describes the inline session-builder panel (where the header doesn't exist); the standalone screen header CTA is the stronger pattern and matches every other staff screen. Recommend: keep the header CTA here; the bottom-of-list create belongs to the §6.5.2 panel in section 5. Flagged rather than silently resolved. |

---

## 10. Decision questions for sign-off

Answered by the operator 2026-06-12. The gap list was approved with these decisions; protocol step 6 (implementation) began the same day.

| Q | Question | Recommendation | Decision |
|---|---|---|---|
| A | G-1 mechanism: DB trigger vs computed COUNT? | **Trigger** — monotonic counter, covers all insert paths including SQL RPCs, one migration + backfill. | **Trigger** (as recommended). |
| B | G-3 RPE inheritance: (a) load-always-wins / (b) RPE-when-no-load / (c) dedicated column? | **(b)** — honours "inherits all defaults" as far as the Q6 model allows without re-opening it. | **(d) — operator's own option: remove the RPE default from the library exercise entirely** (drop `exercises.default_rpe`). Recorded as a deliberate deviation from brief §5.1. Rationale: under the Q6 model a dedicated default can never inherit alongside a load default — a stored value that never flows is a lie in the schema; an RPE target stays fully expressible via the Unit dropdown (`rpe` is a seeded metric unit) and *that* path inherits. Bonus closure: `client_get_week_overview`'s read-time `COALESCE(pe.rpe, e.default_rpe)` let a library edit retroactively change what clients saw on published prescriptions (the §5.2 retroactivity hazard) — removing the column removes the leak. |
| C | G-9 video preview: tab-out vs inline embed? | **Tab-out** (option a). | **Tab-out** (as recommended). |
| D | G-10: seed the five brief tags for new orgs? | **Yes**, with Settings remaining the owner of the list. | **Yes** (as recommended). Backfill restricted to orgs with zero active tags — preflight showed the operator org's curated set differs from the brief's five and must not be touched. |
| E | G-11: keep header create-CTA on the standalone screen? | **Yes**; bottom-of-list lands with the section-5 inline panel. | **Keep header CTA** (as recommended). |

---

## 11. Riders to other sections (recorded, not actioned here)

- **Section 5 — session builder:** §6.5.2 Library tab composes `SearchInput` + `PatternChips` + `TagChips` + `ExerciseGrid` with `onPick`; bottom-of-list "+ Create New Exercise" lives there (G-11); the two default-application paths (TS append + `insert_program_exercise_at`) should converge on the RPC when that pass touches add-exercise — and must both carry whatever G-3 decides.
- **Section 7 — client portal:** brief §6.4 expandable per-exercise video thumbnail. The data already arrives (`exercise_video_url` in `client_get_program_day_exercises_v2`); the portal renders nothing for it today.

Neither rider is go-live-checklist material — no security or launch-gating exposure; both attach to sections still ahead in the locked polish order and will surface in those sections' audits.

---

## 12. Proposed sequencing (on approval)

1. **Migrations** — G-1 trigger + backfill; G-6 optional DB CHECK. `supabase db push`, regen types.
2. **Server actions** — G-5 + G-6 validation in `parseFormFields`; G-7 update honesty; G-3 inheritance rule in `addExerciseToDayAction` **and** `insert_program_exercise_at` (same commit-set).
3. **UI** — G-2 synthetic pattern option; G-9 thumbnail target + conditional Play glyph; G-8 token sweep; G-10 bootstrap seed (if approved).
4. **Tests** — G-4 pgTAP file; re-run full suite.
5. **Acceptance** — gates: usage counts render and the delete warning fires on an in-use exercise; editing a deleted-pattern exercise preserves the pattern; RPE inheritance per Q-B in both paths; value-without-unit blocked with inline error; scheme-less URL auto-fixed or friendly-rejected; thumbnail click opens the video, card click opens edit; zero colour literals in library components; pgTAP green.

**Status: gap list approved 2026-06-12 (decisions recorded in §10); implementation log below.**

---

## 13. Implementation log (2026-06-12)

Gap-by-gap closure notes, dependency order per §12.

- **G-1 (P0, FM-1) — closed.** `bump_exercise_usage_count()` trigger on `program_exercises` + `template_exercises` inserts, plus backfill (168 prescriptions across 18 exercises at migration time) — [`20260612090000`](../../supabase/migrations/20260612090000_exercise_usage_count_trigger.sql). Monotonic "times prescribed": soft-delete does not decrement. Accepted trade-off: each prescription insert writes one `exercises` audit row (`usage_count`, `updated_at`) and moves `updated_at` — low volume, and the audit trail arguably gains signal. Trigger names avoid the `audit_` prefix so the resolver coverage guard ignores them. Stale column comment corrected.
- **G-2 (P0, FM-2) — closed.** Edit form renders a synthetic "Current pattern (removed from settings)" option when the saved `movement_pattern_id` is absent from the active list, so an untouched save preserves it ([ExerciseForm.tsx](../../src/app/(staff)/library/_components/ExerciseForm.tsx)). Card label distinguishes "Pattern removed" (had one, since deleted) from "Unclassified" (never had one). The policy-change alternative was rejected as planned.
- **G-3 (P1, FM-3) — closed per Q-B decision (d).** `exercises.default_rpe` dropped; `client_get_week_overview` updated in the same migration (read-time fallback removed) — [`20260612090100`](../../supabase/migrations/20260612090100_drop_exercises_default_rpe.sql). RPE field removed from form, card, types, and both page selects. Pre-drop check: the only non-null value sat on a soft-deleted seed exercise — nothing live discarded.
- **G-4 (P1, FM-5) — closed.** [`20_library_soft_delete_rpcs_and_usage.sql`](../../supabase/tests/database/20_library_soft_delete_rpcs_and_usage.sql): 17 assertions — cross-org deny / client deny / happy path / invisibility / double-delete for the RPC trio, referenced-pattern-survival, and the usage-count trigger on both insert paths plus monotonicity. Buffered `_tap` style (15–19 convention); run as a single SQL-Editor batch.
- **G-5 (P1, FM-4) — closed.** `normaliseVideoUrl()` in [actions.ts](../../src/app/(staff)/library/actions.ts): scheme-less host-shaped pastes get `https://` prefixed; anything else returns the inline field error "Paste a full URL — https://…". DB CHECK remains the backstop.
- **G-6 (P1, FM-6) — closed.** Value-without-unit blocked server-side with an inline error on the Unit select; unknown/inactive unit codes rejected via `validateMetricCode()`; DB CHECK `exercises_metric_value_requires_unit` added after a two-row backfill (`BW` → `bodyweight` unit, `80kg` → `kg` + value `80`) — [`20260612090200`](../../supabase/migrations/20260612090200_exercises_metric_value_requires_unit.sql). Card now renders load through `formatDefaultLoad()` ([format.ts](../../src/app/(staff)/library/_components/format.ts)) in house voice: "60kg", "BW", "RPE 8", "80%".
- **G-7 (P2, FM-8) — closed.** `updateExerciseAction` appends `.select('id')` and errors on a zero-row match instead of redirecting as if saved.
- **G-8 (P2, FM-9) — closed.** Colour literals replaced across the library components: `#fff` → `--color-card`, `#F5F0EA` → `--color-surface`, `#C7BEB4` → `--color-text-faint`, selected-chip tint → new `--color-accent-soft` token added to `globals.css` (the rgba literal already recurred four times in component rules there; new code references the token).
- **G-9 (P1, FM-7) — closed per Q-C.** Card restructured into sibling targets (an `<a>` cannot nest in an `<a>`): media zone opens the video in a new tab (`rel="noopener noreferrer"`), body links to the edit page, CardMenu floats above both. Play glyph renders only when a video exists; "No video" block keeps its caption. Picker mode (`onPick`) unchanged — one button, no tab-out.
- **G-10 (P2) — closed per Q-D.** `seed_organization_defaults()` reproduced from its latest canonical body (20260423100000 — not the original; resolver-incident lesson applied) plus the brief §6.6 five-tag block; backfill seeds only orgs with zero active tags — [`20260612090300`](../../supabase/migrations/20260612090300_seed_default_exercise_tags.sql).
- **G-11 (P2) — closed per Q-E.** No code change; header CTA stays. Bottom-of-list create recorded as a section-5 item in §11.

**Two additions discovered during browser verification, surfaced here as within-gap elaborations (not new scope):**

- **Form-state preservation on error returns.** Verification exposed that React 19 resets uncontrolled form fields when a server action returns — so the new inline validation errors (G-5/G-6) would wipe everything the EP had typed. Pre-existing behaviour (the old name-required error did it too), but multiplying error paths made it untenable. All error returns now echo the raw submitted values (`ExerciseFormEcho`) and the form prefers the echo over persisted initial values. Verified: name/load/URL survive a value-without-unit rejection.
- **Card dot-separator honesty.** The `·` between sets×reps and load rendered even when sets×reps was absent ("Unclassified · 60kg" with nothing before the dot). Now renders only between two present segments.

**Deployment record (2026-06-12):** commit `236535e` (schema-compatible code) pushed to master → prod deploy confirmed healthy → `supabase db push` applied all four migrations → types regenerated, type-check clean. Post-push data verification (scripts/library-preflight-check.mjs): zero value-without-unit rows; `default_rpe` column absent; operator org's curated tags untouched, five zero-tag orgs received the starter set; usage_count backfill exact — stored equals actual prescription count for all 18 prescribed exercises (e.g. Kickstand Hinge 38, Barbell Back Squat 36). Post-push browser check: 17 cards render "used N×"; "BW" renders from the backfilled `bodyweight` unit. Remaining manual step: run pgTAP test 20 in the SQL Editor (no Docker test target).

**Browser verification record (2026-06-12, localhost:3000 against live DB pre-push, throwaway staff user per the staff-login-path-verify precedent, hard-deleted after):** 28 cards render with sibling media-anchor + body-link structure (zero nested anchors); thumbnails + Play on video cards; tab-out hrefs correct; pattern and tag chips live; create flow end-to-end (scheme-less YouTube paste auto-prefixed to https, card appears with "60kg" formatter output); value-without-unit rejected with inline Unit error and typed values preserved; CardMenu delete → soft-delete RPC → card gone; edit page loads values with no RPE field; zero console errors. Screenshot capture timed out (preview-tool quirk; page healthy) — structural snapshots stand as the evidence.

---

## Closing commit (step 7) — 2026-06-12

**What changed, by gap number.** All eleven gaps from the approved re-audit list (§9) are closed. Code in commits `236535e` (the pass), `1fc8ec4` (types regen + deployment record), `983b563` (test-20 grant fix).

- **P0.** G-1 made `exercises.usage_count` real: a `bump_exercise_usage_count()` AFTER-INSERT trigger on `program_exercises` + `template_exercises` (Q-A: trigger over computed COUNT — monotonic, covers every insert path including the SQL RPCs, lights up the dormant `exercises_usage_idx`), with an exact backfill. The card's "used N×" line and, critically, the delete-confirm's "Used in N program days" safety warning now function. G-2 stopped silent movement-pattern loss on edit: a soft-deleted pattern still referenced by an exercise now renders as a synthetic "Current pattern (removed from settings)" option, so an untouched save preserves it rather than writing NULL; the card distinguishes "Pattern removed" from "Unclassified".
- **P1.** G-3 (Q-B decision **(d)** — the operator's own option, beyond the three offered): `exercises.default_rpe` dropped entirely, a deliberate brief §5.1 deviation. Rationale recorded in the migration header — under the Q6 per-set model a dedicated default can never inherit alongside a load default (a stored value that never flows is a schema lie), and an RPE *target* stays fully expressible via the seeded `rpe` metric unit, which does inherit. Bonus closure: the same migration removed `client_get_week_overview`'s read-time `COALESCE(pe.rpe, e.default_rpe)`, which had let a library edit retroactively change a client's published prescription — the §5.2 retroactivity hazard. G-4: pgTAP test 20 (17 assertions) covers the three library soft-delete RPCs (cross-org deny, client deny, happy path, library-invisibility, double-delete raise; referenced-pattern survival) and the usage-count trigger on both insert paths plus monotonicity. G-5: `normaliseVideoUrl()` auto-prefixes `https://` to scheme-less host-shaped pastes and returns an inline field error otherwise, ahead of the DB CHECK. G-6 (closes the original 2026-05-05 pass's never-implemented acceptance gate 2): value-without-unit blocked server-side with an inline Unit error, unknown/inactive unit codes rejected via `validateMetricCode()`, and a DB CHECK `exercises_metric_value_requires_unit` as backstop after a two-row seed-data backfill. G-9 (Q-C: tab-out): the card media zone is now a real `<a target="_blank" rel="noopener noreferrer">` opening the demo video, the body links to edit, CardMenu floats above both (markup restructured to sibling anchors — no nested `<a>`); the Play glyph renders only when a video exists.
- **P2.** G-7: `updateExerciseAction` errors on a zero-row match instead of redirecting as a fake success. G-8: colour literals across the library components mapped to tokens (`#fff`→`--color-card`, `#F5F0EA`→`--color-surface`, `#C7BEB4`→`--color-text-faint`, and a new `--color-accent-soft` for the selected-chip tint). G-10 (Q-D): `seed_organization_defaults()` now seeds the brief §6.6 five-tag starter set (rebuilt from its latest canonical body per the resolver-incident lesson); backfill restricted to orgs with zero active tags, so the operator's curated set was untouched and five empty test orgs received the starter. G-11 (Q-E): no code change — the header create-CTA stays; the brief's "bottom of the list" placement is recorded as a section-5 (inline panel) item.

Plus two within-gap repairs found during browser verification, not new scope: error returns now echo submitted form values (`ExerciseFormEcho`) so React 19's post-action field reset doesn't wipe the EP's input when the new validation fires; and the card's `·` separator renders only between two present segments.

**Migrations:** four, applied to the live project via `supabase db push` (clean applies, type-regen verified) — `20260612090000` (usage_count trigger + backfill), `20260612090100` (drop `default_rpe` + week-overview update), `20260612090200` (value-requires-unit backfill + CHECK), `20260612090300` (tag seed + zero-tag backfill). Deploy ordering was deliberate and is recorded: schema-compatible code shipped to prod *first*, migrations *after*, since the old prod build still selected `default_rpe`.

**Acceptance tests run and results.**

- `npm run type-check` — pass after every change, and again after the post-drop types regen.
- `npm run build` — pass on the final tree (15 routes).
- pgTAP **test 20 — MET (2026-06-12).** Run in the Supabase SQL Editor; **all 17 assertions returned `ok`** (no Docker test target — single-batch `BEGIN…ROLLBACK` per house convention). Covers the load-bearing RLS denials (cross-org + client) on all three library soft-delete RPCs and the usage-count trigger across both prescription insert paths. A first run failed on a missing `GRANT … ON _tap TO authenticated` in the test harness (not the code under test); fixed in `983b563`, re-run green.
- Post-push live data verification (`scripts/library-preflight-check.mjs`): zero value-without-unit rows; `default_rpe` confirmed absent; usage_count backfill exact for all 18 prescribed exercises; operator org's curated tags untouched, five zero-tag orgs seeded.
- Browser verification (throwaway staff user, hard-deleted after): full create / validate / delete / edit round-trips, both pre- and post-push (records above).

**Deferred, with triggers.** None. All eleven gaps closed in this pass. Two **riders to later sections** (§11) are recorded, not deferred from this section — they belong to sections still ahead in the locked order and will surface in those audits: (1) section 5 (session builder) — the §6.5.2 Library tab composes the now-ready `onPick` atoms, the bottom-of-list "+ Create New Exercise" lands there, and the two default-application paths (TS append + `insert_program_exercise_at`) should converge on the RPC; (2) section 7 (client portal) — the §6.4 expandable per-exercise video thumbnail, whose data (`exercise_video_url`) already reaches the portal but renders nothing. Neither is go-live-checklist material (no security or launch-gating exposure).

**Premortem accounting.** Mitigated: FM-1 (G-1), FM-2 (G-2), FM-3 (G-3 via column removal), FM-4 (G-5), FM-5 (G-4), FM-6 (G-6), FM-7 (G-9), FM-8 (G-7), FM-9 (G-8). No premortem failure mode was left unmitigated. Accepted as planned, unchanged (rationale in §8): client-side `includes()` search with the trigram index pre-paid for the future server-side/session-builder path (re-trigger: >~1,000 rows or felt latency); native `confirm()` in CardMenu (the established staff-surface pattern; unifying on the styled `ConfirmDialog` is a cross-section decision); the form's 4-column prescription grid not collapsing at 375px (staff surface is desktop-first; re-trigger: real EP phone use of the staff platform).

**Process note.** This section carried a pre-protocol gap doc (2026-05-05) that had been *executed* (commit `95bcfd4`) but never closed — no premortem, no closing commit, no sign-off. The 2026-06-12 re-audit verified that prior work line-by-line (§6), found four partial closures and nine live failure modes the original pass didn't weight, and closed them. The lesson for future sections: a doc with a sign-off log is not a closed section unless the ritual below was completed.

---

*Per the section sign-off ritual: Claude Code's work ends at the Closing commit above. The section is not closed until the operator pastes this into the claude.ai project chat and records the decision under a Sign-off heading below. On a "Closed" or "Closed with deferred items" decision, CLAUDE.md's "Active section" advances to polish-pass order item 5 — Program engine and session builder (the differentiator — highest care).*
