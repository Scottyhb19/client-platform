# Polish-pass gap analysis — Session Builder

**Brief:** [`Client_Platform_Brief_v2.1.docx`](../../Client_Platform_Brief_v2.1.docx) (master spec) — session builder is the load-bearing differentiator (CLAUDE.md).
**Reference prototype:** [`session-builder.html`](../../session-builder.html) — design intent only; production implementation has its own reorder + spine logic.
**Reference design system:** [`Odyssey_Design_System.pdf`](../../Odyssey_Design_System.pdf) — authoritative for colour, type, spacing, motion.
**Current implementation:** [`SessionBuilder.tsx`](../../src/app/(staff)/clients/[id]/program/days/[dayId]/_components/SessionBuilder.tsx), [`page.tsx`](../../src/app/(staff)/clients/[id]/program/days/[dayId]/page.tsx), [`actions.ts`](../../src/app/(staff)/clients/[id]/program/days/[dayId]/actions.ts), [`AssignButton.tsx`](../../src/app/(staff)/clients/[id]/program/days/[dayId]/_components/AssignButton.tsx), [`DayLabelEditor.tsx`](../../src/app/(staff)/clients/[id]/program/days/[dayId]/_components/DayLabelEditor.tsx)
**Shared right-panel components:** [`NotesPanel.tsx`](../../src/app/(staff)/clients/[id]/_components/NotesPanel.tsx), [`ReportsPanel.tsx`](../../src/app/(staff)/clients/[id]/_components/ReportsPanel.tsx)
**Schema:** [`20260420101800_programs.sql`](../../supabase/migrations/20260420101800_programs.sql) (program_exercises), [`20260420101300_exercise_metric_units.sql`](../../supabase/migrations/20260420101300_exercise_metric_units.sql), [`20260420101900_session_logging.sql`](../../supabase/migrations/20260420101900_session_logging.sql) (set_logs / exercise_logs / sessions), [`20260420102500_client_portal_functions.sql`](../../supabase/migrations/20260420102500_client_portal_functions.sql) (`client_get_program_day_exercises` RPC).
**Audit date:** 2026-05-07
**Status:** Gap document — awaiting sign-off before any code changes.

---

## 0. Executive summary

The session builder works end-to-end today: load a day, add exercises from the library, edit a single prescription per exercise, group consecutive exercises into supersets, reorder via up/down arrows, soft-delete, autosave, publish ("Assign to Scott"), unpublish. The right-panel adjacency (Library + Notes + Reports) — the load-bearing differentiator — is in place and correct.

What's missing is the difference between *working* and the bar set in CLAUDE.md ("the most important screen … gets the highest care"):

1. **Per-set storage doesn't exist yet.** A 4×6 squat at 80/80/85/85kg can't be expressed — only set 1 is editable; sets 2..N display row 1's value as static text. The component literally has the comment _"they become independent inputs once per-set storage lands."_ This polish pass lands it. New `program_exercise_sets` table, symmetric with `set_logs` (the actuals table) — see §3.1.

2. **Hardcoded design tokens.** [`SessionBuilder.tsx`](../../src/app/(staff)/clients/[id]/program/days/[dayId]/_components/SessionBuilder.tsx) lines 37–45 hardcode `INK = '#1E1A18'`, `INK_SOFT = '#2A2522'`, `CREAM = '#F5F0EA'`, etc. plus `background: '#000'` for the sequence pill. CLAUDE.md is unambiguous: _"Design tokens live in `src/app/globals.css` and `src/lib/constants.ts` only. Do not hardcode colours, radii, spacing values, or font weights elsewhere."_ Every value gets replaced with a token; the harsh black sequence pill switches to a design-system dark-chrome token. (Landed on `var(--color-slate)` per chat 2026-05-07 — see §0.1 row 1.)

3. **The action bar is in the wrong place.** "Superset" + "+ Add exercise" render *below* each card. Clicking Superset on Card 2 groups Card 2 with Card 1 (groups-with-above) — correct behaviour, ambiguous UI. Per the prototype + sign-off, the action bar moves to *between* cards. "Superset" between Card N and Card N+1 groups them. "+ Add exercise" between two cards inserts the new exercise in that slot, with sort_order shifting subsequent rows.

4. **Density doesn't match the brief.** Each card is ~360px tall (the demo video slab alone is 140px). The brief says _"data density without clutter"_ — 6–12-exercise sessions become a long scroll. Tightening the card to ~220px (~90×60 video thumbnail, 26px set rows, tighter padding) is high-impact P2 polish.

5. **The "Load / Notes" cell is freetext** when it should pick from `exercise_metric_units` — the canonical metric list already seeded per org (kg / lb / time_minsec / distance_m / distance_miles / distance_km / percentage / rpe / tempo / bodyweight). Same source the new-exercise form uses.

The remaining gaps — section-title dropdown + dedupe, swap-in-place, drag-and-drop reorder via the grip handle, library filter chips, "Last logged" footer — are P1 functional adds. None are architectural.

Pre-launch advantages apply: the per-set schema change is cheap, the portal RPC update is cheap, and breaking the prescription contract doesn't break anyone.

### 0.1 Sign-off log (chat 2026-05-07)

| # | Question | Answer |
|---|----------|--------|
| 1 | Visual language | **Keep current cream + black-spine direction.** Switch the sequence pill / superset spine from `#000` to a design-system dark-chrome token. *Landed on `var(--color-slate)` (#35363A) — chat 2026-05-07; charcoal #231F20 felt too dark and harsh in context, slate provides +12% lift while staying inside the spec.* |
| 2 | Per-set storage | **Build now.** Pre-launch makes this the right time. |
| 3 | Card density | **Tighten.** Smaller video thumbnail, denser set rows, tighter padding. |
| 4 | Section title behaviour | **Wire to `section_titles` (canonical dropdown), dedupe consecutive same-section bars.** |
| 5 | Swap-in-place | **Yes.** Click name → "Replacing X" mode in right panel → pick from library → new exercise's defaults populate the slot. Slot keeps `sort_order`, `section_title`, `superset_group_id`. Old prescription is discarded. |
| 6 | Library filters | **Add movement-pattern chips + tag chips.** |
| 7 | "Last logged" footer | **Build it in.** Read the most recent `set_logs` for this `exercise_id` + this client. |
| ø-1 | Action bar between cards | Bar moves to between cards; Superset groups the two cards on either side. |
| ø-2 | Drag-and-drop reorder | The grip handle becomes a real drag handle (keep up/down arrows for keyboard a11y). |
| ø-3 | Add-exercise-between | Clicking "+ Add exercise" between Card N and Card N+1 inserts the picked exercise at that slot, with sort_order shifting. |
| ø-4 | Per-set storage shape | **Option A** — new `program_exercise_sets` table, symmetric with `set_logs`. |
| ø-5 | "Load / Notes" cell | Becomes a metric dropdown sourced from `exercise_metric_units` + a value input. Same source the new-exercise form uses. |

---

## 1. What's already correct

Pieces that meet the bar and stay as-is.

### 1.1 Right-panel adjacency (the differentiator — protected)
[`SessionBuilder.tsx`](../../src/app/(staff)/clients/[id]/program/days/[dayId]/_components/SessionBuilder.tsx) tabs Library / Notes / Reports in the right panel. CLAUDE.md memory: this adjacency never gets removed or relocated. The polish pass *adds* behaviour on top (replace-mode, filter chips) but does not touch the structure.

### 1.2 Server actions + soft-delete
[`actions.ts`](../../src/app/(staff)/clients/[id]/program/days/[dayId]/actions.ts) is well-structured: `addExerciseToDayAction`, `removeProgramExerciseAction` (via `soft_delete_program_exercise` RPC — bypasses the SELECT-policy / UPDATE-policy collision documented in user memory), `updateProgramExerciseAction` (allowlist-validated), `moveProgramExerciseAction` (sentinel-swap to dodge any future UNIQUE constraint), `groupWithAboveAction`, `ungroupFromSupersetAction`, `publishProgramDayAction`, `unpublishProgramDayAction`. Per-set storage will add new actions, but none of these get rewritten — they get *extended*.

### 1.3 Sequence pill + superset spine (visual treatment)
The continuous black spine running down a superset with green B1, B2 letters is more distinctive than the prototype's coloured-border treatment. Stays. The only change: the harsh `#000` becomes warm charcoal (`var(--color-charcoal)`).

### 1.4 Up/down arrow reorder (kept alongside drag)
Drag is the new affordance. Keyboard-only users still have arrow buttons. Both backed by the same `moveProgramExerciseAction`.

### 1.5 Publish flow
[`AssignButton.tsx`](../../src/app/(staff)/clients/[id]/program/days/[dayId]/_components/AssignButton.tsx) handles the published / not-published states cleanly: disabled until `exerciseCount > 0`, shows "Assigned · 12 min ago" when published, includes unassign with confirmation. The publish state survives soft-deletes correctly because `published_at` is on `program_days`, not on individual exercises.

### 1.6 Day label rename
[`DayLabelEditor.tsx`](../../src/app/(staff)/clients/[id]/program/days/[dayId]/_components/DayLabelEditor.tsx) — the inline rename UX is already polished (click label, Enter saves, Esc cancels, 30-char cap matches the CHECK constraint). One discoverability gap noted in §4 P2.

### 1.7 Portal RPC shape
[`client_get_program_day_exercises`](../../supabase/migrations/20260420102500_client_portal_functions.sql) is the only public surface that reads `program_exercises` for the client side. With per-set storage it gets updated to return per-set rows; the portal `Logger` already renders per-set, so the change *removes* the row-1-mirror hack on both ends.

---

## 2. Audit findings — concrete gaps

### 2.1 Visual + token violations (P0)

[`SessionBuilder.tsx`](../../src/app/(staff)/clients/[id]/program/days/[dayId]/_components/SessionBuilder.tsx) lines 37–45 hardcodes:
```
const INK = '#1E1A18'        // → var(--color-primary)  but better: var(--color-charcoal)
const INK_SOFT = '#2A2522'   // → not in token set; replace with var(--color-charcoal) or remove
const CREAM = '#F5F0EA'      // → var(--color-surface-2) is #ede8e2 — closest match needs eyeball
const CREAM_DEEP = '#EDE8E2' // → var(--color-surface-2)
const BORDER = '#E2DDD7'     // → var(--color-border-subtle) is #d6cfc6 — close, not exact
const MUTED = '#78746F'      // → var(--color-text-light) is #5e5852 — different
const FAINT = '#A09890'      // → no exact token; create one or fall back
const GREEN = '#2DB24C'      // → var(--color-accent) ✓ exact match
const ALERT = '#D64045'      // → var(--color-alert) ✓ exact match
```
And `background: '#000'` in `SoloPill` line 324, `SupersetSpine` line 368.

The component additionally uses inline `style={{}}` for nearly every element — radii, padding, font weights, font sizes — none reference tokens. Many are minor differences from the design system.

**Fix:** introduce missing tokens in [`globals.css`](../../src/app/globals.css) where the design system has values not yet exported (e.g. a `--color-text-faint` for the placeholder grey, a `--color-cream-deep` if it's distinct from `--color-surface-2`); replace every hex literal in SessionBuilder.tsx with a token reference; replace inline radii / paddings with token-driven CSS classes where the same value repeats. **Do not** add new colours that aren't already in the design system PDF without confirming.

### 2.2 Per-set storage doesn't exist (P0)

[`SessionBuilder.tsx`](../../src/app/(staff)/clients/[id]/program/days/[dayId]/_components/SessionBuilder.tsx) line 861:
> _"Row 1 is the editable 'master' row. Other rows display the same values as static text until per-set data lands."_

`program_exercises` columns `reps`, `optional_value`, `rpe` carry one value for the whole exercise. The set table fakes per-set rows by repeating row 1 via `<StaticCell>` (lines 775–801). This blocks the most basic real-world prescription — wave loading, top-set + back-off sets, ramping intensity.

**Fix:** §3.1 (architectural). New `program_exercise_sets` table; row 1's `sets` count column on `program_exercises` is replaced by `COUNT(*)` of rows in the new table; `reps` / `optional_metric` / `optional_value` / `rpe` move to per-set columns; `instructions` / `tempo` / `rest_seconds` stay on `program_exercises` (they're per-exercise, not per-set). Portal RPC updated to return per-set rows. The portal `Logger` already renders per-set; the `LEFT JOIN ... USING (set_number)` for "prescribed vs actual" becomes one line.

### 2.3 Action bar in the wrong place (P1)

[`SessionBuilder.tsx`](../../src/app/(staff)/clients/[id]/program/days/[dayId]/_components/SessionBuilder.tsx) `CardActions` (lines 1158–1240) renders below each card with two buttons: "Superset" (or "Remove superset" when grouped) + "+ Add exercise" (which only focuses the library search — adds always append at the bottom).

This is two problems wearing one mask:

(a) **Placement is ambiguous.** The button below Card 2 acts on Card 2 + Card 1 (groups-with-above). A user reasonably expects the button below Card 2 to act on Card 2 + Card 3.

(b) **"+ Add exercise" doesn't insert in place.** No matter which "+ Add exercise" you click, the next-picked exercise lands at `MAX(sort_order) + 1`.

**Fix:** action bars render *between* cards (matching the prototype's `data-between` slot). State tracks `insertAfterPeId | null` for the next library pick. `addExerciseToDayAction` accepts an optional `insertAfterPeId` param and shifts subsequent `sort_order`s by +1 inside a transaction. `groupWithAboveAction` becomes `groupAcrossActionBar(slotPosition)` — groups the cards either side of the bar.

### 2.4 No swap-in-place (P1)

Replacing one exercise with another currently requires: trash icon → confirm → search → click new exercise. The new exercise lands at the bottom, not in the original position. Loses your spot in the sequence, loses the section/group context, and forces a manual reorder.

**Fix:** click exercise name → right panel forces tab to Library and shows a "Replacing: {old name}" header strip with a Cancel button → next library click swaps in. Implementation: a new `swapProgramExerciseAction(programExerciseId, newExerciseId)` server action that, in one transaction, soft-deletes the old `program_exercises` row, inserts a new row at the same `sort_order` / `section_title` / `superset_group_id` with the new exercise's defaults (sets, reps, metric, value, RPE, rest, instructions). Old `set_logs` / `exercise_logs` history survives because their FK is on `exercise_id`, not `program_exercise_id`.

### 2.5 Drag-and-drop reorder doesn't exist (P1)

[`SessionBuilder.tsx`](../../src/app/(staff)/clients/[id]/program/days/[dayId]/_components/SessionBuilder.tsx) line 614: `<GripVertical>` is decorative. Reorder happens via up/down arrows, which works but feels archaic for a product positioned as TrainHeroic-superior.

**Fix:** add `@dnd-kit/core` + `@dnd-kit/sortable`. Handle = the grip icon. Drop targets = between cards (matches the action-bar slot model from §2.3). Dropping a member out of a superset ungroups it; dropping into a superset joins it. Keyboard reorder via arrows stays. Server: a new `reorderProgramExercisesAction(dayId, orderedIds)` that takes the full new order and writes `sort_order`s in one transaction (cleaner than chained swaps when dragging across multiple positions).

### 2.6 Section title is free-text + always visible (P1)

[`SessionBuilder.tsx`](../../src/app/(staff)/clients/[id]/program/days/[dayId]/_components/SessionBuilder.tsx) `SectionTitleField` (lines 1348–1395) is a free-text input with placeholder "Section (e.g. Strength, Upper, Stability)". It renders on every card, populated or not. The schema already has `section_titles` — a tenant-configurable canonical list (Mobility, Strength, Hypertrophy, ...) seeded per org by [`bootstrap_functions.sql`](../../supabase/migrations/20260420102400_bootstrap_functions.sql), and nothing in the UI reads it.

Two problems:

(a) **No canonical source.** EPs type "Strength" on one card and "strength" on another; the calendar grouping degrades.

(b) **Repeating placeholder is visual noise.** Three cards in a row with empty section fields render three identical "Section (e.g. ...)" placeholders, even when the section is the same. The prototype dedupes — one bar per group.

**Fix:** `SectionTitleField` becomes a dropdown sourced from `section_titles` for the org, with a "+ Add section…" option that POSTs a new row to `section_titles` (uses an existing org-scoped insert path — same shape as movement-pattern creation). Section bar dedupes: render the bar only on the first card of a run of consecutive same-section cards.

### 2.7 "Load / Notes" cell is freetext (P1)

`InlineCell` for `optional_value` accepts any string. Schema has `optional_metric` (text — kg / lb / time_minsec / etc.) but the UI conflates the two into one field. EPs type "80kg" and "80 kg" and "80" interchangeably.

**Fix:** the "Load / Notes" cell becomes [value input][metric select]. Metric select sources `exercise_metric_units` for the org (filter `is_active = true`, `deleted_at IS NULL`, ordered by `sort_order`). Same source the new-exercise form uses ([library/new/page.tsx](../../src/app/(staff)/library/new/page.tsx)). On load, defaults to the exercise's `default_metric` (or "—" if null). Display when read-only: `{value} {display_label}` — e.g. "80 kg", "3:00 min:sec", "BW" (for `bodyweight` with empty value).

### 2.8 No library filter chips (P1)

[`LibraryPanel`](../../src/app/(staff)/clients/[id]/program/days/[dayId]/_components/SessionBuilder.tsx#L1416) is search-only. With even a modest library (the seed includes 50+ exercises), pure search loses the "I want any squat pattern" use case.

**Fix:** above the search input, a row of movement-pattern chips (loaded from `movement_patterns`) and below the search a row of exercise-tag chips (loaded from `exercise_tags`). All-default, click to filter. Multi-select within a category, AND across categories. Reset button when any filter is active.

### 2.9 No "Last logged" footer on each exercise card (P1)

The prototype shows "Last: 4 × 6 @ 75-80kg" at the bottom of the prescription column. Real coaching context — the EP sees what the client actually did last time without leaving the page. Currently nowhere.

**Fix:** load alongside the program_exercises query: for each `exercise_id`, the most recent `exercise_logs` row for this client (joined to `sessions.client_id`) with its `set_logs`. Render a single line at the bottom of the prescription column: `Last: {N} × {reps} @ {best load or range} · {date}`. Skip the line when there's no history.

Implementation sketch:
```sql
-- For each exercise_id in the page's program_exercises:
SELECT DISTINCT ON (el.exercise_id)
  el.exercise_id,
  el.completed_at,
  -- aggregate set_logs into a render string
  ...
FROM exercise_logs el
JOIN sessions s ON s.id = el.session_id AND s.client_id = $client_id
WHERE el.exercise_id = ANY($exercise_ids)
  AND el.deleted_at IS NULL
  AND el.completed_at IS NOT NULL
ORDER BY el.exercise_id, el.completed_at DESC;
```
Pre-launch the result is empty for every row — fine, the line just doesn't render.

### 2.10 Library row is plain (P2)

Each library row shows name + movement-pattern name only. Prototype includes (a) a "has video" pill, (b) the default sets×reps stamp ("3×8"), (c) tag chips on rows that carry rehab/prehab/etc. tags. Dense, scannable, more useful at-a-glance.

**Fix:** add `default_sets`, `default_reps`, `video_url IS NOT NULL` to the library load. Render: `{name}` (line 1) + chip-row `{movement_pattern}` `{tags}` `{N×reps}` `[Video]` (line 2). Keep the existing single-click-to-add behaviour.

### 2.11 Card density — the rest of the visual polish (P2)

Each card today: 16px / 20px padding, 2-column 1.1fr / 1.2fr grid, 140px-tall video slab, 32px set rows, 12px gap between extras. Card height ≈ 360px.

Target: 12px / 14px padding, video as a 96×60px thumbnail bottom-right of the left column, 26px set rows, 8px gaps. Card height ≈ 220px.

Side effect: at 220px, three exercises fit on a 1080p viewport without scrolling. The session reads as one unit instead of a page-down-page-down list.

### 2.12 Empty state has no inline CTA (P2)

[`EmptyState`](../../src/app/(staff)/clients/[id]/program/days/[dayId]/_components/SessionBuilder.tsx#L155) reads "No exercises yet · Pick exercises from the Library panel on the right." Correct prose, no affordance. New users have to find the library panel themselves.

**Fix:** add a button "Browse the library" inside the empty state that focuses the library search input + flashes the panel border briefly. Same UX hook the action-bar "+ Add exercise" already uses (`focusLibrarySearch` line 1198) — reuse it.

### 2.13 "Duplicate" button is permanently disabled (P2)

[`page.tsx`](../../src/app/(staff)/clients/[id]/program/days/[dayId]/page.tsx) line 229: `<button type="button" className="btn outline" disabled>Duplicate</button>`. No tooltip, no copy explaining why.

**Fix:** implement it. New `duplicate_program_day` RPC that copies the day + all `program_exercises` + their `program_exercise_sets` to a target date the user picks. Reuses the same date-picker popover the calendar already uses for day-level copy ([programs.md Phase E](./programs.md)) — the Duplicate button on the builder is a top-of-page accelerator for that same operation, scoped to the current day. Behaviour: click → date picker → on confirm, copy lands as a draft (`published_at = NULL`) on the chosen date and the user is navigated to the new day. Source day stays untouched.

### 2.14 DayLabelEditor pencil affordance (P2)

The inline rename works well, but the pencil icon fades in only on hover (opacity 0 → 0.55). On a touch device or quick scan, users won't know the label is editable. Already noted in [`DayLabelEditor.tsx`](../../src/app/(staff)/clients/[id]/program/days/[dayId]/_components/DayLabelEditor.tsx) — the design choice is intentional ("intentionally subtle"), which is fine for desktop power users. Bumping pencil opacity to 0.25 at rest, 0.6 on hover, would meaningfully help discoverability without compromising the restraint.

### 2.15 Right-panel sticky behaviour (P2)

[`SessionBuilder.tsx`](../../src/app/(staff)/clients/[id]/program/days/[dayId]/_components/SessionBuilder.tsx) line 106: `<aside style={{ position: 'sticky', top: 20 }}>`. Works at the top. Once you scroll past the panel's content height, the panel scrolls off and you lose access to Library/Notes/Reports until you scroll back up.

**Fix:** the panel becomes a column of `position: sticky; top: 20px; height: calc(100vh - 40px); overflow-y: auto` — so it always fills the visible area to the right of the exercise list, regardless of how far you've scrolled. Long client lists in Notes scroll within the panel, not against it.

### 2.16 Autosave is silent (P2)

`InlineCell` / `EditableTextarea` save on blur with no visible feedback unless an error happens. For a clinician filling out a prescription, silence after typing is mildly unsettling. The prototype's explicit "Save" button is the wrong fix (autosave is correct), but no feedback at all is also wrong.

**Fix:** when the autosave call resolves, briefly flash a green checkmark inside the cell border (200ms in, 600ms hold, 400ms out). On error, the existing red border remains until the next edit. No "Saving…" text — just the post-save tick. Subtle, restraint-aligned, removes the doubt.

---

## 3. Schema changes

### 3.1 New table — `program_exercise_sets`

```sql
CREATE TABLE program_exercise_sets (
  id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  program_exercise_id  uuid         NOT NULL REFERENCES program_exercises(id) ON DELETE CASCADE,
  set_number           smallint     NOT NULL CHECK (set_number BETWEEN 1 AND 50),
  reps                 text         CHECK (reps IS NULL OR length(trim(reps)) BETWEEN 1 AND 40),
  optional_metric      text,        -- code matching exercise_metric_units.code
  optional_value       text,
  rpe                  smallint     CHECK (rpe IS NULL OR rpe BETWEEN 1 AND 10),
  created_at           timestamptz  NOT NULL DEFAULT now(),
  updated_at           timestamptz  NOT NULL DEFAULT now(),
  deleted_at           timestamptz,
  UNIQUE (program_exercise_id, set_number)
);

CREATE INDEX program_exercise_sets_pe_idx
  ON program_exercise_sets (program_exercise_id, set_number)
  WHERE deleted_at IS NULL;

CREATE TRIGGER program_exercise_sets_touch_updated_at
  BEFORE UPDATE ON program_exercise_sets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
```

**Columns to remove from `program_exercises`** (in a follow-up migration once the data path is wired):
- `sets smallint` — derived from `COUNT(*)` of `program_exercise_sets` rows. Removed.
- `reps text` — moves to per-set. Removed.
- `optional_metric text`, `optional_value text` — move to per-set. Removed.
- `rpe smallint` — moves to per-set. Removed.

**Columns that stay on `program_exercises`:**
- `instructions text` — coaching cues are per-exercise, not per-set.
- `tempo text` — tempo is per-exercise (e.g. `30x1` applies to every set).
- `rest_seconds int` — rest is per-exercise (rest *between* sets, not within a set).
- `section_title`, `superset_group_id`, `sort_order` — structural, unchanged.

### 3.2 Per-set RLS

Same parent-walk pattern as `program_exercises`:
```
program_exercise_sets → program_exercises → program_days → programs → organization_id
```
Audit register update: add `program_exercise_sets` to `audit_resolve_org_id()`'s CASE list (per user memory note `project_audit_register_new_tables.md`).

### 3.3 Soft-delete RPC

Same pattern as `soft_delete_program_exercise` — bypass RLS for the UPDATE, re-implement the org check inside via the parent walk. Required because the SELECT policy filters `deleted_at IS NULL` and a direct UPDATE setting `deleted_at` returns 42501 (per user memory note `project_postgrest_soft_delete_rls.md`).

### 3.4 Portal RPC update

[`client_get_program_day_exercises`](../../supabase/migrations/20260420102500_client_portal_functions.sql) returns flat `sets / reps / optional_metric / optional_value` today. New shape:

```sql
RETURNS TABLE (
  program_exercise_id   uuid,
  exercise_id           uuid,
  exercise_name         text,
  -- ...
  -- prescription_sets returned as a JSON array per row (one row per program_exercise):
  prescription_sets     jsonb  -- [{set_number, reps, optional_metric, optional_value, rpe}, ...]
)
```
Or — alternative shape — a separate RPC `client_get_program_day_sets` returning per-set rows. Either works; JSON-array-per-exercise is simpler for the portal `Logger` to consume.

---

## 4. Phasing

Dependency-ordered. Each phase ends with a green test pass before the next begins. Density moved to Phase B (chat 2026-05-07) so the visual transformation lands before the heavier schema work.

| Phase | Scope | Depends on |
|-------|-------|-----------|
| **A. Tokens + warm charcoal** ✓ *signed off 2026-05-07* | Replace hardcoded hex / radii / paddings / font sizes in `SessionBuilder.tsx` with design-system tokens. Add tokens to [`globals.css`](../../src/app/globals.css) where the design system has values not yet exported. Switch sequence pill / spine background from `#000` to a dark-chrome token. *Final landing: `var(--color-slate)`. Two new tokens added: `--color-border-hairline: #e2ddd7`, `--color-text-faint: #a09890`. Paddings/font-sizes/weights deferred to Phase B as agreed.* | None. Lowest risk; lands first. Sets the surface tokens density (Phase B) will reach for. |
| **B. Density tightening** ✓ *signed off 2026-05-07* | Card padding 16/20px → 12/14px. Demo-video slab 140px-tall → 96×60px thumbnail bottom-right of left column. Set rows 32px → 26px. Extras row gap 12px → 8px. Card target height ≈ 220px (was ~360px). Three exercises fit on a 1080p viewport without scrolling. *Landed: ExerciseBody padding `16/20` → `12/14` and gap `20` → `14`; demo video restructured into a flex row with the textarea (textarea `minHeight` 64 → 60, anchored `flex-end` so the thumbnail sits bottom-right); thumbnail `width:96 height:60` with a 26px play circle and 12px Play icon (the "Demo"/"No demo" caption dropped — the play affordance carries the meaning at this size); `ColHeader` / `StaticCell` / `SetRow` set label / `InlineCell` heights all 32 → 26; `ExtrasRow` `marginTop` 12 → 8. No new tokens needed — component-specific dimensions stayed inline. Browser verification deferred (auth session expired and user signed off without it).* | A (tokens — so we don't bake new hardcoded values during the tightening). |
| **C. Per-set storage** | New `program_exercise_sets` table + RLS + soft-delete RPC + audit register. Update `addExerciseToDayAction` to insert default-count rows on add. Update `client_get_program_day_exercises` RPC. Update SessionBuilder set-table to read/write per-set. Drop `program_exercises.sets/reps/optional_*` columns in a follow-up migration after a few days of stability. Portal `Logger` — verify still works (it already renders per-set). | B (set rows are at their final height before becoming independently editable). |
| **D. Action bar between + insert-in-place + groups-across-bar** | Move `CardActions` to a new `BetweenCards` slot. New `addExerciseToDayAction` overload accepting `insertAfterPeId`. New `groupAcrossActionBar` action. | C. |
| **E. Section-title dropdown + dedupe + library filter chips** | Wire `SectionTitleField` to `section_titles`. Dedupe consecutive same-section bars in render. Add movement-pattern + tag chips to `LibraryPanel`. | None of A/B/C/D strictly. Independent; can run in parallel with D. |
| **F. Swap-in-place + "Load / Notes" metric dropdown** | New `swapProgramExerciseAction`. New `[value][metric]` cell driven by `exercise_metric_units`. | C (per-set storage means swap re-creates per-set rows from new exercise's defaults). |
| **G. Drag-and-drop reorder** | `@dnd-kit/core` install. Grip handle becomes drag handle. New `reorderProgramExercisesAction(dayId, orderedIds)`. Drop-into-superset / drop-out-of-superset edge cases. Keep arrow buttons. | D (between-card slot model is the drop-target shape). |
| **H. "Last logged" footer** | New per-card data fetch on the page loader. Render at bottom of prescription column. | C (set storage shape symmetry with `set_logs`). |
| **I. Polish round** | Empty-state CTA, sticky-panel fix, autosave tick, **duplicate-button implementation** (`duplicate_program_day` RPC + date picker + navigate-to-new-day), pencil-affordance opacity bump. | All of the above so the polish doesn't have to redo work. |

Estimated rough effort, EP-day-equivalents (NOT a commitment; calibration only):
- A: 0.5 day
- B: 0.5 day
- C: 2 days (schema + RPC + SessionBuilder + portal verify)
- D: 1 day
- E: 1 day
- F: 1 day
- G: 1.5 days (DnD + group edges)
- H: 0.5 day
- I: 1.5 days (duplicate RPC adds ~0.5 day vs the previous "either/or")

Total: ~9.5 EP-days. Sequenced, no overlap. Acceptance test at the end of each phase.

---

## 5. Out of scope for this pass

- **VALD report integration in the Reports tab.** Tracked in the testing module brief; the Reports panel here just lists what `reports` returns from RLS-scoped queries.
- **Tag-assignment UI in /library.** Tag *filtering* in the session-builder library panel (P1, §2.8) renders against existing tags; tag *creation/assignment* is a separate exercise-library polish pass.
- **Session-template picker on a fresh day.** Brief mentions "start from template" — defer until the new-program flow stabilises (see [`docs/polish/programs.md`](./programs.md)).
- **Session feedback / completion notes flowing back to the EP.** Lives in `sessions.feedback` already; the EP-side surface for reviewing it is a Phase 2 concern.
- **Phase 2 AI-drafted check-ins / smart prescription suggestions.** Per CLAUDE.md, Phase 2 starts only after Phase 1 polish is complete + external IT review has closed.

---

## 6. Open questions

None at sign-off. All architectural calls are resolved in §0.1.

If something surfaces during Phase A that contradicts an answer here, it gets raised in chat — never silently re-decided.
