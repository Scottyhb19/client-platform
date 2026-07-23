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

## Staff session notes — appointment picker lists all sessions (UX papercut, 2026-06-27)

Context: on the client "Session notes" tab, the New-note SESSION dropdown
(`NotesTab.tsx` → `AppointmentPicker`) capped Upcoming and Past to a 14-day window
and rendered a "Show N more sessions" link beneath the select to uncap. That extra
row made the Session field taller than the Template field; because the parent row
bottom-aligns its fields (`alignItems: 'flex-end'`), the taller Session field
pushed Template down so the two no longer shared a line. The cap and the link are
removed: the dropdown now lists every session — Next session, then all Upcoming,
then all Past (newest first) — in its own scroll, so future sessions are visible on
open and the Session/Template fields are equal height and aligned. UI-only; no
schema, RPC, or data change.

### SN-APT-1 — Session and Template sit on one line
- **Setup:** Open a client with many sessions (enough that the old picker would
  have shown "Show N more sessions") → Session notes tab → New note.
- **Action:** Look at the SESSION and TEMPLATE fields without interacting.
- **Pass:** Both labels and both dropdowns share the same baseline — Template is
  not pushed below Session. No "Show N more sessions" link appears beneath SESSION.

### SN-APT-2 — Future sessions show on open, no "show more" step
- **Setup:** A client with future sessions scheduled more than 14 days out.
- **Action:** Open the SESSION dropdown.
- **Pass:** "Next session · …" is first, then an "Upcoming" group listing every
  remaining future appointment (including ones beyond 14 days) — reachable without
  any "Show more" click. "None — no linked session" sits between Next session and
  Upcoming.

### SN-APT-3 — Past sessions remain available, newest first
- **Setup:** A client with past sessions older than 14 days, some already carrying
  a note.
- **Action:** Scroll the open dropdown to the "Past" group.
- **Pass:** Every past appointment is listed, most-recent first; none are hidden by
  a cap. Appointments that already have a note still read "· ✓ has note".

### SN-APT-4 — Empty / sparse states stay clean
- **Setup:** A client with no upcoming sessions (or no sessions at all).
- **Action:** Open the SESSION dropdown.
- **Pass:** Absent groups don't render (no empty "Upcoming"/"Past" headers),
  "None — no linked session" is always selectable, and there is no leftover
  "Show more" affordance or blank row beneath the select.

---

## Staff reports comparison — hook-order crash on clearing selection (bug fix, 2026-06-27)

Context: `ComparisonTable` (`src/app/(staff)/clients/[id]/_components/reports/ComparisonTable.tsx`)
called `useMemo` **after** two early `return`s (no sessions selected / no rows).
Because the table is always mounted inside the comparison overlay and `view` is
driven by the session-picker's selection state, clearing the selection toggled
the component from the populated path (1 hook) to the early-return path (0 hooks)
on the **same instance** — a `react-hooks/rules-of-hooks` violation that makes
React throw "Rendered fewer hooks than expected" and blanks the overlay. Fixed by
hoisting the `useMemo` above the early returns so the hook runs unconditionally;
its result is unused on the early-return paths, so render output is unchanged.

### RPT-CMP-1 — Clearing the session selection does not crash the overlay
- **Setup:** Open the reports comparison overlay for a client with ≥1 captured
  session and select one or more sessions (the pivot table renders).
- **Action:** Click "Clear" in the session picker, then re-select a session.
- **Pass:** The table cleanly swaps to the "Select at least one session to
  compare." empty state and back to the populated pivot — no blank overlay, no
  "Rendered fewer hooks than expected" console error. (Before the fix: clearing
  crashed the comparison view.)

### RPT-CMP-2 — Populated pivot is byte-for-byte unchanged
- **Setup:** A client with multiple captured sessions, several selected.
- **Pass:** Rows (one per test/metric/side), the chronological session columns,
  and the "Δ baseline → latest" column render exactly as before the refactor —
  the hoist changed only *when* the memo runs, not its value or the markup.

---

## EP Dashboard — Needs-Attention Trigger Set v2 (2026-06-28)

Context: the Needs-Attention panel (`src/app/(staff)/dashboard/page.tsx`,
`buildAttentionList`) gains the v2 triggers, a dead-trigger fix, and item-3
reconciliation, as the follow-up to the closed EP Dashboard §11 (see
`docs/polish/ep-dashboard.md` §9). Logic-only — no schema, no new security
surface. The panel splits into two **deduped-separately** groups (operator
decision 2026-06-28): **Adherence** (Overdue/Ended/Ending/New/Onboarding — is the
client training?) and **Clinical admin** (Flag/Reconcile — is the appointment
paperwork done?); a client can show one row in each. Assessment-completeness
stays parked.

### DASH-V2-1 — Onboarding funnel: invite not accepted
- **Setup:** A client with `invited_at` 8 days ago, `onboarded_at` NULL, no
  completed sessions, not archived.
- **Action:** Load `/dashboard`.
- **Pass:** A Needs-attention row with the **Onboarding** tag, reason
  "Invited 8 days ago — not accepted", action **Open** → `/clients/{id}`
  (client details). The avatar is amber; the tag is the soft neutral style.

### DASH-V2-2 — Onboarding funnel: onboarded, no first session
- **Setup:** A client `onboarded_at` set, `invited_at` 9 days ago, zero rows in
  `sessions` with `completed_at` for that client.
- **Pass:** One **Onboarding** row, reason "Onboarded — no sessions logged yet",
  action Open → client details.

### DASH-V2-3 — Onboarding funnel stays quiet when it should
- **Setup (a):** A client invited 3 days ago, not accepted. **(b):** a client
  invited 20 days ago who has ≥1 completed (logged) portal session. **(c):** a
  client created with no invite (`invited_at` NULL). **(d):** a stalled client
  whose `overdue_followed_up_at` was set <10 days ago.
- **Pass:** None of (a)–(d) produce an Onboarding row. (a) inside the 7-day
  clock; (b) has logged a portal session; (c) never invited; (d) acknowledged
  recently. **Note:** a past in-clinic appointment does NOT suppress onboarding
  (operator decision 2026-06-28) — only a logged portal session counts as
  "got going". See DASH-V2-14.

### DASH-V2-4 — The old "invited — not onboarded" New row is gone
- **Setup:** Any invited-not-onboarded client past 7 days.
- **Pass:** Their row carries the **Onboarding** tag, never a green **New** tag
  reading "Invited — not yet onboarded" (that branch was replaced).

### DASH-V2-5 — Program ended: no training days remaining
- **Setup:** A program client with **no program day scheduled today or later**
  (across their active/draft programs) and no `draft` block queued. Their nominal
  end date and any booked appointments are irrelevant to this trigger.
- **Pass:** One **Ended** row (amber tag), reason "Program ended — no new block",
  action **Plan** → `/clients/{id}/program`. The client does **not** also appear
  as Overdue or Ending.

### DASH-V2-6 — Ending → Ended is a state machine (never both)
- **Setup:** A program with no program day scheduled beyond its end and no future
  booking. Move its end across "today": first 5 days in the future, then 2 days
  in the past.
- **Pass:** While future-dated the client shows exactly one **Ending** row; once
  past-dated with nothing remaining, exactly one **Ended** row. Never both at
  once for the same client.

### DASH-V2-7 — Ended suppressors (program track vs single-session track)
- **Setup (a):** A program client with a `draft` block queued. **(b):** a
  program client with a program day scheduled today-or-later (incl. one past the
  nominal end date). **(c):** a single-session client (no program) with an
  upcoming appointment.
- **Pass:** None produce an Ended row. For a **program** client only a remaining
  program day or a draft suppresses — booked appointments do **not** (the next
  block is still owed). For a **single-session** client the upcoming appointment
  is what suppresses.

### DASH-V2-8 — "New" fires off the initial-assessment note (dead-table fix)
- **Setup:** A client with a `clinical_notes` row `note_type =
  'initial_assessment'` (`deleted_at` NULL) and no program of any status.
- **Pass:** One green **New** row, "Assessment complete — no program yet",
  action **Build program** → `/clients/{id}/program/new`. Verified the dashboard
  no longer queries the dormant `assessments` table (it queries `clinical_notes`
  for `initial_assessment`). A client with **no** initial-assessment note does
  not get this row.

### DASH-V2-9 — Per-client dedupe keeps the most urgent across the new tones
- **Setup:** One client who is simultaneously assessment-complete-no-program
  (**New**) and 8-days-invited-no-session (**Onboarding**).
- **Pass:** Exactly one row for that client — the **New** row (New outranks
  Onboarding). Priority order overall: Flag > Overdue > Ended > Ending > New >
  Onboarding.

### DASH-V2-10 — Onboarding can be dismissed like Overdue
- **Setup:** An Onboarding row (e.g. invited 8 days ago, not accepted).
- **Action:** Click **Program checked & message sent** beside the row.
- **Pass:** `clients.overdue_followed_up_at` is stamped; the row drops off on
  revalidate and stays gone for ~10 days, then re-surfaces if the client is still
  stalled. It is the same control (and label) Overdue uses.

### DASH-V2-11 — Single-session client with no program is caught
- **Setup:** A client with **no program of any status**, a past (non-cancelled)
  in-clinic appointment **>10 days ago**, and no upcoming appointment.
- **Pass:** One **Ended** row, reason "No sessions booked — last seen N days
  ago", action **Open** → `/clients/{id}`. (Before v2 this client was invisible
  to the panel.) A single-session client last seen **<10 days ago**, or with any
  upcoming appointment booked, produces **no** row.

### DASH-V2-12 — "Sessions remaining" beats the nominal end date
- **Setup:** An `active` program already past `start_date + duration_weeks×7`
  but with at least one program day scheduled today or later.
- **Pass:** **No Ended row** — a remaining scheduled session means training isn't
  over, even though the nominal end date has passed.

### DASH-V2-13 — Program ended shows even with standing appointments (regression)
- **Setup:** A program client with **0 upcoming program days** (including the
  open-ended case: an `active` program with NULL `start_date`/`duration_weeks`)
  **and** many upcoming appointments booked.
- **Pass:** They surface as **Ended → "Program ended — no new block"**. This is
  the bug found in review against the seeded "Browning" test clients: the
  nominal-window check (an open-ended program counted as "in window") plus the
  appointment check together hid these clients even though their programs had no
  training days left. The trigger judges the program track by program days only;
  appointments belong to the single-session track.

### DASH-V2-14 — In-clinic client with no logged session shows as Onboarding
- **Setup:** A client invited 8+ days ago, accepted (`onboarded_at` set), with
  past and/or upcoming in-clinic appointments but **no logged portal session**,
  not acknowledged.
- **Pass:** They surface as **Onboarding → "Onboarded — no sessions logged yet"**
  (action Open → client details), regardless of their appointments. Operator
  decision 2026-06-28: only a logged portal session counts as "got going". A
  client who also qualifies for a more urgent row (e.g. a program client who is
  also Ended) shows that row instead via dedupe — so the onboarding row appears
  only for clients with no higher-priority **adherence** reason. **Reconcile** is
  a separate group (Clinical admin), so the same client can ALSO show a Reconcile
  row — the two domains don't compete (DASH-V2-19).

### DASH-V2-15 — Reconcile: a past appointment needs attendance
- **Setup:** A client with a `kind='appointment'` booking whose `end_at` is in
  the past (within ~30 days), still `pending` or `confirmed` (attendance never
  set).
- **Pass:** A **Reconcile** row (amber), reason "<date> — attendance not set",
  action **Open** → `/schedule?d=<that date>` (the schedule jumps to that day).
  Marking the appointment completed or no-show (or it ageing past ~30 days)
  clears it.

### DASH-V2-16 — Reconcile: a completed session owes a note
- **Setup:** A past `completed` appointment with **no** linked clinical note.
- **Pass:** A **Reconcile** row, reason "<date> — note owed". Adding a clinical
  note for that appointment (the popover Add-note carries the appointment link)
  clears it. A completed appointment that already HAS a note does not show.

### DASH-V2-17 — Reconcile excludes the reconciled / out-of-scope
- **Pass:** No Reconcile row for: `no_show` or `cancelled`; completed-with-note;
  appointments older than ~30 days; or `kind='unavailable'` blocks. Portal
  home/gym training lives in `sessions` (not `appointments`), so it's excluded by
  construction — the "in-clinic only" scope.

### DASH-V2-18 — Reconcile is ONE combined row per client
- **Setup:** A client with both an unactioned attendance (pending/confirmed) and
  a note-owed (completed, no note) past appointment.
- **Pass:** A SINGLE Reconcile row in the Clinical-admin group — attendance and
  note are **never** split into separate rows (operator decision 2026-06-28).
  Exactly one session total → inline "<when> — <type>" with a direct Open;
  multiple (any mix) → "N sessions to reconcile" whose Open opens the pop-up
  (DASH-V2-23).

### DASH-V2-19 — Two domains: a client can show in both groups
- **Setup:** A client with BOTH an adherence issue (e.g. an Ended program, or an
  Onboarding/no-logged-session state) AND an unreconciled past appointment.
- **Pass:** The Needs-attention panel renders **two labelled groups** —
  **Adherence** and **Clinical admin**. The client appears **once in each** (e.g.
  Ended under Adherence, Reconcile under Clinical admin); the two concerns dedupe
  separately and never mask each other. Domains: Flag + Reconcile = Clinical
  admin; Overdue/Ended/Ending/New/Onboarding = Adherence. An empty group renders
  nothing; both empty → "Nothing flagged".

### DASH-V2-20 — Dashboard caps at 10 rows; overflow opens an actionable modal
- **Setup:** More than 10 attention rows across both groups.
- **Pass:** The dashboard panel shows at most **10 rows** (Adherence first, then
  Clinical admin). A **View more (N) →** appears (and the header **View all →**),
  opening a **modal** that houses **every** row in both groups — not a link to
  Clientele. Each row in the modal keeps its action (Open/Review/Build/Plan + the
  Overdue/Onboarding ack), so it's actionable in place; an ack re-renders the
  dashboard and the modal updates without closing. Esc / backdrop / × closes it.

### DASH-V2-21 — Counts are by row, not client
- **Setup:** A client with two rows (e.g. Ended + Reconcile).
- **Pass:** The "Need attention" stat and the sub-line count **total rows** —
  that client contributes **2**, not 1. The 10-row cap and the View-more
  threshold are likewise row-based.

### DASH-V2-22 — Actioning a past session on the schedule reflects on the dashboard
- **Setup:** A Reconcile row → **Open** → the schedule jumps to that day.
- **Action:** Mark the appointment Complete / No-show, or Cancel it.
- **Pass:** Back on the dashboard the change is reflected — No-show / Cancel
  clears the Reconcile row; Complete turns "attendance not set" into "note owed".
  The lifecycle actions revalidate `/dashboard` (not just `/schedule`), so the
  dashboard no longer shows the stale pre-action state.

### DASH-V2-23 — Multiple sessions → one row + combined pop-up
- **Setup:** A client with ≥2 unactioned past appointments (any mix of
  attendance not set and note owed).
- **Pass:** One Reconcile row "N sessions to reconcile"; its **Open** opens a
  per-client **pop-up** (like the View-all modal) listing every session —
  attendance and note **combined**, oldest-first (date + time, so same-day ones
  are distinct) — each labelled with its type and with its own **Open →** that
  booking on the schedule. A single-session client renders inline with a direct
  Open and no pop-up.

### DASH-V2-24 — Opening a session focuses it on the schedule
- **Setup:** From a single Reconcile row's Open, or a session in the pop-up,
  navigate to `/schedule?d=<date>&focus=<appointment id>`.
- **Pass:** The schedule lands on that day **scrolled to the booking**, with it
  **highlighted** (accent ring) and every other booking **dimmed** — the
  client-finder spotlight. Navigating the week clears the focus; a `focus` id not
  in the loaded set dims nothing (no false blackout).

Context: WeekView's appointment drag handler (`handleMove`) is created once with
stable identity (deps `[gridRef]`) and reads dynamic values through refs. But
`pxPerQuarter` — the measured pixels-per-15-min, re-measured at runtime and on
window resize — was read directly, so `handleMove` captured the pre-measure
default (`PX_PER_QUARTER_DEFAULT`) for the component's lifetime. Vertical snapping
(`Math.round(dy / pxPerQuarter) * 15`) therefore used the wrong scale whenever the
measured value differed from the default. Fixed by mirroring `pxPerQuarter` into a
`pxPerQuarterRef` (kept fresh by an effect, matching the existing
dragRef/apptRef/callbacksRef pattern) and snapping against `pxPerQuarterRef.current`.
This is the `react-hooks/exhaustive-deps` warning that flagged the stale capture.

### SCH-DRAG-1 — Vertical drag snaps to the visible 15-min grid
- **Setup:** Open the staff schedule on a viewport where the measured
  pxPerQuarter differs from the pre-measure default (most real screens).
- **Action:** Drag an appointment block up/down by a few rows.
- **Pass:** The committed start/end time matches the 15-min line it was dropped
  on — snap granularity tracks the visible grid, not a fixed default scale.
  (Before the fix: the offset could be proportionally off after the grid
  re-measured.)

### SCH-DRAG-2 — Drag still works after a window resize
- **Setup:** Resize the browser so the schedule re-measures pxPerQuarter, then
  drag an appointment.
- **Pass:** Snapping reflects the new scale immediately; horizontal day-shift and
  the click-vs-drag threshold are unchanged.

---

## Schedule — reschedule via calendar move-mode (2026-06-28)

Context: the appointment popover's **Reschedule** button puts the calendar into a
move-mode — the popover closes, a persistent bar names the appointment being
moved, and the EP navigates/scrolls the grid freely and **taps a new slot** to
move it there (with a confirm). Picking a slot visually beats typing a time — you
see availability. Reuses `updateAppointmentTimeAction` (no schema), so the
double-booking guard + automatic reminder re-timing come for free; the tapped
slot's instant comes from the grid's own `slotToDate` (practice-tz). Drag-to-move
still works. Attendance (Complete/No-show) + the appointment-linked Add-note
already existed and are unchanged. A move-mode reschedule also **emails the
client** (new time, previous struck through), gated by the org email toggle; a
drag-move stays silent. The portal bookings view reads the same `appointments`
row (force-dynamic), so it reflects the new time on the client's next load.

### SCH-RESCHED-1 — Move a booking by tapping a new slot
- **Setup:** A confirmed 60-min appointment.
- **Action:** Open its popover → **Reschedule**. The popover closes and a
  "Rescheduling [name] — tap a new time" bar appears. Scroll / change day, then
  tap an empty slot → confirm "Move … to [time]?" → **Move**.
- **Pass:** The appointment moves to the tapped slot (duration preserved), the
  bar clears, the grid refreshes. The confirm showed the slot just tapped.

### SCH-RESCHED-2 — Move-mode survives calendar navigation
- **Action:** Enter move-mode, then change week (prev/next) and scroll the grid.
- **Pass:** The mode bar stays visible and tapping a slot in the new week still
  moves the appointment there — navigating does not drop the mode.

### SCH-RESCHED-3 — Overlap is rejected, no move
- **Setup:** In move-mode, tap a slot that overlaps another booking for the same
  practitioner.
- **Pass:** The confirm surfaces an error ("overlaps an existing booking…"); the
  appointment does **not** move; move-mode stays active so the EP can pick
  another slot. (The 23P01 EXCLUDE-constraint backstop.)

### SCH-RESCHED-4 — Button gating + exit
- **Pass:** **Reschedule** appears in the popover for **pending / confirmed**
  only (absent for completed / no-show / cancelled). **Cancel** on the mode bar
  or **Esc** leaves move-mode with no change.

### SCH-RESCHED-5 — Reschedule emails the client (move-mode only)
- **Setup:** A confirmed client appointment; the client has an email; the org's
  email notifications are ON.
- **Action:** Reschedule it via move-mode (tap a slot → Move).
- **Pass:** The client receives a "Rescheduled: …" email — new date/time, the
  previous time struck through ("Was …"), type, location, and a "View booking"
  link to the portal. Best-effort: a send failure logs but does not block the
  move. **No** email when the org toggle is OFF, the client has no email, or it's
  an Unavailable block. A **drag-move / resize** sends nothing (silent).

### SCH-RESCHED-6 — Portal reflects the new time
- **Setup:** Reschedule a client's upcoming appointment.
- **Pass:** On the client's `/portal/book`, the booking shows the **new** date/
  time — it reads the same `appointments` row (force-dynamic), so there's no
  separate copy to sync. Moved into the past, it drops off the upcoming list.

## Staff schedule — round-two (next-session, status visuals, archive) (2026-06-29)

These cover the schedule popover "Next session" anchor fix, the completed/
no-show/cancelled pill treatment, and the new Archive action. Setup: a staff
session on `/schedule` with a client who has a mix of past and future bookings.

### SCH-NEXT-1 — "Next session" on a PAST appointment shows the next UPCOMING one
- **Setup:** Open an appointment whose `start_at` is in the past (e.g. months
  ago), while the client has a genuinely-future pending/confirmed booking.
- **Pass:** "Next session" shows the **upcoming** booking (anchored on now), not
  "the next one after that past session." Before the fix it reported a stale
  appointment that was itself already past. (`getClientNextAppointmentAction`
  anchors on `max(now, appt.start_at)`.)

### SCH-NEXT-2 — "Next session" on a FUTURE appointment shows the one after it
- **Setup:** Open a future booking that has another booking later still.
- **Pass:** "Next session" shows the **later** booking — opening a future slot
  still reports the one that follows it, not now's next.

### SCH-NEXT-3 — No upcoming booking → "none booked"
- **Setup:** Open any appointment for a client with nothing scheduled after now.
- **Pass:** "Next session · none booked" (cancelled / no-show / completed /
  soft-deleted bookings never count).

### SCH-VIS-1 — Completed appointment: green tick, colour unchanged
- **Setup:** Mark an appointment Complete.
- **Pass:** A small **green tick** pip appears top-right (beside the time / any
  Odyssey mark). The pill keeps its normal colour (session-type colour, or the
  green fallback) — no full repaint, no opacity change.

### SCH-VIS-2 — No-show appointment: red minus, colour unchanged
- **Setup:** Mark an appointment No-show.
- **Pass:** A small **red minus** pip appears top-right. The pill keeps its
  normal colour — it no longer floods red. (Pre-change behaviour painted the
  whole block red; that drowned the signal when no-shows piled up.)

### SCH-VIS-3 — Cancelled is the ONLY pill that changes colour/opacity
- **Setup:** Cancel an appointment (with "Show cancelled" on so it stays
  visible).
- **Pass:** The pill goes **neutral grey** (surface fill, border-grey) with
  **faded** content — visibly "voided" and distinct from completed/no-show,
  which keep their colour. No other status changes colour or opacity.

### SCH-ARCH-1 — Archive removes a mis-booking without a cancellation
- **Setup:** Open a client appointment created by mistake → "Archive (created by
  mistake)" → confirm.
- **Pass:** The appointment **disappears** from the grid (soft-deleted,
  `deleted_at` set). It does **not** appear under "Show cancelled," and the
  Analytics cancellation rate is **unchanged** (archive ≠ cancel). Any queued
  reminder for it is cancelled, so the client is not emailed.

### SCH-ARCH-2 — Archive is available for every status, including cancelled
- **Setup:** Open an already-**cancelled** appointment (a mistaken cancel that
  polluted the rate) → Archive → confirm.
- **Pass:** It soft-deletes and drops out of the cancellation-rate denominator/
  numerator — the Archive row is present regardless of status.

### SCH-ARCH-3 — Archive is auth-scoped and kind-scoped (DB)
- **Pass (pgTAP / manual):** `archive_appointment` rejects anon (EXECUTE
  revoked + in-body 42501 guard), only soft-deletes rows in the caller's org,
  and refuses `kind='unavailable'` blocks (those use `soft_delete_unavailable_block`).

### SCH-DLG-1 — Popover confirm dialogs actually fire (regression)
- **Context:** The appointment popover closes on any outside `mousedown`.
  `ConfirmDialog` portals to `<body>`, so a click on its confirm button is
  "outside" the popover card — the popover used to close and unmount the dialog
  before the button's onClick ran, so **Cancel / Archive / Remove appeared dead
  (no error, nothing happened)** while in-card Complete / No-show worked. The
  fix exempts `[role="dialog"][aria-modal="true"]` from the outside-click close.
- **Pass:** Open an appointment → Cancel appointment → **confirm** → the
  appointment cancels and the popover closes. Same for **Archive**, and for an
  Unavailable block's **Remove**. Clicking the dialog's own Cancel (or its scrim)
  dismisses only the dialog and leaves the popover open to retry.

### SCH-PILL-1 — Short blocks degrade instead of clipping content
- **Context:** Block height tracks duration; inner content is fixed-size, so
  short slots used to clip the name / time / type line under overflow:hidden.
- **Pass:** A 60-min block shows name + time (+ full "Odyssey." mark if
  app-booked) + the session-type line. A ~30-min block tightens padding and
  **drops the type line** (no clipped half-line). A 15-min sliver keeps the name
  + time legible. Nothing renders as a cut-off partial row.

### SCH-PILL-3 — App-booked mark stays visible on short blocks (compact "O.")
- **Setup:** An online/client-portal-booked appointment at a short duration
  (e.g. 30 min) and at a long duration (e.g. 60 min).
- **Pass:** The long block shows the full **"Odyssey."** wordmark stacked above
  the time (top-right). The short block shows a compact **"O."** (accent-green
  dot kept) **inline next to the time** on the right, and the name, time, and
  status badge shrink so the **name fits on its own row without being squeezed**.
  A staff-booked appointment shows no mark at either size.

### SCH-PILL-2 — Height stays proportional to duration
- **Pass:** A 90-min appointment renders visibly ~3× the height of a 30-min one
  in the same view; durations remain readable as relative block heights.

### SCH-CANCEL-1 — "Hide cancelled" never hides unavailable blocks
- **Context:** Unavailable blocks (admin / meeting / note, `kind='unavailable'`)
  are the EP's own time-blocking, not client appointments. The "Hide cancelled"
  filter is scoped to `kind='appointment'`, so it only hides cancelled client
  appointments. (A legacy artifact left one note at `status='cancelled'`; the
  data migration `20260629130000` reset live unavailable blocks to `confirmed`.)
- **Pass:** Toggle **Hide cancelled** on a day that has a note/meeting block and
  a cancelled client appointment. The cancelled appointment disappears; the
  **note/meeting stays put**. The note renders in its neutral stone-grey type
  colour (`#78716c`), not the cancelled grey, in both toggle states.

### SCH-CANCEL-2 — Unavailable blocks are never in a cancelled state (DB)
- **Pass (manual / SQL):** No live `kind='unavailable'` row sits at
  `status='cancelled'` / `no_show` / `completed` (migration `20260629130000`).
  Removing an unavailable block soft-deletes it (`deleted_at`), it does not
  cancel — so it never feeds the Analytics cancellation rate.

---

## Profile rework — client medications + gender→sex rename (commit 1, schema, 2026-06-29)

Context: `client_medications` cloned from `client_medical_history` (migration
`20260629140000`) — org-scoped, staff-only RLS, audit-registered, `is_active` +
`deleted_at` status mechanism (active / ceased / archived). `clients.gender`
renamed to `clients.sex` (migration `20260629150000`), a rename only — free-text,
no value-model change. This commit lands schema only; the medications UI is
commit 2.

### MED-RLS-1 — A client cannot read its own medication rows (isolation)
- **Setup:** A `client_medications` row owned by a client's `clients` row, in
  the client's own org, with `clients.user_id` = the client's auth uid.
- **Pass:** Under the client session, `SELECT … FROM client_medications` for that
  `client_id` returns **0 rows** (staff-only SELECT policy); a staff session in
  the same org sees the row (count 1); the same client session still sees its own
  `clients` row (count 1, session live not blind). pgTAP `47` §A asserts all three.

### MED-RLS-2 — Cross-tenant: org B cannot see org A's medications
- **Pass:** A staff/owner of org B sees **0** of org A's `client_medications`
  rows (the `organization_id = user_organization_id()` clause). Same property the
  cross-tenant suite (test 17) proves for every tenant table; `client_medications`
  carries `organization_id` and the same SELECT shape, so it inherits it.

### MED-GRANTS-1 — Soft-delete / restore RPCs are anon-locked, authenticated-open
- **Pass:** `has_function_privilege('anon', …, 'EXECUTE')` is **false** for both
  `soft_delete_client_medications(uuid)` and `restore_client_medications(uuid)`;
  **true** for `authenticated`. pgTAP `47` §B asserts all four. (Guards the
  Supabase auto-grant trap: `REVOKE FROM PUBLIC` alone leaves anon a direct grant,
  so the migration also `REVOKE … FROM anon`.)

### MED-AUDIT-1 — Medication mutations are audit-logged with the right org
- **Pass:** Insert/update/delete on `client_medications` writes an `audit_log`
  row with the correct `organization_id` (direct-org resolver branch). The
  migration ends with `assert_audit_resolver_coverage()`, which fails the push if
  the `audit_client_medications` trigger lacks a resolver branch.

### MED-STATUS-1 — The three states are reachable (active / ceased / archived)
- **Pass:** A new row defaults `is_active = true` (**active**). Staff `UPDATE … SET
  is_active = false` (ordinary RLS UPDATE) → **ceased**. `soft_delete_client_medications`
  sets `deleted_at` → **archived** (drops out of the default `deleted_at IS NULL`
  SELECT); `restore_client_medications` clears it. A bare `UPDATE … SET deleted_at`
  by a staff session fails `42501` (the soft-delete-trap — why the RPC exists).

### SEX-RENAME-1 — The field is "Sex" end to end, "gender" is gone
- **Pass:** The Contact panel shows a **SEX** eyebrow label (uppercased by
  `FieldBox`) reading the client's value; the Edit dialog field is labelled
  **Sex** (`id="edit-sex"`) and saves through `updateClientDetailsAction({ …, sex })`
  to `clients.sex`. A repo-wide grep for `gender` (case-insensitive) finds no live
  code/type/query reference — only historical polish-doc mentions. The build is
  clean.

### SEX-RENAME-2 — The rename is value-preserving
- **Pass:** Existing values survive the column rename unchanged (ALTER TABLE …
  RENAME COLUMN is lossless); the field stays free-text (no enum, no new values).
  A client whose value was "Female" still reads "Female" after the rename.

---

## Profile rework — clinical rail cards + progressive disclosure (commit 2, presentation, 2026-06-29)

Context: the Profile tab (renamed from "Client details") brings Contact, Medical
history, Medications, and Goals into the design-system card (`.card` — surface /
border / 14px radius / shadow tokens). Left column = Contact; right rail =
Medical history → Medications → Goals. Row actions moved into a hover/focus
overflow menu (`profile-ui.tsx`). No schema change.

### PROF-TAB-1 — The tab reads "Profile"
- **Pass:** The record's first tab label reads **Profile** (not "Client
  details"). Its URL key is unchanged (`?tab` absent / `details`), so existing
  deep-links still land on it.

### PROF-CARD-1 — The four sections are design-system cards
- **Setup:** Open a client's Profile tab on an authenticated staff session.
- **Pass:** Contact, Medical history, Medications, and Goals each render as a
  white card — `background` = `--color-card` (#ffffff), `border` =
  `1px solid --color-border`, `border-radius` = 14px (`--radius-card`), and the
  `.card` box-shadow. Verified with `preview_inspect` on `.card`, not by eye. No
  hardcoded colour/radius/shadow in the components (tokens only).

### PROF-DISCLOSURE-1 — Row actions are hidden until hover, revealed on hover
- **Setup:** A Medical history (or Medications) card with ≥1 row.
- **Pass:** At rest the row shows the name (+ optional context note) and **no
  action links / no visible control**. On row hover a single overflow (⋯)
  control appears; clicking it opens a menu — Medical history: **Edit / Mark
  resolved / Archive**; Medications: **Edit / Mark ceased / Archive**.

### PROF-DISCLOSURE-2 — The overflow control and menu are keyboard accessible
- **Pass:** Tabbing reaches the ⋯ control (it becomes visible on focus via the
  row's focus-within, even with no mouse). `Enter`/`Space`/`ArrowDown` opens the
  menu and focuses the first item; `ArrowUp`/`ArrowDown`/`Home`/`End` move focus
  between items; `Enter` activates; `Escape` closes and returns focus to the ⋯
  control. The trigger carries `aria-haspopup="menu"` + `aria-expanded`; the menu
  is `role="menu"` with `role="menuitem"` children.

### PROF-RED-1 — Archive is the only red item, and only inside the menu
- **Pass:** In both menus, only **Archive** uses `--color-alert` (red); Edit and
  Mark resolved / Mark ceased use the normal text token. Nothing on the row is
  red at rest, and no routine action is ever red. Selecting Archive closes the
  menu first, then opens the on-system confirm (no native dialog).

### PROF-GOALS-1 — Goals render as a real list, one per line
- **Setup:** Edit goals via the pencil affordance; enter three goals on three
  lines; save.
- **Pass:** The Goals card renders a real `<ul>` with one `<li>` per non-empty
  line — never run-on inline text. The pencil **Edit goals** affordance still
  opens the details dialog. Empty goals → muted "None recorded."

### PROF-MEDS-1 — The Medications card reads and writes
- **Setup:** Profile tab, Medications card (add affordance = the same "+" the
  other sections use).
- **Pass:** "+" opens Add medication (name required, optional one-line context
  note). Saving inserts a `client_medications` row and it appears under the
  active list. Edit updates it; **Mark ceased** moves it to a subdued "Ceased"
  group (`is_active=false`); **Archive** (confirm) routes through
  `soft_delete_client_medications` and removes it from the card. All writes are
  staff-only (RLS + `requireRole`).

### PROF-MEDS-2 — The context note is neutral-only, one line
- **Pass:** The medication (and medical-history) context note renders in the
  smaller muted body style beneath the name. Copy steers it to neutral context
  ("why this isn't currently a concern"), explicitly **not** contraindications or
  precautions — those are flagged in the clinical-notes layer, never stored here.

---

## Profile rework — medical-history Tag / No-tag header control (commit 3, schema, 2026-06-29)

Context: the medical-history **severity** field is retired and replaced by a
per-condition **Tag / No-tag** choice that decides whether a condition appears
as a chip on the client's sticky header. Persisted in
`client_medical_history.show_on_header` (migration `20260629160000`, default
true). The `severity` column is left dormant in the DB (removed from all UI /
types / queries). No new RLS or audit surface.

### TAG-1 — The dialog offers Tag / No-tag (default Tag), not severity
- **Pass:** Add/Edit condition shows a **Header tag** dropdown with **Tag**
  (default on add) / **No tag** — and **no Severity** field. Editing an existing
  condition pre-selects its stored value.

### TAG-2 — Tag controls header inclusion
- **Setup:** Two active conditions, one **Tag**, one **No tag**.
- **Pass:** The sticky header chips show only the **Tagged** active condition;
  the No-tag one never appears there (but both still render in the Medical
  history card). Switching the second to **Tag** makes it appear; switching the
  first to **No tag** removes its chip.

### TAG-3 — Header cap still applies to tagged conditions
- **Setup:** Three+ active **Tagged** conditions.
- **Pass:** The header shows the first two as chips plus a **"+N more"**
  affordance (clicking lands on the Profile tab). Un-tagged conditions are not
  counted in N.

### TAG-4 — Severity is gone from the UI, header chips carry no severity text
- **Pass:** No "Severity N" appears on a medical-history row, in the dialog, or
  appended to a header chip (chips read just the condition name). Existing rows
  keep their dormant `severity` value in the DB but it is never read; new rows
  default `show_on_header=true` (Tagged).

### TAG-5 — Migration is additive and safe
- **Pass:** `show_on_header` is `NOT NULL DEFAULT true`; pushing it does not
  break the deployed frontend (which doesn't select it), and every existing
  condition defaults to Tagged, so the header looks unchanged until an EP
  un-tags one. pgTAP 19 still passes unchanged (it inserts `severity`, which
  remains a valid column).

## Schedule round-three reopen (2026-06-30)

### SCHED-RO-1 — Booking modal has no default client
- **Pass:** Opening "Book an appointment" shows "Choose a client…" selected (not
  a real client). Submitting without picking one is blocked. Picking a client
  then booking works.

### SCHED-RO-2 — Start time is 15-minute slots
- **Pass:** Start time is a dropdown of 15-minute slots (12-hour labels). Opening
  from a grid slot pre-selects that slot; opening from the button pre-selects the
  nearest quarter. No free-minute typing.

### SCHED-RO-3/4 — Location removed, Type full-width
- **Pass:** No Location field in the modal. Type spans the full row. A booked
  appointment that already had a location still shows it in its popover.

### SCHED-RO-5 — Duration is freely typeable
- **Pass:** The Duration field can be cleared and any positive number typed (not
  locked to 15-minute steps). Choosing a Type still pre-fills its default
  duration. Submitting with an empty/zero duration is blocked with a message.

### SCHED-RO-6 — Orphaned-client appointment is deletable
- **Setup:** An appointment whose client was since soft-deleted (the popover
  shows "Client no longer on file").
- **Pass:** Its "Remove appointment" archives the row (it disappears). A genuine
  Unavailable block still shows "Unavailable · not client-visible" and removes
  via its own path.
- **Unit (vitest):** `appointment-removal.test.ts` — `removalActionForAppointment`
  routes a null-client appointment to `archive` (not the unavailable path); an
  unavailable block to `remove-unavailable`. (`npm run test`.)
- **DB/RLS:** pgTAP `49` — orphan archives via `archive_appointment`;
  `soft_delete_unavailable_block` raises `no_data_found` on it (4/4).
  Assertion 1 updated 2026-07-03 to the CN-7 posture (archived client stays
  visible to staff, migration `20260702190000`) — the pre-CN-7 "invisible"
  assertion had gone stale; caught by the first full-suite staging run.

### SCHED-RO-7 — Archive this occurrence and all future ones
- **Setup:** A recurring series booked after the recurrence_group_id migration.
- **Pass:** Archiving an occurrence offers "This session only" vs "This and all
  later sessions". "This session only" removes one; "This and all later" removes
  that occurrence and every later one in the series, leaving earlier ones intact.
  Reminders for the archived rows are cancelled. A single (non-series) booking
  shows no choice and archives alone. A pre-migration repeat archives single-row.
- **DB/RLS:** pgTAP `26` — anon cannot execute `archive_appointment_and_future`,
  authenticated keeps EXECUTE (plan 16). pgTAP `48` — behavioural: archives the
  anchor + later occurrences, keeps earlier + other series, returns the count,
  cancels the archived rows' reminders, org-scoped (10/10).

### SCHED-RO-8 — Month header tracks the date strip live
- **Pass:** Scrolling the date rolodex updates the month header as the centred
  date crosses a month boundary, not only when scrolling stops.

---

## Appointment reminders — pg_cron path + Vault token (2026-07-01)

Context: the `appointment-reminders-5min` pg_cron job (job_id 1) was found on
2026-07-01 to have never invoked the Edge Function — its `net.http_post` URL
held the placeholder host `YOUR-PROJECT.supabase.co`, so pg_net failed every
tick with `Couldn't resolve host name` while `job_run_details.status` read
`succeeded`. The job is now defined in a tracked migration
(`20260701120000_appointment_reminders_cron_to_vault.sql`) with a reviewed URL
literal, and its bearer token moved to Supabase Vault. REM-CRON-1/4/5 are
properties of the committed migration; REM-CRON-2/3 are the operator-apply gate.

### REM-CRON-1 — Cron command carries a reviewed URL and no token literal
- **Action:** `SELECT (regexp_match(command,'https?://[^'']+'))[1] AS url, command FROM cron.job WHERE jobname='appointment-reminders-5min';`
- **Pass:** `url` is exactly
  `https://azjllcsffixswiigjqhj.supabase.co/functions/v1/send-appointment-reminders`
  (no `YOUR-PROJECT`, no `<function-url>`). The command contains the substring
  `vault.decrypted_secrets` and **no** inline bearer token (the text after
  `'Bearer '` is a `SELECT … FROM vault.decrypted_secrets` subquery, not a value).

### REM-CRON-2 — A reminder actually delivers *through the cron*, not just direct curl
- **Setup:** Vault secret `cron_shared_secret` seeded with the same value as the
  Edge `CRON_SHARED_SECRET`. Plant + re-time a due synthetic reminder per the
  Cron-path send check (`deploy-an-edge-function.md`).
- **Action:** Do **nothing** — wait for the next ≤5-min tick. No manual curl.
- **Pass:** The reminder row flips to `status='sent'` with a non-null
  `provider_message_id`. `net._http_response` shows no
  `error_msg='Couldn't resolve host name'`. (Direct-curl success is **not**
  sufficient — that is the blind spot this scenario exists to cover.)

### REM-CRON-3 — Rotating the Vault secret rotates cron auth with no command change
- **Setup:** Capture `command` from `cron.job` before rotation.
- **Action:** Rotate per `rotate-a-secret.md` → CRON_SHARED_SECRET: set the new
  value in both the Edge secret and Vault (`vault.update_secret`).
- **Pass:** A post-rotation Cron-path send check reaches `status='sent'`, and
  `cron.job.command` is byte-identical to the pre-rotation capture (rotation
  touched only Vault and the Edge secret — never `cron.alter_job`).

### REM-CRON-4 — Migration is idempotent (alter-in-place vs schedule)
- **Pass:** Re-applying the migration when the job exists ALTERs it in place —
  `jobname` unchanged, schedule still `*/5 * * * *`, exactly **one** row in
  `cron.job` with that name (no duplicate). On a fresh database with no such
  job, it is SCHEDULEd. The job is matched by `jobname`, not a hard-coded jobid.

### REM-CRON-5 — Apply is safe before the Vault secret is seeded; pre-flight gates go-live
- **Pass:** Applying the migration with no `cron_shared_secret` in Vault does
  **not** error at apply time (the subquery is stored as text, evaluated only at
  tick time). The go-live pre-flight
  `SELECT length(decrypted_secret) FROM vault.decrypted_secrets WHERE name='cron_shared_secret';`
  returns the token length (not null, no permission error) once seeded — proving
  the `postgres` role the tick runs as can read it, before the live job is cut over.

---

## Performance — function/database region co-location (Pass 2, promoted 2026-07-01)

Context: Vercel functions defaulted to `iad1` (US East) while the Supabase DB and
the AU users are in Sydney (`ap-southeast-2`), so every authenticated navigation
paid 5–6 sequential cross-Pacific query round-trips (~200 ms each) — the dominant
interaction-lag cause in `docs/perf/baseline-2026-06-26.md`. Fixed by pinning the
function region to `syd1` via `vercel.json` (commit `339eacd`), promoted to
production 2026-07-01. This criterion guards the regression (a deploy reverting to
a non-Sydney region, or a query path that re-introduces a cross-region hop).

### PERF-REGION-1 — A DB-touching route pays no cross-region query tax on syd1
- **Setup:** A `syd1` deployment (`vercel.json` → `"regions": ["syd1"]`). Probe a
  no-DB route (`/login`) and a DB-touching route (`/i/<uuid>`) back-to-back,
  several times, from any single location (the requester→compute hop is common to
  both routes and cancels in the delta — valid even when run from outside Australia).
- **Measure:** `delta = TTFB(DB-touching) − TTFB(no-DB)`.
- **Pass:** `x-vercel-id` shows the compute region as **`syd1`** (`…::syd1::…`),
  **and** the delta is **near-zero — within network noise (≈ ±50–90 ms, often
  negative)** — not the ~0.65–0.85 s cross-Pacific tax an `iad1` build shows.
  Evidence (`docs/perf/baseline-2026-06-26.md` §11): before (`iad1`) ~0.75 s;
  after (`syd1`) ~0.00 s, preview-proven and production-verified 2026-07-01.
- **Scope note (residual, NOT covered here):** an *authenticated* DB route may
  still show an Edge-middleware residual (auth re-verified against Sydney every
  request; middleware isn't region-pinned). That's a separate, unmeasured pass —
  see `docs/polish/perf-middleware-residual.md`. This criterion covers the
  per-query DB tax only.

---

## Client portal — bilateral milestone fits phone width (bug fix, 2026-07-02)

Context: the portal Reports → **Data** tab overflowed on phone widths. A bilateral
(Left/Right) milestone rendered two side-by-side boxes (`1fr 1fr`), each holding a
`1fr auto 1fr` baseline→latest grid. Inside the ~315px portal column that crushed
each endpoint to ~34px — wrapping the date to 3–4 lines and overflowing the box on
≤375px screens. Fixed by switching the bilateral grid to
`repeat(auto-fit, minmax(220px, 1fr))` so the two sides **stack** when the
container can't give each ≥220px (`MilestoneChart.tsx`, commit `39267c1`).
CSS-only; no schema, no shared date-helper change; the wider staff publish-preview
dialog keeps its side-by-side view.

### CP-MS-1 — Bilateral force card stacks and fits on a 375px portal
- **Setup:** Client portal → Reports → Data tab, on a 375px-wide viewport, with a
  published bilateral test that has 3-digit values (e.g. a knee isometric peak-force
  card, `190 N` / `680 N`).
- **Pass:** Left and Right render **stacked** (Left above Right), each full card
  width. Each endpoint's value + date sit on 1–2 lines — no 3–4-line date wrap —
  and nothing clips or scrolls horizontally past the screen edge.

### CP-MS-2 — Wider container keeps side-by-side (no staff-preview regression)
- **Setup:** Staff → a client → Reports → publish a milestone test; view the
  publish-dialog client preview on desktop.
- **Pass:** The bilateral sides render **side-by-side** (the dialog is wider than
  the 220px-per-side threshold). Unilateral metrics are unaffected in both surfaces
  (they never used this grid).

---

## Client profile — medical-history concurrent edits don't clobber (CN-6 closure, 2026-07-02)

Context: `client_medical_history` had no OCC `version` column and its UPDATE policy
admits every owner/staff member of the org, so two staff editing the same condition
silently clobbered each other — a live exposure in the two-staff beta (go-live
checklist §8, CN-6 deferred item). Migration `20260702120000` added the §12 pattern
(`version` + `bump_version_and_touch()`), and `updateMedicalConditionAction` now
keys its UPDATE on the last-read version. Machine-gated by pgTAP
`51_cmh_occ_version.sql` (4/4 on live); this scenario is the browser-level pass.

### CP-OCC-1 — Stale medical-history edit is refused, not silently lost
- **Setup:** Staff → a client → Details tab. Open the same condition's Edit dialog
  in two browser tabs (same or different staff accounts). In tab A, change the
  condition text and Save (succeeds). In tab B — still holding the pre-edit form —
  change something else and Save.
- **Pass:** Tab B's save is **refused** with "Someone else edited this condition
  while you were typing. Reload the page and try again." — it does not overwrite
  tab A's edit. After a reload, tab B sees tab A's text and can edit normally.
  Mark resolved / Reactivate and Archive remain versionless by design (single-field
  verbs) and still work regardless of a concurrent text edit.

---

## Client profile — medication concurrent edits don't clobber (§12 parity, 2026-07-02)

Context: `client_medications` is a direct clone of `client_medical_history` and
carried the identical last-write-wins property — no OCC `version` column, and an
UPDATE policy that admits every owner/staff member of the org — so two staff editing
the same medication silently clobbered each other, a live exposure in the two-staff
beta. Rather than re-affirm the earlier "short structured rows" acceptance, the CN-6
§12 pattern was applied for parity (go-live checklist §8): migration `20260702180000`
added `version` + `bump_version_and_touch()` (replacing the plain touch trigger), and
`updateMedicationAction` now keys its UPDATE on the last-read version. Machine-gated by
pgTAP `55_cmed_occ_version.sql` (4/4 on live); this scenario is the browser-level pass.

### MED-OCC-1 — Stale medication edit is refused, not silently lost
- **Setup:** Staff → a client → Profile tab, Medications card. Open the same
  medication's Edit dialog in two browser tabs (same or different staff accounts). In
  tab A, change the medication name (or context note) and Save (succeeds). In tab B —
  still holding the pre-edit form — change something else and Save.
- **Pass:** Tab B's save is **refused** with "Someone else edited this medication
  while you were typing. Reload the page and try again." — it does not overwrite tab
  A's edit. After a reload, tab B sees tab A's value and can edit normally. Mark ceased
  / Reactivate and Archive remain versionless by design (single-field verbs) and still
  work regardless of a concurrent name edit.

---

## Messaging — client→EP email is queued, observable, and debounced (P1-1c closure, 2026-07-02)

Context: the new-message email to the EP was a best-effort post-response send with
unobservable failures. It now runs on the §9 reminder posture: the client's message
INSERT fires the `message_notification_enqueue` trigger (migration `20260702140000`)
→ `message_notifications` queue row → the `send-message-notifications` Edge Function
drains it on the 5-minute cron (`20260702150000`) with retry and a recorded
sent/failed outcome. DB behaviour machine-gated by pgTAP `53` (8/8 on live); the
send path verified by the standing synthetic check (`succeeded:1`, runbook
`deploy-an-edge-function.md`).

### MSG-NQ-1 — First unread client message emails the EP within ~5 minutes, once
- **Setup:** A client (portal) sends a message to a thread the EP has fully read.
  The client then sends two more messages before the EP opens the app.
- **Pass:** The EP receives **exactly one** "New message from {first name}" email
  within ~5 minutes of the first message (no body content in the email, first name
  only). No further email arrives for the second and third messages. After the EP
  reads the thread and the client messages again, one new email arrives for the new
  cycle. In staff-side data (or SQL), the queue row for the cycle reads
  `status='sent'` with a `provider_message_id`; a Resend outage instead leaves
  `retry_count` climbing and, past 5 retries, `status='failed'` with a
  `failure_reason` — never a silent drop.

---

## Messaging — "New message" opens the thread directly (UX papercut, 2026-07-21)

Context: the inbox "New message" button linked to `/clients`, so picking a
client landed on their profile, not a conversation — the opposite of the
profile speech-bubble, which opens the thread. "New message" now opens an
in-place searchable client picker (`NewMessageButton`); selecting a client runs
the same `getOrCreateThreadAction` and navigates straight to
`/messages?thread=…`. Archived clients are excluded from the picker
(`deleted_at IS NULL`) — the action refuses them anyway.

### MSG-NEW-1 — New message picks a client and lands in their thread
- **Setup:** Messages → New message. Search for a client and click them.
- **Pass:** A modal picker opens (search + live client list, category-tone
  avatars). Selecting a client goes straight to `/messages?thread=…` with that
  client's thread active in the pane — no detour through the profile. A client
  with no prior conversation gets a freshly-created empty thread; a client with
  an existing thread reopens it (no duplicate). Escape / clicking the backdrop /
  the ✕ closes the picker without navigating.

### MSG-NEW-2 — Archived clients aren't offered
- **Setup:** Archive a client, then open the New message picker.
- **Pass:** The archived client does not appear in the list (even via search).
  Live clients are all present, ordered by first name.

---

## Archived-client record access (CN-7, 2026-07-02)

Context: brief §7.2 — archived records stay queryable. Migration `20260702190000`
added the additive staff-only archived-read policy and made `soft_delete_client`
cancel the client's future appointments; the client list gained an Archived chip,
the profile renders archived records read-only with a Restore affordance, and
every client-scoped mutating server action is guarded (`archive-guard.ts`).
DB behaviour machine-gated by pgTAP `55` (8/8 on live); these are the browser pass.

### CP-ARC-1 — Archiving a client hides them from working views but never loses the record
- **Setup:** Staff → a client with notes, conditions and a FUTURE confirmed
  appointment → Archive (header overflow → confirm).
- **Pass:** Redirects to Clientele; the client is absent from All/Active/New and
  from the dashboard, schedule pickers and library picker — but appears under the
  **Archived** chip with their archive date. Their future appointment reads
  **cancelled** on the schedule (history rows untouched), and no reminder email
  ever sends for it (`appointment_reminders` row `cancelled`).

### CP-ARC-2 — The archived profile is fully readable and truly read-only
- **Setup:** Clientele → Archived chip → open the archived client.
- **Pass:** The profile renders (no 404): banner "Archived {date} — this record is
  read-only" with a **Restore client** button; status tag reads Archived. Every tab
  opens and shows its history (Details, Notes incl. Export PDF, Bookings, Program
  completions, Reports history, Files downloads) but NO mutating affordance exists
  anywhere — no edit/add buttons, no note composer, no row menus, no upload, no
  delete, no Record test, no builder links, no header message/flag/archive icons.
  Any direct server-action call (stale tab) is refused with "This client is
  archived — their record is read-only."

### CP-ARC-3 — Restore brings the client back; cancelled bookings stay cancelled
- **Setup:** On the archived profile, Restore client → confirm.
- **Pass:** The profile returns to its editable state (banner gone, actions back);
  the client reappears in the live list. Appointments cancelled at archive time
  remain cancelled (the confirm dialog says so — re-book manually). If another
  live client has since been invited with the same email, Restore is refused with
  the humane conflict message instead of a raw database error.

---

## Staff session builder — column autofill for set values (UX papercut, 2026-07-03)

Context: prescribing or changing a value set-by-set dragged. Now a value
committed (blur/Enter) into a Volume or Load cell **follows downward** —
into every cell **below** the edited set that is empty **or still holds the
edited cell's previous value**, via `autofillProgramExerciseSetColumnAction`
(bulk UPDATEs gated `set_number >` / `IS NULL` / `= previous` **server-side**,
immune to the stale-props window left by single-cell autosaves). Sets above
the edited one never move — that's what makes ascending/descending sequences
enterable top-down (owner refinement 2026-07-03: a whole-column follow made
8/6/4 unreachable, since editing set 2 dragged set 1's matching 8 along). A
below-cell customised to a *different* value never moves — wave loading
survives. This covers the defaults-seeded case: an exercise added from the
library arrives with every set holding the exercise's default reps (per-set
fan-out in `insert_program_exercise_at`), so editing **set 1** of a uniform
8/8/8 column changes the whole column. Sibling cells adopt the followed value
from the revalidated day payload only when untouched (unfocused, idle,
undirtied, no own save pending against a stale prop). Design line: sensible
defaults — reduce repetitive data entry. No migration, no new table surface
(same RLS-scoped `program_exercise_sets` UPDATE path as the per-cell save).

### SB-AF-1 — First value fills the column downward
- **Setup:** An exercise whose Volume/Load cells are all empty (e.g. one whose
  library defaults carry no reps), 3+ sets. Type `8` into set 1's Volume cell
  and press Enter (or click away).
- **Pass:** Sets 2 and 3's Volume cells fill with `8` (after the save
  round-trip, each showing the value without being touched). The Load column
  stays empty — autofill is per-column.

### SB-AF-2 — Editing set 1 of a uniform (defaults-seeded) column changes the column
- **Setup:** Add an exercise from the library so all sets arrive seeded with the
  same default reps (e.g. 8/8/8). Change set 1's Volume cell to `10` and commit.
- **Pass:** Sets 2 and 3 follow to `10` — final column 10/10/10. (The
  2026-07-03 report: "changing the reps should change the other sets".)

### SB-AF-3 — A descending sequence entered top-down (sets above never move)
- **Setup:** Seeded 8/8/8. Change set 2 to `6` and commit; then change set 3 to
  `4` and commit.
- **Pass:** After the first commit the column reads 8/6/6 — set 3 followed,
  set 1 did NOT (it sits above the edited set, even though it matches the
  previous `8`). After the second commit: 8/6/4. (Owner refinement 2026-07-03 —
  under the whole-column rule this sequence was unreachable.)

### SB-AF-4 — A customised below-value never moves (wave loading survives)
- **Setup:** Load column set to 60/65/70 (each typed individually). Change set 1
  to `62` and commit. Then clear set 3, and change set 1 to `64`.
- **Pass:** First commit: sets 2 and 3 hold 65/70 — only set 1 changes (their
  values differ from set 1's previous `60`, so they don't follow). Second
  commit: set 2 still holds 65; set 3 (now empty) fills with `64`.

### SB-AF-5 — An own edit sticks — never reverts (regression, 2026-07-03)
- **Setup:** Any cell holding a saved value (seeded or typed). Change it and
  commit; also try several rapid edit→Enter cycles on the same cell.
- **Pass:** The cell keeps the new value after the save tick — it never snaps
  back to the previous value. (The first-cut adoption logic misread the
  deliberately-stale prop after an own save as fresh server data and reverted
  the edit.)

### SB-AF-6 — A cell mid-edit never moves under the EP
- **Setup:** All cells empty. Type `8` into set 1's Volume cell, press Enter, and
  immediately click into set 2's Volume cell and type `12` before the autofill
  lands.
- **Pass:** Set 2 shows `12` (the in-flight edit wins locally; blur saves `12`
  over the autofilled value). Set 3 fills with `8`. Final column: 8 / 12 / 8.

### SB-AF-7 — Clearing a cell does not cascade
- **Setup:** A fully-filled column. Clear set 2's Volume cell and commit.
- **Pass:** Only set 2 empties; sets 1 and 3 keep their values. (Autofill fires
  on non-empty commits only.)

### SB-AF-8 — Portal sees the followed prescription
- **Setup:** After SB-AF-3, open the session on the client portal.
- **Pass:** The three sets show 8 / 6 / 4 — the follows landed in
  `program_exercise_sets` rows, not just the staff UI.

### Live preview (UX papercut, 2026-07-21)

Context: the follow-the-value only appeared after a blur/Enter round-trip, so
it needed Enter and felt laggy ("too slow"). The eligible cells below now
**mirror the value instantly as you type** — a display-only preview computed
client-side from the edited cell's live value, using the *same* eligibility
rule as the server (empty **OR** == the edited cell's previous value), read off
each below-cell's own stable server value. The durable save is unchanged: it
still flows through `autofillProgramExerciseSetColumnAction` on blur/Enter, so
SB-AF-1..8 all still hold — the preview just removes the wait and the Enter.
Because the preview is display-only and self-heals on the revalidate, a failed
save can never leave a below-cell showing a value the DB doesn't hold.

### SB-AF-9 — Preview follows the keystrokes, no Enter
- **Setup:** Seeded 8/8/8 (or all empty). Focus set 1's Volume cell and type `5`
  — do **not** press Enter or click away.
- **Pass:** Sets 2 and 3 immediately show `5` (previewed) the instant the key
  lands. Type another digit (`54`) and they track to `54` live. Blur/Enter then
  persists — reopen the day (or the portal) and 54/54/54 is saved. The Load
  column is untouched (per-column).

### SB-AF-10 — Preview obeys the follow rule (customised below not previewed)
- **Setup:** Load column 60/65/70 (typed individually). Focus set 1 and type
  `62` without committing.
- **Pass:** Sets 2 and 3 do **not** preview `62` (their values differ from set
  1's previous `60`). Now clear set 3, focus set 1, type `64` — set 3 (empty)
  previews `64`, set 2 (65) stays. Matches the committed SB-AF-4 result.

### SB-AF-11 — Clicking a previewed cell keeps what you see
- **Setup:** All empty. Type `8` into set 1 (sets 2/3 preview `8`). Without
  pressing Enter, click into set 2's Volume cell.
- **Pass:** Set 2 shows `8` (the previewed value is adopted on focus, not the
  blank server value) and is editable from there — editing to `6` and blurring
  saves `6`; the final column is 8/6/8, never 8/(blank)/8.

### SB-AF-12 — Typed-then-cleared withdraws the preview
- **Setup:** Seeded 8/8/8. Focus set 1, type `5` (sets 2/3 preview `5`), then
  delete back to `8` (the original) and blur.
- **Pass:** The preview disappears and nothing changes — 8/8/8 stands (no
  save fired, no stray preview left behind).

---

## Staff session builder — create-exercise returns to the builder (UX papercut, 2026-07-03)

Context: the builder's Library-tab "Create New Exercise" CTA sent the EP to
`/library/new`, and the save redirected to `/library` — dumping them out of
the session they were building. The CTA now carries
`?returnTo=/clients/{id}/program/days/{dayId}`; the page, the form's Cancel,
and `createExerciseAction`'s post-save redirect all honour it. `returnTo` is
validated as an internal single-leading-slash path on **both** ends
(`safeInternalPath` — page render and server action), so a tampered value
(`https://…`, `//host`, `/\host`) falls back to `/library` rather than
open-redirecting. The library's own create flow (no `returnTo`) is unchanged.

### SB-CX-1 — Save returns to the builder with the exercise pickable
- **Setup:** In a session builder day, right panel → Library tab → "Create New
  Exercise". Fill in a name and save.
- **Pass:** Lands back on the same builder day (not `/library`); searching the
  Library tab finds the new exercise, and picking it adds it to the day.

### SB-CX-2 — Cancel and the back arrow also return to the builder
- **Setup:** Same entry path; on `/library/new` click Cancel (then repeat via the
  header back arrow).
- **Pass:** Both land back on the builder day. Nothing was created.

### SB-CX-3 — The library's own create flow is unchanged
- **Setup:** Library → "New exercise" (no returnTo) → save; separately, Cancel.
- **Pass:** Both return to `/library`, exactly as before.

### SB-CX-4 — A tampered returnTo never leaves the app
- **Setup:** Manually open `/library/new?returnTo=https://example.com` (and
  `//example.com`); save a valid exercise.
- **Pass:** The back arrow/Cancel point at `/library` and the save redirects to
  `/library` — an external or protocol-relative target is never followed.

### SB-CX-5 — A validation error keeps the return path
- **Setup:** From the builder CTA, submit the form with an invalid YouTube URL,
  fix the error, save.
- **Pass:** The inline error round-trip preserves what was typed (existing echo
  behaviour) AND the eventual save still returns to the builder — the hidden
  `returnTo` survives the error re-render.

---

## Library editors — set-grid autofill + create-exercise return parity (2026-07-03)

Context: the three in-Library editors (session template `/library/sessions/[id]`,
program template day `/library/programs/[id]`, circuit `/library/circuits/[id]`)
share the cloned editor-kit set grid; they now get the SAME downward
follow-the-value column autofill as the session builder (see that section for
the full rule), wired per-storage — `autofillSessionSetColumnAction` /
`autofillTemplateSetColumnAction` / `autofillCircuitSetColumnAction` over
`session_template_exercise_sets` / `template_exercise_sets` /
`circuit_exercise_sets`, each with the server-side `set_number >` / `IS NULL` /
`= previous` guards and each revalidating its own editor path. The kit's
`SetCell` carries the builder's `lastSeenProp` adoption (own edits never
revert; untouched siblings adopt the fill). Autofill runs through the
editors' `run()` so the save-status pill covers it. The `DayEditorActions`
contract makes `autofillSetColumn` required — a future consumer cannot
silently ship without it. Separately, the editors' library-panel "Create New
Exercise" CTAs now carry `?returnTo=` (DayLibraryPanel via `usePathname`,
CircuitLibraryPanel via its `circuitId`), landing the EP back in the editor
after save/Cancel instead of `/library`. No migration, no new table surface.

### LIB-AF-1 — Autofill parity in the session-template editor
- **Setup:** `/library/sessions/[id]`, an exercise with a seeded/uniform Volume
  column (e.g. 8/8/8) and 3+ sets.
- **Pass:** The SB-AF matrix holds: set 1 → `10` sweeps below (10/10/10);
  set 2 → `6` gives 10/6/6 (set 1 never moves); a below-cell customised to a
  different value holds; the edited cell never reverts; the save pill ticks
  through the fill.

### LIB-AF-2 — Autofill parity in the program-template day editor
- **Setup:** `/library/programs/[id]`, expand a day; same column shapes.
- **Pass:** Same matrix as LIB-AF-1, on `template_exercise_sets`.

### LIB-AF-3 — Autofill parity in the circuit editor
- **Setup:** `/library/circuits/[id]`; same column shapes.
- **Pass:** Same matrix as LIB-AF-1, on `circuit_exercise_sets`.

### LIB-AF-4 — Live preview parity (2026-07-21)
- **Setup:** In each of the three editors, focus a set's Volume cell and type a
  value **without** pressing Enter (as in SB-AF-9).
- **Pass:** The eligible cells below preview the value instantly as you type
  (same rule: empty OR == the edited cell's previous), clicking a previewed
  cell keeps what's shown (SB-AF-11), typing-then-deleting-back withdraws it
  (SB-AF-12), and blur/Enter still persists through the per-storage autofill
  action. The kit `SetCell` mirrors the builder's live-preview behaviour.

### LIB-CX-1 — Create-exercise from an editor returns to that editor
- **Setup:** From each of the three editors' Library panel → "Create New
  Exercise" → save; separately Cancel and the back arrow.
- **Pass:** All land back on the originating editor page, and the new exercise
  is findable in that panel's list. (Program editor: the template page is
  restored; the expanded-day state is client-side, so the day re-collapses —
  accepted.) The standalone library create flow (no returnTo) still returns
  to `/library`.

---

## Clientele — category-coloured initials avatars (2026-07-03)

Context: client initials bubbles previously took a random tone seeded from
the client UUID — a pool that included the practitioner green and the
clinical-flag red, and the colour meant nothing. Operator rule: a client's
bubble colour now encodes their **clientele category** (`client_categories`
— seeded defaults Athlete / Rehab / Lifestyle / Golf / Osteoporosis /
Neurological), via `categoryToneFor()` in `clients/_lib/client-helpers.ts`:
one hue per category in the org's `sort_order` — blue / plum / teal /
violet / amber / bronze (globals.css `.avatar.b/.p/.t/.v/.a/.br`), wrapping
past six categories. Green stays reserved for the practitioner's own avatar
(TopBar / portal thread) and red for clinical flags — neither is in the
category palette. Uncategorised clients and unknown category ids render
neutral grey. The tone is resolved server-side and passed down on every
surface: Clientele list, client profile header, program calendar header,
dashboard Recently-completed AND needs-attention rows (operator follow-up
2026-07-03: attention avatars are identity-coloured like everywhere else —
the urgency signal lives on the row's tag chip, which keeps its semantic
tones, and on the stat cards), messages inbox (list + thread head + side
panel), and the schedule appointment popover. Contact (referral network)
avatars stay neutral grey — practitioners are not colour-coded. The old
`toneFor(id)` seeded helper is deleted. Same follow-up swapped the stat-card
tones: "Need attention" count is RED when > 0 (act now) and "Programs
ending" is AMBER when > 0 (plan ahead) — previously the reverse. Pure
presentation + query projection: no migration, no new security surface.

### CL-AV-1 — Client bubbles match their category everywhere
- **Setup:** Six clients, one per seeded category, plus one with no
  category. Visit `/clients`, a client profile, that client's program
  calendar, `/dashboard` (with a recent completion AND a needs-attention
  row), `/messages` (a thread per client), and a schedule appointment
  popover.
- **Pass:** On every surface — including the needs-attention rows — the
  same client shows the same colour; the six categories are six visibly
  different colours; the no-category client is neutral grey; no client
  bubble is the practitioner green or the clinical-flag red. A flagged
  client's attention row still signals via its red "Flag" tag chip, not
  the avatar. The TopBar practitioner avatar stays green.

### CL-AV-2 — Category changes and edge cases follow the rule
- **Setup:** Change a client's category on the profile (CN-5 edit) and
  reload; separately add a 7th category in Settings and assign it.
- **Pass:** The bubble tracks the new category after reload (no stale
  seeded colour); a 7th+ category wraps to reuse the palette from the
  start (documented, accepted); deleting a category returns its clients
  to neutral grey.

### CL-AV-3 — Contacts stay neutral
- **Setup:** `/contacts` with contacts across several groups.
- **Pass:** Every referral-network bubble is the neutral grey `avatar n`
  regardless of group; no group colour-coding on practitioners.

### CL-AV-4 — Stat-card urgency colours
- **Setup:** `/dashboard` with at least one needs-attention row and one
  program ending inside 7 days; then a state with both counts at zero.
- **Pass:** "Need attention" renders its number in the alert red
  (`--color-alert`) when > 0; "Programs ending" renders in the warning
  amber (`--color-warning`) when > 0; both fall back to neutral charcoal
  at zero. (Operator rule: red = act now, amber = plan ahead — deliberately
  swapped from the original mapping.)

---

## Clinical notes — rich-text formatting (2026-07-04)

Context: note-field content and template starter text move from plain
textareas to a rich-text editor (TipTap; new `RichTextEditor` /
`RichText` components) supporting bold / italic / underline, bullet +
numbered lists, Shift+Enter soft breaks and Tab list indenting — nothing
else (design-system restraint; the schema IS the grammar). Values are
stored as an HTML subset inside the existing columns
(`clinical_notes.content_json.fields[].value`,
`note_template_fields.default_value`) — no migration. Every write passes
the server-side allowlist sanitiser (`src/lib/rich-text-server.ts`:
p/br/strong/em/u/ul/ol/li, zero attributes) — the XSS boundary that makes
the readers' HTML injection safe. Legacy plain-text notes coexist:
`isRichHtml()` (matches only a leading `<p|ul|ol`) routes them down the
old pre-wrap path, and text like "<5/10 pain" is never misread as markup.
Read sites converted: profile Notes reader, session-builder /
program-calendar rail (NotesPanel), print view. Editor sites: note form
fields + Settings template starter text. Sanitiser attack cases (script,
onerror, javascript: href, event attrs, style) verified stripped via
direct module test 2026-07-04.

### CN-RT-1 — Formatting round-trips through save and every reader
- **Setup:** Write a note with bold, italic, underline, a bullet list, a
  numbered list, and a Shift+Enter line break; save; view it in the
  profile reader, the session-builder Notes rail, the calendar side
  panel, and the print view.
- **Pass:** All formatting renders identically on all four surfaces; the
  print/PDF output keeps the lists and emphasis.

### CN-RT-2 — Hostile markup never survives a save
- **Setup:** Via devtools/direct action call, save a note value containing
  `<script>`, an `onerror` image, a `javascript:` link and inline styles.
- **Pass:** The stored value contains none of them — only allowlisted
  tags with no attributes; the note renders as plain readable text.

### CN-RT-3 — Legacy plain-text notes are untouched
- **Setup:** View a pre-existing plain-text note (incl. one whose text
  starts with "<", e.g. "<5/10 pain"); then edit and re-save it.
- **Pass:** Unedited legacy notes render exactly as before (line breaks
  preserved, no markup leakage); opening one in the editor shows its text
  with line breaks intact; re-saving converts it to rich text without
  visual change.

### CN-RT-4 — Template starter text carries formatting
- **Setup:** In Settings → note templates, give a field formatted starter
  text (list + bold); create a new note from that template.
- **Pass:** The note form's field opens pre-filled with the same
  formatting, editable; saving keeps it.

### CN-RT-5 — Empty rich content is empty
- **Setup:** Open a note form, click into a field, apply bold, type
  nothing, try to save; separately clear a template starter text to
  blank formatting only.
- **Pass:** The empty-note guard still fires ("Fill in at least one
  field"); the cleared starter text stores NULL, and new notes from that
  template open blank — no invisible `<p></p>` remnants anywhere.

## Security — SECURITY DEFINER grant hygiene (2026-07-09)

Locks migration `20260709130000` (health-check P2-1 / P2-2). Four SECURITY
DEFINER functions stayed anon-EXECUTEable because the earlier revoke idiom did
not match the surviving grant path: `circuit_exercise_enforce_exercise_org()` and
`session_template_exercise_enforce_exercise_org()` kept anon via a **PUBLIC**
grant (their `REVOKE … FROM anon` hit a grant that did not exist);
`sync_client_profile_name(uuid)` kept anon via an **explicit anon** grant (its
`REVOKE … FROM PUBLIC` was a no-op); `handle_new_auth_user()` held **both** and was
never revoked. The fix revokes `FROM anon, PUBLIC` on all four.

### SEC-REVOKE-1 — anon EXECUTE removed from all four revoke-idiom leftovers
- **Setup:** After applying `20260709130000`, run a live grant probe against
  `circuit_exercise_enforce_exercise_org()`,
  `session_template_exercise_enforce_exercise_org()`,
  `sync_client_profile_name(uuid)`, and `handle_new_auth_user()`:
  `has_function_privilege('anon', oid, 'EXECUTE')` plus an `aclexplode(proacl)`
  scan for a PUBLIC (`grantee = 0`, i.e. `=X`) or `anon`-role EXECUTE entry.
- **Pass:** All four return anon EXECUTE = **false**, with **no** surviving PUBLIC
  (`=X`) or explicit-anon proacl entry. `authenticated` is **retained** on
  `sync_client_profile_name` (a staff RPC that needs it); the three trigger
  functions keep their inert `authenticated`/`service_role` grants. Signup is
  unaffected — `handle_new_auth_user` fires as a trigger regardless of EXECUTE
  grants (checked at CREATE TRIGGER time), verified by the fixture-driven user
  creation in the full pgTAP suite still passing.

## UI — Completed-session tiles + panel canvas (2026-07-09)

The client-profile Program tab's `<Panel>` chrome (`.panel` / `.panel-head` /
`.panel-title`) never made it from the `dashboard.html` prototype into
`globals.css`, so the "Program" and "Recent completions" panels had been
rendering as unstyled naked divs. Ported into `globals.css` as a card-equivalent
container. Separately, the shared `SessionExerciseSummary` (the completed-session
expander used on both the profile `CompletionsPanel` and the dashboard
`RecentlyCompletedPanel`) was re-treated: each exercise is a white card tile
(header / hairline / set grid) with an accent-green-tinted sequence badge —
sanctioned completion + sequence-bubble green, the same treatment as `.tag.new`
and the logger's done-card tint — sitting on a warm surface canvas both
expanders now provide.

### UI-COMP-1 — Profile Program-tab panels are styled cards
- **Setup:** Open `/clients/[id]?tab=program` for a client with an active program.
- **Pass:** Both the "Program …" panel and the "Recent completions" panel render
  as white cards — hairline border, 14px radius, the standard card shadow, and a
  hairline-divided head whose title is Barlow Condensed 700. No naked/borderless
  panel; no body-font title.

### UI-COMP-2 — Completed-session expander renders as tiles with accent badges
- **Setup:** On the same Program tab, expand a completed-session row (one with
  ≥1 logged set); then open `/dashboard` and expand a "Recently completed" row.
- **Pass:** In both places the summary renders one white card tile per exercise
  on a warm surface inset: a header (green-tinted A / A1 / B badge + exercise
  name), a hairline, then the set grid (set # · result · RPE). The RPE pill stays
  neutral (never green). Load/reps/RPE align down the columns. The two surfaces
  read identically.

### UI-COMP-3 — Zero-set exercise still reads honestly
- **Setup:** Expand a session where one exercise logged no sets while others did.
- **Pass:** That exercise's tile shows its header then a hairline-divided
  "No sets logged" in muted italic — not an empty or broken tile.

## PWA — Install identity on every route (2026-07-11)

The "C / Client Platform" home-screen tile (Roger, then Olivia Terry): the PWA
identity (manifest link, apple-touch-icon, "OdysseyHQ." title) was declared only
in `portal/layout.tsx`, but new clients are told to Add to Home Screen on
`/welcome/install` — which renders under the ROOT layout, where none of that
metadata existed and the title was the placeholder "Client Platform". iOS built
a letter tile from `<title>`; Android Chrome never fired `beforeinstallprompt`
(no manifest on the page) and the manual fallback created a title-named
shortcut. Fix: hoist manifest + `appleWebApp` + apple icon + "OdysseyHQ." title
to the root layout so every route carries them; portal layout inherits.

### PWA-ID-1 — Pre-portal pages carry full PWA identity
- **Setup:** Load `/login` and `/welcome/install` (the latter as a
  newly-onboarded client) and inspect the rendered `<head>`.
- **Pass:** Both pages contain `<link rel="manifest" href="/manifest.json">`,
  `<link rel="apple-touch-icon" href="/icons/icon-apple-touch.png">`,
  `<meta name="apple-mobile-web-app-title" content="OdysseyHQ.">`, and
  `<title>OdysseyHQ.</title>`. No route in the app renders the placeholder
  "Client Platform" title.

### PWA-ID-2 — Guided install from /welcome/install produces the branded tile
- **Setup:** On a real phone, complete client onboarding to `/welcome/install`
  and follow the on-screen install steps (iOS: Share → Add to Home Screen;
  Android: the Install button — `beforeinstallprompt` must now fire on this
  page — or the three-dots fallback).
- **Pass:** The home-screen tile shows the OdysseyHQ icon (green-rimmed "O"
  mark) named "OdysseyHQ." — never a letter "C", never "Client Platform".
  Launching it opens `/portal` standalone (no browser chrome).

## Library — create-from-builder auto-add, e/s retirement, Conditioning (2026-07-13)

Dogfooding batch. (1) The "Create New Exercise" CTA in the four day-editing
surfaces (client session builder, library session editor, program-template
editor, circuit editor) already returned the EP to the surface they came from;
now the just-created exercise is also appended there server-side
(`createExerciseAction` → `autoAddForReturnTo`), so the EP never re-searches
for an exercise they created seconds ago. The program-template editor encodes
the open day in `?day=` (its pathname alone can't identify one) and re-expands
that day on return. (2) The `e/s` reps notation is retired: the create-form
placeholder no longer teaches it and a data cleanup stripped it from library
defaults and all prescription tables (client-logged history is numeric and
untouched). (3) A 'Conditioning' movement pattern exists in every org and in
the new-org seed defaults; with the existing 'Field' tag it separates field
sessions from off-feet conditioning (bike, rower, ski erg, …).

### LIB-AUTOADD-1 — Create from the client session builder lands in the day
- **Setup:** In a client's session builder, open the Library tab, click
  "Create New Exercise", fill in a name, save.
- **Pass:** You land back in the same session builder and the new exercise is
  the last card in the day (default sets fanned out). No re-search needed.

### LIB-AUTOADD-2 — Create from the program-template editor returns to the open day
- **Setup:** In a program template with 2+ days, expand a day that is not the
  first, click the panel's "Create New Exercise", save.
- **Pass:** You land back on the template with the SAME day expanded and the
  new exercise appended to it — not an all-collapsed template, and never a
  different day.

### LIB-AUTOADD-3 — Create from the session editor and the circuit editor
- **Setup:** Repeat the create flow from a library session editor, then from a
  circuit editor.
- **Pass:** In each case the new exercise is appended to the session/circuit
  on return.

### LIB-AUTOADD-4 — Plain library create is unchanged
- **Setup:** Create an exercise from `/library` itself (no returnTo).
- **Pass:** Saves and lands on `/library` as before; the exercise is added to
  no program/session/circuit.

### LIB-ES-1 — e/s is gone from the form and the data
- **Setup:** Open the create-exercise form; then search the library for any
  exercise that previously carried "e/s" reps (e.g. a split squat) and open a
  program day that prescribed it.
- **Pass:** The Reps placeholder reads "8-12" (no e/s); no library default and
  no prescription set renders an "e/s" suffix anywhere (staff builder or
  client portal logger).

### LIB-COND-1 — Conditioning pattern is available and filters
- **Setup:** Open Settings → movement patterns, then the library filter chips
  and a builder Library tab.
- **Pass:** "Conditioning" appears in all three; selecting the chip filters to
  conditioning exercises; combining it with the "Field" tag chip separates
  field work from off-feet conditioning.

## Portal — completion volume honesty + messaging composer layout (2026-07-13)

Dogfooding batch, client portal. (1) The end-of-session "Volume" tile summed
`weight_value × reps_performed` without reading `set_logs.rep_metric`, so a
weighted timed hold (10kg × 30s) added 300 "kg" and a loaded carry
(40kg × 20m) added 800 "kg" — kg·seconds and kg·metres wearing a kg label.
It also summed lb loads as raw kg. Volume is now strict tonnage: only sets
with `rep_metric IS NULL` (a true rep count) qualify, and lb converts to kg.
(2) The portal message composer relied on a textarea sizing rule scoped to
the STAFF wrapper class (`.thread-pane__composer`), so on the portal the
textarea collapsed to its intrinsic width and packed left; and the thread
height was measured in `100vh` (the large viewport), pushing the pinned
composer below the fold behind mobile browser chrome. The sizing rule now
covers `.portal-thread__composer`, thread/shell heights use `dvh`, the nav
offset's `env()` fallback matches the nav's own (14px), and the portal
textarea gets a 16px font floor (stops iOS zoom-on-focus) with no resize
handle.

### VOL-1 — Volume counts only reps × kg
- **Setup:** Complete a portal session containing (a) a plain weighted set,
  e.g. 60kg × 10; (b) a weighted timed hold, e.g. 10kg × 30s (rep unit
  Seconds); (c) a weighted carry, e.g. 40kg × 20m (rep unit Metres); (d) a
  bodyweight set logged with no load.
- **Pass:** The completion screen's Volume tile reads exactly 600kg — the
  timed, distance, and unloaded sets contribute nothing. The Sets count still
  includes all four sets.

### VOL-2 — lb loads convert instead of masquerading as kg
- **Setup:** Log one set with the load typed as "100lb" × 5, complete the
  session.
- **Pass:** Volume shows ~227kg (100 × 0.4536 × 5), not 500kg.

### VOL-3 — All-non-tonnage session shows the empty state
- **Setup:** Complete a session of only timed/bodyweight work (no set has
  both a plain rep count and a load).
- **Pass:** The Volume tile shows "—", never 0kg or a fabricated number.

### MSG-COMPOSER-1 — Composer spans the width on a phone
- **Setup:** Open `/portal/messages` at 375px (real phone or devtools mobile
  emulation).
- **Pass:** The message textarea stretches the full row width with the Send
  button at its right edge — it is not a narrow box packed to the left.

### MSG-COMPOSER-2 — Composer is visible without scrolling
- **Setup:** Open `/portal/messages` on a real phone with the browser address
  bar visible, thread containing enough messages to fill the screen.
- **Pass:** The composer sits pinned above the bottom nav and is fully
  visible on load — no scrolling required to reach it; the bottom nav never
  overlaps it. The message list scrolls within the thread body.

### MSG-COMPOSER-3 — Focusing the composer does not zoom the page (iOS)
- **Setup:** On an iPhone, tap into the message textarea.
- **Pass:** The keyboard opens without Safari zooming the page in; after
  dismissing the keyboard the layout returns with the composer still pinned.

## Messaging attachments (2026-07-13)

Structural build (docs/polish/messaging-attachments.md — the messaging §5
re-trigger fired). Staff attach any file (25 MB, executable extensions
blocked); clients attach photos only (10 MB); up to 4 per message; a photo
alone is a message (empty body allowed when attachments present); attachments
are immutable like messages. Blobs upload browser-direct to the private
`message-attachments` bucket under {org}/{thread}/ paths — the platform's
first client-role storage writes — and the `send_message_with_attachments`
definer RPC verifies every blob (existence, uploader, authoritative mimetype,
size) before the message lands. DB behaviours are locked by pgTAP
`59_message_attachments.sql` (20 assertions); these scenarios cover the
browser layer.

### ATT-1 — Staff sends a file with text
- **Setup:** Staff inbox, open a thread, click the paperclip, pick a PDF
  under 25 MB, type a short message, Send.
- **Pass:** One bubble renders with the file chip (name + size) above the
  text; clicking the chip opens/downloads the file with its original name.
  The thread-list preview shows the message text.

### ATT-2 — Client sends a photo-only message
- **Setup:** Portal messages on a phone, tap the photo button, pick one
  gallery photo, leave the text empty, Send.
- **Pass:** The photo renders as an image bubble (no empty text line under
  it); the staff inbox receives it in realtime as an image bubble, and the
  thread-list preview reads "[Attachment]" — never blank.

### ATT-3 — Multiple photos, cap enforced
- **Setup:** Portal, attempt to attach 5 photos.
- **Pass:** The composer refuses the fifth with "Up to 4 photos per message."
  Four photos send as one message with four image bubbles.

### ATT-4 — Client cannot attach a non-image
- **Setup:** Portal photo picker (accept=image/*); attempt a workaround by
  picking a non-image if the OS allows it.
- **Pass:** The composer rejects it ("Photos only in here."); anything that
  slips past the UI dies at the storage policy (extension) or the RPC
  (authoritative mimetype) — the send errors honestly, nothing half-lands.

### ATT-5 — Oversize honesty
- **Setup:** Portal: pick a photo over 10 MB. Staff: pick a file over 25 MB.
- **Pass:** Both are refused at pick time with the size named; nothing
  uploads.

### ATT-6 — Send-failure rollback leaves no orphan visible
- **Setup:** With devtools offline mode enabled mid-send (after picking
  photos), attempt Send; then restore the connection and retry.
- **Pass:** The failed attempt shows an inline error and no message bubble;
  the retry sends cleanly with no duplicate photos. (Blob orphans from the
  failed upload are uploader-deletable only and swept per
  docs/runbooks/message-attachments-orphan-sweep.md.)

### ATT-7 — Realtime attachment delivery
- **Setup:** Staff inbox and the client portal open side-by-side; client
  sends a photo.
- **Pass:** The staff pane shows the image bubble without a refresh (the
  attachment fetch rides the realtime INSERT); same in reverse for a staff
  file → portal chip.

### ATT-8 — Immutability holds end-to-end
- **Setup:** After sending, look for any edit/delete affordance on an
  attachment in either surface.
- **Pass:** None exists — matching messages. (DB-level: pgTAP 59 asserts
  UPDATE raises P0001 and DELETE is denied.)

### ATT-9 — Adversarial: a mime-spoofed "image" cannot execute (finding a)
- **Setup:** This is the reviewer's finding (a) — `storage.objects` mimetype is
  caller-controlled (verified 2026-07-13: SVG bytes stored under a declared
  `image/png` Content-Type serve back as image/png with no `nosniff`). Try to
  land and trigger such a blob: e.g. craft a file whose bytes are
  `<svg><script>…</script></svg>` but whose Content-Type is `image/png`.
- **Pass (send layer):** The composer refuses it — `uploadMessageAttachments`
  magic-number sniff rejects "doesn't look like the image it claims to be"
  before upload. (Defense-in-depth; not the guarantee.)
- **Pass (render layer — the guarantee):** Even a blob that reaches a bubble
  (e.g. crafted via a direct storage/RPC call bypassing the composer) renders
  ONLY through `<img>` — no `<a>`/new-tab navigation to the raw signed URL
  exists. The image either decodes as a picture or shows as broken; no script
  runs, and "view larger" is an in-DOM lightbox (same `<img>`, no navigation).
  Files (incl. any SVG, which the RPC classifies kind='file') only ever
  download, never render inline.

### ATT-10 — Immutability holds for archived threads (finding b)
- **Setup:** A client sends a photo, then the client (and so their thread) is
  archived. Attempt, as that client, to delete the already-sent photo's blob.
- **Pass:** The blob cannot be deleted — the message and its photo persist.
  (DB-level: pgTAP 59 tests 21-23 prove the storage DELETE policy resolves
  "referenced?" through a SECURITY-DEFINER helper that bypasses the caller's
  archived-thread RLS, while genuine orphans stay deletable for rollback.)

---

## Dogfooding — Bookings tiles + Sex dropdown (staff, presentation, 2026-07-14)

Context: two UX papercuts inside already-signed-off surfaces — pure
presentation, no schema / RLS / pgTAP. (1) The client Bookings tab
(`BookingsTab.tsx`) moves from two stacked Upcoming/Past lists to two
side-by-side tiles, each with its nearest appointment front-and-centre and a
chevron to drop the full list. (2) The Edit-details Sex field
(`EditClientDetails.tsx`) becomes a dropdown (Female / Male / Prefer not to say)
over the still-free-text `clients.sex` column — UI-only, values not DB-enforced.

### BOOK-TILES-1 — Two side-by-side tiles, Past and Upcoming
- **Setup:** Open a client's Bookings tab (authed staff) with both past and
  future appointments.
- **Pass:** The tab renders two tiles, **Past** (left) and **Upcoming** (right),
  side by side on desktop; each is a `.card` carrying the section label and a
  count. They collapse to one column when the viewport is too narrow for two
  (grid `repeat(auto-fit, minmax(min(100%, 280px), 1fr))`).

### BOOK-TILES-2 — The nearest appointment is front-and-centre
- **Pass:** The Upcoming tile's headline row is the **closest** upcoming
  appointment (soonest `start_at`, status pending/confirmed); the Past tile's
  headline is the **most recent** past one (latest `start_at`). Each shows the
  date line, time range · type, and status label.

### BOOK-TILES-3 — The chevron drops the full list, independently per tile
- **Setup:** A tile with more than one appointment.
- **Pass:** Collapsed, only the headline shows, with an "N more" toggle (down
  chevron). Clicking it reveals the remaining appointments below the headline
  and flips to "Show less" (up chevron); the other tile's expand state is
  unaffected, and — crucially — the other tile does **not** grow to match the
  expanded one's height (grid `align-items: start`, so each tile sizes to its
  own content with no dead space beside a dropped-down list). A tile with a
  single appointment shows no toggle; an empty tile shows "No past bookings." /
  "No upcoming bookings."

### BOOK-TILES-4 — Cancel still works, from the Upcoming tile only
- **Pass:** Upcoming rows keep the **Cancel** affordance → shared `ConfirmDialog`
  → `cancelAppointmentAction` → refresh. Past rows have no Cancel. Behaviour
  carried over unchanged from the pre-tile layout.

### SEX-DROPDOWN-1 — Sex is a controlled dropdown
- **Setup:** Open a client's Edit-details dialog (authed staff).
- **Pass:** The Sex field (`id="edit-sex"`) is a `<select>` offering **—**
  (unset), **Female**, **Male**, **Prefer not to say**. Choosing one and saving
  writes that exact string to `clients.sex` via `updateClientDetailsAction`; the
  Profile tab's SEX FieldBox then reads it back.

### SEX-DROPDOWN-2 — A legacy free-text value is preserved, not blanked
- **Setup:** A client whose `clients.sex` holds a value outside the canonical
  three (e.g. "M" or "Non-binary" typed before this change).
- **Pass:** Opening Edit-details shows that legacy value as the selected extra
  option (not blank), so saving other fields does not silently rewrite Sex. The
  EP can re-pick a canonical option; the column stays free-text (no CHECK), so
  either write is accepted. (Prevents the classic "select value not in option
  list → renders blank → clobbers on save" data-loss trap.)

## Dogfooding — Category on the Contact card (staff, presentation, 2026-07-21)

Context: a UX papercut inside the already-signed-off client Profile tab — pure
presentation, no schema / RLS / pgTAP. The client "title" (category: Athlete /
Rehab / Lifestyle / …) was already editable in the Edit-details dialog and shown
as the header tag, but was **absent from the Contact card's read view**, so it
read as un-changeable. A **Category** `FieldBox` is added to the Contact grid
(after Sex), reading the same `client.category_name` the header tag uses. The
existing Edit-details → Category dropdown is unchanged; no new edit path.

### CAT-FIELD-1 — Category is visible at rest on the Contact card
- **Setup:** Open a categorised client's Profile tab (authed staff).
- **Pass:** The Contact card shows a **CATEGORY** eyebrow FieldBox reading the
  client's category name (e.g. "Rehab"), the same value as the header tag. An
  uncategorised client renders the em dash (`—`), muted — never blank or a crash.

### CAT-FIELD-2 — It's edited through the existing Edit-details dialog
- **Pass:** Changing the category via Edit-details → **Category** and saving
  (`updateClientDetailsAction`, `clients.category_id`) is reflected in the new
  Contact FieldBox after refresh. No separate edit control was added on the read
  view — the single "Edit details" pencil still owns every Contact field.

## Dogfooding — Completed-session lock + calendar completion tick (staff, 2026-07-15)

Context: a completed session (the client has logged it) is now **read-only** in
the session builder — its prescription is the record the client actually
performed against, so freezing it keeps that record honest. The program calendar
shows a green **Completed** tick on days with a logged session. Both are
read-only projections over the already-staff-readable `sessions` table
(`sessions.completed_at`, `program_day_id`-linked, client-scoped) — no schema /
RLS / pgTAP. Lock predicate = **completed AND still assigned**; Unassign is the
unlock. "Missed" (red mark) is deferred (`deferred-prompts.md`). The
calendar-pristine rule was consciously amended to allow a single binary status
glyph on a cell (see `docs/polish/program-calendar.md` §10).

### CAL-DONE-1 — Completed day shows a green tick on the calendar
- **Setup:** A client with a `program_day` that has a completed session
  (`sessions.completed_at` set, `program_day_id` linked) and is assigned.
- **Pass:** The day's top-right corner shows a **Completed** pill — green
  `Check` (strokeWidth 3) on `--color-accent-soft-strong` — superseding the
  "Assigned" pill. Assigned-but-not-completed days still show **Assigned**;
  unassigned-with-exercises show the **Assign** paper-plane. The detailed logged
  data does NOT appear on the calendar (still profile-only).

### LOCK-1 — Completed + assigned session opens read-only
- **Setup:** Open the session builder for a completed, still-assigned day.
- **Pass:** A quiet lock banner sits above the exercise list — Lock icon +
  "This session is locked — completed {date}. Unassign it above to make
  changes." The set-value cells render as **static text**, not inputs; the
  Load/Notes and Reps column headers are static slabs, not dropdowns; rest/tempo
  and instructions are static text; the exercise name is plain text (no swap).

### LOCK-2 — Every write affordance is absent when locked
- **Pass:** No move-up/down, no ungroup, no remove (trash), no drag handle, no
  set +/− stepper (the "N sets" count still shows), no between-cards
  "+ Add exercise" / "Superset" bars, no section-title dropdown (a set section
  shows as a static eyebrow; a blank one renders nothing), and the day label in
  the header is plain text (no rename pencil). Attempting a write via a stale
  control (or racing the DB directly) is additionally guarded — the mutation
  handlers early-return while locked (UI guardrail; DB-level enforcement is
  deferred, `go-live-checklist.md` §8).

### LOCK-3 — Unassigning re-enables editing
- **Setup:** On the locked builder, click **Unassign** in the page header,
  confirm.
- **Pass:** `published_at` clears, so `locked` goes false and the builder
  returns to fully editable (inputs, steppers, bars, drag all back). The
  calendar still shows the **Completed** tick for that day (completion is a
  historical fact, independent of assignment) — the tick does not depend on the
  day being assigned.

### LOCK-4 — Assigned-but-not-completed stays fully editable
- **Setup:** Open the builder for a day that is assigned (`published_at` set)
  but has NO completed session.
- **Pass:** The builder is fully editable — no lock banner, all controls live.
  Assigning a session does not lock it; only completion (with assignment) does.
  (Confirms we did not regress the common "assign then tweak tomorrow's load"
  flow.)

### LOCK-5 — Library browse stays live; add/swap is inert when locked
- **Setup:** On the locked builder, open the right-panel **Library** tab.
- **Pass:** Search, chip filters, and video links all work (browse for
  reference). Clicking an exercise to add/swap does **not** mutate the session —
  it surfaces the on-system notice "This session is locked — unassign it above
  to add or swap exercises." The Library tab itself is never removed (the
  Notes/Reports/Library adjacency is the differentiator).

## Go-live §3 — post-reset sibling-session revocation (auth, 2026-07-21)

Context: the last open go-live-checklist §3 item. A password reset (or a
welcome-flow first password-set) now calls `auth.signOut({ scope: 'others' })`
after the successful password write — every OTHER session for the account is
revoked; the session that just proved email control survives. Revocation kills
refresh tokens, not live access tokens, so a revoked device dies at its next
token refresh (worst case ~1h, the access-token TTL). Best-effort: a revoke
failure is logged (`[reset-password]` / `[welcome-accept]` console.error) and
never blocks the user — the password change already succeeded. No schema / RLS
/ pgTAP (no DB surface; GoTrue owns session storage).

### RESET-REVOKE-1 — Password reset kills the other device's session
- **Setup:** Log the same account in on two browsers (A and B). In A, run the
  full forgot-password → email link → reset flow to a new password.
- **Pass:** B is bounced to `/login` at its next token refresh — force it
  immediately by leaving B idle past access-token expiry, or by restarting B's
  browser (the persisted session must re-authenticate via the refresh token,
  which is now revoked). B cannot regain access without the NEW password.

### RESET-REVOKE-2 — The resetting session itself survives
- **Setup:** Same as RESET-REVOKE-1, observing browser A.
- **Pass:** A lands on its role-aware destination (staff → `/dashboard`,
  client → `/portal`) signed in, with no re-login prompt. Subsequent
  navigation in A keeps working past the next token refresh.

### WELCOME-REVOKE-1 — Invite accept revokes a pre-existing session (parity)
- **Setup:** An auth account with a live session in browser B is re-invited
  (the Imaan-class case: auth user predates the invite). In browser A, open
  the invite link and complete the welcome set-password flow.
- **Pass:** A proceeds to `/welcome/install` normally; B's old session is dead
  at its next refresh, same semantics as RESET-REVOKE-1.

## Environment separation — staging-default resolution (2026-07-21)

Context: the environment-separation flip (CLAUDE.md "Environment separation",
now Operative). Local dev, bare CLI commands, type generation, and the pgTAP
runner all resolve to the STAGING project; production is reached only through
explicit channels (`PROD_*` keys + `--prod` flags, `scripts/prod-workdir.sh`).
Staging carries synthetic data only (`scripts/seed-staging.mjs`).

### ENV-SEP-1 — Local dev server targets staging
- **Setup:** `npm run dev`, open `http://localhost:3000/api/health`, then sign
  in with the `STAGING_DEV_LOGIN_*` credentials from `.env.local`.
- **Pass:** Health reports `db:ok`; the dashboard shows the synthetic clients
  (Jordan Sample, Casey Demo, …), never a real client name. The Supabase
  cookies on localhost carry the staging project ref (`sb-fbtfzlgv…`).

### ENV-SEP-2 — Prod probes refuse to run without the explicit flag
- **Setup:** `node scripts/staff-login-path-verify.mjs https://odysseyhq.com.au`
  (no `--prod`).
- **Pass:** The script exits 2 with the "refusing to probe the prod site with
  staging keys" message before creating any probe user. With `--prod` appended
  it runs against production using the `PROD_*` keys and prints
  `Supabase target: PRODUCTION`.

### ENV-SEP-3 — Bare CLI commands land on staging
- **Setup:** `supabase migration list` from the repo root; then
  `node scripts/seed-staging.mjs` (against an already-seeded staging).
- **Pass:** The migration list shows the staging linkage (no prod touch); the
  seed script prints `Target: staging (…)` and REFUSES because the seed orgs
  already exist — proving both the target resolution and the re-run guard.

## DB-level write immutability (2026-07-21, migration 20260721120000)

Context: docs/polish/db-write-immutability.md. The CN-7 archived-client
trigger family + the completed-and-assigned session edit-lock, enforced at
the database so raw API writes obey the same rules as the UI. pgTAP 60 is
the machine gate; these are the browser-level confirmations.

### DBWI-1 — Archived client record refuses writes at the DB layer
- **Setup:** Archive a client. Via any API path that bypasses the UI guard
  (e.g. a stale tab's save, or a crafted PostgREST call with a staff key),
  attempt to add a note / edit medical history / book them / edit their
  program.
- **Pass:** Every attempt fails with "This client is archived — their record
  is read-only. Restore the client to make changes." Nothing is written.

### DBWI-2 — Completed-and-assigned day is locked at the DB layer
- **Setup:** Client completes an assigned session. In the builder, the day
  renders read-only (existing behaviour). Attempt a direct API write to a
  set row of that day.
- **Pass:** The write fails with "This session is completed and still
  assigned — unassign it to edit the prescription." After Unassign, the same
  edit succeeds (UI and DB agree).

### DBWI-3 — Archive/restore cascades still run end-to-end
- **Setup:** A client with a future confirmed appointment. Archive them;
  then restore them.
- **Pass:** Archive succeeds; the future appointment flips to cancelled
  (reason "Client archived") and its reminder cascade-cancels. Restore
  succeeds; the client is live again; the cancelled booking stays cancelled.

### DBWI-4 — Archived clients row cannot be edited OR hard-deleted; the day-row unassign bypass is accepted (2026-07-22)
- **Setup:** Archive a client. Via raw PostgREST with a staff key, attempt to
  UPDATE and to DELETE that client's `clients` row. Separately, on a completed
  + assigned day, attempt the two-step unassign→edit→reassign via raw API.
- **Pass:** The UPDATE is refused by the guard ("This client is archived …");
  the DELETE is refused (by the guard, or by RLS — either layer; a successful
  delete `rows:1` is the only failure). The unassign→edit→reassign path is
  **accepted, not blocked** — it is the sanctioned unlock at every layer — and
  is confirmed audit-logged: the `program_days` unassign leaves an
  `audit_program_days` row, and the performed record (`set_logs`/`sessions`)
  is unchanged. pgTAP 60 #5/#13 are the machine gate.

### DBWI-5 — A forged archive_cascade GUC cannot bypass the family guards
- **Setup:** As the authenticated staff role, set `odyssey.archive_cascade`
  to `'1'` in the session, then attempt an archived-client write to
  `clinical_notes` and to `program_exercise_sets`.
- **Pass:** Both writes are still refused — only `clients_row_write_guard`
  (used by `restore_client`) consults the GUC; the family guards ignore it.
  pgTAP 60 #11/#12 are the machine gate.

## G-6 — auth-event audit log (2026-07-21, migration 20260721140000)

Context: auth-onboarding-staff.md "G-6 closure". Every auth flow leaves a
structured row in auth_events; the table is server-side-only + append-only.

### G6-1 — Auth flows leave audit rows
- **Setup:** Perform a failed login, a successful login, a password-reset
  request + completion, and an invite send + accept.
- **Pass:** auth_events (SQL editor, owner read) shows one row per event with
  the right event name, email/user_id, and detail fields. No auth flow is
  slowed or broken by the logging (it is best-effort).

### G6-2 — The log is invisible to API roles and immutable
- **Setup:** As any signed-in user (or anon), attempt to SELECT/INSERT on
  auth_events via PostgREST; as owner, attempt UPDATE/DELETE on a row.
- **Pass:** API roles get permission denied (42501). UPDATE/DELETE are
  refused ("auth_events is append-only") — pgTAP 61 is the machine gate.

## Invite link mint-at-POST (2026-07-21, migration 20260721150000)

Context: auth-onboarding-client.md "C-14 deferred item 1 closure". The
Supabase accept URL is minted at the human's gate tap, never at send.

### INV-MINT-1 — Invite flow works with tap-time minting
- **Setup:** Invite a client. Open the emailed /i/<id> gate; tap Continue.
- **Pass:** The tap lands them authenticated on /welcome set-password. In
  invite_tokens the row shows consumed_at set AND action_link stored (it was
  NULL between send and tap). Re-opening the gate shows "already been used".

### INV-MINT-2 — A failed mint is retryable, not a dead invite
- **Setup:** Force a mint failure (e.g. temporarily unreachable GoTrue) and
  tap Continue.
- **Pass:** The gate returns with "That didn't go through — tap again";
  consumed_at is back to NULL, and a later tap succeeds. The invite is never
  bricked by a transient failure.

## Comms tab + system-send logging (2026-07-21, migration 20260721160000)

Context: polish/email-and-sms.md "Part B — the LOGGING half". Every outbound
client email lands on the profile's Comms tab; failed sends surface there.

### COMMS-1 — Sends appear on the Comms tab
- **Setup:** Invite a client; book them (staff-side and portal-side); let a
  reminder send. Open the client profile → Comms.
- **Pass:** One row per send, newest first: invite (attributed), booking
  confirmations, reminder ("Automatic"). Rows expand to the stored body;
  the invite/booking bodies are the actual plaintext that went out.

### COMMS-2 — A failed send is visible to the EP
- **Setup:** Cause a send failure (e.g. invalid Resend key on staging) for a
  reminder or invite.
- **Pass:** The Comms tab shows the row with FAILED in the alert colour and
  the failure reason on expand. No send is retried or blocked by logging.

### COMMS-3 — The record outlives archiving and stays staff-only
- **Setup:** Archive a client with comms history; view their profile → Comms.
  Separately, as a portal client, attempt to read communications via API.
- **Pass:** The archived profile still shows the full comms record (FM-8
  boundary). The client-role API read returns zero rows (pgTAP 62 #5).
- **Automated:** `e2e/staff-render.spec.ts` → "Comms tab renders for an
  ARCHIVED client — the record outlives the archive (FM-8)" asserts the
  archived read-only chrome AND the comms row render on one page.

### COMMS-4 — A reminder row is labelled a summary, not the sent email
- **Context:** Reminder rows are logged DB-side (`reminder_log_communication`)
  with a factual SUMMARY line in `body`, not the verbatim email (the Edge
  Function's render isn't captured). Without a marker an EP reads it back as
  the message that went out.
- **Setup:** Open a client profile → Comms and expand a reminder row (subject
  "Appointment reminder"), then expand an app-side row (invite/booking).
- **Pass:** The reminder row shows the caption "Summary of the reminder — the
  exact message sent isn't stored." above the body; the app-side row does NOT
  (its body is the real email text). Both reminder rows also read "Automatic".
- **Automated:** `e2e/staff-render.spec.ts` → "Comms tab labels a reminder
  summary and surfaces a failed send" (the same test also exercises COMMS-2's
  failed-reminder rendering: FAILED label + failure reason on expand).

### COMMS-5 — A failed comms-log write is observed, never silent
- **Context:** `logCommunication` is best-effort so a logging failure can't
  break or retry a send. But the Comms tab is now the EP-facing surface for a
  failed send (FM-5) — so if the log write itself fails, the tab under-reports
  and the miss must still be observable.
- **Setup (reasoning/unit):** Force the `communications` insert in
  `src/lib/comms/log.ts` to error (e.g. a constraint violation) on a failed
  send.
- **Pass:** The log-write failure is routed through `captureException` (the
  `[observability]` seam), not a raw `console.error`, so it surfaces on the
  same channel as the send paths and lights up when the real Sentry SDK is
  wired. The send is neither retried nor blocked.

## 2026-07-23 parity pass (paying-client-gate closures)

### UNASSIGN-1 - Raw unassign of a completed session is DB-refused
- **Context:** the completed-lock hard gate (migration 20260723140000).
  Unassign was a raw `published_at -> NULL` UPDATE - the sanctioned unlock -
  so a staff credential could unassign->edit->reassign via raw PostgREST.
- **Setup:** a program day with a completed, still-assigned session; issue a
  raw PostgREST `PATCH program_days {published_at: null}` as staff.
- **Pass:** refused with "Completed sessions are unassigned through the app -
  use the Unassign action." A published day with NO completed session still
  raw-unassigns (nothing is locked).
- **Automated:** pgTAP `60` #18-19.

### UNASSIGN-2 - The app's Unassign action still works, via the RPC
- **Setup:** in the builder, open a completed+assigned day; click Unassign and
  confirm.
- **Pass:** the day unassigns (lock lifts, builder editable); the write went
  through `unassign_program_day()` (the only setter of the day_unassign GUC).
  A client-role session calling the RPC gets 42501.
- **Automated:** pgTAP `60` #20-22 (RPC success, unassigned verify, client-role
  refusal). Browser: unchanged LOCK-1..5 flow.

### UNASSIGN-3 - The RPC's GUC never outlives its own UPDATE (disarm)
- **Context:** sign-off blocker B1 (migration 20260723190000). v1 armed the
  transaction-local `odyssey.day_unassign` GUC and never disarmed it, so any
  later raw unassign IN THE SAME TRANSACTION would slip past guard branch (c)
  - and the idempotent RPC was a free arming primitive. PostgREST's
  one-request-one-transaction shape made the practical window nil; the disarm
  removes the dependence on that deployment detail.
- **Setup:** in one transaction: call `unassign_program_day()` successfully on
  a locked day, then issue a raw `published_at -> NULL` UPDATE on a SECOND
  locked day.
- **Pass:** the second, raw unassign is refused with the branch (c) copy. (The
  successful RPC beforehand proves arming worked; the refusal after proves
  disarming did.) The **idempotent no-op** path is proven the same way: an RPC
  call on an ALREADY-unassigned day (the specific free-arming primitive) also
  disarms — a raw unassign of a locked day right after is still refused.
- **Automated:** pgTAP `60` #23 (successful-unassign path, with #20 as the
  arming proof) + #25 (idempotent no-op path).

### UNASSIGN-4 - Cross-org staff cannot unassign via the definer RPC
- **Context:** sign-off blocker B2 - `unassign_program_day` is SECURITY
  DEFINER, so its own-org check is the only tenant boundary on this path; it
  was asserted in prose only.
- **Setup:** staff session in org X calls the RPC on an org-W locked day.
- **Pass:** refused with "program day ... not found in your organization"
  (no_data_found); the day stays assigned.
- **Automated:** pgTAP `60` #24.

### REMIND-NONFATAL-1 - A failing derived-log INSERT never re-sends mail
- **Context:** the unbounded-resend latent (checklist S8): any exception in
  reminder_log_communication aborted the EF's terminal status write, so the
  row stayed 'scheduled' and re-sent every cron tick.
- **Setup:** a reminder whose derived communications row is constraint-invalid
  (sms type, phoneless client); flip it to 'sent' the way the EF does.
- **Pass:** the flip COMMITS (status='sent'); no communications row is derived;
  a WARNING lands in the DB logs. The EF additionally bounds real sends at
  MAX_RETRIES even if terminal writes keep failing (pre-send ceiling +
  trigger-safe retry_count bump).
- **Automated:** pgTAP `62` #7-8.

### REMIND-SMS-1 - An SMS reminder outcome logs a valid sms row
- **Setup:** client WITH a phone; sms-type reminder flipped to 'sent'.
- **Pass:** communications row with communication_type='sms',
  recipient_phone = the client's phone, system sender (NULL).
- **Automated:** pgTAP `62` #9.

### ARCH-MSG-1 - Archived client's in-app message history is producible
- **Context:** FM-8 (AHPRA/APP record production). Archiving cascades
  deleted_at onto the thread; staff RLS was live-only, so the record vanished.
- **Setup:** archive a client who has a message thread; open their profile ->
  Comms tab.
- **Pass:** an "In-app messages" read-only transcript renders (sender,
  timestamp, body, attachment count); the staff inbox still excludes the
  archived thread; the client role still sees nothing.
- **Automated:** pgTAP `63` (6/6) + `e2e/staff-render.spec.ts` -> "archived
  Comms tab renders the in-app message history (FM-8)".

### PORTAL-END-1 - Archived client gets the closed door, not /welcome
- **Setup:** log into the portal as a client whose record is archived.
- **Pass:** the "Your portal access has ended" screen renders (practice name,
  records-retained line, Sign out) - no portal nav, no /welcome onboarding
  funnel, no broken empty screens. Sign out works.
- **Automated:** `e2e/parity-pass.spec.ts` -> P2-3 test.

### G15-DEEPLINK-1 - Staff deep link survives login
- **Setup:** logged out, open /clients/<id> directly; log in on the redirect.
- **Pass:** land on /clients/<id> (not /dashboard). Negative control: a
  claimless user driven through the same flow still lands on /onboarding/org.
- **Automated:** `e2e/parity-pass.spec.ts` -> both G-15 tests.

### ALERT-1 - auth.md S11 threshold breach emails the operator
- **Context:** G-6 F-2 closure - auth_events_threshold_scan + the
  auth-events-alerts EF on an hourly Vault-token cron.
- **Setup (synthetic):** insert >10 auth.signup.failure rows (or >50
  auth.login.failure rows sharing a client_ip) with occurred_at in the last
  hour; invoke the EF with the CRON_SHARED_SECRET bearer.
- **Pass:** HTTP 200 `{breaches: >=1, emailed: true}` and the alert email
  arrives at ALERT_EMAIL naming the breach; with no breaches, 200
  `{breaches: 0}` and no email; with ALERT_EMAIL unset, 500 (fail-loud).
- **Automated:** pgTAP `61` #12-14 (grant posture + shape); the send path is
  verified at deploy per the synthetic check pattern.

### R4-HTTP-1 - Real-token PostgREST cross-tenant denial over HTTP
- **Setup:** `node scripts/r4-request-path-verify.mjs` (staging-only by
  refusal; seeded two-org logins; cred-desync self-heal built in).
- **Pass:** all checks green - cross-read/list/PATCH 0 rows, cross-INSERT
  refused at the tenant boundary with zero residue, own-org positive controls
  and the same-org PATCH control prove the zeros are RLS, not dead endpoints.
- **Cadence:** re-run on any JWT custom-claims hook change; the named test
  case for the external IT reviewer (re-run against prod with their creds).

---

## Messaging — unread badges ignore archived threads (bug fix, 2026-07-23)

Context: the staff TopBar unread count queried `messages` directly
(`sender_role='client'`, `read_at` null, `deleted_at` null). Archiving a
client stamps `deleted_at` on the `message_threads` row only
(`client_cascade_thread_archive`) — the child messages stay `deleted_at NULL`
— so unread messages in an archived thread inflated the bell/nav badge
forever, with no inbox row to open and clear them (the inbox filters archived
threads out). Fixed read-side: the badge count now inner-joins
`message_threads` on `deleted_at IS NULL` (staff layout), and the portal
badge is scoped to the client's live thread id. Deliberately NOT fixed by
stamping `read_at` at archive time — `read_at` is recipient-only integrity
(pgTAP `34`), a bulk stamp would forge read receipts on a record FM-8
preserves, and it would not survive client restore.

### MSG-BADGE-1 — Archiving a client with unread messages clears the staff badge
- **Setup:** A client sends a message the EP does not read (TopBar badge shows
  ≥1). Archive that client from their profile.
- **Pass:** After archive, the TopBar messages badge no longer counts that
  thread's unread messages (badge drops by the thread's unread count; hidden
  at 0). The thread is gone from the inbox. Restoring the client brings the
  thread — and the same messages, still unread — back: the badge count
  returns and the messages are NOT silently marked read.

### MSG-BADGE-2 — Portal badge counts only the live thread
- **Setup:** A portal client with no message thread yet; then one with a
  thread holding an unread staff message.
- **Pass:** With no thread, the portal Messages badge shows nothing (count
  query skipped). With a live thread, the badge counts unread staff messages
  in that thread only. (An archived client cannot reach the portal layout at
  all — AccessEnded — so the archived mirror is unreachable by design; the
  thread-id scope is the guard if a thread-level archive path ever lands.)
