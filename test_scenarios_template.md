# Odyssey — Test scenarios

Behaviour pass-criteria log (CLAUDE.md **Maintenance rule**). Every shipped
behaviour — bug fix or feature — adds or updates a scenario here with a written
pass criterion **before it is considered done**. A behaviour without a written
pass criterion is untested, and untested behaviour does not ship.

> **Provenance note (2026-06-26):** CLAUDE.md references this file as the canonical
> behaviour-scenario log, but no such file existed in the repo when the Maintenance
> rule next required one. Created here with the Change 1 (client-portal in-session
> RPE simplification) scenarios. If behaviour scenarios are in fact tracked
> elsewhere (e.g. the Notion capture board), reconcile this file with that surface.

Each scenario: an id, setup/action, and an explicit **Pass** criterion.

---

## Client portal — in-session logging (RPE simplification, 2026-06-26)

Context: client-logged per-set RPE was removed from the in-session flow; the
post-session **Session RPE** capture is kept; the weekly "Avg RPE" stat was
removed. Owner-approved deviation from brief §6.3.1 (see
`docs/polish/client-portal-pwa.md` §10.1).

### CP-RPE-1 — A set logs with no RPE input; Session RPE is recorded and stored
- **Setup:** Client begins today's session with ≥1 exercise.
- **Action:** Inspect a set row; log it. On the wrap-up screen pick a Session RPE
  (e.g. 7) and tap Finish session.
- **Pass:** No RPE field appears on any set row (only the volume + load inputs).
  Every logged set has `set_logs.rpe = NULL`. `sessions.session_rpe = 7` is
  stored, and the EP sees "RPE 7" in the client-profile completion summary.

### CP-RPE-2 — Session RPE remains optional (skip → clean state, never a dash)
- **Action:** Finish a session without selecting a Session RPE.
- **Pass:** Completion succeeds; `sessions.session_rpe IS NULL`; the completion
  summary's **Session RPE** tile shows a muted "Not rated" — never "—".

### CP-RPE-3 — "This week" block is a clean two-up
- **Action:** Open the portal home (Today).
- **Pass:** The "This week" block shows exactly two stats — **Completed** and
  **Remaining**. No "Avg" / "Avg RPE" stat, and no empty slot where it was.

### CP-RPE-4 — Completion summary reflects this session's RPE (not an average)
- **Setup:** Finish a session with Session RPE = 8 across multiple exercises.
- **Pass:** The completion summary 2×2 reads Exercises / Volume / **Session RPE**
  / Duration, with Session RPE = **8** (the value just given, not a per-set mean).

### CP-RPE-5 — Prescribed RPE shows only when prescribed
- **Setup (a):** A program exercise prescribed with `optional_metric='rpe'`,
  value `8`. **Setup (b):** an exercise with no RPE prescribed.
- **Pass:** (a) the day-card exercise row and the in-session prescription line
  both show "RPE 8"; (b) nothing RPE-related appears on either surface.

---

## Client portal — metric-driven set logging (Change 2, 2026-06-26)

Context: each set row's inputs are driven by the stored prescription metric —
the volume box is headed by the actual unit (Reps / Seconds / Metres), and a
load box appears ONLY when kg/lb is the prescribed load metric (Decision B).
Prescription pre-fills; native numeric keypad; focus pre-selects.

### CP-LOG-1 — Weighted (kg) exercise
- **Setup:** A set prescribed reps + `optional_metric='kg'`, value `80`.
- **Pass:** Two boxes — one headed **REPS** pre-filled with the reps, one headed
  **KG** pre-filled `80`. No generic "Load" heading anywhere. Logging stores
  `reps_performed` + `weight_value=80`, `weight_metric='kg'`.

### CP-LOG-2 — Bodyweight / no-load exercise
- **Setup:** A set with `optional_metric='bodyweight'` or NULL (not kg/lb), reps volume.
- **Pass:** A single **REPS** box, full width. **No load box.** Logging stores
  `reps_performed`, no weight.

### CP-LOG-3 — AMRAP / "max" exercise
- **Setup:** A set with non-numeric reps (`max`, or a range like `8-12`).
- **Pass:** The volume box shows the prescribed text as a **placeholder** (e.g.
  "max"), empty value, and is the primary input. Typing a number logs it as the
  actual reps.

### CP-LOG-4 — Timed hold (load box suppressed BY the time metric, by design)
- **Setup:** A set with `rep_metric='time_minsec'`, reps `30`.
- **Pass:** A single box headed **SECONDS**, pre-filled `30`, no load box, no
  separate reps box. Logging stores `reps_performed=30`, `rep_metric='time_minsec'`.
- **By design:** the load box is suppressed *because the volume metric is time*,
  not coincidentally absent — a timed hold is time-only even if a kg load were
  prescribed. (No weighted timed holds exist in the library today; revisit only
  if one is ever added.)

### CP-LOG-5 — Distance (and loaded carry)
- **Setup (a):** `rep_metric='distance_m'`, reps `20`, no kg. **(b):** same with
  `optional_metric='kg'`, value `40` (e.g. a Farmer's Carry).
- **Pass:** (a) one box headed **METRES** pre-filled `20`, no load box. (b)
  **METRES** + **KG** boxes (distance + load), both pre-filled.
- **By design — integer metres:** distance logs as **whole metres** via a numeric
  (not decimal) keypad, because the volume column `set_logs.reps_performed` is
  `smallint`. This is intentional, not a decimal-input bug — sub-metre precision
  would require a schema change (out of scope; would re-enter the polish protocol).

### CP-LOG-6 — Confirm-as-prescribed is one tap
- **Setup:** Any prescribed set, autofill on.
- **Pass:** The prescribed values show as muted (ghost) defaults; tapping **Log**
  once (no keyboard) commits the set exactly as prescribed.

### CP-LOG-7 — Deviation persists the actual, changes only the touched value
- **Action:** Tap the load value (it pre-selects), type a different number, tap Log.
- **Pass:** Only the touched field changes; the volume keeps its prescribed value.
  The logged set reflects the deviation (actual ≠ prescription), and the row reads
  as edited (not ghost) for the changed field.

### CP-LOG-8 — Heading is the runtime metric, never hardcoded
- **Setup:** One exercise prescribed in `kg`, one in `lb`.
- **Pass:** The load box reads **KG** and **LB** respectively (from the stored
  `optional_metric`), and a bare number is logged in that unit. Never "Load".

### CP-LOG-9 — Carried-forward prefill reads as an adjustable ghost
- **Setup:** Set 1 logged as a deviation (e.g. prescribed 80kg, logged 82kg);
  set 2 untouched, autofill on.
- **Pass:** Set 2's load pre-fills **82** rendered as a **translucent ghost** (not
  solid) — signalling it's still adjustable. Editing set 2's load makes only that
  field solid (set 2's reps stay ghosted); tapping Log commits the carried value.
  A field reads ghost until the client edits THAT field, for every prefill source
  (prescription, carry-forward, or last-logged fallback).

---

## Client portal — last-logged reference line + prefill fallback (Change 3, 2026-06-26)

Context: a quiet `last: 80kg × 6 · Sat 11 Apr` reference line beneath kg/lb set
rows, and a prefill fallback that protects a deliberate prescription. Requires a
test client with **prior completed sessions** logging the same exercises. Reuses
the staff builder's last-logged read (client-RLS, most-recent-completed wins,
keyed by `exercise_id`); no new RPC, no migration.

### CP-REF-1 — Reference line on a kg/lb set with prior history
- **Setup:** A kg exercise the client logged last session (e.g. 80kg × 6).
- **Pass:** Beneath that set's boxes, a muted line reads `last: 80kg × 6 · <date>`
  (load × volume in its unit; date in the client's timezone). Reference only —
  it does not write into the box.

### CP-REF-2 — No prior history → no reference line (clean absence)
- **Setup:** A kg exercise the client has never logged.
- **Pass:** No reference line renders — never `last: —`.

### CP-REF-3 — Unmatched set number → no reference line for that set
- **Setup:** Last session logged 3 sets; today's prescription has 4.
- **Pass:** Sets 1–3 show their matched reference lines; **set 4 shows none**
  (no `last: —`).

### CP-REF-4 — Load-only scope
- **Setup:** A bodyweight set, a timed set, and a distance-only (no-kg) set, all
  with prior completed logs.
- **Pass:** **No reference line** on any of them — the line appears only on kg/lb
  sets, where it informs what to load.

### CP-REF-5 — Prefill priority (prescription protected) + reference independence
- **Setup (a):** kg set prescribed `@ 85kg`, last logged `80kg`. **(b):** kg set
  with the **metric but no prescribed weight**, last logged `80kg`.
- **Pass:** (a) the box pre-fills **85** (the prescription wins; last-logged never
  overwrites it), and the reference line still shows `last: 80kg …`. (b) the box
  pre-fills **80** from the last-logged actual. In both, the reference line is
  shown because prior history exists — independent of what pre-filled.

---

## Staff session builder — last-logged footer reads sessions.completed_at (bug fix, 2026-06-26)

Context: the per-exercise "Last logged" footer on the staff session builder
(`src/app/(staff)/clients/[id]/program/days/[dayId]/page.tsx`) filtered and
ordered on `exercise_logs.completed_at` — a column **no logging path ever
populates** (the portal RPCs stamp `set_logs.completed_at` and, on finish,
`sessions.completed_at`; the `exercise_logs` parent is inserted without a
`completed_at`). Result: `.not('completed_at','is',null)` matched nothing, so the
footer was **always empty for every portal-logged session**. Fixed to key off
`sessions.completed_at` via a `sessions!inner(client_id, completed_at)` join with
a TS recency sort (PostgREST can't order the parent by an embedded child column),
mirroring the portal's own last-logged read. No migration, no new RPC. Requires a
test client with prior **completed** sessions logging the day's exercises.

### SB-LL-1 — Portal-logged completed session surfaces in the footer (the regression)
- **Setup:** Client logs an exercise via the portal (e.g. 80kg × 6) and **completes**
  the session. Open that exercise on the staff session builder for the same client.
- **Pass:** The exercise card's "Last logged" footer renders the logged sets
  (80kg × 6) dated to the session's completion. (Before the fix: always empty.)

### SB-LL-2 — Most-recent completed session wins, deduped by exercise
- **Setup:** The same exercise completed in two sessions on different dates.
- **Pass:** The footer shows only the **newest** completed session's sets — one
  footer per exercise, never stacked history.

### SB-LL-3 — In-progress session excluded (completion gates the footer)
- **Setup:** Client logs sets for the exercise but does **not** complete the
  session (`sessions.completed_at` IS NULL), and no earlier completed session
  exists for it.
- **Pass:** No footer renders for that exercise — only completed sessions count
  as "last logged", matching the portal's reference-line behaviour.

### SB-LL-4 — Client scoping (shared exercise_id never leaks across clients)
- **Setup:** Two clients in the org have each completed the same catalog exercise.
  Open the exercise on client A's session builder.
- **Pass:** The footer shows **only client A's** logged sets — client B's history
  for the same `exercise_id` never appears (the `.eq('sessions.client_id', id)`
  scope holds; RLS keeps the org boundary, the client filter narrows within it).

---

## Staff platform — on-system dialogs & notices (2026-06-27)

Context: every native browser `confirm()`/`alert()` across the staff app was
replaced with on-system UI. Confirmations use the shared `ConfirmDialog`
(`src/app/(staff)/_components/ConfirmDialog.tsx`); failures at sites with no
inline error slot use a new bottom-anchored `Notice` toast
(`src/app/(staff)/_components/Notice.tsx`, with `NoticeHost` mounted once in the
staff layout). No `confirm()`/`alert()` calls remain (the PWA-install
`promptEvent.prompt()` is a different API and is untouched). Migration-free, no
new DB surface.

### DLG-1 — Destructive actions confirm via ConfirmDialog, not the browser
- **Setup:** Any delete/archive across the staff app (e.g. Settings → Session
  types → trash a type; a library circuit/session/program card → Delete; a
  program-day → Delete day; an availability rule → Delete).
- **Action:** Click the delete/archive control.
- **Pass:** The on-system ConfirmDialog opens (dark scrim, ~440px card,
  display-font heading, Cancel + tonal confirm) — never the browser's native
  `confirm()`. Cancel closes it with no change; the confirm button carries the
  action's verb (e.g. "Delete", "Archive", "Unassign").

### DLG-2 — A confirmed action that fails surfaces inside the dialog (retry, no alert)
- **Setup:** Trigger a delete/archive whose server action fails (e.g. offline).
- **Action:** Confirm in the dialog.
- **Pass:** The dialog STAYS open and shows the error in its inline alert block;
  the buttons re-enable so the EP can retry or cancel. No browser `alert()` fires,
  and the item is not removed from the list.

### DLG-3 — A no-slot failure surfaces as an on-system notice (toast)
- **Setup:** A tiny async control with no inline error slot — the session-builder
  set grid (add/move set, group/ungroup, reorder), a library set-stepper or
  column-unit dropdown (`editor-kit`), a settings test toggle, or a schedule
  drag-to-reschedule.
- **Action:** Force the underlying server action to fail (e.g. offline), then use
  the control.
- **Pass:** A bottom-anchored on-system notice appears with the error message
  (alert-red, AlertCircle icon, dismiss ×), auto-dismisses after ~6s and is
  dismissible by hand. No browser `alert()` fires. Optimistic UI reverts where
  applicable (e.g. the test toggle flips back).

### DLG-4 — The schedule popover's confirm renders ABOVE the popover
- **Setup:** Schedule grid → click an appointment to open its popover (z-index 1000).
- **Action:** Click "Cancel appointment" (client appt) or "Remove block"
  (Unavailable block).
- **Pass:** The ConfirmDialog scrim + card render ABOVE the popover (caller passes
  `zIndex={1100}`) and are fully interactive; confirming performs the action and a
  failure shows in the dialog. A lifecycle action (Complete / No-show) that fails
  shows an on-system notice visible ABOVE the popover (NoticeHost z-index 2000),
  never a browser `alert()`.

### DLG-5 — NoticeHost causes no hydration mismatch
- **Setup:** Any staff page (NoticeHost is mounted in the staff layout).
- **Action:** Load the page fresh (full SSR + hydration) with the browser console open.
- **Pass:** No "Hydration failed" / NoticeHost mismatch error. NoticeHost renders
  nothing while no notice is active — the list is empty through SSR and the first
  client render, so the server and client trees match — and the toast container
  mounts only once a notice is pushed.

### DLG-6 — Advisory (non-destructive) confirm is primary-toned
- **Setup:** Settings → Availability → add/edit an hours rule whose time range
  overlaps an existing rule for the same day/date.
- **Action:** Save.
- **Pass:** A primary-toned ConfirmDialog asks "Save anyway?" (overlap is allowed
  by the DB — recoverable, not destructive). Confirming saves; cancelling returns
  to the form with no save. No browser `confirm()`.

## Staff program calendar — day popover prescription summary (bug fix, 2026-06-27)

Context: the program-calendar day popover (`MonthCalendar.tsx` → `DaySummaryPopover`)
showed "—" for every exercise's set/reps/metrics. Root cause: its loader
(`clients/[id]/program/page.tsx`) read the legacy flat columns
`program_exercises.sets/reps/rpe/optional_*`, which have been dead since the
per-set fan-out — the live prescription lives in the child
`program_exercise_sets` table (per-set `reps` + `rep_metric`, and `optional_value`
+ `optional_metric`). The loader now reads the per-set rows and precomputes a
one-line summary via the shared `summarisePrescription`
(`src/lib/prescription/summarise.ts`), which renders the volume axis through the
same `formatVolume` the builder/portal use, so units can't drift. Read-only;
migration-free; no new DB surface.

### PCAL-1 — The day popover shows the real prescription, not "—"
- **Setup:** A client with a programmed day whose exercises carry prescribed sets
  (e.g. the seed "Day 1": Hip Circles 2×12, 90/90 breathing 1×10, Adductor 2×12,
  BB Back Squat 3×8 @ 80kg).
- **Action:** Open the program calendar and click that day to open its summary popover.
- **Pass:** Each exercise row shows its prescription under the name — "2 × 12",
  "1 × 10", "2 × 12", "3 × 8 · 80kg" — not "—". The `×` is the U+00D7 sign and
  sets/reps match what the session builder shows for the same day.

### PCAL-2 — Volume and load metrics render in the summary
- **Setup:** On one day, prescribe a timed hold (e.g. 3 sets, volume unit Seconds,
  value 30), a percentage-load lift (e.g. 1 × 5 at 75%), and an RPE-targeted set
  (Load/Notes metric = RPE, value 8).
- **Action:** Open the day popover.
- **Pass:** The timed row reads "3 × 30s" (the volume unit, via `formatVolume`),
  the percentage row reads "1 × 5 · 75%", and the RPE row appends "· RPE 8".
  A uniform load shows once (e.g. "· 80kg"); varied reps list compactly
  ("8 / 6 / 4") rather than collapsing to a single value.

### PCAL-3 — Honest "—" only when nothing is prescribed
- **Setup:** Add an exercise to a day but leave all of its sets blank (no reps,
  no load), or an exercise with no set rows yet.
- **Action:** Open the day popover.
- **Pass:** That row shows "—" (genuinely empty), while sibling exercises that DO
  have a prescription render theirs. An exercise with set rows but no reps typed
  reads "{n} sets".

### PCAL-4 — An ascending / varied load lists every set's value
- **Setup:** Prescribe an exercise as an ascending-load sequence — same reps,
  different load per set (e.g. 3 × 8 at 80 / 85 / 90 kg).
- **Action:** Open the day popover.
- **Pass:** The row lists every load — "3 × 8 · 80kg / 85kg / 90kg" — not a blank
  and not a single value. Varied RPE lists the same way ("· RPE 7 / 8 / 9"); a set
  left blank holds its place ("80kg / – / 90kg"); a uniform load still collapses to
  one ("· 80kg").
