# Session Builder — phase kickoff prompts

Pre-written kickoff prompts for the remaining phases of the session-builder polish pass. Each phase below is self-contained — paste the entire section (from the H2 down to the next H2) into a fresh Claude Code chat to start that phase.

The contract is [docs/polish/session-builder.md](./session-builder.md). Each prompt assumes the prior phases have landed; if you skip ahead, edit the **Precondition** line on the spot.

**Status (as of 2026-05-07):**
- Phase A (tokens + slate) ✓ signed off
- Phase B (density tightening) ✓ signed off
- Phase C (per-set storage) ✓ signed off
- Phases D–I — prompts below

---

## Phase D — action bars between cards + insert-in-place + groups-across-bar

You're picking up the Odyssey project's session-builder polish pass at Phase D.

**Project root:** C:\Users\scott\Desktop\Client Software Platform (Windows, bash + PowerShell available).

**Read first, in this order:**
1. CLAUDE.md — working agreement, design rules, code standards.
2. docs/polish/session-builder.md — gap-analysis contract. §0.1 sign-off log; §2.3 the gap (action bar in the wrong place); §0.1 rows ø-1 (groups-across-bar) and ø-3 (add-exercise-between); §4 row D. Skim Phase C's "Landed" note in §4 row C — it changed the data model the page loader hands to SessionBuilder, and Phase D builds on top of it.
3. The user's memory at .claude/projects/C--Users-scott-Desktop-Client-Software-Platform/memory/MEMORY.md — load-bearing for this phase: SQL Editor copy-paste default, schema-migration-push correctness, audit register new tables, soft-delete RLS gotcha, function arity evolution, prefix shell with repo cd.
4. supabase/migrations/20260420101800_programs.sql — `program_exercises.sort_order int NOT NULL DEFAULT 0`. No UNIQUE on (program_day_id, sort_order); the move action uses a sentinel-swap defensively.
5. supabase/migrations/20260507100000_program_exercise_sets.sql — Phase C model (per-set storage). Don't touch the schema here; just orient.
6. src/app/(staff)/clients/[id]/program/days/[dayId]/_components/SessionBuilder.tsx — surface to rewire. Look at `CardActions` (the current below-card bar), `renderGroupedExercises` (walker that produces SoloExercise / SupersetBlock), `LibraryPanel`, and `focusLibrarySearch`.
7. src/app/(staff)/clients/[id]/program/days/[dayId]/actions.ts — `addExerciseToDayAction` always appends at MAX(sort_order)+1 today; `groupWithAboveAction` is the current grouping primitive; `moveProgramExerciseAction` shows the sentinel-swap pattern.

**Phase D scope:** action bar moves to *between* cards (gap doc §2.3 + §0.1 ø-1, ø-3 + §4 row D).

Today: "Superset" + "+ Add exercise" render below each card. Clicking Superset on Card 2 groups Card 2 with Card 1 (groups-with-above) — correct behaviour, ambiguous UI. "+ Add exercise" anywhere just focuses library search; the next library pick lands at MAX(sort_order)+1 regardless.

Target: action bars render between cards. The bar between Card N and Card N+1: "Superset" groups them; "+ Add exercise" arms an "insert here" mode and the next library pick inserts at that slot with sort_order shifted. Plus a bar at top (insert-at-start) and bottom (insert-at-end / fall-through to today's append).

Concretely:
- **Migration**: new SECURITY DEFINER RPC `insert_program_exercise_at(p_day_id, p_exercise_id, p_after_pe_id)` for atomic shift+insert+per-set fan-out. Three-hop RLS walk inside (program_days → programs). Audit triggers fire on inserted rows; nothing new to register.
- **Server actions**: extend `addExerciseToDayAction` to accept `insertAfterPeId | null`. When set, route through the new RPC; when null, fall through to existing append behaviour. New `groupAcrossActionBarAction(beforePeId, afterPeId)`. Decide whether to keep `groupWithAboveAction` available or delete it; flag the call.
- **SessionBuilder**: replace per-card `CardActions` with `BetweenCardsBar` rendered in `renderGroupedExercises` between every adjacent pair, plus top + bottom. State `insertSlot: { afterPeId: string | null } | null` set by the bar's "+ Add exercise" click; cleared after the next library pick or on Cancel. Library-pick consumes the slot.
- **Type regen**: standard `npm run supabase:types` after the push.

**Architectural questions to surface BEFORE writing code:**
1. **Sort_order strategy** — integer shift via RPC vs gap-based numbering (sparse 100, 200, 300) vs fractional indices. Recommend integer shift via RPC: atomic, simple, no migration of existing rows.
2. **Bar visibility default** — always-on quiet hairline vs hover-revealed. Recommend always-on quiet (1px hairline, small icon-only buttons): the bar is the primary affordance now; hover-revealed loses discoverability.
3. **Bars adjacent to / inside existing supersets** — "+ Add exercise" between two members of the same group: inject as new group member, or break and add ungrouped? "Superset" between two adjacent groups: merge, or disabled? Recommend: inside-group "+" inserts as new group member (inherits superset_group_id); group-boundary "Superset" merges adjacent groups; two ungrouped cards "Superset" creates a fresh group.

**Precondition:** Phases A, B, C signed off. Migration head is 20260507100200. Type-check clean. Phase C left the legacy columns on program_exercises populated (drop migration is deferred until stability).

**Working norms (inherited):**
- Polish-pass protocol: gap doc is the contract. No scope creep without asking.
- No guessing. Architectural decisions get a focused question with options + a recommendation; wait for confirmation.
- DB-shape changes require: migration file → supabase db push → type regen → verify before declaring done.
- When SQL has to land via the Supabase SQL Editor, write it in a fenced code block and name the destination + success signal.
- Prefix PowerShell snippets with: `cd "C:\Users\scott\Desktop\Client Software Platform"`
- No local Docker — `supabase db reset` / `supabase test db` unavailable. Use `supabase db push`, SQL Editor, psql against remote.
- Soft-delete via dedicated RPC; never UPDATE `deleted_at` directly (RLS collision).
- New tenant tables added to `audit_resolve_org_id()`'s CASE list, not just given a trigger.
- Function-signature changes: DROP old signature before CREATE OR REPLACE.
- Library + Notes + Reports adjacency in the right panel of the session builder is protected — don't touch its structure.
- Use the Claude Preview MCP for verification. Offer taskkill if `next dev` blocks the port.
- Prefer Edit over Write for existing files.

**End-of-phase output:** (1) files changed, (2) what was tested and how (preview screenshots / inspect calls / SQL spot-checks), (3) deferred items + reasoning. Wait for explicit sign-off before stopping.

---

## Phase E — section-title dropdown + dedupe + library filter chips

You're picking up the Odyssey project's session-builder polish pass at Phase E.

**Project root:** C:\Users\scott\Desktop\Client Software Platform (Windows, bash + PowerShell available).

**Read first, in this order:**
1. CLAUDE.md — working agreement, design rules, code standards.
2. docs/polish/session-builder.md — §2.6 (section title is free-text + always visible), §2.8 (no library filter chips), §0.1 rows 4 (canonical dropdown + dedupe) and 6 (movement-pattern + tag chips), §4 row E.
3. The user's memory at .claude/projects/C--Users-scott-Desktop-Client-Software-Platform/memory/MEMORY.md — load-bearing: schema-migration-push correctness, audit register new tables, prefix shell with repo cd.
4. supabase/migrations/20260420101200_section_titles.sql — section_titles table shape.
5. supabase/migrations/20260420102400_bootstrap_functions.sql — section_titles seed function (how new orgs get default rows).
6. The migration that creates `movement_patterns` and `exercise_tags` (search supabase/migrations for those table names) — for the seed pattern + RLS.
7. src/app/(staff)/clients/[id]/program/days/[dayId]/_components/SessionBuilder.tsx — `SectionTitleField` (free-text input today), `LibraryPanel` (search-only), `renderGroupedExercises` (walker tracks `lastSection` for the bar render).
8. src/app/(staff)/clients/[id]/program/days/[dayId]/page.tsx — current loader doesn't fetch section_titles or tags; will need new queries.
9. src/app/(staff)/library/new/page.tsx — existing pattern reference for org-scoped dropdowns + "Add new…" creation flow.

**Phase E scope:** SectionTitleField becomes a dropdown sourced from `section_titles` (with "+ Add section…" affordance); section bars dedupe across consecutive same-section cards; LibraryPanel gets movement-pattern + tag chip filters.

Concretely:
- **Page loader**: add queries for `section_titles`, `movement_patterns`, `exercise_tags` (all org-scoped, deleted_at IS NULL, ordered). Pass arrays into SessionBuilder via new props.
- **SessionBuilder**: `SectionTitleField` rewrite — dropdown with the org's section_titles + an "Add new section" option that POSTs to `section_titles` (existing org-scoped insert path). New server action `addSectionTitleAction(name)` returns the new id + name; component updates state. Dedupe in `renderGroupedExercises`: walker already tracks `lastSection`; the bar-render branch already only fires on section change — confirm correct, plus visual treatment when the field is empty (probably no bar at all).
- **LibraryPanel**: above the search input, row of movement-pattern chips. Below the search, row of tag chips. Multi-select within a category. Reset button when any filter is active.

**Architectural questions to surface BEFORE writing code:**
1. **Section title primary key in DB** — keep using free-text on `program_exercises.section_title` (current) or switch to FK on `section_titles.id`? Recommend free-text — the dropdown is a UI helper, not a referential constraint; keeps the constraint loose, tolerates orgs renaming a section without rewriting program_exercises.
2. **Empty-section card render** — bar omitted entirely vs subtle "Untitled" placeholder. Recommend omitted (matches the prototype; Apple-like restraint).
3. **Library chip combine** — AND across categories (movement = squat AND tag = rehab) vs OR across categories. Recommend AND across categories, OR within (the standard filter UX).

**Precondition:** Phases A, B, C, D signed off. Type-check clean.

**Working norms (inherited):**
- Polish-pass protocol: gap doc is the contract. No scope creep without asking.
- No guessing. Architectural decisions get a focused question with options + a recommendation; wait for confirmation.
- DB-shape changes require: migration file → supabase db push → type regen → verify before declaring done.
- When SQL has to land via the Supabase SQL Editor, write it in a fenced code block and name the destination + success signal.
- Prefix PowerShell snippets with: `cd "C:\Users\scott\Desktop\Client Software Platform"`
- No local Docker — `supabase db reset` / `supabase test db` unavailable. Use `supabase db push`, SQL Editor, psql against remote.
- Soft-delete via dedicated RPC; never UPDATE `deleted_at` directly (RLS collision).
- New tenant tables added to `audit_resolve_org_id()`'s CASE list, not just given a trigger.
- Function-signature changes: DROP old signature before CREATE OR REPLACE.
- Library + Notes + Reports adjacency in the right panel of the session builder is protected — don't touch its structure.
- Use the Claude Preview MCP for verification. Offer taskkill if `next dev` blocks the port.
- Prefer Edit over Write for existing files.

**End-of-phase output:** (1) files changed, (2) what was tested and how, (3) deferred items + reasoning. Wait for explicit sign-off before stopping.

---

## Phase F — swap-in-place + Load/Notes metric dropdown

You're picking up the Odyssey project's session-builder polish pass at Phase F.

**Project root:** C:\Users\scott\Desktop\Client Software Platform (Windows, bash + PowerShell available).

**Read first, in this order:**
1. CLAUDE.md.
2. docs/polish/session-builder.md — §2.4 (swap-in-place), §2.7 (Load/Notes cell is freetext), §0.1 rows 5 (swap UX) and ø-5 (Load/Notes becomes [value][metric]), §4 row F. Phase C's "Landed" note in §4 row C — it added `optional_metric` per-set and noted that Phase F surfaces it.
3. The user's memory at .claude/projects/C--Users-scott-Desktop-Client-Software-Platform/memory/MEMORY.md.
4. supabase/migrations/20260420101300_exercise_metric_units.sql — canonical metric list per org (kg / lb / time_minsec / distance_m / distance_miles / distance_km / percentage / rpe / tempo / bodyweight).
5. supabase/migrations/20260420101500_exercises.sql — exercises shape, including `default_metric`, `default_metric_value`.
6. supabase/migrations/20260507100000_program_exercise_sets.sql — Phase C; reaffirm `optional_metric` column exists per set.
7. src/app/(staff)/clients/[id]/program/days/[dayId]/_components/SessionBuilder.tsx — `SetCell` (Phase C component) for the Load/Notes cell; right-panel `LibraryPanel` for the swap mode.
8. src/app/(staff)/library/new/page.tsx — pattern reference for `[value][metric]` cell.
9. src/app/portal/session/[dayId]/_components/Logger.tsx — `ActiveSet` already routes on `optional_metric === 'rpe'` for prefill (Phase C set this up); Phase F's structured cell makes that logic kick in for real prescriptions.

**Phase F scope:**
- **Swap-in-place**: click an exercise name → right panel forces tab to Library and shows "Replacing: {old name}" header with Cancel button → next library click swaps in. New `swapProgramExerciseAction(programExerciseId, newExerciseId)` — soft-delete old `program_exercises` row, insert new row at same `sort_order` / `section_title` / `superset_group_id` with the new exercise's defaults, fan out per-set rows. Old `set_logs` / `exercise_logs` history survives because their FK is on `exercise_id`, not `program_exercise_id`.
- **Load/Notes cell becomes [value input][metric select]**. Metric select sources `exercise_metric_units` for the org (filter `is_active = true`, `deleted_at IS NULL`, ordered by `sort_order`). On load, defaults to the exercise's `default_metric` (or empty if NULL). Display when read-only: `{value} {display_label}` — "80 kg", "3:00 min:sec", "BW" (for bodyweight with empty value).

Concretely:
- **Migration**: new RPC `swap_program_exercise(p_pe_id, p_new_exercise_id)` — soft-delete old, insert new, fan out sets in one transaction. RLS-check via parent walk.
- **Server actions**: `swapProgramExerciseAction` calls the RPC.
- **Page loader**: new query for `exercise_metric_units` (org-scoped, is_active, ordered).
- **SessionBuilder**: `SetCell` becomes `SetMetricCell` — accepts both `optional_metric` and `optional_value`; renders [value input][metric select]. Right-panel "swap mode" header strip with Cancel; click on exercise name in card sets `swapTarget: peId | null`.
- **Type regen** after the push.

**Architectural questions to surface BEFORE writing code:**
1. **Swap atomicity** — single RPC vs sequence of supabase-js calls. Recommend single RPC: mid-swap orphans (old soft-deleted, new not yet inserted) would be visible to the EP if the page revalidates between calls.
2. **Old prescription preservation on swap** — discard entirely (gap doc default) vs offer to copy reps/load to the new exercise. Recommend discard: the EP picked a different exercise, prescription should reset to the new exercise's defaults.
3. **Metric select fallback** — when the exercise has no default_metric, what's the cell's default state? Empty metric = "—" (no metric)? Or force a kg default? Recommend empty: the EP might genuinely want a notes-only cell (e.g., "BW + chains").

**Precondition:** Phases A, B, C, D, E signed off. Type-check clean.

**Working norms (inherited):**
- Polish-pass protocol: gap doc is the contract. No scope creep without asking.
- No guessing. Architectural decisions get a focused question with options + a recommendation; wait for confirmation.
- DB-shape changes require: migration file → supabase db push → type regen → verify before declaring done.
- When SQL has to land via the Supabase SQL Editor, write it in a fenced code block and name the destination + success signal.
- Prefix PowerShell snippets with: `cd "C:\Users\scott\Desktop\Client Software Platform"`
- No local Docker. Use `supabase db push`, SQL Editor, psql against remote.
- Soft-delete via dedicated RPC; never UPDATE `deleted_at` directly.
- New tenant tables added to `audit_resolve_org_id()`'s CASE list.
- Function-signature changes: DROP old signature before CREATE OR REPLACE.
- Library + Notes + Reports adjacency in the right panel is protected.
- Use the Claude Preview MCP for verification. Offer taskkill if `next dev` blocks the port.
- Prefer Edit over Write for existing files.

**End-of-phase output:** (1) files changed, (2) what was tested and how, (3) deferred items + reasoning. Wait for explicit sign-off.

---

## Phase G — drag-and-drop reorder

You're picking up the Odyssey project's session-builder polish pass at Phase G.

**Project root:** C:\Users\scott\Desktop\Client Software Platform (Windows, bash + PowerShell available).

**Read first, in this order:**
1. CLAUDE.md.
2. docs/polish/session-builder.md — §2.5 (DnD doesn't exist), §0.1 row ø-2, §4 row G. Phase D's "Landed" note in §4 row D — its `BetweenCardsBar` slots become the drop targets for Phase G.
3. The user's memory at .claude/projects/C--Users-scott-Desktop-Client-Software-Platform/memory/MEMORY.md.
4. supabase/migrations/20260420101800_programs.sql — sort_order shape.
5. src/app/(staff)/clients/[id]/program/days/[dayId]/_components/SessionBuilder.tsx — current up/down arrows + `GripVertical` (decorative today); the `BetweenCardsBar` slots from Phase D become drop targets.
6. src/app/(staff)/clients/[id]/program/days/[dayId]/actions.ts — `moveProgramExerciseAction` (the sentinel-swap pattern) for reference; Phase D may have added `insert_program_exercise_at` RPC, which is structurally similar to what Phase G needs for atomic reorders.
7. package.json — confirm `@dnd-kit/core` and `@dnd-kit/sortable` not yet installed.

**Phase G scope:** the grip handle becomes a real drag handle. Drop targets reuse Phase D's `BetweenCardsBar` slots. Drop into a superset joins it; drop out ungroups it (with singleton cleanup). Keep up/down arrow buttons as keyboard a11y fallback.

Concretely:
- **Install**: `npm i @dnd-kit/core @dnd-kit/sortable`. Explain what each does — `@dnd-kit/core` provides DndContext + sensors; `@dnd-kit/sortable` provides useSortable + arrayMove helpers.
- **Migration**: new RPC `reorder_program_exercises(p_day_id, p_ordered_ids uuid[])` — accepts the full new order, writes sort_orders in one transaction. Cleaner than chained swaps for multi-position moves. RLS-check via parent walk.
- **Server action**: `reorderProgramExercisesAction(dayId, orderedIds)` calls the RPC.
- **DnD wiring**: `DndContext` at the top of `renderGroupedExercises`. Each card is a `useSortable`. Drop into a between-bar slot triggers reorder. Drop into a superset's interior triggers reorder + superset_group_id assignment. Drop-out-of-superset: server-side action sets superset_group_id = null on the moved card; if the leftover group has only 1 member, that member also clears (existing singleton-cleanup logic).
- **Sensors**: PointerSensor + KeyboardSensor + TouchSensor.

**Architectural questions to surface BEFORE writing code:**
1. **Reorder API shape** — `reorderProgramExercisesAction(dayId, orderedIds[])` (full list) vs `moveProgramExerciseAction(peId, newSortOrder)` (single). Recommend full list: DnD events naturally produce "the new order", not "this one moved to that index"; full-list is one transaction and atomic.
2. **Cross-group drop semantics** — drag from group A into group B: do they merge or does the dragged card leave A and join B? Recommend "leave A and join B" (intuitive: drag is a move, not a merge). If A loses its 2nd-to-last member, the singleton-cleanup runs.
3. **Touch / keyboard parity** — @dnd-kit ships KeyboardSensor + TouchSensor. Recommend enabling all three (Pointer + Keyboard + Touch): the staff platform is desktop-first but tablets are common in the gym.

**Precondition:** Phases A–F signed off, with Phase D's `BetweenCardsBar` in place (Phase G's drop targets reuse those slots). Type-check clean.

**Working norms (inherited):**
- Polish-pass protocol: gap doc is the contract. No scope creep without asking.
- No guessing. Architectural decisions get a focused question with options + a recommendation; wait for confirmation.
- DB-shape changes require: migration file → supabase db push → type regen → verify before declaring done.
- When SQL has to land via the Supabase SQL Editor, write it in a fenced code block and name the destination + success signal.
- Prefix PowerShell snippets with: `cd "C:\Users\scott\Desktop\Client Software Platform"`
- No local Docker. Use `supabase db push`, SQL Editor, psql against remote.
- Soft-delete via dedicated RPC; never UPDATE `deleted_at` directly.
- New tenant tables added to `audit_resolve_org_id()`'s CASE list.
- Function-signature changes: DROP old signature before CREATE OR REPLACE.
- Library + Notes + Reports adjacency in the right panel is protected.
- Use the Claude Preview MCP for verification. Offer taskkill if `next dev` blocks the port.
- Prefer Edit over Write for existing files.
- Never install packages without explaining what they do.

**End-of-phase output:** (1) files changed, (2) what was tested and how (drag screenshots, drop-into-superset behaviour confirmed, sort_order spot-check), (3) deferred items + reasoning. Wait for explicit sign-off.

---

## Phase H — "Last logged" footer

You're picking up the Odyssey project's session-builder polish pass at Phase H.

**Project root:** C:\Users\scott\Desktop\Client Software Platform (Windows, bash + PowerShell available).

**Read first, in this order:**
1. CLAUDE.md — note the voice & copy rules ("Time-ago is explicit" — `9 days ago`, not `recently`).
2. docs/polish/session-builder.md — §2.9, §4 row H. Includes a SQL sketch for the most-recent-set query.
3. The user's memory at .claude/projects/C--Users-scott-Desktop-Client-Software-Platform/memory/MEMORY.md.
4. supabase/migrations/20260420101900_session_logging.sql — exercise_logs and set_logs shape.
5. src/app/(staff)/clients/[id]/program/days/[dayId]/page.tsx — page loader; new query lands here.
6. src/app/(staff)/clients/[id]/program/days/[dayId]/_components/SessionBuilder.tsx — render slot is the bottom of the prescription column inside `ExerciseBody`.

**Phase H scope:** load the most-recent `set_logs` for each `exercise_id` × this client; render a single line at the bottom of the prescription column. Pre-launch this is empty for everything; just don't render the line when there's no history.

Concretely:
- **Page loader**: new query (per the SQL sketch in §2.9). For each exercise_id in this page's program_exercises, the most recent exercise_logs (DISTINCT ON exercise_id, ORDER BY completed_at DESC) joined to its set_logs and aggregated.
- **SessionBuilder**: render `Last: {N} × {reps} @ {best load or range} · {date}` at the bottom of the prescription column. Skip when no history.
- **Performance**: fine pre-launch (zero rows). Post-launch, scope check; if it's slow under real traffic, switch to a SECURITY DEFINER RPC with proper indexing.

**Architectural questions to surface BEFORE writing code:**
1. **Load aggregation across sets** — show best (heaviest) load, range (low–high), or last set's load? Recommend range when sets vary (`75–80kg`), single value when uniform. Mirrors the prototype.
2. **Date format** — "9 days ago" (relative) vs "Sat 11 Apr" (absolute). CLAUDE.md voice & copy rules say time-ago is explicit and relative — recommend `9 days ago` style.
3. **Footer slot location** — bottom of prescription column (right side of card, under SetTable + Stepper + Extras) vs bottom of left column (under demo video). Recommend right column under set table — it's data adjacent to data, not adjacent to UI elements.

**Precondition:** Phases A–G signed off. Type-check clean.

**Working norms (inherited):**
- Polish-pass protocol: gap doc is the contract. No scope creep without asking.
- No guessing. Architectural decisions get a focused question with options + a recommendation; wait for confirmation.
- DB-shape changes require: migration file → supabase db push → type regen → verify before declaring done.
- When SQL has to land via the Supabase SQL Editor, write it in a fenced code block and name the destination + success signal.
- Prefix PowerShell snippets with: `cd "C:\Users\scott\Desktop\Client Software Platform"`
- No local Docker. Use `supabase db push`, SQL Editor, psql against remote.
- Library + Notes + Reports adjacency in the right panel is protected.
- Use the Claude Preview MCP for verification. Offer taskkill if `next dev` blocks the port.
- Prefer Edit over Write for existing files.

**End-of-phase output:** (1) files changed, (2) what was tested and how, (3) deferred items + reasoning. Wait for explicit sign-off.

---

## Phase I — polish round (empty state, duplicate, sticky panel, autosave tick, pencil)

You're picking up the Odyssey project's session-builder polish pass at Phase I — the final consolidated polish round.

**Project root:** C:\Users\scott\Desktop\Client Software Platform (Windows, bash + PowerShell available).

**Read first, in this order:**
1. CLAUDE.md — design system rules, motion timing (150ms hover/press, 300ms reveal, easing `cubic-bezier(0.4, 0, 0.2, 1)`).
2. docs/polish/session-builder.md — §2.12 (empty state), §2.13 (duplicate button), §2.14 (pencil affordance), §2.15 (sticky panel), §2.16 (autosave tick), §4 row I.
3. The user's memory at .claude/projects/C--Users-scott-Desktop-Client-Software-Platform/memory/MEMORY.md.
4. The component files referenced in each polish item — they may have shifted shape across Phases D–H; orient before editing.
5. docs/polish/programs.md (if it exists) — gap doc references it for the date-picker reuse on duplicate. The Programs polish landed a date-picker for day-level copy; duplicate-button on the builder reuses that.

**Phase I scope:** five separate polish items, each small, bundled together because none alone justifies a phase.

- **§2.12 Empty state CTA**: button "Browse the library" inside `EmptyState` that focuses library search input + flashes the panel border briefly. Reuse the existing `focusLibrarySearch` hook.
- **§2.13 Duplicate-button implementation**: today the button is permanently disabled. New `duplicate_program_day` RPC that copies the day + program_exercises + program_exercise_sets to a target date. Reuse the calendar's date-picker popover. Click → date picker → on confirm, copy lands as a draft (`published_at = NULL`) on the chosen date and the user is navigated to the new day.
- **§2.14 DayLabelEditor pencil**: bump the rest-state opacity from 0 to 0.25, hover from 0.55 to 0.6. Subtle visibility increase without losing the design's restraint.
- **§2.15 Sticky right panel**: today the `<aside>` is `position: sticky; top: 20`. Once the page scrolls past the panel's content height, the panel scrolls off. Change to `position: sticky; top: 20px; height: calc(100vh - 40px); overflow-y: auto`. Long Notes/Reports/Library content scrolls within the panel, not against the page.
- **§2.16 Autosave tick**: when an autosave call resolves, briefly flash a green checkmark inside the cell border (200ms in, 600ms hold, 400ms out). On error, the existing red border behaviour stays. No "Saving…" text. State machine in `SetCell` + `InlineCell` (if still extant) + `EditableTextarea` + `SmallField` — look across all autosave components; Phases C–F may have refactored some.

Concretely (per item):
- **Empty state**: just a button + reuse `focusLibrarySearch`.
- **Duplicate**: new migration `duplicate_program_day(p_source_day_id, p_target_date)`. Walks via parent program, inserts cloned rows in one transaction. The page action triggers the RPC + navigates to `/clients/[id]/program/days/[newDayId]`. Date conflict: refuse if a program_day already exists on that date for this program.
- **Pencil**: one CSS opacity tweak.
- **Sticky panel**: the `<aside>` style.
- **Tick**: CSS animation triggered by a key change on the cell. Less state to manage than a JS-driven setTimeout.

**Architectural questions to surface BEFORE writing code:**
1. **Duplicate-day target date conflict** — what if the EP picks a date that already has a program_day for this program? Refuse, overwrite, or merge? Recommend refuse with a clear "A session is already scheduled for that date" error. Overwrite is dangerous; merge is unclear.
2. **Tick implementation** — CSS animation + key state vs JS-driven setTimeout state. Recommend CSS animation triggered by a `key={`saved-${savedAt}`}` rerender on the tick element with a fresh animation. Less state.
3. **Sticky panel scroll independence** — content inside Notes/Reports/Library scrolls within the panel (own scroll context). Recommend independent per the gap doc.

**Precondition:** Phases A–H signed off. Type-check clean. This is the final phase of the session-builder polish pass; on sign-off the section is done and ready for the next polish-pass section (per the order in CLAUDE.md, Programs / Calendar / Client portal etc., though deviation by deliberate choice is allowed).

**Working norms (inherited):**
- Polish-pass protocol: gap doc is the contract. No scope creep without asking.
- No guessing. Architectural decisions get a focused question with options + a recommendation; wait for confirmation.
- DB-shape changes require: migration file → supabase db push → type regen → verify before declaring done.
- When SQL has to land via the Supabase SQL Editor, write it in a fenced code block and name the destination + success signal.
- Prefix PowerShell snippets with: `cd "C:\Users\scott\Desktop\Client Software Platform"`
- No local Docker. Use `supabase db push`, SQL Editor, psql against remote.
- Soft-delete via dedicated RPC; never UPDATE `deleted_at` directly.
- New tenant tables added to `audit_resolve_org_id()`'s CASE list.
- Function-signature changes: DROP old signature before CREATE OR REPLACE.
- Library + Notes + Reports adjacency in the right panel is protected.
- Use the Claude Preview MCP for verification. Offer taskkill if `next dev` blocks the port.
- Prefer Edit over Write for existing files.

**End-of-phase output:** (1) files changed, (2) what was tested and how — for each of the five polish items, (3) deferred items + reasoning. Wait for explicit sign-off. On sign-off, the session-builder polish pass is complete; flag readiness to move to the next section per CLAUDE.md's polish-pass order.
