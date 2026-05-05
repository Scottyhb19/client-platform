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
