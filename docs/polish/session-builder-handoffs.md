# Handoff prompts — Session Builder polish pass

These are starter prompts for fresh chats covering Phases B–I of the session-builder polish pass. Each block is self-contained — copy the **whole block** (between the `---` rules) into the first message of a new conversation.

The shared rules (CLAUDE.md, polish-pass protocol, design tokens, no guessing) are baked into each prompt so a fresh Claude instance picks them up cold without seeing prior chats.

**Phase contract:** [docs/polish/session-builder.md](./session-builder.md). §0.1 has the sign-off log; §4 has the dependency-ordered phasing; §2 has every per-gap detail.

**Pacing:** one phase per chat. Sign off the phase, then start the next phase in a new chat with the next prompt.

---

## Phase B — Density tightening

```
You're picking up the Odyssey project's session-builder polish pass at Phase B.

**Project root:** C:\Users\scott\Desktop\Client Software Platform (Windows, bash shell available, PowerShell also OK).

**Read first, in this order:**
1. CLAUDE.md — project working agreement, design rules, code standards.
2. docs/polish/session-builder.md — gap-analysis contract for the polish pass. §0.1 sign-off log; §4 phasing; §2.11 has the per-gap detail for density.
3. The user's memory at .claude/projects/C--Users-scott-Desktop-Client-Software-Platform/memory/MEMORY.md for working preferences.

**Phase B scope:** Density tightening of the session-builder exercise card (gap doc §2.11 + §4 row B).
- Card padding 16/20px → 12/14px
- Demo-video slab 140px-tall → 96×60px thumbnail bottom-right of the left column
- Set rows 32px → 26px
- Extras row gap 12px → 8px
- Target card height ~220px (was ~360px)
- Three exercises fit on a 1080p viewport without scrolling

**Precondition:** Phase A (tokens + warm charcoal) has been signed off as complete. The token system is in place; do not introduce new hardcoded hex values during density work. If a token doesn't exist for a value you need, add it to src/app/globals.css rather than hardcoding inline.

**Working norms (inherited from earlier chats):**
- Polish-pass protocol: gap doc is the contract. Don't expand scope without asking.
- No guessing. Where a decision needs to be made, ask the user a focused question with options + a recommendation. Wait for confirmation.
- Prefix PowerShell snippets the user runs with: cd "C:\Users\scott\Desktop\Client Software Platform"
- Prefer Edit over Write for existing files.
- Use the Claude Preview MCP for verification: preview_start (uses .claude/launch.json), navigate, preview_screenshot / preview_inspect / preview_resize. Offer taskkill if a stale next dev blocks the port.
- The Library + Notes + Reports adjacency in the right panel of the session builder is protected — don't touch its structure.

**End-of-phase output:** When the work is done, post a short summary: (1) what files changed, (2) what was tested and how (preview screenshots / inspect calls), (3) any deferred items + reasoning. Wait for explicit sign-off before stopping. Once signed off, the user spins a fresh chat for Phase C.

Confirm you've read the docs above and are ready to proceed.
```

---

## Phase C — Per-set storage

```
You're picking up the Odyssey project's session-builder polish pass at Phase C.

**Project root:** C:\Users\scott\Desktop\Client Software Platform (Windows, bash shell available, PowerShell also OK).

**Read first, in this order:**
1. CLAUDE.md — project working agreement, design rules, code standards.
2. docs/polish/session-builder.md — gap doc. §2.2 (per-set gap), §3.1 (new table schema), §3.2 (RLS), §3.3 (soft-delete RPC), §3.4 (portal RPC update), §4 row C (phase scope).
3. docs/schema.md — current database overview.
4. .claude/projects/C--Users-scott-Desktop-Client-Software-Platform/memory/MEMORY.md — note especially the "Soft-delete UPDATE + RLS gotcha", "Audit register new tables", "plpgsql function arity evolution", "No local Docker", and "pgTAP + FORCE RLS pattern" entries.

**Phase C scope:** Per-set storage. The biggest functional change in this polish pass.
- New table program_exercise_sets (full DDL in gap doc §3.1).
- RLS via parent walk (program_exercise_sets → program_exercises → program_days → programs → organization_id). See §3.2.
- Soft-delete RPC soft_delete_program_exercise_set following the same pattern as soft_delete_program_exercise. See §3.3.
- Audit register update — add program_exercise_sets to audit_resolve_org_id()'s CASE list.
- Update addExerciseToDayAction to insert default-count rows on add (using the exercise's default_sets, default_reps, default_metric, default_metric_value, default_rpe).
- Update SessionBuilder set-table to read/write per-set rows. Each row's REPS / LOAD / RPE inputs become live and independent.
- Update the portal RPC client_get_program_day_exercises to return prescription_sets as a JSON array per row (or split into a sibling RPC — gap doc leaves the choice open; pick one and justify).
- Verify portal Logger still works; it already renders per-set, so the change should *remove* the row-1-mirror hack rather than break anything.
- Drop legacy program_exercises columns (sets, reps, optional_metric, optional_value, rpe) in a follow-up migration only after a few days of stability — flag this for the user but do not drop in this phase.

**Precondition:** Phases A + B signed off. Tokens are in place, density is tightened. Existing set-table renders row 1 + N-1 static reflections; this phase makes them all live.

**Critical things to watch for:**
- Pre-launch: cheap migrations, no data to backfill. Push the schema change to remote Supabase (no Docker — see memory note).
- Soft-delete RLS gotcha: direct UPDATE setting deleted_at returns 42501. Use the RPC pattern (memory note: project_postgrest_soft_delete_rls).
- Audit register: new tenant tables MUST be added to audit_resolve_org_id()'s CASE list, not just given a trigger (memory note).
- supabase-js function arity: when an existing function changes signature, the migration must DROP the old arity before CREATE OR REPLACE (memory note).
- Verify type regen post-push: supabase gen types typescript ...

**Working norms:**
- Polish-pass protocol: gap doc is the contract. Don't expand scope without asking.
- No guessing. The portal RPC return shape choice (JSON array vs sibling RPC) is one decision worth surfacing. Ask the user with a recommendation.
- Schema/migration/push correctness (memory note): migration file → supabase db push → type regen → verify before declaring done.
- Prefix PowerShell snippets with: cd "C:\Users\scott\Desktop\Client Software Platform"
- Use the Claude Preview MCP for live verification.
- The Library + Notes + Reports right-panel structure is protected.

**End-of-phase output:** Summary covering: (1) migration files added, (2) RLS / RPC / audit register updates, (3) component changes in SessionBuilder.tsx + actions.ts + portal RPC + portal Logger, (4) what was tested (live preview + a known scenario like "Set 1 = 80kg, Set 3 = 85kg"), (5) the column-drop follow-up migration listed as a separate task. Wait for explicit sign-off before the user spins a fresh chat for Phase D.

Confirm you've read the docs above and are ready to proceed.
```

---

## Phase D — Action bar between + insert-in-place + groups-across-bar

```
You're picking up the Odyssey project's session-builder polish pass at Phase D.

**Project root:** C:\Users\scott\Desktop\Client Software Platform.

**Read first, in this order:**
1. CLAUDE.md.
2. docs/polish/session-builder.md — focus on §2.3 (action bar gap), §4 row D (phase scope).
3. The reference prototype session-builder.html — the action-bar slot model (data-between="N-M") and doSS / addEx behaviour.
4. Memory at .claude/projects/.../memory/MEMORY.md.

**Phase D scope:** Move the action bar to between cards, fix the superset semantics, and make insert-in-place work.
- CardActions component (currently rendered below each card in SessionBuilder.tsx ~line 1158) moves to a between-cards slot. One slot per gap, including before the first card and after the last.
- The Superset button between Card N and Card N+1 groups the two cards on either side. Replace groupWithAboveAction with groupAcrossActionBar(slotPosition) that picks both adjacent program_exercises by sort_order and assigns them a shared superset_group_id (or joins an existing group when one side is already in one).
- "+ Add exercise" between Card N and Card N+1 inserts the next-picked library exercise at that slot. Track insertAfterPeId | null in component state. addExerciseToDayAction accepts an optional insertAfterPeId and shifts subsequent sort_orders by +1 in a single transaction.
- An action bar after the last card preserves the existing "append at the bottom" behaviour.

**Precondition:** Phase C signed off. Per-set storage is live, set rows are independently editable.

**Edge cases to handle:**
- Inserting between Card 2 and Card 3 where Card 2 + Card 3 are in the same superset group → the new exercise inherits the group (joins the superset).
- Grouping across the bar where one card is already in a group with its neighbours on the other side → join the existing group rather than minting a new id.
- Ungroup behaviour when a group has only two members and one is removed → second member's superset_group_id is cleared (existing logic in ungroupFromSupersetAction handles this; verify it still applies after the action-bar restructure).

**Working norms:**
- Polish-pass protocol: gap doc is the contract.
- No guessing. Where the prototype is silent on an edge case (e.g. dragging a group-of-2's first member out — see Phase G later), surface the decision rather than picking.
- Prefix PowerShell snippets with: cd "C:\Users\scott\Desktop\Client Software Platform"
- Use Claude Preview MCP for verification.
- Sort_order rewrites: prefer a single transactional shift. If supabase-js doesn't expose a clean transaction, use an RPC.
- The Library + Notes + Reports right-panel structure is protected.

**End-of-phase output:** Summary: (1) component restructure (between-card slot model), (2) action changes (groupAcrossActionBar, addExerciseToDayAction overload, optional new RPC for the sort_order shift), (3) tested scenarios — superset between adjacent cards, insert into the middle, insert at end, insert into a superset, ungroup edge cases. Wait for explicit sign-off.

Confirm you've read the docs above and are ready to proceed.
```

---

## Phase E — Section-title dropdown + dedupe + library filter chips

```
You're picking up the Odyssey project's session-builder polish pass at Phase E.

**Project root:** C:\Users\scott\Desktop\Client Software Platform.

**Read first, in this order:**
1. CLAUDE.md.
2. docs/polish/session-builder.md — focus on §2.6 (section title), §2.8 (library filters), §4 row E (phase scope).
3. The seed data for section_titles, movement_patterns, exercise_tags in supabase/migrations/20260420102400_bootstrap_functions.sql and 20260423100000_session_types.sql.
4. The new-exercise form at src/app/(staff)/library/new/_components/NewExerciseForm.tsx for how patterns/tags are loaded today.

**Phase E scope (independent of D, can run in parallel):**

A. Section-title canonical dropdown.
- SectionTitleField becomes a dropdown sourced from section_titles for the org (filter is_active or deleted_at IS NULL as appropriate; check the schema).
- Include a "+ Add section…" option that POSTs a new row to section_titles. Reuse any existing org-scoped insert path.
- On the program_exercises row, store section_title as text matching the label, NOT a foreign key — schema treats it as text.

B. Section-title bar dedupe.
- In renderGroupedExercises (or wherever the section bar is emitted), only render the bar on the FIRST card of a run of consecutive cards sharing the same section_title.
- The previous bar still shows when the section changes.
- Empty section_title means "no section" — those cards have no bar.

C. Library filter chips.
- Above the search input in LibraryPanel: row of movement-pattern chips (load from movement_patterns).
- Below the search input: row of exercise-tag chips (load from exercise_tags).
- Multi-select within a category, AND across categories (chip A + chip B = exercises matching both).
- An "All" / "Reset" affordance when any filter is active.
- Filters apply on top of the existing search.

**Precondition:** Phase D signed off. Action bar is between cards.

**Working norms:**
- Polish-pass protocol: gap doc is the contract.
- No guessing. If section_titles ordering or "is the dropdown searchable?" needs deciding, ask.
- Prefix PowerShell snippets with: cd "C:\Users\scott\Desktop\Client Software Platform"
- Tokens only — no hardcoded hex during chip styling.
- The Library + Notes + Reports right-panel structure is protected; we're adding controls *inside* the Library tab, not changing the tab structure.

**End-of-phase output:** Summary: (1) SectionTitleField changes + dedupe logic location, (2) LibraryPanel filter chip components + data fetch, (3) tested — pick a canonical section, add a custom one, dedupe a run of three same-section cards, filter by movement pattern, filter by tag, filter by both, reset. Wait for explicit sign-off.

Confirm you've read the docs above and are ready to proceed.
```

---

## Phase F — Swap-in-place + "Load / Notes" metric dropdown

```
You're picking up the Odyssey project's session-builder polish pass at Phase F.

**Project root:** C:\Users\scott\Desktop\Client Software Platform.

**Read first, in this order:**
1. CLAUDE.md.
2. docs/polish/session-builder.md — focus on §2.4 (swap), §2.7 (metric dropdown), §4 row F (phase scope), §0.1 sign-off log Q5 (the swap semantics — defaults of new exercise come along, slot keeps position/section/group).
3. supabase/migrations/20260420101300_exercise_metric_units.sql for the metric units schema.
4. src/app/(staff)/library/new/_components/NewExerciseForm.tsx for how the new-exercise form already consumes exercise_metric_units.

**Phase F scope:**

A. Swap-in-place.
- Click an exercise's name → right panel forces the active tab to Library and renders a "Replacing: {old name}" header strip with a Cancel button.
- Next click in the library swaps the exercise in place.
- Server action swapProgramExerciseAction(programExerciseId, newExerciseId): in one transaction, soft-delete the old program_exercises row, insert a new row at the same sort_order / section_title / superset_group_id, populate the prescription from the new exercise's defaults (default_sets, default_reps, default_metric, default_metric_value, default_rpe, default_rest_seconds, instructions). With per-set storage live (Phase C), the action also creates default_sets-many program_exercise_sets rows.
- The slot's clinical sequencing (section, superset, position) is preserved; the prescription is reset to the new exercise's defaults.
- exercise_logs.exercise_id history survives by design — the FK is on exercise_id, not program_exercise_id.

B. "Load / Notes" cell becomes a metric dropdown + value input.
- The single freetext cell splits into [value input][metric select].
- Metric select sources exercise_metric_units for the org (filter is_active = true, deleted_at IS NULL, ordered by sort_order). Same data shape the new-exercise form uses.
- On load, defaults to the program_exercise_sets row's optional_metric (or the exercise's default_metric on a fresh row, or "—" if null).
- Read-only display: "{value} {display_label}" — e.g. "80 kg", "3:00 min:sec", "BW" (for bodyweight with empty value).
- This applies to every set row independently (per-set storage from Phase C).

**Precondition:** Phases C + E signed off. Per-set storage is live; section_titles dropdown is wired.

**Working norms:**
- Polish-pass protocol: gap doc is the contract.
- No guessing. Where the swap UX is silent (e.g. what happens if the user cancels mid-swap and clicks the name on a different exercise?), ask.
- Prefix PowerShell snippets with: cd "C:\Users\scott\Desktop\Client Software Platform"
- Tokens only.
- The Library + Notes + Reports right-panel structure is protected; we're adding a *mode* (Replacing X) on top of the existing Library tab, not changing the tab structure.

**End-of-phase output:** Summary: (1) swap action + UI flow, (2) metric dropdown component + data fetch, (3) tested — swap a solo exercise, swap a member of a superset (group is preserved), swap clears prescription correctly, metric dropdown for kg/lb/bodyweight/time_minsec/etc. renders correctly, value input formats. Wait for explicit sign-off.

Confirm you've read the docs above and are ready to proceed.
```

---

## Phase G — Drag-and-drop reorder

```
You're picking up the Odyssey project's session-builder polish pass at Phase G.

**Project root:** C:\Users\scott\Desktop\Client Software Platform.

**Read first, in this order:**
1. CLAUDE.md.
2. docs/polish/session-builder.md — focus on §2.5 (drag-and-drop gap), §4 row G (phase scope).
3. The current moveProgramExerciseAction in src/app/(staff)/clients/[id]/program/days/[dayId]/actions.ts (the sentinel-swap pattern that handles a single position swap; for drag-and-drop we want bulk reorder).
4. CLAUDE.md: "Drag-and-drop in [the prototype] is shape-only; the production implementation has its own reorder logic." Up/down arrows stay for keyboard a11y.

**Phase G scope:**
- Install @dnd-kit/core and @dnd-kit/sortable. Pin to a recent stable version. Explain the choice in the install message.
- The GripVertical icon (currently decorative) becomes the drag handle. Keep arrow buttons.
- Drop targets = the between-card slot model from Phase D. Dropping in a slot positions the dragged card at that slot.
- Edge cases:
  - Drag a member out of a superset group → it ungroups (and if the group has only two members, the remaining member's superset_group_id clears too — same logic as ungroupFromSupersetAction).
  - Drag into a superset group → it joins the group (inherits superset_group_id).
  - Drop onto the slot at the very top (before all cards) → sort_order shifts everyone down.
- New server action: reorderProgramExercisesAction(dayId, orderedIds: string[]). Takes the full new order, writes sort_orders in one transaction. Cleaner than chained swaps when dragging across multiple positions.
- Group-membership changes during drag get computed client-side from the slot the card lands in (which group is on either side of the slot?). The action accepts a per-id { sort_order, superset_group_id } and writes both atomically.

**Precondition:** Phase D signed off (between-card slot model exists; drag uses the same slots).

**Working norms:**
- Polish-pass protocol: gap doc is the contract.
- No guessing. Drag-into-the-middle-of-an-existing-superset has multiple reasonable interpretations (insert as a member? split the group around the drop?); surface the question.
- Explain any new dependency before installing it.
- Prefix PowerShell snippets with: cd "C:\Users\scott\Desktop\Client Software Platform"
- Tokens only for drag-state styling.
- A11y: the drag handle gets a sensible aria-label; keyboard reorder via arrows still works.

**End-of-phase output:** Summary: (1) dnd-kit install + version, (2) handle/slot wiring, (3) reorderProgramExercisesAction + transactional sort_order writes, (4) tested — drag a solo to reorder, drag into a superset (joins), drag a superset member out (ungroups), drag to top, drag to bottom, keyboard arrows still work. Wait for explicit sign-off.

Confirm you've read the docs above and are ready to proceed.
```

---

## Phase H — "Last logged" footer

```
You're picking up the Odyssey project's session-builder polish pass at Phase H.

**Project root:** C:\Users\scott\Desktop\Client Software Platform.

**Read first, in this order:**
1. CLAUDE.md.
2. docs/polish/session-builder.md — focus on §2.9 (last logged gap), §4 row H (phase scope).
3. supabase/migrations/20260420101900_session_logging.sql — exercise_logs and set_logs schemas. Note exercise_logs.exercise_id is the right join key (FK on exercise_id, not program_exercise_id, so history survives swaps).
4. src/app/(staff)/clients/[id]/program/days/[dayId]/page.tsx — current page loader where the new query lives.

**Phase H scope:** Render a "Last logged" footer at the bottom of each exercise card's prescription column.

- One per program_exercise: the most recent exercise_logs row for this exercise_id and this client (joined via sessions.client_id), with completed_at IS NOT NULL.
- Aggregate the matching set_logs into a render string. Format examples:
  - "Last: 4 × 6 @ 80kg" (uniform load)
  - "Last: 4 × 6 @ 75–85kg" (load varied across sets)
  - "Last: 3 × 8 e/s BW" (bodyweight, no load value)
  - "Last: 2 × 10" (no metric/value)
- Append a date stamp: "Last: 4 × 6 @ 80kg · 9 days ago" (use the time-ago convention from the design system / NotesPanel).
- If no history (the empty pre-launch state), the line doesn't render — no "no history" placeholder.

**Implementation suggestion (gap doc §2.9 has a SQL sketch):**
- Single batched query in the page loader. SELECT DISTINCT ON (el.exercise_id) ordered by completed_at DESC, scoped to this client's sessions, restricted to the exercise_ids on this day.
- For each exercise_id, a follow-up read of set_logs grouped by set_number to build the render string. Or do this in a single CTE.
- Pass the resulting map { exercise_id → renderString } down to SessionBuilder.

**Precondition:** Phase C signed off (set storage symmetry with set_logs is what makes this query clean).

**Working norms:**
- Polish-pass protocol: gap doc is the contract.
- No guessing. The exact load-range-format ("75–85kg" vs "75/80/85kg") is a UX call worth asking.
- Prefix PowerShell snippets with: cd "C:\Users\scott\Desktop\Client Software Platform"
- Tokens only.
- The Library + Notes + Reports right-panel structure is protected.

**End-of-phase output:** Summary: (1) loader query, (2) rendering location + format decisions, (3) tested — at least one program_exercise with prior history (you may need to seed a session_log fixture pre-launch), one without history (line absent), one with varied loads, one with bodyweight. Wait for explicit sign-off.

Confirm you've read the docs above and are ready to proceed.
```

---

## Phase I — Polish round (empty-state CTA, sticky panel, autosave tick, duplicate button, pencil affordance)

```
You're picking up the Odyssey project's session-builder polish pass at Phase I — the final phase.

**Project root:** C:\Users\scott\Desktop\Client Software Platform.

**Read first, in this order:**
1. CLAUDE.md.
2. docs/polish/session-builder.md — focus on §2.12, §2.13, §2.14, §2.15, §2.16, §4 row I.
3. supabase/migrations/20260503130000_program_copy_repeat.sql for the existing day-copy machinery. The duplicate-button RPC reuses this pattern.

**Phase I scope:**

A. Empty-state CTA (§2.12).
- EmptyState component gets a "Browse the library" button that focuses the library search input + briefly flashes the panel border. Reuse the existing focusLibrarySearch helper (line ~1198 in current SessionBuilder.tsx).

B. Right-panel sticky behaviour (§2.15).
- The right aside becomes position: sticky; top: 20px; height: calc(100vh - 40px); overflow-y: auto. Long Notes/Reports lists scroll within the panel.

C. Autosave tick (§2.16).
- When InlineCell / EditableTextarea / SmallField autosave resolves successfully, briefly flash a green checkmark inside the cell border (200ms in, 600ms hold, 400ms out, cubic-bezier easing per design system).
- On error, the existing red border persists until the next edit.
- No "Saving…" text — just the post-save tick.

D. Duplicate-button implementation (§2.13).
- New RPC duplicate_program_day(p_source_day_id uuid, p_target_date date) that copies the program_day row + all program_exercises (and their program_exercise_sets, given Phase C is done) to the target date as a draft (published_at = NULL). Source day untouched.
- New action duplicateProgramDayAction wired to the Duplicate button.
- Click → date picker (reuse the calendar's existing one) → on confirm, navigate to /clients/{id}/program/days/{newDayId}.
- If the target date already has a day for this client, ask the user (overwrite? add as a second day?). Surface this decision.

E. Pencil affordance (§2.14).
- DayLabelEditor pencil opacity: 0 → 0.25 at rest, 0.55 → 0.6 on hover. Subtle bump for discoverability.

**Precondition:** Phases A–H signed off.

**Working norms:**
- Polish-pass protocol: gap doc is the contract.
- No guessing. The "duplicate where target date is occupied" UX is the main decision worth surfacing.
- Prefix PowerShell snippets with: cd "C:\Users\scott\Desktop\Client Software Platform"
- Tokens only — autosave tick uses var(--color-accent), error border uses var(--color-alert).
- The Library + Notes + Reports right-panel structure is protected.

**End-of-phase output:** Summary: (1) per-item changes, (2) tested — empty state CTA works, panel stays visible at all scroll positions, autosave tick shows + clears cleanly, duplicate creates a draft on the target date and navigates, pencil is now discoverable at rest. This is the FINAL phase of the session-builder polish pass; once signed off, the section is closed and the polish-pass protocol moves to the next section per CLAUDE.md's polish-pass order list.

Confirm you've read the docs above and are ready to proceed.
```

---

## Notes on using these prompts

- Each prompt assumes prior phases have been signed off. If you skip ahead (rare), the new instance will still try to read the gap doc and may flag missing preconditions — that's good.
- The "Read first" lists name CLAUDE.md and the gap doc. The new instance does not have access to this chat's context; the doc is the contract.
- The user is an Exercise Physiologist learning to build, not a developer. The handoff prompts inherit that working style: explain trade-offs, ask before proceeding on judgment calls.
- If a phase finishes in fewer changes than expected, the gap doc may need a follow-up note — but never silently re-decide. Ask in chat.
- Each phase ends with explicit sign-off. The user signs off; the next chat starts.
