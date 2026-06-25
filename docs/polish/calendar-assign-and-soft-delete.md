# Dogfooding batch — assign-all, assigned marker, software delete dialogs

**2026-06-25. Within-surface changes (no schema, no new security surface) →
four-bucket dogfooding loop, not the full polish protocol.** Items 1, 2 are
UX additions to the signed-off program calendar (section 6); item 4 is a UX
papercut fix across the session builder (section 5) and library editors.

> Maintenance-rule note: CLAUDE.md's rule says scenarios go in
> `test_scenarios_template.md`. **That file does not exist in the repo** (no file
> and no reference to it anywhere) — surfaced as CLAUDE.md drift. Pass criteria
> are recorded here in the polish-doc convention until the canonical location is
> confirmed.

---

## Item 1 — "Assign all" (publish backlog in one action)

**What changed**
- New `publishAllProgramDaysAction(clientId)` in
  `src/app/(staff)/clients/[id]/program/day-actions.ts`. Publishes every
  unassigned (`published_at IS NULL`), live program_day that has ≥1 live
  exercise, across **all active blocks** for the client. Empty days are skipped
  and counted (mirrors the single-day `AssignButton` guard). Runs as the authed
  EP — **RLS scopes every read + the UPDATE to the caller's org** (no SECURITY
  DEFINER). One `published_at` timestamp across the batch.
- `MonthCalendar` shows an **"Assign all · N"** primary button (Send icon) in the
  header right cluster when `N > 0` and the calendar is idle. Click → on-system
  `ConfirmDialog` (tone primary — publishing is recoverable via Unassign) → on
  confirm, runs the action and `router.refresh()`. Failures surface inside the
  dialog.
- `published_at` threaded through the loader (`program/page.tsx`) and the
  `ProgramDayWithExercises` type; `clientFirstName` passed to `MonthCalendar` for
  the confirm copy.

**Pass criteria**
1. Client with ≥2 unassigned days (each with exercises) across active blocks →
   header shows "Assign all · 2"; confirm → both publish; button disappears;
   tiles show the Assigned marker.
2. A day with **zero exercises** is **not** counted and **not** published.
3. Unassigned count spans **all** active blocks, not just the visible month.
4. Action on a client in another org touches **zero** rows (RLS), returns
   `assigned: 0`.
5. A mid-action failure keeps the dialog open with the error; no partial silent
   failure.

## Item 2 — "Assigned" marker on the calendar tile

**What changed**
- Programmed-day `DateCell` renders an accent-green **check + "Assigned"** below
  the exercise count when `published_at !== null`. Green appears **only on the
  checkmark** (design-system's sanctioned completion-state use); the label is
  `--color-muted`, weight 500 (respects "no weight 600+ below 13px").

**Pass criteria**
1. An assigned day shows the green-check "Assigned" marker; an unassigned day
   does not.
2. Assigning (single-day or Assign-all) makes the marker appear after refresh;
   Unassign removes it.
3. Marker reads legibly at normal and panel-open (narrow) cell widths.

## Item 4 — software delete dialog (not browser `confirm()`)

**What changed** — the delete-exercise `confirm()`/`alert()` replaced with the
shared on-system `ConfirmDialog` at three sites; a delete **failure now renders
inside the dialog** (no separate `alert()`):
- `SessionBuilder.tsx` (`ExerciseBody`) — "Remove exercise from this session".
- `CircuitEditor.tsx` (`CircuitExerciseRow`) — "…from this circuit".
- `DayContentEditor.tsx` (`DayExerciseRow`) — "…from this day" (library Sessions +
  program-template days; the shared editor).
- `ConfirmDialog` **relocated** `clients/[id]/_components/` →
  `(staff)/_components/` (shared home, beside `MonthYearPicker`); the 3 prior
  importers (ClientFlags, MedicalHistory, NotesTab) repointed to
  `@/app/(staff)/_components/ConfirmDialog`.

**Pass criteria**
1. Trash on an exercise (each of the 3 surfaces) → styled dialog, **no** browser
   popup; Cancel keeps the exercise; Remove deletes it.
2. A delete failure shows the error **inside** the dialog; the dialog stays open
   to retry/cancel.
3. The 3 existing `ConfirmDialog` consumers (flags resolve, medical-condition
   delete, notes) still work after the relocation.

## Revision — review feedback (2026-06-25)

**Item 4 — modal was trapped inside the card, then jumped on lock.** The delete
dialog rendered as a `position: fixed` descendant of a dnd-kit sortable card,
whose `transform` re-bases fixed positioning onto the card (not the viewport):
the scrim was confined to the card, the page still scrolled, and sibling cards
bled through. Fix in `ConfirmDialog` (one place, all consumers): render through a
**portal to `<body>`** + z-index 300. The scroll-lock was then refined: the first
version set `overflow:hidden` on `<html>` (which is `height:100%` here), clipping
it to the viewport and snapping the page to the top — visibly dragging the
session-builder library rail upward. Replaced with a **pin-the-body lock**
(`position:fixed; top:-scrollY` + scrollbar-width compensation, restore + scroll
back on close) → zero visual movement.
- Pass: open the dialog → whole screen dims, nothing behind scrolls, moves, or
  responds (incl. the library rail); Cancel/Esc/scrim-click closes and the page is
  exactly where it was; the non-card consumers (flags/medical/notes) still work.

**Item 2 — marker moved to the tile corner, with label.** The "Assigned" check was
in the cell's content flow, so an assigned tile grew taller. Moved to an
absolutely-positioned **top-right pill** — green `--color-accent` check + the word
**"Assigned"** on `--color-accent-soft` — so tile height is identical assigned vs
not (the corner is out of flow).

**Item 3 (addition) — one-click assign from the tile.** The same corner shows an
**"Assign" pill with the paper-plane icon** on a not-yet-assigned day that has
exercises; clicking it publishes that day immediately (matches the in-builder
`AssignButton` — no confirm, Unassign is the undo) and the pill flips to the green
"Assigned". Empty days show no corner (can't be assigned), consistent with
Assign-all. Hidden during a copy-pick.
- Pass: unassigned-with-exercises tile shows the "Assign" pill → click → "Assigned"
  pill appears, "Assign all" count drops by one, day shows in the client's portal;
  assigned tile shows the "Assigned" pill; empty day shows neither; tile size
  constant in all states.

## Out of scope this batch
- Item 3 (block-less / one-off sessions) — structural, built separately →
  `docs/polish/one-off-sessions.md` (implemented 2026-06-25, awaiting section sign-off).
- The broader `confirm()`/`alert()` sweep across the app (owner chose the 3 named
  delete sites only).
- Pre-existing `react-hooks/set-state-in-effect` lint errors (3, all in code not
  touched here) — left as-is to avoid scope-creep.
