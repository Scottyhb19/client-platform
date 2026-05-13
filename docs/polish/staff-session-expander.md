# Polish-pass gap analysis — Staff session exercise-summary expander (Phase L)

**Parent phase doc:** [`client-portal.md`](./client-portal.md) §4 (Phase L row to be added on close).
**Handoff prompt:** [`client-portal-handoff-phase-l.md`](./client-portal-handoff-phase-l.md).
**Phase D context:** [`staff-program-session-display.md`](./staff-program-session-display.md) — §8 redirect log is load-bearing for this doc.
**Brief:** No standalone MD. Target state captured in the handoff prompt + `dashboard.html` prototype's "Recently completed" panel (lines 252-282) + Phase D's `CompletionsPanel`.
**Audit date:** 2026-05-14
**Status:** Implemented 2026-05-14. EP sign-off captured in §8; what shipped in §9. Awaiting EP visual verification on a logged-in dashboard session and explicit commit sign-off.

---

## 0. Pre-flight — four pieces of handoff staleness flagged before the questions

The Phase L handoff prompt was written before some adjacent work landed. The polish-pass protocol exists to catch this kind of drift — surfaced here so the EP confirms the corrected scope before any code goes in.

| # | Handoff said | Reality | Resolution |
|---|---|---|---|
| **S1** | Extend Phase D's per-session display "inside the `DaySummaryPopover` on the `MonthCalendar`." | Phase D's first attempt landed in the popover and was **reverted same day** ([`staff-program-session-display.md` §8](./staff-program-session-display.md#8-redirect-log--2026-05-11)). EP's rule: "I do not want it in the calendar section, that is wrong … it should be on the right hand side in that empty space in the programs section of the client ID." Completion data lives in `CompletionsPanel` inside [`ClientProfile.tsx:1007`](../../src/app/(staff)/clients/[id]/_components/ClientProfile.tsx) on `/clients/[id]?tab=program`. The MonthCalendar is back to pristine — no completion data, no green dot. The protected adjacency rule from the memory `feedback_calendar_pristine_completions_on_profile.md` codifies this. | **Phase L extends `CompletionsPanel` on the profile, not the popover.** |
| **S2** | Dashboard's "Recent Activity section. Currently a placeholder view ported from prototype HTML — no real data wiring." | The dashboard has a real, wired [`ActivityFeed.tsx`](../../src/app/(staff)/dashboard/_components/ActivityFeed.tsx) component that mixes notes + appointments + flag-type buckets, with chip filters (All / Sessions / Notes / Flags), expand-on-click excerpts, and a "Load N more" affordance. NOT a placeholder. | **The Phase L "expander" target on the dashboard is NOT the existing `ActivityFeed`.** See S3. |
| **S3** | Recent Activity is the dashboard surface to build. | The `dashboard.html` prototype carries a **separate, dedicated** "Recently completed" panel (lines 252-282) — distinct from anything matching the ActivityFeed concept. Each row in the prototype reads: "Yesterday / Isaac Fong / Day A — Lower Body · RPE 7." Completed *training sessions only*, no notes/appointments mixed in. | **Q-L9 below** asks whether Phase L's dashboard surface is (i) a new "Recently completed" panel matching the prototype, (ii) a new "Completions" bucket inside the existing `ActivityFeed`, or (iii) both. Recommend (i). |
| **S4** | The existing "Sessions" filter chip in `ActivityFeed` is the natural home for completion data. | The current "Sessions" filter shows `bucket === 'appointment'` — booked calendar appointments, not completed training sessions. Conflating "session" (training) with "appointment" (booking) is exactly the confusion the prototype's separate "Recently completed" panel avoids. | If Q-L9 lands on (i), the `ActivityFeed` stays untouched and the naming clash is moot. If (ii) or (iii), Phase L should rename the existing chip to `Appointments` and add a new `Completions` chip — surfaced in Q-L9 sub-question. |

These corrections shift the Phase L scope from "extend the popover + replace placeholder Recent Activity" to **"extend `CompletionsPanel` + add a new Recently-completed panel to the dashboard."** Substantively similar work, different target surfaces.

---

## 1. What's already correct (preserve)

### 1.1 Phase D's completion loader on the client profile
[`clients/[id]/page.tsx:160-179`](../../src/app/(staff)/clients/[id]/page.tsx) already eager-loads the last 10 completed sessions per client into `ProfileCompletion[]`. Embed shape:
```
sessions
  - id, program_day_id, started_at, completed_at, duration_minutes,
    session_rpe, feedback
  - program_day:program_days(day_label, scheduled_date)
  - exercise_logs(id, set_logs(rpe))
```
This SELECT only pulls `set_logs.rpe` (enough for `set_count` + `avg_rpe`). Phase L extends it with the per-set + exercise-name shape — same pattern, more columns. Staff RLS already permits `exercises` + `program_exercises` SELECTs in own org.

### 1.2 `CompletionsPanel` + `CompletionRow` in ClientProfile.tsx
[`ClientProfile.tsx:1007-1124`](../../src/app/(staff)/clients/[id]/_components/ClientProfile.tsx). Already renders the collapsed row shape: eyebrow ("Day C · Sat 10 May"), Barlow-Condensed metric line ("42m · 12 sets · avg RPE 7.3 · RPE 7"), italic feedback. Empty-state, internal-scroll, hover-title-full-feedback all in place. Phase L adds a chevron-toggle expander below the existing content per row.

### 1.3 ActivityFeed expand-on-click pattern
[`ActivityFeed.tsx:31-32`](../../src/app/(staff)/dashboard/_components/ActivityFeed.tsx) — single-row-expanded-at-a-time state (`expandedId: string | null`), chevron-up/down, indented excerpt panel beneath. **Don't touch this code.** If Q-L9 lands on (i), the new Recently-completed panel can borrow the *interaction pattern* for consistency, but the existing ActivityFeed stays intact.

### 1.4 The MonthCalendar pristine state
[`MonthCalendar.tsx`](../../src/app/(staff)/clients/[id]/program/_components/MonthCalendar.tsx) was reverted by Phase D. Don't touch — Phase L is explicitly forbidden from putting completion data on the calendar by the EP's rule in the redirect log and by `feedback_calendar_pristine_completions_on_profile.md`.

### 1.5 Shared staff components directory
[`src/app/(staff)/_components/`](../../src/app/(staff)/_components/) already exists with `PlaceholderPage`, `TopBar`, `MonthYearPicker`. Natural home for a shared expander piece if Q-L1 lands there.

### 1.6 Logger / portal complete page
Portal-side write path unchanged. Phase L is read-side staff surface only.

---

## 2. Gaps to close

### A. Profile-side: per-row expander on `CompletionsPanel`

| # | Gap | Files |
|---|---|---|
| **L1** | Each `CompletionRow` shows session-level data only. The EP can't see *what the client actually did per exercise* without leaving the page. | [`ClientProfile.tsx:1051-1124`](../../src/app/(staff)/clients/[id]/_components/ClientProfile.tsx) |
| **L2** | The Phase D SELECT pulls `set_logs.rpe` only — not enough to render per-exercise per-set detail. Needs extension. | [`clients/[id]/page.tsx:167-179`](../../src/app/(staff)/clients/[id]/page.tsx) |

### B. Dashboard: new Recently-completed surface

| # | Gap | Files |
|---|---|---|
| **L3** | No "Recently completed" panel exists on the dashboard. Prototype carries it; live code doesn't. | [`dashboard/page.tsx`](../../src/app/(staff)/dashboard/page.tsx) (loader + panel layout); new component file (see Q-L1) |
| **L4** | No completions-scoped SELECT on the dashboard. Existing dashboard pulls notes + appointments only. | [`dashboard/page.tsx`](../../src/app/(staff)/dashboard/page.tsx) |
| **L5** | If Q-L9 lands on (ii) or (iii): the existing ActivityFeed's "Sessions" filter conflates appointments + completions. | [`ActivityFeed.tsx`](../../src/app/(staff)/dashboard/_components/ActivityFeed.tsx), [`dashboard/page.tsx`](../../src/app/(staff)/dashboard/page.tsx) |

---

## 3. Questions for EP sign-off

Surfaced before code per the polish-pass protocol. Recommendations stated for each.

### Q-L1 — Where does the shared expander content live?

The expander needs a "per-exercise rows with sets/reps/load/RPE" presentation that both `CompletionRow` (profile) and the new dashboard panel can use. Three placements:

- **(a)** `src/app/(staff)/_components/SessionExerciseSummary.tsx` — top-level shared staff component. Sits alongside `TopBar`, `MonthYearPicker`, `PlaceholderPage`.
- **(b)** Co-locate two copies — one inside `ClientProfile.tsx`, one inside the new dashboard panel. Faster to ship; risks drift.
- **(c)** Split — share the inner rows, keep the chevron-toggle parent local. Compromise.

**Recommend (a).** Single source of truth. The "per-exercise rows" content is the same shape in both surfaces; the only difference is what chrome surrounds it. (b) invites future drift. (c) is fine but adds boilerplate for a small body of code.

**EP answer:**

### Q-L2 — Data fetch timing

- **(a)** Eager — extend the existing profile SELECT and add a parallel SELECT to the dashboard loader. Expander opens instantly.
- **(b)** Lazy — fire a server action on chevron click. Less data upfront; ~100-200ms perceived delay per first-open.

**Recommend (a).** Profile-side already eager-loads completions. Pattern continuity wins. Per-completion data is small (≤30 set_logs × small columns). The handoff Q-L8 (perf bound) raises this as a watch item; defer the RPC promotion until evidence.

**EP answer:**

### Q-L3 — Detail level per exercise

Per-exercise row inside the expander shows:
- Exercise name (e.g. "Back squat")
- Each set: `set N`, reps performed, load (`weight_value` + `weight_metric`) OR `optional_value` (e/s, time, distance), RPE

Optional metric example: a row for `e/s` skips weight and shows the e/s count + RPE only.

**Sub-options:**
- (a) All fields per the bullets above — the "what did the client log" full read.
- (b) Sets + reps + load only (drop per-set RPE + optional metric).

**Recommend (a).** Same data the portal completion page already renders. The expander is the "what did they log" surface — show it.

**EP answer:**

### Q-L4 — Recently-completed panel: sort + filter

- **(a)** Last 5 completed sessions across all of the EP's clients, sorted by `completed_at DESC`. Bounded by count. Matches the prototype's 5-row layout.
- **(b)** Last 7 days of completed sessions.
- **(c)** Last completed session per client (deduped most-recent-per-client).

**Recommend (a).** Bounded by count, not time, so the panel isn't empty during low-activity stretches. Matches the prototype exactly. (c) is interesting for "who's been active" framing but harder to scan when one client hyperactive.

**EP answer:**

### Q-L5 — Recently-completed row shape (collapsed state)

Per the prototype: time-ago / avatar / client name / day label + session RPE detail line.

Concretely:
- Avatar (initials, 28-30px, tone derived from client id same way the rest of staff does it)
- Client name (linked → `/clients/[id]?tab=program`)
- Detail line — recommend `${day_label} · RPE ${session_rpe}` matching prototype, with `—` for NULL session_rpe
- Right-aligned: time-ago ("Yesterday", "2 days ago", or `Sat 10 May` beyond a week — same `relativeTime` shape as ActivityFeed)
- Chevron at the very end → toggles the expander

**EP answer / refinements:**

### Q-L6 — Where on the dashboard does the new panel sit?

Looking at the current dashboard layout ([`dashboard/page.tsx`](../../src/app/(staff)/dashboard/page.tsx)):
1. Page-head greeting
2. 4-up stat cards
3. 2-col grid: AttentionPanel + TodaysSessionsPanel
4. ActivityFeed (full-width)

The prototype's "Recently completed" sits next to "Today's sessions" in a vertical right-column stack. Options:

- **(a)** Insert into the existing 2-col grid as a stacked right-column member, below TodaysSessionsPanel. Matches prototype framing — "today's sessions" + "recently completed" read as a pair.
- **(b)** New full-width row between the 2-col grid and the ActivityFeed.
- **(c)** Squeeze into the 2-col grid as a third column.

**Recommend (a).** Cleanest match to the prototype's design intent + the reading flow ("here's what's coming today / here's what just happened"). (b) over-emphasises the panel. (c) crowds the row.

**EP answer:**

### Q-L7 — Empty state

- (a) Hide the panel when no recent completions exist.
- (b) Show with an empty card: "No sessions completed yet. Sessions your clients finish will show here."
- (c) Show with a CTA toward the client list.

**Recommend (b).** Same call as the existing TodaysSessionsPanel + AttentionPanel — they render empty cards, not collapse. Keeps the dashboard's vertical rhythm stable as data accrues.

**EP answer:**

### Q-L8 — Performance bound

Dashboard fan-out: 5 completions × ~5 exercise_logs × ~5 set_logs = ~125 rows per page load. Trivial pre-launch. Plan a SECURITY DEFINER RPC `staff_get_recent_completions(p_org_id, p_limit)` if metrics later show this is hot.

**Confirm:** acceptable for v1, revisit post-launch if telemetry says otherwise?

**EP answer:**

### Q-L9 — Dashboard surface choice (new question, surfaced by §0 finding S3)

The handoff's "Recent Activity" terminology collides with the existing `ActivityFeed` component AND the prototype's separate "Recently completed" panel. Three readings:

- **(i)** New `RecentlyCompletedPanel` component matching the prototype. Leave `ActivityFeed` untouched. The two coexist — one for notes/appointments/flags, one for completed training sessions.
- **(ii)** Add a `Completions` chip filter to `ActivityFeed`. Single feed for everything. Cheaper. Surface-area churn on the existing component.
- **(iii)** Both — a new panel for the latest 5, AND a bucket inside ActivityFeed for browsing further back.

**Recommend (i).** Matches the prototype's clear intent. "Recently completed training" is a different concept from "recent clinical activity" — different cadence (once per workout vs continuous), different audience (the EP's quick "who finished what" glance vs the EP's clinical-record review). Conflating them in one feed (ii) muddies both.

**If (ii) or (iii):** also rename existing "Sessions" filter chip to "Appointments" — keeps the "session" terminology dedicated to training (matches portal language).

**EP answer:**

### Q-L10 — Profile-side expander multi-row state (new question)

In the `CompletionsPanel`, with 10 rows: should expanding one row collapse any other open row, or allow multiple open?

- **(a)** Single-row-expanded — mirror `ActivityFeed.expandedId` pattern. Cleaner UI when scrolling.
- **(b)** Multiple — allow comparing two completions side by side. More flexibility, more vertical sprawl inside the 480px-capped scroll area.

**Recommend (a).** Matches the ActivityFeed precedent. Comparison side-by-side is a power-user case; quick-scan is the dominant case. (b) can be added later if real-use signals it's needed.

**EP answer:**

### Q-L11 — Zero-sets completion display (new question)

Phase D's §7.1 SQL probe found three of Scott's test completions had zero sets logged (skip-to-complete). Phase L's expander needs a behaviour for these:

- (a) Show the expander chevron; expanded body reads "No sets logged."
- (b) Hide the chevron entirely when `set_count === 0`. Row remains, just non-expandable.
- (c) Show chevron but disable it visually (greyed out, no click).

**Recommend (b).** Cleanest. A non-expandable row mirrors how nothing-to-show-here cells work elsewhere in the staff app. (a) bloats the surface with an empty state per row.

**EP answer:**

---

## 4. Implementation plan (post-sign-off)

Sequenced so each step is independently verifiable. Plan assumes the recommendations land; if any answer shifts, the affected step re-cuts.

### Step 1 — Extend the profile-side SELECT to carry per-exercise + per-set data (Q-L2, Q-L3)
1. [`clients/[id]/page.tsx`](../../src/app/(staff)/clients/[id]/page.tsx) sessions SELECT: extend the embed:
   ```
   exercise_logs(
     id, program_exercise_id,
     program_exercise:program_exercises(
       sort_order, section_title, superset_group_id,
       exercise:exercises(name)
     ),
     set_logs(
       set_number, reps_performed, weight_value, weight_metric,
       optional_metric, optional_value, rpe
     )
   )
   ```
2. Add new exported types in [`ClientProfile.tsx`](../../src/app/(staff)/clients/[id]/_components/ClientProfile.tsx): `ProfileCompletionExercise`, `ProfileCompletionSet`, extend `ProfileCompletion` to carry an `exercises: ProfileCompletionExercise[]` array.
3. Update the JS reduce in `page.tsx` to project the embed into the new shape (preserve sort_order; tolerate orphan rows with NULL `program_exercise`).

### Step 2 — Shared exercise-summary component (Q-L1)
1. New file `src/app/(staff)/_components/SessionExerciseSummary.tsx`. Accepts `exercises: ProfileCompletionExercise[]`. Renders a compact list of per-exercise rows with their sets. No own expand/collapse state — that's the parent's job.
2. Uses staff `.tag` / `.eyebrow` primitives + Barlow Condensed for set numbers. No new hex literals, no raw radii.

### Step 3 — Profile-side expander (Q-L1, Q-L10, Q-L11)
1. Convert `CompletionRow` to a controlled toggle: chevron at end of row, `useState<string | null>(expandedId)` lifted to `CompletionsPanel`. Single-row open at a time per Q-L10 (a).
2. Hide chevron when `completion.set_count === 0` (Q-L11 b).
3. Expanded row renders `<SessionExerciseSummary exercises={completion.exercises} />` beneath the existing metric/feedback block, with a hairline divider above.

### Step 4 — Dashboard Recently-completed panel (Q-L4, Q-L5, Q-L6, Q-L9 (i))
1. [`dashboard/page.tsx`](../../src/app/(staff)/dashboard/page.tsx) Parallel.all extension: new SELECT pulling 5 most recent completed sessions across all clients in this org. Embed includes `program_day(day_label, scheduled_date)`, `client(id, first_name, last_name)`, and the same per-exercise / per-set embed as Step 1.
2. New component `src/app/(staff)/dashboard/_components/RecentlyCompletedPanel.tsx` (co-located with `ActivityFeed`). Same chevron-expand pattern as `ActivityFeed.expandedId`. Single-row-expanded.
3. Layout: insert into the existing 2fr/1fr grid as a stacked right-column member below `TodaysSessionsPanel` per Q-L6 (a).
4. Empty state per Q-L7 (b).

### Step 5 — Verify
1. `npm run build` clean.
2. Spot-check on `:3000` (existing dev server per project memory) at:
   - `/dashboard` → Recently completed panel renders, expander opens, single-row-at-a-time, zero-sets rows show no chevron.
   - `/clients/[id]?tab=program` → expander appears on `CompletionsPanel` rows.
3. Token grep — no new hex literals / raw radii / shadow strings in changed files.
4. Phase L row added to [`client-portal.md`](./client-portal.md) §4 marked ✓.

**No migration.** Phase L is query + UI only.

---

## 5. What NOT to touch

- **MonthCalendar / DaySummaryPopover** — pristine, enforced by EP rule. Phase L does not modify either.
- **ActivityFeed** — if Q-L9 lands on (i), don't touch at all. The "Sessions" filter naming clash gets a one-line memory note for future cleanup if anything; not in Phase L's scope.
- **Session builder + clinical notes right-panel adjacency** — staff-side surface protected per `feedback_protect_session_builder_notes_adjacency.md`. Phase L is dashboard + profile only.
- **Portal-side Logger + completion screen** — write path. Phase L is read-only surfacing.
- **`client_complete_session` RPC** — feeding Phase C data. Don't touch.
- **Phase D's existing `CompletionsPanel` collapsed-row chrome** — the eyebrow, the metric line, the feedback block, the empty state. Phase L *adds* an expander beneath; doesn't reshape what's there.
- **The Phase H/I work on the portal** — unrelated.

---

## 6. Acceptance bar

Phase L closes when:

1. `/clients/[id]?tab=program` → `CompletionsPanel` rows show a chevron (when `set_count > 0`); clicking expands to show per-exercise rows with sets / reps / load / RPE / optional metric.
2. `/dashboard` → new "Recently completed" panel below "Today's sessions". 5 most recent completions across all clients, each with the same expander.
3. Both surfaces respect Q-L10 (single-row-expanded) and Q-L11 (no chevron when zero sets) sign-off.
4. `npm run build` passes clean.
5. Phase L row in [`client-portal.md`](./client-portal.md) §4 marked ✓ with closure date.
6. Token grep on changed files shows zero new violations:
   ```
   grep -nE "'#[0-9a-fA-F]{3,8}'|borderRadius: [0-9]+|boxShadow:" \
     'src/app/(staff)/_components/SessionExerciseSummary.tsx' \
     'src/app/(staff)/dashboard/_components/RecentlyCompletedPanel.tsx' \
     'src/app/(staff)/clients/[id]/_components/ClientProfile.tsx' \
     'src/app/(staff)/clients/[id]/page.tsx' \
     'src/app/(staff)/dashboard/page.tsx'
   ```
7. Phase D's `MonthCalendar` shows zero diff vs master — pristine.

---

## 7. Open follow-ups (likely surfaces during implementation)

- If Q-L9 lands on (ii) or (iii): the `ActivityFeed` "Sessions" filter rename + new chip. Capture in §5 of parent doc.
- If perf measurements during Step 5 show the fan-out is meaningfully slow on the dashboard, escalate to a SECURITY DEFINER RPC `staff_get_recent_completions`. Captured here as a watch-list item.
- "View previous completions" affordance per Phase D §7.8 stays deferred — not in Phase L scope.

---

## 8. Sign-off log (2026-05-14)

| # | Question | Answer | Notes |
|---|----------|--------|-------|
| L1 | Component location | **(a)** `src/app/(staff)/_components/SessionExerciseSummary.tsx` shared. | |
| L2 | Eager vs lazy | **(a)** Eager. | Profile already does this; dashboard mirrors. |
| L3 | Detail level | **(a)** Full — sets / reps / load / RPE / optional metric. | |
| L4 | Sort + filter | **(a)** Last 5 completed sessions across all clients, sorted by `completed_at DESC`. | EP delegated between (a) and (c) — "whichever is more beneficial long-term." Claude picked (a) because: (1) it matches the prototype's design intent exactly, (2) simpler SQL → easier RPC promotion if perf later demands it, (3) the dashboard is a "what's happening now" surface and time-ordered recency matches that framing, (4) (c)'s "who's been active across the roster" breadth view belongs on the client list, not the dashboard — a different surface Phase L isn't touching. Flag for override if EP disagrees once they see it rendered. |
| L5 | Collapsed-row shape | Accepted as recommended: avatar + linked client name + `day_label · RPE N` detail + relative time + chevron. | |
| L6 | Panel placement | **Full-width bottom slot — REPLACES the existing `ActivityFeed`.** Same vertical position the ActivityFeed currently holds. | Refined 2026-05-14 after EP described the dashboard as exactly three surfaces: Needs Attention + Today's schedule + Recent activity (from client portal). The bottom "Recent activity" slot gets repurposed to show portal-originated completions, not the previous notes + appointments mix. Reading A confirmed via follow-up. |
| L7 | Empty state | **(b)** Empty card with message. | Same pattern as the other dashboard panels — layout stays stable. |
| L8 | Perf bound | **CONFIRM** — acceptable for v1; SECURITY DEFINER RPC `staff_get_recent_completions` deferred until telemetry says otherwise. | Captured as watch-list item in §7. |
| L9 | Dashboard surface choice | **REPLACE** the existing `ActivityFeed`. New `RecentlyCompletedPanel` takes the bottom full-width slot; the notes + appointments mixed feed is removed. Flagged-notes surfacing still happens via the existing `AttentionPanel` (separate query, unchanged). | Refined 2026-05-14: EP described dashboard as three surfaces (Needs Attention + Today's schedule + Recent activity from client portal). ActivityFeed isn't one of them — the bottom slot becomes the completions feed. |
| L6/L9 follow-up | Rename "Today's sessions" → "Today's schedule"? | **No** — leave heading as-is. EP's wording in chat was descriptive, not prescriptive. | |
| L10 | Profile expander multi-row | **(a)** Single-row-expanded. | Mirrors `ActivityFeed.expandedId`. |
| L11 | Zero-sets display | **(b)** Hide chevron when `set_count === 0`. | |

**Implementation begins on explicit "start coding" from EP.** The two soft answers (Q-L4, Q-L6/Q-L9 read together) are flagged here so any override happens before code lands rather than after.

---

## 9. What shipped (2026-05-14)

| File | Change |
|------|--------|
| [`src/app/(staff)/clients/[id]/page.tsx`](../../src/app/(staff)/clients/[id]/page.tsx) | Extended the Phase D `sessions` SELECT embed to include `program_exercise → exercise.name` + the full `set_logs` column set (`set_number`, `reps_performed`, `weight_value`, `weight_metric`, `optional_metric`, `optional_value`, `rpe`). Single-pass JS reduce projects per-exercise + per-set detail alongside the existing aggregates. `weight_value` coerced through `Number()`. New `ProfileCompletionExercise`/`ProfileCompletionSet` types imported from ClientProfile. |
| [`src/app/(staff)/clients/[id]/_components/ClientProfile.tsx`](../../src/app/(staff)/clients/[id]/_components/ClientProfile.tsx) | Exported new `ProfileCompletionSet` + `ProfileCompletionExercise` types. `ProfileCompletion.exercises` added. `CompletionsPanel` lifts `expandedId` state (single-row open). `CompletionRow` accepts `isExpanded` + `onToggle`; renders a chevron when `set_count > 0`; mounts `<SessionExerciseSummary>` beneath when open. Imports: added `ChevronDown` + `ChevronUp`. Chevron button styled with `var(--radius-button)` only — no raw radii. |
| [`src/app/(staff)/_components/SessionExerciseSummary.tsx`](../../src/app/(staff)/_components/SessionExerciseSummary.tsx) | NEW shared component. Computes A/A1/A2/B sequence letters inline (mirrors portal `DayScreen.buildExerciseList`). Per-exercise rows render letter + name + ordered sets. Each set line: load + `×` + reps OR `{reps} reps` OR optional_value, right-aligned RPE chip when present. Pure presentation. |
| [`src/app/(staff)/dashboard/page.tsx`](../../src/app/(staff)/dashboard/page.tsx) | REMOVED: `recentAppointments` + `recentNotes` loaders, `activityItems` composition, 6 unused helpers (`isFlagNote`, `titleFromNote`, `metaFromNote`, `excerptFromNote`, `prettifyNoteType`, `formatDayTime`), `ActivityFeed` import. ADDED: `recentCompletions` SELECT with same embed shape as the profile loader plus `client:clients(id, first_name, last_name)`. JS reduce projects `DashboardCompletion[]`. `<RecentlyCompletedPanel>` replaces `<ActivityFeed>` at the bottom of the page. |
| [`src/app/(staff)/dashboard/_components/RecentlyCompletedPanel.tsx`](../../src/app/(staff)/dashboard/_components/RecentlyCompletedPanel.tsx) | NEW dashboard panel. Header "Recently completed" + sub-line "Sessions your clients have logged from the portal". Each row: avatar + linked client name + `day_label · RPE N` detail + relative time + chevron (or reserved-column spacer when zero sets). Grid layout with the Link wrapping the row body and the chevron button as a sibling — no nested interactives. Inline `relativeTime` (`just now` → `Sat 10 May`). Expander mounts `<SessionExerciseSummary>` indented under the client name column. |
| [`src/app/(staff)/dashboard/_components/ActivityFeed.tsx`](../../src/app/(staff)/dashboard/_components/) | DELETED. Replaced wholesale per Q-L9. |

**Migrations.** None. Existing staff RLS on `sessions` / `exercise_logs` / `set_logs` / `exercises` (per Phase D §1) was sufficient.

**Verification — `npm run build`.** Clean. 11.0s compile + 22.8s TypeScript. All 12 static pages generated, all 40 routes registered.

**Verification — token grep on changed files.** Zero new matches for `'#[0-9a-fA-F]{3,8}'`, `borderRadius: [0-9]+`, or `boxShadow:`. The one violation introduced during initial scaffolding (`borderRadius: 6` on the chevron button) was fixed to `var(--radius-button)` before this row was written.

**Verification — preview server.** The dev server on `:3000` returned `200` on the last several `/dashboard` GETs after the final edit landed. Intermediate hot-reload errors during the multi-step edit are visible in the historical log but resolved by the final state. Full visual verification (rendered layout, expand/collapse interaction, real completion data) is pending the EP's logged-in session — the preview verification ran against an unauthenticated session that redirects to `/login`.

**Watch-list (per §7).**
- If telemetry shows the dashboard's 5-completion fan-out becomes slow, promote to a `staff_get_recent_completions` SECURITY DEFINER RPC.
- "View previous completions per program_day" deferred from Phase D §7.8 stays deferred; not in Phase L scope.

**Suggested next phase.** Per the signed-off K → L → J order, **Phase J — Data-tab redesign** (`/portal/reports?tab=data`). Owns its own sub-protocol gap doc (`docs/polish/client-portal-data-tab.md`) per the parent doc's §4 row.
