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
