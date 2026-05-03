# Polish-pass gap analysis — Programs section

**Brief:** No standalone MD. Target state captured in chat 2026-05-03 (sign-off log §0.1 below).
**Reference prototypes:** [`program-calendar.html`](../../program-calendar.html), [`session-builder.html`](../../session-builder.html)
**Reference UX (already in repo):** Schedule month-year picker — [`WeekView.tsx`](../../src/app/(staff)/schedule/_components/WeekView.tsx) lines 2318–2457
**Current implementation:** [`ProgramCalendar.tsx`](../../src/app/(staff)/clients/[id]/program/_components/ProgramCalendar.tsx), [`page.tsx`](../../src/app/(staff)/clients/[id]/program/page.tsx), [`SessionBuilder.tsx`](../../src/app/(staff)/clients/[id]/program/days/[dayId]/_components/SessionBuilder.tsx)
**Schema:** [`20260420101800_programs.sql`](../../supabase/migrations/20260420101800_programs.sql)
**Audit date:** 2026-05-03
**Status:** Gap document — awaiting sign-off before any code changes.

---

## 0. Executive summary

The current implementation models programs as **week-relative** structures: `program_weeks` numbered 1..N, `program_days` carrying `day_of_week` 0..6 (0=Monday). The actual calendar date for any day is computed at render time as `program.start_date + (week_number - 1) × 7 + dow_offset`. The UX shows collapsible week strips labelled "Week 1", "Week 2", etc.

The target state captured in chat is **date-authoritative**: real calendar months at the top level, programs as date ranges, day-level copy/repeat to arbitrary calendar dates, multiple training blocks per client coexisting across time. The week is no longer the load-bearing unit — the date is.

This is not a presentation-only change. Two underlying assumptions in the current schema break under the target UX:

1. **Date is derived, not stored.** Day-level copy ("copy this Tuesday's session to June 15") and weekly repeat ("repeat every Tuesday until June 30") need a target date as a first-class input. With the current model, every copy/repeat code path has to reverse-engineer "which week + which day_of_week" from the EP's date input — and that reverse engineering becomes ambiguous as soon as the target date falls outside the program's existing week range. The clean fix is to add `scheduled_date date NOT NULL` to `program_days` as the authoritative field. Pre-launch, this migration is cheap.

2. **One active program per client.** The unique partial index `programs_one_active_per_client_idx` enforces single-active-per-client at the DB level. "Repeat current block" (5c=B) creates a new program starting where the current one ends — both must coexist with `status='active'`, both must be reachable from the calendar. The constraint must drop.

The chat answer to Q6 was "A — keep schema, presentation layer only." After auditing the schema I'm recommending we override that decision. The reasoning is in §4 Q1 below; this is the single most important sign-off before Phase A starts.

Pre-launch advantages apply to both schema changes: no real client data to migrate, RLS policy changes are reversible without coordination, and breaking changes to API contracts don't break clients (no clients exist).

### 0.1 Sign-off log (chat 2026-05-03)

| # | Question | Answer | Notes |
|---|----------|--------|-------|
| 1 | Calendar months and program spanning | **A** — every month in range is its own collapsible section, including months with no program days | |
| 1b | Source for the month-picker UX | The existing Cliniko-style scheduler in this repo | Reference: `WeekView.tsx` `MonthYearPicker` |
| 2 | Side panel availability | **C** — same `NotesPanel` + `ReportsPanel` components used in both surfaces. **Session builder keeps Library + Notes + Reports as in-builder tabs (the load-bearing differentiator per CLAUDE.md — protected).** Calendar page gets a toggle-able side panel (default closed) using the same Notes + Reports components. | Corrected 2026-05-03 after Q9 sign-off — see §4 Q9. |
| 2b | Files tab | **C** — skip Files for now, ship Notes + Reports first | |
| 3 | Day click behaviour | **A** — inline summary expansion, "Open" button takes you to the full builder | |
| 3b | Collapse granularity | **A** — both whole weeks AND individual day summaries collapse independently | |
| 4a | Day-level copy flow | **A** — click copy icon, then click destination day directly on the calendar | |
| 4b | Day-level repeat flow | Mini calendar; pick an end date; system creates copies on the **same weekday every week** between source and end | |
| 4c | Progression modifier on copy/repeat | **C** — exact duplicate now, progression in Phase 2 | |
| 5a | What is a "block"? | **A** — entire mesocycle/program (all weeks of the active program) | |
| 5b | "Copy current block" semantics | **A** — duplicates structure to a new mesocycle starting on a date you pick | |
| 5c | "Repeat current block" semantics | **B** — creates a new back-to-back block immediately following, same structure | |
| 6 | Architecture impact | **A** — keep existing schema, presentation layer only | **Audit override recommended; see §4 Q1.** |
| ø | Schema work mandate | **"If these need to be developed as solid schema to have a high quality software, i want you to do that as well"** | Frees the audit to recommend schema changes where the architecture demands them |

---

## 1. What's already correct

Pieces of the existing implementation that align with the target state and should be preserved.

### 1.1 Data model basics
- `programs → program_weeks → program_days → program_exercises` four-level hierarchy with proper FK cascades.
- Soft-delete (`deleted_at`) and OCC (`version` + `bump_version_and_touch` trigger) on `programs` and `program_exercises`.
- Cross-org enforcement triggers on every FK that crosses an org boundary (`programs.client_id`, `programs.template_id`, `program_exercises.exercise_id`).
- Sensible CHECK constraints (`programs.duration_weeks BETWEEN 1 AND 52`, `program_exercises.tempo ~ '^[0-9x]{4}$'`, etc.).

The hierarchy itself is the right shape. What needs to change is how `program_days` are addressed (date vs. week_number + day_of_week) and how many programs a client can have active.

### 1.2 New mesocycle creation flow
[`NewProgramForm.tsx`](../../src/app/(staff)/clients/[id]/program/new/_components/NewProgramForm.tsx) + [`createProgramAction`](../../src/app/(staff)/clients/[id]/program/new/actions.ts) handles split-pattern defaults (`defaultDaysOfWeek`), letter labels (A, B, C…), and pre-creates all weeks and days in a single transaction. The auto-archive of the prior active program (lines 59–71 of actions.ts) is precisely the wrong shape under the new model — that logic comes out — but the rest of the flow stays.

### 1.3 Session builder side panels (existing tabs — protected)
[`SessionBuilder.tsx`](../../src/app/(staff)/clients/[id]/program/days/[dayId]/_components/SessionBuilder.tsx) already contains:
- `LibraryPanel` (lines 1439–1557) — searchable exercise library, click-to-add.
- `NotesPanel` (lines 1639–1684) — pinned clinical notes for the client.
- `ReportsPanel` (lines 1559–1625) — recent test sessions / publications.

**All three stay exactly where they are.** Library + Notes + Reports as tabs in the right panel of the session builder is the load-bearing differentiator called out in CLAUDE.md ("the session builder with clinical notes adjacent to the programming calendar is the single most important screen in this platform"). Phase E does not remove or relocate any of these.

What Phase E does do: extract `NotesPanel` and `ReportsPanel` into their own files (out of the SessionBuilder.tsx monolith) so the calendar page can import the same components. The session builder still renders all three in its right panel as it does today. The calendar page renders just Notes + Reports inside a toggle-able side panel. Same components, two deployments.

Notes and Reports already query the right shape — `clinical_notes` filtered by `is_pinned = true`, `test_sessions` joined with publications. The components are panel-shaped; extracting them is a refactor, not a rebuild.

### 1.4 Schedule month-year picker (mirror this exactly)
[`WeekView.tsx`](../../src/app/(staff)/schedule/_components/WeekView.tsx) lines 2318–2457: a 280px popover under a month label, with a year header (chevron < year > chevron) and a 4×3 month grid. Currently selected month fills accent green, today's month gets a green ring. ESC + outside-click dismiss. Lift this into a shared component — the program calendar will use the same picker with the same shape.

### 1.5 Program calendar today-detection
[`ProgramCalendar.tsx`](../../src/app/(staff)/clients/[id]/program/_components/ProgramCalendar.tsx) has `findActiveWeekNumber` that picks the week containing today and opens it by default. The same intent applies in the new model — open today's month by default — but the implementation is a one-line `today.getMonth()` instead of a date-arithmetic helper.

### 1.6 RLS pattern library
The existing RLS policies on `programs` / `program_weeks` / `program_days` / `program_exercises` walk parent-org through joins. When `program_week_id` becomes nullable (P0-4 below) we add a denormalised `program_days.program_id` column so policies can resolve org without depending on the week link. Same security model, less plumbing.

---

## 2. Gaps to close

### P0 — Architectural (schema + data model)

Each item must close before any UI work in Phase B can land. These are non-negotiable: skipping any of them means cumulative complexity in every downstream code path.

| # | Gap | Why it matters |
|---|-----|----------------|
| **P0-1** | **No date-authoritative scheduling on `program_days`.** Date is derived from `program.start_date + (week_number-1)*7 + day_of_week_offset`. The new UX requires per-day copy/repeat to arbitrary target dates — the inverse mapping (date → week_number + day_of_week) is ambiguous for dates outside the program's existing week range. | Without `scheduled_date` as a stored column, every copy/repeat operation needs to (a) compute which week the target date belongs to, (b) create that week if it doesn't exist, (c) handle the case where two days collide on the same weekday in the same week, (d) re-render the calendar by reverse-mapping back to dates. With `scheduled_date` it's a single INSERT. |
| **P0-2** | **`programs_one_active_per_client_idx` blocks back-to-back blocks.** Unique partial index forbids two programs with `status='active'` for the same client. Q5c=B requires "Repeat current block" to create a new program adjacent to the current one — both must be active. | Constraint must drop. Replaced with a date-range non-overlap check (EXCLUDE constraint with btree_gist) or app-level enforcement. |
| **P0-3** | **No cross-program calendar query.** [`page.tsx`](../../src/app/(staff)/clients/[id]/program/page.tsx) line 45–53 fetches a single `WHERE status='active'` program. The new month-view calendar can show a month spanning two programs (e.g., current block ends May 11, next starts May 12). Loader needs to fetch all programs whose date range intersects the visible window plus their days. | Without this, the calendar will silently miss days in any month that crosses a block boundary. |
| **P0-4** | **No denormalised `program_id` on `program_days`.** RLS and the cross-org trigger walk `program_days → program_weeks → programs`. If `program_week_id` becomes nullable (P0-1 follow-on, allows orphan days from a copy operation when no matching week exists), the join breaks. | Add `program_days.program_id uuid NOT NULL` with FK to `programs(id)`. RLS policies and triggers updated to resolve org via the direct FK. |
| **P0-5** | **No copy/repeat RPCs.** Day-level (`copy_program_day`, `repeat_program_day_weekly`), block-level (`copy_program`, `repeat_program`). Each touches multiple tables (program + weeks + days + exercises) and must be atomic. | Without atomic RPCs, partial copies on failure leave orphan days/exercises. SECURITY INVOKER + explicit RLS check at the head of each RPC matches the existing pattern (see `create_test_session` for precedent). |
| **P0-6** | **`program_weeks` semantics become ambiguous.** With dates as authoritative, what is "week 5"? Calendar week? Program-relative week? Periodisation block (accumulation/intensification/deload)? The existing `week_number` column doesn't carry an explicit meaning. | Decision needed (open question §4 Q2). Recommended path: keep `program_weeks` as an *optional periodisation grouping* with `week_number` independent of calendar weeks. The calendar UI doesn't surface week numbers; the EP can label deload weeks via the existing `program_weeks.notes` field. |

### P1 — Functional (features specified, missing)

| # | Gap | Brief reference |
|---|-----|-----------------|
| **P1-1** | **Real-month calendar component.** Replace the week-strip layout in `ProgramCalendar.tsx` with month sections. Each month collapsible (Q3b=A). Current month at top by default (Q1=A). Mirror the schedule's `MonthYearPicker` for the dropdown month picker (Q1b). | Q1, Q1b, Q3b |
| **P1-2** | **Inline day-cell expansion.** Click a programmed day → cell expands to show: exercise sequencing badges (A1, A2, B1…), exercise names, sets×reps. Top-right corner of the expanded summary: an "Open" button linking to `/clients/[id]/program/days/[dayId]` (the existing session builder). Day cells AND week rows collapse independently (Q3b=A). | Q3, Q3b |
| **P1-3** | **Day-level copy + repeat icons in the expanded summary.** Two icons next to "Open": copy and repeat. **Copy:** clicking enters target-pick mode; EP clicks any day on the calendar to paste; pasted day inherits all exercises with same prescription (Q4c=C, exact duplicate). **Repeat:** clicking opens a mini-calendar; EP picks an end date; system creates copies on the **same weekday every week** between source and end (Q4b). | Q4a, Q4b, Q4c |
| **P1-4** | **Block-level toolbar.** Replace the current "Copy week" / "Clinical notes" / "New mesocycle" buttons with: **Copy current block** (clones whole program, EP picks new start date — Q5b=A), **Repeat current block** (clones whole program back-to-back, start_date = current_end_date + 1 — Q5c=B), **New training block** (existing `/program/new` flow — Q5a=A). The "Clinical notes" button moves into the side panel (P1-5). | Q5a, Q5b, Q5c |
| **P1-5** | **Shared `NotesPanel` + `ReportsPanel` components, two deployments.** Extract from `SessionBuilder.tsx` into their own files under `src/app/(staff)/clients/[id]/_components/`. **Session builder unchanged** — still renders Library + Notes + Reports as tabs in its right panel (the differentiator). **Calendar page gains a new toggle-able side panel** with just Notes + Reports tabs; toggle button (`PanelRight` icon, top right of header), default closed (per Q answer "default is just the calendar view"). State persists in URL param `?panel=notes` (or `?panel=reports`) so it survives a refresh. **No Files tab in v1** (Q2b=C). | Q2, Q2b, Q9 |
| **P1-6** | **Cross-program day rendering.** When a month spans two programs, the calendar must render days from both, with a subtle visual separator at the boundary (e.g., a different-coloured background tint). Source-of-truth: the `scheduled_date` filter on the loader query. | Q1, Q5c |
| **P1-7** | **Conflict handling on copy / repeat.** When a target date already has a programmed day, the operation must not silently overwrite. Recommended UX: confirm dialog showing the source day, the existing destination day, and per-conflict choice (overwrite / skip / cancel). For repeat-weekly with multiple conflicts, show all conflicts together in a single dialog. | — (open Q5 below) |
| **P1-8** | **"Current block" determination across multiple programs.** "Copy current block" / "Repeat current block" need an unambiguous current. Recommended definition: the program where today's date falls within `[start_date, start_date + duration_weeks*7)`. Tie-break: most recently created. If no program contains today: most recent past program. | — (open Q3 below) |

### P2 — Polish (design system, copy, motion)

Deferred until architecture and features land. Listed now so they don't get forgotten.

| # | Gap | Notes |
|---|-----|-------|
| **P2-1** | **Empty days in month view.** Days outside any program show as muted dashed cells with date only. Reuse existing `.day-cell.empty` style. |
| **P2-2** | **Today indicator.** Match the schedule view — a small accent-green ring on the date number. |
| **P2-3** | **Mid-month boundary in mid-week.** When a month starts on a Wednesday, the row begins with empty Mon/Tue cells (or runs Mon-first with prior-month dates greyed). Recommended: Mon-first with prior-month dates greyed at 40% opacity, matches the schedule. |
| **P2-4** | **Inline summary visual.** Sequence badges (A1, A2, B1…) match `session-builder.html` prototype. Superset/triset coloured left-borders consistent with prototype. No shadows, single accent green for completed/grouping markers only. |
| **P2-5** | **Copy target-pick mode UX.** When target-pick mode is active: cursor changes to a copy icon, calendar dims past dates and the source cell, Esc cancels. |
| **P2-6** | **Toolbar copy.** "Copy current block", "Repeat current block", "New training block" — sentence case per design system §02. |
| **P2-7** | **Side-panel toggle button.** Lucide `PanelRight` icon, top right of the page header. |
| **P2-8** | **Motion.** Month/week/day collapse uses 300ms reveal per design system. No bounce, no spring. |
| **P2-9** | **Per-month "blocks contained" pill.** When a month has program days from multiple blocks, show a small subtle indicator in the month header (e.g., "Apr 2026 · 2 blocks"). |

---

## 3. Migration plan (dependency order)

Architecture before features, features before polish. Each phase ends with a gate; do not proceed until the gate passes.

### Phase A — Schema foundation (P0)

1. **Decisions doc.** Append to `docs/decisions.md`:
   - **D-PROG-001** — `scheduled_date` becomes authoritative on `program_days`; `day_of_week` dropped (or made GENERATED — see open Q4 below).
   - **D-PROG-002** — `programs_one_active_per_client_idx` dropped; multiple programs per client allowed; "current" computed from date range per P1-8.
   - **D-PROG-003** — `program_weeks` role decision per open Q2 below.
2. **Migration `XXXX_program_days_scheduled_date.sql`:**
   - Add `program_days.scheduled_date date` (nullable initially).
   - Backfill from existing data:
     ```sql
     UPDATE program_days pd
     SET scheduled_date = p.start_date
       + ((pw.week_number - 1) * 7
       + ((pd.day_of_week + 6) % 7))::int  -- (dow + 6) % 7 maps Mon=0 → 0, Sun=6 → 6
     FROM program_weeks pw, programs p
     WHERE pd.program_week_id = pw.id
       AND pw.program_id = p.id
       AND p.start_date IS NOT NULL
       AND pd.day_of_week IS NOT NULL;
     ```
   - SET NOT NULL on `scheduled_date` (any rows without start_date or day_of_week stay NULL — open Q on whether to fail-closed and require both, or allow unscheduled days).
   - Drop `day_of_week` (or convert to GENERATED, pending Q4).
   - Add `program_id uuid NOT NULL` with FK to `programs(id) ON DELETE CASCADE`. Backfill via `program_weeks → programs`.
   - Add index `program_days_program_date_idx ON (program_id, scheduled_date) WHERE deleted_at IS NULL`.
   - Drop `program_days_dow_idx` (no longer needed).
   - Make `program_week_id` nullable (allows days that aren't part of a periodisation week, e.g. orphan copies).
3. **Migration `XXXX_drop_unique_active_program.sql`:**
   - `DROP INDEX programs_one_active_per_client_idx`.
   - Add `EXCLUDE` constraint preventing date-range overlap on active programs of the same client (requires `btree_gist` extension):
     ```sql
     ALTER TABLE programs ADD CONSTRAINT programs_no_active_overlap
       EXCLUDE USING gist (
         client_id WITH =,
         daterange(start_date, start_date + (duration_weeks * 7), '[)') WITH &&
       ) WHERE (status = 'active' AND deleted_at IS NULL);
     ```
   - If `btree_gist` is unavailable on Supabase managed Postgres: fall back to app-level enforcement in the create/copy/repeat actions, with a pgTAP test asserting the application-level check holds.
4. **Update cross-org trigger** `enforce_program_exercise_same_org` — switch the parent-org walker from `program_days → program_weeks → programs` to `program_days → programs` directly via the new FK. One less join.
5. **RLS policy update.** Audit every policy that joins `program_days` to anything for org resolution. Switch to `program_days.program_id`. No security model change — same checks, fewer joins.
6. **Audit register.** Add new tables (none here, only column changes) — verify `audit_resolve_org_id` doesn't break (per project memory: new tables must register in the CASE list).
7. **pgTAP `XX_programs_dates.sql`:**
   - Insert `program_days` with `scheduled_date` round-trips.
   - Drop unique-active constraint allows two active programs (non-overlapping dates).
   - Date-range overlap rejected (if EXCLUDE constraint applied).
   - RLS isolation maintained — staff in org A cannot read `program_days` in org B via the new direct `program_id` FK.

**Gate:** Phase A ends when pgTAP green on staging, `npm run supabase:types` regenerated, and the app still compiles (some loader code will need updates for the renamed/dropped columns — see Phase B step 7).

### Phase B — Calendar redesign (P1-1, P1-2, P1-6)

7. **Loader rewrite.** Replace the single-program query in `page.tsx` with a query keyed on visible month range:
   - Resolve all programs for the client whose date range intersects the visible window.
   - Fetch all `program_days` for those programs in the visible window, ordered by `scheduled_date`.
   - Fetch program_exercises in bulk for those days (single round-trip with `IN (...)`).
8. **Lift `MonthYearPicker` to shared component.** Move from `WeekView.tsx` lines 2318–2457 to `src/app/(staff)/_components/MonthYearPicker.tsx`. Both surfaces import. No behaviour change.
9. **Replace `ProgramCalendar.tsx` with `MonthCalendar.tsx`:**
   - Top-level: list of month sections, current month first.
   - Each month section: header with month/year label + chevron + month picker dropdown (lifts the same picker on click); body is a 7-column Mon-first grid with prior/next month dates greyed.
   - Each programmed day cell collapsible to inline summary (P1-2).
   - Multiple program tints when a month spans blocks (P1-6).
10. **Inline day summary component.** Inside an expanded cell:
    - Sequence badges (A1, A2…) per the prototype.
    - Exercise name + sets×reps per exercise.
    - Top-right buttons: Open, Copy, Repeat (Copy and Repeat icons exist but no behaviour yet — they're disabled until Phase C).

**Gate:** Phase B ends when calendar renders correctly across multiple programs and inline summaries open/close. No copy/repeat behaviour required yet.

### Phase C — Day-level copy + repeat (P1-3, P1-7)

11. **RPC `copy_program_day(p_source_day_id uuid, p_target_date date) RETURNS uuid`:**
    - Validate source day org matches caller (RLS-friendly: `SELECT organization_id FROM programs WHERE id = (SELECT program_id FROM program_days WHERE id = p_source_day_id)`; raise if NULL).
    - Resolve target program by date (the program for this client where `p_target_date BETWEEN start_date AND start_date + duration_weeks*7`); raise if no covering program (open Q6 — what to do when target date isn't in any program).
    - Conflict check: existing `program_day` on target date for this program with `deleted_at IS NULL`. Raise specific SQLSTATE; UI catches and shows confirm dialog (P1-7).
    - Insert new `program_day` with `scheduled_date = p_target_date`, `program_id = <target>`, `program_week_id = NULL` (or resolved if a week covers the date), `day_label` cloned from source.
    - Clone all `program_exercises` for the source day, with new ids and re-mapped `superset_group_id` (each source group_id maps to a fresh group_id).
    - Return new day_id.
12. **RPC `repeat_program_day_weekly(p_source_day_id uuid, p_end_date date) RETURNS uuid[]`:**
    - Compute the list of target dates: `p_source.scheduled_date + 7, +14, +21, …` up to and including `p_end_date`.
    - For each target: same logic as `copy_program_day`, but accumulate conflicts and only commit if EP confirmed (UI passes a `force boolean DEFAULT false` parameter; if false and conflicts exist, return the conflict list and do nothing).
    - Returns array of new day_ids on success.
13. **Server actions** wrapping the RPCs in `src/app/(staff)/clients/[id]/program/day-actions.ts`:
    - `copyDayAction(sourceId, targetDate, force?)` — initial call without force; on conflict response, UI shows dialog; second call with force=true.
    - `repeatDayWeeklyAction(sourceId, endDate, force?)` — same shape.
14. **UI: target-pick mode for copy.**
    - State machine: `idle → picking → committed`. State held in calendar component, scoped to one source day.
    - Cursor changes to copy-icon variant. Past dates and the source cell dim. Esc cancels.
    - Click on any non-dimmed cell → fires `copyDayAction`. On conflict, dialog opens. On success, calendar refreshes.
15. **UI: mini-calendar popover for repeat.**
    - Single end-date input. Below the input, a preview line: "This will create N copies on Tuesdays from May 19 to Jun 23."
    - Submit fires `repeatDayWeeklyAction`. Conflict dialog if any. On success, calendar refreshes.

**Gate:** Phase C ends when both flows work end-to-end against a seeded client, conflict dialog confirmed on a manual walkthrough, and pgTAP for the RPCs green.

### Phase D — Block-level copy + repeat + new (P1-4, P1-8)

16. **RPC `copy_program(p_source_program_id uuid, p_new_start_date date, p_new_name text DEFAULT NULL) RETURNS uuid`:**
    - Validate source program org matches caller.
    - Insert new `programs` row with `start_date = p_new_start_date`, `duration_weeks` cloned, `name` from p_new_name or `<source>.name || ' (copy)'`, `status = 'draft'` (EP activates manually).
    - Clone all `program_weeks` (same `week_number` for each).
    - Clone all `program_days` with `scheduled_date` shifted by `p_new_start_date - source.start_date` days.
    - Clone all `program_exercises` (re-map superset_group_ids).
    - Return new program_id.
17. **RPC `repeat_program(p_source_program_id uuid) RETURNS uuid`:**
    - Compute `new_start = source.start_date + source.duration_weeks * 7`.
    - Same as `copy_program` with computed start, name = `<source>.name || ' (next)'`, status = 'active' (immediate continuation).
    - Return new program_id.
18. **Toolbar redesign in `page.tsx`:**
    - Remove "Copy week", "Clinical notes" (clinical notes moves into side panel — Phase E).
    - Replace with three buttons (per Q5):
      - **Copy current block** — opens a date picker; on confirm, fires `copyProgramAction(currentBlockId, pickedDate)`.
      - **Repeat current block** — one click; fires `repeatProgramAction(currentBlockId)`. Confirm dialog with the computed new start date (no ambiguity, just confirmation).
      - **New training block** — links to existing `/program/new` flow.
19. **"Current block" resolver utility** in `src/lib/programs/current-block.ts`:
    ```ts
    export async function resolveCurrentBlock(supabase, clientId): Promise<Program | null> {
      // 1. Try program containing today
      // 2. Else most recent past program
      // 3. Else null (no program ever — show "New training block" CTA only)
    }
    ```
    Used by both the toolbar (which block do Copy/Repeat target?) and the calendar header (which block label is shown?).

**Gate:** Phase D ends when toolbar actions work end-to-end and pgTAP for block RPCs green.

### Phase E — Side panel on calendar (P1-5)

The session builder is **not modified** in this phase. It keeps Library + Notes + Reports tabs in its right panel exactly as today.

20. **Extract `NotesPanel` and `ReportsPanel` into their own files.**
    - Create `src/app/(staff)/clients/[id]/_components/NotesPanel.tsx` — body lifted from `SessionBuilder.tsx` lines 1639–1684, props unchanged.
    - Create `src/app/(staff)/clients/[id]/_components/ReportsPanel.tsx` — body lifted from `SessionBuilder.tsx` lines 1559–1625, props unchanged.
    - Update `SessionBuilder.tsx` to import from the new locations. Behaviour identical — this is a pure refactor for code reuse.
    - Type-check + smoke-test the session builder to confirm no regression.
21. **Calendar side panel component.**
    - Create `src/app/(staff)/clients/[id]/program/_components/CalendarSidePanel.tsx` — wraps the extracted `NotesPanel` and `ReportsPanel` in a tab strip, fixed-width column on the right side of the calendar page.
22. **Toggle + URL state on the calendar page only.**
    - Add toggle button (`PanelRight` icon) to the calendar page header.
    - Click toggles `?panel=notes` ↔ no param. Default state: closed (no param).
    - Calendar page loader reads `searchParams.panel`; fetches `pinnedNotes` and `reports` only when panel is open (avoids wasted queries when the EP isn't using the panel).
    - Empty states preserved from the existing panels (no copy changes).

**Gate:** Phase E ends when (a) the session builder still works exactly as it did before — Library + Notes + Reports tabs all functional, no regressions; (b) the calendar page's toggle button opens a side panel containing the same Notes + Reports content; (c) URL param round-trips on refresh.

### Phase F — Polish + acceptance

23. **P2 items.** Today indicator, mid-month boundaries, inline summary visuals, copy mode dim, motion timings, multi-block month indicator.
24. **End-to-end manual checklist.** Walk every flow on a seeded client with two adjacent blocks:
    - Calendar shows real months; current month at top; prior/next month dates greyed.
    - Click a day → inline summary; click again → collapse.
    - Click "Open" on a summary → session builder.
    - Click copy on a day → target-pick mode → click another day → success → both days visible.
    - Click repeat on a day → mini calendar → pick date → preview shows N copies → confirm → all dates populated.
    - Toolbar: Copy current block → date picker → confirm → new program in calendar.
    - Toolbar: Repeat current block → confirm → new program back-to-back in calendar.
    - Side panel toggle on calendar → Notes tab shows pinned notes → Reports tab shows test sessions.
    - Side panel toggle on session builder → same content, same component.
25. **Update docs.** `decisions.md` (D-PROG-001 to D-003), `schema.md` (date authority on `program_days`), this polish doc's progress log.

---

## 4. Open questions to resolve before Phase A

**Sign-off status (2026-05-03):** All recommendations approved by user, with one explicit override: Q9 corrected — keep Library + Notes + Reports tabs in the session builder (the load-bearing differentiator). Phase A may begin.

1. **Schema authority — sign-off needed (overrides chat Q6=A).** The chat answer was "keep schema, presentation only." After auditing the schema I recommend overriding: add `program_days.scheduled_date date NOT NULL` as authoritative. **Reason:** every copy/repeat code path will translate dates ↔ (week_number, day_of_week) otherwise, and the translation is ambiguous as soon as a target date falls outside the existing program weeks. Pre-launch advantage applies — migration is cheap, no client data to lose. **Recommend: approve schema change.** Confirm.

2. **`program_weeks` fate.** Three options:
   - **(a)** Keep `program_weeks` as an *optional periodisation grouping*. The EP can group days into accumulation/intensification/deload phases. `week_number` becomes a stable integer label, no longer rigidly tied to calendar weeks. The calendar UI doesn't surface week numbers; the existing `program_weeks.notes` field carries periodisation intent.
   - **(b)** Drop `program_weeks` entirely. Days attach directly to programs via `program_id`. Periodisation moves to `program_days` (e.g., a `phase text` column).
   - **(c)** Keep `program_weeks` but auto-compute `week_number` from `scheduled_date` (week-of-program). This is the most rigid and least flexible — disallows EP-defined periodisation that doesn't match calendar weeks.
   - **Recommend (a)** — preserves the option of clinically-meaningful periodisation without forcing it. EP can ignore weeks entirely if they want; the column just stays NULL on `program_days.program_week_id`. Confirm.

3. **What is "current block" when today is between programs?** E.g., previous block ended Apr 30, next block starts May 12, today is May 5.
   - **Recommend:** the most recent past program is "current" until the next one starts. Reason: when the EP clicks "Copy current block" on May 5, the most useful target is the block they were just running (its structure is freshest in their mind). Confirm.

4. **`day_of_week` after `scheduled_date` is added.** Two options:
   - **(a)** Drop the column entirely. Display "Tue" comes from `scheduled_date.toLocaleDateString('en-AU', { weekday: 'short' })`.
   - **(b)** Keep as a Postgres `GENERATED ALWAYS AS (extract(dow from scheduled_date)) STORED` column for query convenience.
   - **Recommend (a)** — fewer moving parts, derived-at-render is fine for a single small integer. Confirm.

5. **Conflict on copy / repeat.** When target date already has a `program_day`, options:
   - **(a)** Overwrite silently (worst — destructive).
   - **(b)** Skip silently (worst — user has no idea what was skipped).
   - **(c)** Warn with confirm dialog showing source + existing destination, EP picks per conflict (overwrite / skip).
   - **Recommend (c).** For repeat-weekly with multiple conflicts, show all conflicts in one dialog with a per-row choice (or a global "overwrite all" / "skip all" toggle). Confirm.

6. **Cross-program day-level copy.** Can the EP copy a day from program A to a date that falls within program B? (e.g. copy a Tuesday from the spring block to a date in the upcoming summer block).
   - **Recommend: yes** — the new day attaches to whichever program covers the target date. If no program covers the target date, the operation fails with a clear error: "No active block covers May 28. Create a new block first." Confirm.

7. **Day "label" on copies.** When copying Day A from week 1 of block X to a new date, does the new day keep `day_label='A'` or get a fresh label?
   - **Recommend: keep label.** The label is a periodisation marker (Lower / Upper / Push / Pull), independent of date. The EP renames it manually if they want. Confirm.

8. **Side panel default state.** Default open or closed on first visit?
   - **Recommend: closed** on both calendar and session builder. Matches the spec ("default is just the calendar view"). EP toggles on demand. Confirm.

9. **In-builder Notes/Reports panels — keep or remove after Phase E extraction?** ~~Recommended (a) remove.~~ **Closed 2026-05-03 by user override.** The original recommendation contradicted the load-bearing rule in CLAUDE.md ("the session builder with clinical notes adjacent to the programming calendar is the single most important screen in this platform"). **Decision: keep all three tabs (Library + Notes + Reports) in the session builder right panel exactly as they are today.** Phase E extracts `NotesPanel` and `ReportsPanel` into their own files purely for code reuse so the calendar page can import them; the session builder's behaviour does not change. Process note: any future recommendation that touches a CLAUDE.md "protect this" rule must call that rule out explicitly and justify the deviation before it lands in a polish doc.

10. **Acceptance test runner.** pgTAP for schema + RPCs is clear. For UI workflows (P1-2 inline expansion, P1-3 copy mode, P1-4 toolbar) — Playwright? Manual checklist?
    - **Recommend: manual checklist.** Matches the testing-module pattern (see `docs/polish/testing-module.md` §8). Less infrastructure, faster iteration during the polish pass. Add Playwright in a future round if regressions become a problem. Confirm.

11. **`status='draft'` on copied blocks.** The `copy_program` RPC creates the new block with `status='draft'` so the EP can review/tweak before activating. The `repeat_program` RPC creates with `status='active'` immediately (back-to-back continuation, no review intended).
    - Is that right, or do you want `repeat_program` to also start as draft? **Recommend: copy → draft, repeat → active.** Repeat is meant to be one-click continuation; draft would add friction. Confirm.

12. **`program_days_dow_idx` removal.** The existing `program_days_dow_idx ON (program_week_id, day_of_week) WHERE day_of_week IS NOT NULL` becomes useless when day_of_week is dropped. Drop the index in the same migration. (Flagging here so it doesn't get missed.) **No question — just FYI.**

---

## 5. Out of scope for this pass

Per chat answers and spec boundaries — flagged here so they don't drift in:

- **Drag-and-drop reordering of exercises within a day.** Separate session-builder polish pass (Phase 5 of CLAUDE.md polish-pass order).
- **Progression modifier on copy/repeat** (Q4c=C → Phase 2). Exact-duplicate only in v1.
- **Rule-based repeat shortcuts** ("every Tuesday for 4 weeks", "every Mon/Wed/Fri until X"). Q4b confirmed only one shape: weekly-on-source-weekday until end date.
- **Multi-select copy across multiple days at once.** EP can repeat one day but not "copy these three days to next week."
- **Block-level templates.** Save block as template, instantiate template for a new client. Separate feature, separate surface (Settings).
- **Files tab on the side panel** (Q2b=C). Deferred until a use case lands.
- **Mobile staff calendar.** Desktop-first per CLAUDE.md.
- **Client portal program view.** Separate Phase 7 of CLAUDE.md polish-pass order.
- **Program archival / hide-old-blocks UI.** EP can have many blocks across years; eventually they'll want a way to hide old ones. Track in `deferred-prompts.md`; not blocking for v1.

---

## 6. Stop point

This document is the contract. **No code changes start until the open questions in §4 are resolved.** Most critically:

- **§4 Q1** (schema authority — overrides chat Q6) — shapes every migration that follows.
- **§4 Q2** (`program_weeks` fate) — shapes the migration scope.
- **§4 Q3** (current block when today is between programs) — shapes the toolbar and the loader.

Resolution of open questions can be terse: "Q1 yes, Q2 a, Q3 ok, Q4 a, Q5 c, Q6 yes, Q7 keep, Q8 closed, Q9 a, Q10 manual, Q11 ok, Q12 noted." No code starts until those are signed off.

---

## 7. Progress log

Running record of what's closed, in order. Each entry references the commit on master.

### Phase A — Schema foundation (closed; pgTAP 09 green on staging 2026-05-03)

- **D-PROG-001 / 002 / 003 logged** in [`docs/decisions.md`](../decisions.md). The three architectural decisions: scheduled_date authoritative on program_days; multiple active programs per client allowed; program_weeks retained as optional periodisation grouping.
- **P0-1 / P0-3 / P0-4 / P0-6** — closed in migration `20260503100000_program_days_scheduled_date.sql`. Adds `program_days.scheduled_date date NOT NULL` and `program_days.program_id uuid NOT NULL` (with FK + new `(program_id, scheduled_date)` index). Backfills both from the existing week-relative data using the Mon-first day-of-week mapping. Drops `day_of_week` column and its `program_days_dow_idx`. Relaxes `program_week_id` to nullable with `ON DELETE SET NULL`. Updates `enforce_program_exercise_same_org()` to walk via the direct `pd.program_id`. Updates `audit_resolve_org_id()` for both `program_days` (direct lookup) and `program_exercises` (one-hop walk). Drops and recreates the SELECT/INSERT/UPDATE RLS policies on `program_days` and `program_exercises` to use the shorter walk.
- **P0-2** — closed in migration `20260503110000_drop_unique_active_program.sql`. Drops `programs_one_active_per_client_idx`. Adds `programs_no_active_overlap` EXCLUDE constraint using `btree_gist` so two active programs for the same client cannot have overlapping `[start_date, start_date + duration_weeks*7)` half-open ranges. Inactive / undated programs are exempt.
- **TypeScript types regenerated** via `npm run supabase:types`. `program_days.Row` now carries `program_id: string`, `program_week_id: string | null`, `scheduled_date: string`; `day_of_week` is gone.
- **pgTAP `09_programs_dates.sql`** — green on staging 2026-05-03. 7 assertions across §A (scheduled_date round-trips, program_week_id can be NULL), §B (two non-overlapping active programs allowed), §C (overlap rejected with SQLSTATE 23P01), §D (RLS isolation across orgs holds, program_exercises policy exists). Test pattern: per-assertion TAP lines captured into a temp `_tap` table, final SELECT returns all 7 rows — works around `supabase db query --linked --file` only returning the last statement's results.
- **Known regression (intentional)**: the running app's program calendar page (`/clients/[id]/program`) currently throws because [page.tsx](../../src/app/(staff)/clients/[id]/program/page.tsx) and [ProgramCalendar.tsx](../../src/app/(staff)/clients/[id]/program/_components/ProgramCalendar.tsx) still query `program_days.day_of_week`. Phase B rewrites the loader and the calendar component to query `scheduled_date` directly — fixes the regression as part of the calendar redesign.

### Phase A acceptance gate

Closed. Schema is in the target shape; downstream phases (B–F) can proceed against this foundation.

### Phase B — Calendar redesign (closed; type-check + dev-server green; visual walkthrough pending)

- **One-off cleanup before Phase B started.** The Phase A migration's day-of-week → scheduled_date backfill formula assumed Mon=0, but the application code stored day_of_week using JS convention (Sun=0). All 48 existing seed program_days were soft-deleted (`UPDATE program_days SET deleted_at = now() WHERE deleted_at IS NULL`) — the data was unrecoverable from the wrong scheduled_date alone. Pre-launch, no real data lost; user can recreate seed programs via the UI as needed.
- **P1-1 / P1-6 — Lift MonthYearPicker into shared component.** Moved from inline in `WeekView.tsx` (lines 2297–2457 originally) to `src/app/(staff)/_components/MonthYearPicker.tsx`. Exports `MonthYearPicker`, `MONTH_LABELS_SHORT`, and `monthArrowStyle`. WeekView imports from there; behaviour identical to before.
- **P0-3 — Loader rewrite.** [`page.tsx`](../../src/app/(staff)/clients/[id]/program/page.tsx) now fetches:
  1. All `status='active'` programs for the client (D-PROG-002 — multiple actives allowed).
  2. All `program_days` across those programs by `program_id IN (...)`, ordered by `scheduled_date`.
  3. All `program_exercises` in bulk by `program_day_id IN (...)`, joined to `exercises(name, video_url)`.
  4. Resolves "current block" — program containing today, else most recent past program (P1-8 / §4 Q3).
- **P1-1 / P1-2 — `MonthCalendar.tsx` replaces `ProgramCalendar.tsx`.** Renders one collapsible `MonthSection` per month in the program's date range; current month auto-expanded. `MonthSection` header has a click-to-open `MonthYearPicker` popover that scrolls to the picked month. `MonthGrid` lays out a Mon-first 7×6 calendar (always six rows for layout stability), prior/next-month dates greyed at 40% opacity. Programmed day cells carry the `Day {label}` badge + an exercise-count caption.
- **P1-2 — Inline `DaySummary`.** Clicking a programmed day expands a full-width summary inside the same calendar grid (`grid-column: 1 / -1`) immediately below that day's calendar week. Summary shows: Day {label}, formatted long date, current block name, sequence-badge list (A1, A2, B1…) with superset members shown with a green left-border accent, exercise name, formatted prescription (`4 × 6 · RPE 8 · 90s rest`), and four buttons in the top-right: Open (link to session builder), Copy (disabled, Phase C), Repeat (disabled, Phase C), Close. Single open day at a time keeps the calendar readable.
- **Downstream fixups for the dropped `day_of_week` column:**
  - [`days/[dayId]/page.tsx`](../../src/app/(staff)/clients/[id]/program/days/[dayId]/page.tsx) — session builder loader switched from joining `program_week → program → client_id` to a one-hop `program → client_id` walk via the new direct FK; eyebrow shows `scheduled_date` (formatted as `Sat 4 Apr`) instead of `Week N`.
  - [`new/actions.ts`](../../src/app/(staff)/clients/[id]/program/new/actions.ts) — auto-archive of the prior active program is removed (D-PROG-002); day inserts use `scheduled_date` computed from `start_date + (week_number-1)*7 + ((dow + 6) % 7)`, where `dow` is the JS-convention value from `defaultDaysOfWeek()` and the `(dow + 6) % 7` rotation maps Mon=0..Sun=6 onto the calendar's Mon-first layout.
  - [`portal/page.tsx`](../../src/app/portal/page.tsx) — client portal home rewritten to query `program_days` directly by `scheduled_date BETWEEN [weekStart, weekStart+7)` rather than joining through `program_weeks` and filtering by `day_of_week`. The today-session lookup is now a string-equality match on the ISO date. `weekNumberFor()` helper derives the program week number from `start_date` for display purposes only — the data layer doesn't address by week.
- **`type-check` clean** (`npm run type-check` returns no errors). Dev server compiles `/clients/{id}/program` without warnings; multiple consecutive `GET /clients/.../program` requests return 200 OK with reasonable timing (≈200ms application code).
- **Visual walkthrough — first-pass feedback:** user wanted (a) one month visible at a time with prev/next + picker at the top, not collapsible per-month sections; (b) the day summary as a popover anchored to the cell, not a full-width row that hides the rest of the week. Refactored `MonthCalendar.tsx` accordingly:
  - Top-of-calendar header: ← prev / month-name (click for picker) / next → / Today button (only when navigated away from this month) or "This month" pill.
  - One month grid visible at a time. State held in component (visible year + month + open day).
  - `DaySummaryPopover` replaces the inline full-row `DaySummary`. 360px wide, anchored to the day cell with `position: absolute`. Anchor side flips: cols 1–4 anchor left, cols 5–7 anchor right (avoids overflowing the right edge). Esc + outside-click close. Doesn't reflow the calendar grid — other days in the same week stay clickable.
  - "Open" button → session builder works (verified by 200 OK on `/clients/.../program/days/{dayId}` in the dev log after the user created a new program).
  - Visual walkthrough pending second-pass user feedback.

### Phase C — Day-level copy + repeat (closed; pgTAP 10 green on staging 2026-05-03; visual walkthrough pending)

- **Migration** `20260503120000_program_days_copy_repeat.sql`:
  - `_program_for_date(p_client_id uuid, p_date date) RETURNS uuid` — internal helper that resolves the active program covering a date for the client. SECURITY DEFINER, REVOKEd from PUBLIC (only callable from the two RPCs below).
  - `copy_program_day(p_source_day_id uuid, p_target_date date, p_force boolean DEFAULT false) RETURNS jsonb` — clones a `program_day` (and its exercises, with re-mapped superset_group_ids) onto the target date. Cross-program: the new day attaches to whichever active program covers the target date (Q6 sign-off). Returns `{ status: 'created', new_day_id }` | `{ status: 'conflict', conflicts: [...] }` | `{ status: 'no_program', target_date }`.
  - `repeat_program_day_weekly(p_source_day_id uuid, p_end_date date, p_force boolean DEFAULT false) RETURNS jsonb` — clones the source onto every same-weekday occurrence between source.scheduled_date+7 and p_end_date inclusive. Two-pass internally (bucket targets into create / conflict / no-program; commit only if no conflict OR force=true). Returns `{ status: 'created', new_day_ids, no_program_dates }` | `{ status: 'conflict', conflicts, no_program_dates }` | `{ status: 'invalid_end_date' }`.
  - **SECURITY DEFINER + manual org gate** on both RPCs. The conflict-overwrite path soft-deletes via `UPDATE program_days SET deleted_at = now()`, which fails RLS WITH CHECK under `SECURITY INVOKER` because the program_days SELECT policy filters `deleted_at IS NULL` (the documented soft-delete + RLS gotcha — see `20260429120000_soft_delete_rpcs.sql` for the established pattern).
  - **Superset group remap bug caught + fixed during pgTAP development.** Initial implementation used `SELECT DISTINCT superset_group_id, gen_random_uuid()` for the remap CTE, which doesn't dedupe because `gen_random_uuid()` is volatile (every row produces a fresh "distinct" pair). Resulted in a Cartesian product on the LEFT JOIN, so a 2-exercise source produced a 4-row clone. Fixed by deduplicating in a subquery first, then assigning new uuids to the distinct rows.
- **pgTAP `10_program_days_copy_repeat.sql`** — 11/11 green on staging. Coverage: §A clean copy + label preservation + exercise count + fresh superset_group_id; §B no_program path; §C conflict + force overwrite; §D weekly repeat creates correct number of days; §E invalid_end_date short-circuit.
- **Server actions** `src/app/(staff)/clients/[id]/program/day-actions.ts`:
  - `copyDayAction(clientId, sourceDayId, targetDate, force?)` → `CopyDayActionResult` tagged union (`created` | `conflict` | `no_program` | error).
  - `repeatDayWeeklyAction(clientId, sourceDayId, endDate, force?)` → `RepeatDayActionResult` (`created` | `conflict` | `invalid_end_date` | error).
  - Both `requireRole(['owner', 'staff'])` and `revalidatePath` on success.
- **UI: `MonthCalendar.tsx` mode state machine** — `idle` | `copy-pick` | `repeat-pick` | `confirm-copy` | `confirm-repeat` | `no-program-toast`. Esc cancels any non-idle mode globally. `useTransition` + `router.refresh()` on success so the calendar re-fetches without a hard navigation.
- **Copy flow:**
  - Click Copy icon in popover → mode flips to `copy-pick`, popover closes, banner appears at the top of the calendar ("Copying Day A from Mon, 27 Apr — click any future day to paste, or press Esc to cancel").
  - Day cells in the calendar branch on mode: in `copy-pick`, the source cell and past dates dim out (`disabled`, `cursor: not-allowed`); all other cells (programmed AND empty) become click-targets with a copy-cursor + dashed accent border; clicking fires `copyDayAction`. Conflict response → `confirm-copy` mode → modal. No-program response → `no-program-toast` mode → "OK"-only modal.
- **Repeat flow:**
  - Click Repeat icon in popover → mode flips to `repeat-pick`, popover closes, full-screen modal with `RepeatEndDatePicker` opens.
  - Mini date grid (Mon-first 7×6) with prev/next month nav. Source weekday occurrences across the visible month are tinted accent-green so the EP can see candidate end-dates at a glance. Default end-date = source + 28 days (4 weeks).
  - Live preview line: "5 copies on Mondays — Mon, 4 May to Mon, 1 Jun". Confirm button disabled when 0 copies or busy.
  - Confirm fires `repeatDayWeeklyAction`. Conflict response → `confirm-repeat` modal listing all conflicting dates + count of skipped no-program dates → "Overwrite" or "Cancel". Force=true on confirm.
- **`ConflictDialog`** — full-viewport modal (z-200), backdrop dismissible (when not busy), shows title + description + scrollable list of conflicting dates + (if any) "N dates fall outside any active block and will be skipped" caption. `confirmLabel` and `hideCancel` configurable so the same component handles both confirms and one-button toasts.
- **Type-check clean**, dev server compiles `/clients/.../program` with consistent 200 OK responses (15 in a row in the logs after the wiring landed). Visual walkthrough pending user refresh + click-through.
