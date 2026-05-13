# Polish-pass gap analysis — Portal per-day card view (Phase K)

**Parent phase doc:** [`client-portal.md`](./client-portal.md). Phase K row added to §4 when this gap doc is closed.
**Handoff prompt:** [`client-portal-handoff-phase-k.md`](./client-portal-handoff-phase-k.md).
**Brief:** No standalone MD. Target state captured in the handoff prompt + the closed Phase I §4.5.1 I-R5 row + the §5 follow-up "Strip-cell routing on future + skipped-past days".
**Reference prototype:** [`client-portal.html`](../../client-portal.html) — same per-day card shape Phase K will reuse for non-today days.
**Audit date:** 2026-05-13
**Status:** Gap document — signed off 2026-05-13. Implementation in progress.

---

## 0. Why this phase exists

Today's Today screen renders the rich card (exercise list + state-appropriate CTA) only for today. Tap any other day's strip cell — completed past day, future programmed day, or skipped past day — and the client gets sent straight to `/portal/session/[dayId]`, which is the Logger URL.

Phase I closed two of the three resulting awkward paths in [§4.5.1](./client-portal.md#451-pre-flight-discovery--phase-h-regression-fixes):

- **Completed past day:** the page-level guard in [`/portal/session/[dayId]/page.tsx`](../../src/app/portal/session/[dayId]/page.tsx) redirects to `/complete`. Friendly enough — but the client never sees the day's *card* (the exercise list), only the summary.
- **Today, completed:** the conditional CTA on `TodayScreen` now reads "Session complete · view summary" → `/complete`. Doesn't go through the Logger URL at all.

The two paths still unresolved are surfaced in [§5 of `client-portal.md`](./client-portal.md#5-open-follow-ups):

- **Future programmed day:** strip cell taps create a fresh session row dated today (`started_at = now()`), mismatched against the future `scheduled_date`. Nothing on the UI tells the client this is "premature" — they're just thrown into the Logger.
- **Skipped past day:** strip cell taps create a session for a date that's already passed. The Logger doesn't refuse it; the resulting session row says it happened today.

Phase K's pitch: make the **card** the canonical surface for every day with a programmed session. The card shows the exercise list (so the client knows what's prescribed) and a state-appropriate CTA at the bottom (so the action matches the day's reality — view summary, begin, scheduled for, etc). The Logger URL becomes the *destination* of the "Begin" / "Resume" CTA, not the strip-cell landing page.

The protections from Phase I remain:

- The page-level completion guard in [`/portal/session/[dayId]/page.tsx`](../../src/app/portal/session/[dayId]/page.tsx) stays as defence-in-depth for any URL that bypasses the card.
- The v3 `client_start_session` RPC refusal stays as the DB-level backstop.

Phase K is the friendly path. The two guards remain the safety net.

---

## 1. What's already correct (preserve)

### 1.1 The page-level completion guard
[`/portal/session/[dayId]/page.tsx`](../../src/app/portal/session/[dayId]/page.tsx) lines 38-49. Don't touch. Phase K reduces how often this code path runs (because the card now intercepts the strip-cell tap before it hits the Logger URL), but the guard stays as the safety net for deep links, browser back, and shared URLs.

### 1.2 The v3 `client_start_session` RPC backstop
[`20260513120000_client_start_session_v3.sql`](../../supabase/migrations/20260513120000_client_start_session_v3.sql). Don't touch. Same logic as 1.1 — Phase K's card UI is the friendly path; the RPC is the DB-level refusal for any path that bypasses both the card and the page-level guard.

### 1.3 `weekdayIndex` as the canonical Mon-first index
[`portal-helpers.ts:42`](../../src/app/portal/_lib/portal-helpers.ts). The Phase I fix collapsed the SET side (`page.tsx`) and the lookup side (`portal-helpers.ts buildWeekDots`) onto this one helper. Phase K must not reintroduce drift — any new date-to-index conversion uses `weekdayIndex`.

### 1.4 `client_get_week_overview` RPC + `completedDayIds` Set
[`page.tsx:80-115`](../../src/app/portal/page.tsx). The RPC already returns exercises per day for every day in the week; the `completedDayIds` Set already tells us which days completed. Phase K's card view reads exactly this data — no new RPC needed for the read path. (Whether Q-K3 needs a *write* RPC is a separate question, addressed below.)

### 1.5 `buildWeekDots` contract
[`portal-helpers.ts:93-122`](../../src/app/portal/_lib/portal-helpers.ts). The `WeekDot` type carries `state: 'rest' | 'done' | 'today' | 'upcoming'` + `dayId: string | null` + `dayLabel: string | null`. The strip rendering in [`TodayScreen.tsx:164-204`](../../src/app/portal/_components/TodayScreen.tsx) consumes these. Phase K may need to enrich the state (skipped vs done) — but only if a UI decision in Q-K4 / Q-K5 demands it. Default to leaving the shape alone.

### 1.6 `BottomNav`
[`BottomNav.tsx`](../../src/app/portal/_components/BottomNav.tsx). Phase K does not touch. Phase F (booking, parallel chat) owns BottomNav changes. Per the handoff prompt's coordination notes.

### 1.7 Session builder + clinical notes right-panel adjacency
Staff-side. Phase K is portal-side only. Stated for safety per the `feedback_protect_session_builder_notes_adjacency.md` memory.

---

## 2. Gaps to close

| # | Gap | Files | Why it matters |
|---|-----|-------|----------------|
| **K1** | Strip-cell taps on non-today days route to the Logger URL, not a card view. | [`TodayScreen.tsx:186-204`](../../src/app/portal/_components/TodayScreen.tsx) | Future programmed days create premature sessions; skipped past days create sessions dated today; completed past days redirect to `/complete` via the page-level guard but skip the card entirely. None of these surfaces show the exercise list the day was prescribed with. |
| **K2** | The `TodayScreen` component renders only "today" — selecting another strip cell updates the highlight but the card below stays on today. | [`TodayScreen.tsx:73-78`](../../src/app/portal/_components/TodayScreen.tsx) | The current `useState(selectedIdx)` is decorative — the strip remembers a selection, but the card doesn't follow it. Phase K makes the card track the selection (either via URL param or local state). |
| **K3** | No mechanism for "Begin session early" — the future programmed day's scheduled_date stays put. | [`actions.ts:14-47`](../../src/app/portal/session/[dayId]/actions.ts) + RPC | The EP-locked confirmation copy ("…it will no longer be available to complete on this day") implies the future date moves to today. Needs a write-side decision (Q-K3) before any code lands. |
| **K4** | The `WeekDot.state` enum has no `skipped` value. Per the §5 follow-up + the Phase H buildWeekDots note, past programmed-but-uncompleted days currently get `state: 'done'`. | [`portal-helpers.ts:108-113`](../../src/app/portal/_lib/portal-helpers.ts) | Phase I dropped the `\|\| isPast` short-circuit (see §4.5.1 I-R4 context — wait, actually §4.5 I-Q4 said in-phase fix, let me re-read). Actually re-reading: §4.5 I-Q4 said in-phase fix for that. Verify before writing code. If still present, add to Phase K. If already fixed, the discrimination already exists via `entry.done` boolean. |

> *Note on K4 — verify in §3.1 before treating as a gap.*

---

## 3. Questions for EP sign-off

Surface before writing code, per the polish-pass protocol. Recommendations are stated for each.

### Q-K1 — URL structure for the selected day

**Options:**
- (a) Same `/portal` route with a `?d=YYYY-MM-DD` query param. Today is the default; tapping a strip cell sets the param.
- (b) New `/portal/day/[dayId]` route. `/portal` stays "today."
- (c) Other.

**Recommend (a).** Cleanest. The hero greeting, week strip, and "This week" stats stay visible — only the card swaps. Same component, same data load, single source of truth for "the day card." (b) duplicates the page chrome for no gain; the handoff prompt notes this explicitly.

One small consequence to confirm:
- (a.i) The page reads `?d=YYYY-MM-DD` and defaults to today's ISO date when missing. Invalid dates fall back to today.
- (a.ii) Strip cells render as `<Link href="/portal?d=YYYY-MM-DD">` instead of `<Link href="/portal/session/[dayId]">`.
- (a.iii) The card's CTA is the only thing that links into `/portal/session/[dayId]` (or `/complete`, depending on state).
- (a.iv) The browser back button takes the client from card → strip selection → home page, in that order. Reads naturally on iPhone.

**EP answer:**

---

### Q-K2 — Component naming

**Context.** `TodayScreen` currently represents "today's view." After Phase K it'll represent "the selected day's view" — which is often *not* today.

**Options:**
- (a) Rename to `DayScreen`. Update the one import site (`page.tsx`).
- (b) Keep `TodayScreen` (the URL is still `/portal`, which is conceptually "today's home page").
- (c) Other.

**Recommend (a).** Component name should match what it renders. The route is the user-facing concept; the component is the developer-facing concept. Today the alignment is fine because they're the same thing; after Phase K they're not. Cost of the rename is ~30 seconds — one import, one export.

**EP answer:**

---

### Q-K3 — Future-day "Begin session early" mechanics

**Context.** The EP-locked confirmation copy says:

> *"Are you sure you want to move this session to today, it will no longer be available to complete on this day?"*

The semantic explicitly says the future date will no longer hold the session. Three implementations satisfy this differently.

**Options:**

- **(α) New RPC `client_reschedule_program_day_to_today` — UPDATE `program_days.scheduled_date`.**
  Moves the future programmed day's date forward to today, then starts the session. Future date disappears entirely. Simple. Matches the confirmation copy literally.
  - Cost: one new SECURITY DEFINER RPC. Audit register: not needed (`program_days` is already in [`audit_resolve_org_id`'s CASE list](../../supabase/migrations/20260428120900_audit_register_testing_module.sql) at line 75 — the existing trigger captures the UPDATE).
  - Risk: destructive to the EP's intended schedule. The EP might have programmed Thursday's leg session *for Thursday* for a reason (e.g. recovery from Tuesday). If the client says "I want to do it today," the EP's week-shape moves.
  - Risk: no UNIQUE constraint on `program_days(program_id, scheduled_date)` — if today already has a programmed day, the UPDATE creates two same-date rows. Unusual but possible. Refuse in the RPC, or accept.

- **(β) New RPC `client_advance_program_day_to_today` — INSERT a fresh `program_days` row for today, cloned from the future one.**
  Future date stays where it is. New today-dated row inherits the future row's exercises (`program_exercises` get duplicated via a sub-INSERT). Future day is marked... what? Still scheduled? Soft-deleted? Pending the EP's call.
  - Cost: a more involved RPC. Audit-wise still no register change (`program_days` and `program_exercises` already covered).
  - Risk: the staff calendar now shows the same workout twice if the future row stays put — once at the future date, once at today. The original confirmation copy says the future date won't hold the session anymore, so the future row needs to be marked somehow.
  - Risk: clones the exercises wholesale; doesn't preserve any future EP edits to the original row if the EP later adjusts the future row before that future date arrives. The cloned-today row is now a stale snapshot.

- **(γ) No schema activity at all. Just start a session on the future `program_day_id` with `started_at = now()`.**
  Server-side: the v3 RPC's "only one in-progress session" check still applies; the session row writes against the future `program_day_id` but `started_at` is today.
  - Cost: zero. No new RPC; reuse `client_start_session` directly.
  - Risk: the staff calendar shows `program_day` X as "scheduled Thursday" while the session row's `started_at` is Monday. Two perspectives on "when did this happen". The completion summary on `/complete` would read "completed Monday" while the calendar still shows the day as scheduled Thursday. Future-self confusion.
  - Risk: the future strip cell would still show the day as "future" because `scheduled_date` is unchanged — but the client has already done it. After completion the page-level guard would redirect to `/complete`, so this is mostly cosmetic. Still: the client tapping the future cell on Tuesday would see "Session complete · view summary" for a day that's still scheduled in the future. Reads strangely.

**Recommend (α).** Closest to the EP's confirmation copy. Future date moves to today; client and EP both see the same single truth. Same-date collision (refusal vs silent accept) is the one detail to surface to the EP. Strong default: **refuse** with a hint ("today already has a session — finish or skip it first"). Otherwise an unexpected click could silently double-stack a day with two workouts. Soft-delete the original row's future scheduling? Or just UPDATE and let it be a single row at the new date? Single-row UPDATE is simpler — pick that.

(β) has the right safety properties but doubles the schema work and the stale-clone risk is real. (γ) is the cheapest but creates a calendar-vs-session-row mismatch that'll bite when a real EP first uses the staff dashboard to see a client's week.

**EP answer:**

**Sub-questions if (α) is picked:**
- (α.i) If today already has a programmed day for this client: **refuse** vs **accept-and-stack**? Recommend refuse.
- (α.ii) Audit-log message style: "Client rescheduled program_day X from {old_date} to today." Already covered by the existing UPDATE trigger — just confirm the audit row will have the before/after `scheduled_date` in the diff JSON.
- (α.iii) Confirmation copy verbatim (EP-locked): "Are you sure you want to move this session to today, it will no longer be available to complete on this day?" — implement as a `confirm()`-equivalent (a `<dialog>` or custom modal). Native `window.confirm` is acceptable for a v1 implementation but reads cheaper than a styled modal. Pick which.

---

### Q-K4 — Past-skipped visual treatment

**Context.** A past day that was programmed but never completed. The card view needs a treatment for this.

**Options:**
- (a) Muted/grey card + plain message. Body copy: "This session wasn't completed."
- (b) Clinical-flag banner pattern (red 3px left border + alert background).
- (c) New dedicated `state: 'skipped'` in `buildWeekDots` + a `.portal-card.is-skipped` variant.

**Recommend (a).** The clinical-flag banner pattern is reserved for clinical flags per the CLAUDE.md design rules — "the left-border accent pattern is restricted ... used only on clinical flag banners ... do not generalise this pattern to other components." Skipping a session is an observation, not a clinical alarm. Muted treatment matches the "factual not dramatised" voice rule. (c) is over-engineered for a one-off — promote to a modifier class only if a second consumer appears.

For the inert "no button" decision: just don't render a CTA. The card shows: exercise list (greyed out at 60% opacity), a tiny eyebrow "Past session", and a small message "Not completed — message your EP if you want to redo it." The "message your EP" half is optional copy; surface to EP.

**EP answer:**

**Sub-question if (a) is picked:**
- (a.i) Include the "message your EP" suggestion in the past-skipped body copy? Or leave it as pure observation? Recommend including — gives the client a path forward without bloat.

---

### Q-K5 — Week strip dot semantics

**Context.** With richer card-side state (today/completed/skipped/upcoming/future), should the strip dot encode more?

**Options:**
- (a) Keep current — single green dot = "session here." Strip is at-a-glance only; the card carries the state.
- (b) Differentiate by colour/shape — green = completed, accent-outlined = today/upcoming, hollow = skipped past.
- (c) Other.

**Recommend (a).** The card surface is doing the work of state communication. Adding colour to the strip would create visual chatter and would still require the client to learn what each variant means. The "is-selected" charcoal-fill on the cell already does the heavy lifting for "which day is the card showing right now." (b) might tempt later if the EP wants pattern at-a-glance — re-evaluate after a few real clients have used it.

**EP answer:**

---

### Q-K6 — Data coverage

**Context.** `client_get_week_overview` already returns the exercise list for every day in the week (see [migration line 64-83](../../supabase/migrations/20260510140000_client_get_week_overview.sql)). Phase K's card view consumes exactly this shape — same as today's card today.

**Question:** Does the current RPC return enough data for the card view? Or does it need extension?

**Audit table:**

| Field needed by card | Source today | Sufficient for Phase K? |
|----------------------|-------------|-------------------------|
| `day_label` (e.g. "Day C — Lower") | RPC | ✓ |
| `scheduled_date` (for header date) | RPC | ✓ |
| Exercise rows (name, sets, reps, optional_value, rpe, superset_group_id) | RPC | ✓ |
| Completion state (`done: boolean`) | Separate SELECT against `sessions` (Phase H) | ✓ |
| "Session in progress" state (for today/Resume CTA) | Not currently fetched | **MISSING — see Q-K6.1** |

**Q-K6.1 — Detecting "in-progress" today vs "not-started" today.**

Today's CTA shows either "Begin session" (no rows) or "Session complete · view summary" (completed_at NOT NULL). It does *not* discriminate "started but not completed" — there's an in-progress refusal in the RPC, but the UI doesn't read it.

For Phase K's Today/in-progress state ("Resume session" CTA), we need to know whether a session row exists with `completed_at IS NULL`.

**Options:**
- (i) Extend `client_get_week_overview` to include a per-day `has_in_progress_session boolean`.
- (ii) Add a separate SELECT against `sessions` in `page.tsx` to build an `inProgressDayIds` Set, parallel to `completedDayIds`.
- (iii) Only show "Begin session" — let the page-level guard in `/portal/session/[dayId]/page.tsx` show a "resume?" state when the Logger hydrates. (Current behaviour, more or less.)

**Recommend (ii).** Matches the Phase H pattern (`completedDayIds` Set). Mirrors how `done` is computed. RLS-scoped. No migration. The Logger's own resume detection (`startOrResumeSessionAction` already handles the case) stays intact — the card's CTA is informative ahead of the action.

If the EP picks (i), the cost is one migration to extend the RPC return shape — but the RPC is already an RPC so the wire shape is flexible. (iii) is the cheapest but loses the "Resume" CTA differentiation, which is one of the locked CTA states from the handoff.

**EP answer:**

---

### Q-K7 — Strip cell tap target on rest days

**Context.** Currently rest-day strip cells are `<button>` elements that update client-side selection but don't navigate. Programmed-day cells are `<Link>` to `/portal/session/[dayId]`. Phase K makes programmed-day cells link to `/portal?d=YYYY-MM-DD` (per Q-K1). The question is what rest-day cells do.

**Options:**
- (a) Yes — every cell tap navigates. Rest-day cells link to `/portal?d=YYYY-MM-DD`. The card view renders a "Rest day" empty state when the selected date has no programmed day. Consistent behaviour across all seven cells.
- (b) No — rest-day cells stay client-side inert (current behaviour). Tap updates the highlight; the card stays on whatever the URL says.

**Recommend (a).** Consistency wins. The "Rest day" empty already exists ([`TodayScreen.tsx:321-328`](../../src/app/portal/_components/TodayScreen.tsx)) — extending it to non-today rest days is a one-line conditional. The behaviour "tap a cell → see what's on that day" is more intuitive than "tap a cell → highlight changes but content doesn't." Cost is approximately zero.

**EP answer:**

---

## 4. Implementation plan (pending sign-off)

Sequenced so each step is independently verifiable. The plan assumes the recommendations stand; revisit if the EP picks differently.

### Step 1 — Wire the URL param + selected-date model (Q-K1, Q-K2, Q-K6, Q-K7)
1. `page.tsx`: read `?d=YYYY-MM-DD` alongside `?w=`. Parse, fall back to today's ISO. Derive `selectedDate: Date` and `selectedDayIso: string` from this.
2. Add the second SELECT against `sessions` for in-progress days (per Q-K6 (ii)). Build `inProgressDayIds: Set<string>`.
3. Find the `weekDays` entry matching `selectedDayIso`. If none, the selected day is a rest day — pass `session: null` to the screen and let it render the "Rest day" empty.
4. Compute the selected day's state machine (today/past/future × completed/in-progress/not-started/no-programmed-day) once on the server, hand it to the screen as a discriminated union.
5. Rename `TodayScreen` → `DayScreen`. Update `page.tsx` import + the file's exports.
6. Strip cells render as `<Link href={\`/portal?d=${dayIso}&w=${weekIso}\`}>` — programmed and rest days alike.

### Step 2 — Card CTA state machine (Q-K3, Q-K4)
Use a tagged union for the card state. The exhaustive `switch` in `DayScreen` renders the right CTA:

| State | Card body | CTA |
|-------|-----------|-----|
| `today-not-started` | Exercise list (full opacity) | "Begin session" → `/portal/session/[dayId]` |
| `today-in-progress` | Exercise list (full opacity) | "Resume session" → `/portal/session/[dayId]` |
| `today-completed` | Exercise list (full opacity) | "Session complete · view summary" → `/portal/session/[dayId]/complete` |
| `past-completed` | Exercise list (full opacity) | "View summary" → `/portal/session/[dayId]/complete` |
| `past-skipped` | Exercise list (60% opacity) | inert "Past — not completed" (no button) |
| `future-scheduled` | Exercise list (full opacity) | "Scheduled for [day, date]" label + "Begin session early" button (triggers Step 3 flow) |
| `rest-day` (no programmed day on this date) | "Rest day" empty card | — |

### Step 3 — Future-day "Begin session early" (Q-K3)
**If EP picks (α):**
1. Migration `20260514XXXXXX_client_reschedule_program_day_to_today.sql` — new SECURITY DEFINER RPC. Validates: caller owns the program_day, day is in the future, no in-progress session exists, today doesn't already have a programmed day for this client (refusal per α.i). UPDATEs `scheduled_date` to today. Triggers the existing `program_days` audit row.
2. New server action `rescheduleAndStartSessionAction(dayId)` — wraps the RPC + `client_start_session` in sequence. Same idempotency idiom as `startOrResumeSessionAction`.
3. Client-side soft confirmation modal — minimal native `<dialog>` or `window.confirm` (TBD per α.iii). Body verbatim: *"Are you sure you want to move this session to today, it will no longer be available to complete on this day?"*. On confirm → `rescheduleAndStartSessionAction(dayId)` → `redirect('/portal/session/[dayId]')`.
4. Run `supabase gen types` after migration applies. Verify TS surfaces don't break.

**If EP picks (β) or (γ):** revise this step before writing code.

### Step 4 — Past-skipped card variant (Q-K4)
1. Card renders the exercise list with `opacity: 0.6` (single style override, no new modifier class needed for a one-off).
2. Body copy: "Past session — not completed." Optional sub-copy per Q-K4 sub-question.
3. No CTA. The card footer area stays empty.

### Step 5 — Verify with build + manual matrix
1. `npm run build` clean.
2. Six CTA states reached manually on the phone PWA — `?d=` URLs constructed for each. Screenshot each card state.
3. Tap-through verification: each CTA lands on its expected URL.
4. Defence-in-depth verification: deep-link to `/portal/session/<completed-dayId>` still redirects to `/complete` (page-level guard intact).
5. Future-day flow: tap future cell → card shows scheduled CTA → tap "Begin session early" → confirm copy verbatim → confirm action → land in Logger with session row dated today (and future day's `scheduled_date` updated, per (α)).

---

## 5. What NOT to touch

- `BottomNav` — Phase F (booking, parallel chat) owns it.
- The page-level completion guard in `/portal/session/[dayId]/page.tsx` — Phase I closed it; Phase K reduces traffic but the guard stays.
- The v3 `client_start_session` RPC — same reason.
- `weekdayIndex` helper — the single source of truth for Mon-first indexing.
- `client_get_week_overview` RPC — read-only signature stays put (assuming Q-K6 lands on (ii)).
- The session builder + clinical notes right-panel adjacency — Phase K is portal-side only.
- The Logger flow (per-set RPC writes, optimistic state, completion screen stats) — protected per the parent doc §3.

---

## 6. Open follow-ups (likely surfaces during implementation)

Tracked here so they don't get lost:

- If Q-K3 lands on (α): the EP-side staff calendar might need a small annotation showing "rescheduled by client" on the day that was moved. Out of scope for Phase K — captures in the parent doc's §5.
- If Q-K6 lands on (i): the RPC return shape grows. Worth a follow-up to audit whether the new `has_in_progress_session` field is consumed anywhere outside the Today screen.
- Phase K does not address the case where a client taps a future cell on a day far ahead of the program's start_date — the v3 RPC and Phase K's reschedule RPC should both refuse (no active program day → no operation). Worth verifying during Step 5.

---

## 7. Acceptance bar

Phase K is signed off when:

1. Tapping any strip cell with a programmed session lands on the per-day card view at `/portal?d=YYYY-MM-DD` (or `/portal/day/[dayId]` if Q-K1 lands on (b)).
2. All six CTA states render correctly per §4 Step 2's table.
3. Future-day "Begin session early" soft confirmation copy matches the EP-locked wording verbatim.
4. `npm run build` passes clean.
5. The Phase I page-level completion guard + v3 RPC backstop both still work — confirmed by hitting `/portal/session/<completed-dayId>` directly.
6. Phase K row in [`client-portal.md`](./client-portal.md) §4 marked ✓ with closure date.
7. Any deferred items surfaced during implementation tracked in [`client-portal.md`](./client-portal.md) §5.

---

## 8. Sign-off log

| # | Question | Answer | Notes |
|---|----------|--------|-------|
| K1 | URL structure | **(a)** `?d=YYYY-MM-DD` on `/portal`. | EP guidance: "whichever decision has the least resistance for the client, and keeps good data showing to the EP." Resolves to: strip cells link to `/portal?d=YYYY-MM-DD` (a.ii); invalid `?d=` falls back to today (a.i); card CTAs are the only routes into `/portal/session/[dayId]` (a.iii); browser back walks card → home (a.iv). |
| K2 | Component name | **(a)** Rename `TodayScreen` → `DayScreen`. | Update the one import site in `page.tsx`. |
| K3 | Future-day mechanics | **(α)** New `client_reschedule_program_day_to_today` RPC; UPDATE `program_days.scheduled_date` to today. | Cleanest match to the EP-locked confirmation copy ("it will no longer be available to complete on this day"). |
| K3.i | Same-date refusal | **(α.i)** Refuse with a hint when today already has a programmed day for this client. | "Today already has a session — finish or skip it first." |
| K3.ii | Audit message style | Automatic via existing `program_days` UPDATE trigger — diff JSON carries before/after `scheduled_date`. | No new audit-register entry needed; `program_days` already in CASE list. |
| K3.iii | Confirmation modal — native `confirm` vs styled dialog | **Styled overlay (DayScreen-local) — default call by Claude.** EP did not pick explicitly; choosing styled to keep EP-locked copy verbatim without browser-URL chrome corrupting it. Native `confirm()` on iOS prefixes the page URL, which would read as cheap. Tiny `.portal-card`-shaped overlay with two CTAs ("Yes, move it" / "Cancel"). | Flag for EP to redirect if they'd prefer native `confirm()`. |
| K4 | Past-skipped treatment | **(a)** Muted card + plain message; include "message your EP" sub-copy. | Exercise list at 60% opacity, no CTA. Body: "Past session — not completed." Sub: "Message your EP if you want to redo it." |
| K4.i | Include "message your EP" in past-skipped body | **Yes.** Pairs with the muted treatment to give a path forward. | |
| K5 | Week strip dot semantics | **(a)** Keep current — single green dot = "session here." | Card carries the state; strip stays at-a-glance. |
| K6 | RPC data coverage | **No change to `client_get_week_overview`.** | |
| K6.1 | In-progress detection | **Single combined SELECT in `page.tsx`.** Pulls `program_day_id`, `completed_at`, `started_at` for sessions in this week. Derive both `completedDayIds` and `inProgressDayIds` from one query. | EP guidance: "do not choose the easy route choose the most effective long term and robust solution." Mirrors and *extends* the Phase H pattern: one source query, derive multiple sets at runtime, room for future states (abandoned/paused) without re-queries. Cleaner than two parallel SELECTs. |
| K7 | Rest-day strip cell tap behaviour | **(a)** Every cell navigates. Rest-day cells link to `/portal?d=YYYY-MM-DD`. Card renders the existing "Rest day" empty state when selected date has no programmed day. | |
