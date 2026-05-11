# Polish-pass gap analysis — Staff program view: per-session completion display (Phase D)

**Audit date:** 2026-05-11
**Parent gap doc:** [`client-portal.md`](./client-portal.md) §0.1 sign-off row B1 (locked) and §4 Phase D row.
**Parent item:** B1 — capture post-session feedback + session RPE on the portal, display on the staff side. Phase C (portal capture) shipped on master in commits 12fbb18, fbee16f, 4a0c2c1. This doc covers the staff-side display half.
**Scope:** Query + UI pass only. No schema changes expected; the columns (`sessions.feedback`, `sessions.session_rpe`) already exist and Phase C is writing to them.
**Status:** Implemented 2026-05-11. **First implementation lived in the calendar popover (commit `4e4fe1a`); reverted same day and re-landed on the client profile Program tab right panel after EP pushback on the calendar placement.** See §8 for the redirect log.

---

## 0. Pre-flight finding — the brief assumes a list; the code is a calendar

Both the brief and the parent gap doc describe Phase D as "a collapsible per-session expander on each row of the program day list." That phrasing assumes a flat list-of-rows layout. The actual implementation in [`src/app/(staff)/clients/[id]/program/page.tsx:408`](../../src/app/(staff)/clients/[id]/program/page.tsx) renders a `<MonthCalendar>`:

- 7-column Mon-first month grid with six week rows.
- Each programmed day is a `DateCell` (button) showing the date number, the `day_label` tag, and the exercise count.
- Clicking a programmed cell opens a `DaySummaryPopover` anchored below/beside the cell. Popover width matches the cell (so ~120–180px in a typical desktop viewport). Content is: day_label + four icon actions (Open / Copy / Repeat / Delete) + the exercise sequence (`A1`, `A2`, `B1`, etc.) with the prescription per row.
- The popover is a controlled-state singleton — only one cell can be open at a time. ESC + outside-click dismiss.

**This kills the brief's implied UI ("accordion-in-place")** because expanding a cell vertically would reflow the calendar grid. The DaySummaryPopover is the natural surface for completion data — same affordance, same anchor — but it's cell-width by default, which constrains long feedback text. §3 picks the resolution.

The protected adjacency from project memory (`feedback_protect_session_builder_notes_adjacency`) is in [`src/app/(staff)/clients/[id]/session/...`](../../src/app/(staff)/clients/[id]/session/) — the session-builder's right panel. Not touched here.

---

## 1. What's already in place (Phase D doesn't have to build)

| Piece | File | Note |
|---|---|---|
| RLS for `sessions` SELECT (staff) | [`20260420102600_rls_enable_and_policies.sql:851-863`](../../supabase/migrations/20260420102600_rls_enable_and_policies.sql) | Pattern D — owner/staff with `organization_id = public.user_organization_id()` see all sessions for clients in their org. No RPC needed. |
| RLS for `exercise_logs` + `set_logs` SELECT | Same file lines 902-919 / 958-975 | Embed via PostgREST works for staff. |
| Schema columns | [`20260420101900_session_logging.sql`](../../supabase/migrations/20260420101900_session_logging.sql) | `sessions.feedback` text, `sessions.session_rpe` smallint (1-10 or NULL), `sessions.duration_minutes` generated col, `set_logs.rpe` smallint nullable. |
| `sessions_completed_requires_rpe` CHECK | Dropped 2026-05-10 in [`20260510150000_relax_sessions_completed_requires_rpe.sql`](../../supabase/migrations/20260510150000_relax_sessions_completed_requires_rpe.sql) | Completed sessions may now have NULL `session_rpe`. UI must render "—" for that case. |
| Aggregation pattern (set_count + avg per-set RPE) | [`portal/session/[dayId]/complete/page.tsx:53-85`](../../src/app/portal/session/[dayId]/complete/page.tsx) | Same embed shape `exercise_logs(sets:set_logs(reps_performed, weight_value, rpe))` then a JS reduce. Reusable verbatim. |
| Day-popover UI shell | [`MonthCalendar.tsx:1099`](../../src/app/(staff)/clients/[id]/program/_components/MonthCalendar.tsx) `DaySummaryPopover` | The component the new content needs to live in or beside. ESC + outside-click already wired. |
| Phase C captures | Logger.tsx [`CompletePrompt`](../../src/app/portal/session/[dayId]/_components/Logger.tsx) — both fields land in the existing `client_complete_session` RPC. |

---

## 2. Data shape

What needs to render per opened day-cell:

| Field | Source | Render |
|---|---|---|
| `started_at`, `completed_at` | `sessions` | "Last completion · Sat 10 May 2026". Duration = generated col `duration_minutes`, formatted as `42m` or `1h 7m`. |
| `session_rpe` | `sessions.session_rpe` | "RPE 7" plain chip. "—" when NULL. |
| `feedback` | `sessions.feedback` | Free text, wrap to lines. "—" when NULL/empty. |
| `set_count` | `count(set_logs.id)` via embed | "12 sets" |
| `avg_rpe` (per-set) | `avg(set_logs.rpe) WHERE rpe IS NOT NULL` | "RPE 7.3" — one decimal. "—" when no rpe data. |

All rendered "—" for NULL per brief §E.

Empty state (no completed session for a programmed day): muted "Not yet completed" line. Only shown for past or today's programmed days — future days don't need the row at all (the EP knows it hasn't happened yet).

---

## 3. Decisions — three options each, with recommendation

### Q1 — Query path

| | Option | Pros | Cons |
|---|---|---|---|
| **(a)** | Direct PostgREST in the page loader (`page.tsx`). Server-side embed `exercise_logs(sets:set_logs(rpe))` filtered to the relevant `program_day_id`s. JS reduces sets + avg(rpe). | Zero new SQL surface. RLS already grants staff SELECT. Mirrors the portal `complete/page.tsx` pattern exactly. | One extra SELECT per page render. |
| **(b)** | New SECURITY DEFINER RPC `staff_get_program_day_completions(program_day_ids uuid[])` returning the aggregated shape. | Tailored return shape; future-proof for a "show all completions per day" feature. | Adds API surface + migration + type regen for a screen that staff RLS already permits to read directly. Overshoot for now. |
| **(c)** | Hybrid: lazy fetch via a per-cell server action that runs only when the popover opens for a day. | Avoids fetching set_logs for days the EP never opens. | Loading state in the popover. Adds 100-200ms perceived delay on every open. The page already eagerly loads ALL `program_exercises` so the bulk-load pattern is already established for this view. |

**Recommendation: (a).** Staff RLS grants what's needed. The data is bounded (≤ ~100 sessions per active block × ≤ ~30 set_logs each). The page is already doing a bulk `program_exercises` fetch — adding `sessions` + `exercise_logs` + `set_logs` is the same shape. RPC adds work without benefit at this size.

### Q2 — Multiple completions per program_day

| | Option | Pros | Cons |
|---|---|---|---|
| **(a)** | Show only the most recent completion. | Clean. Most days will only ever have one. | If a client resumes mid-session twice, the older row is hidden — EP can't compare. |
| **(b)** | List all completions, newest first. | EP sees every completion. | Adds a list/scroll inside the popover; visually heavier. |
| **(c)** | Most recent + a quiet "+ N earlier" affordance that expands to a list when clicked. | Best of both. | More code; the "expand inline within an already-cramped popover" pattern is fiddly. |

**Recommendation: (a).** Per brief default. Multi-completion-per-day is a real edge case (resume bug → multiple completed rows for the same `program_day_id`) but rare; surfacing it is a follow-up if EP asks. The data fetch should still pull `ORDER BY completed_at DESC LIMIT 1` per day for efficiency.

### Q3 — Lazy vs eager loading

| | Option | Pros | Cons |
|---|---|---|---|
| **(a)** | **Eager.** Page loader fetches sessions+exercise_logs+set_logs for all `program_day_ids` visible. Passes a `completionsByDayId: Map<string, CompletionSummary>` down to `MonthCalendar`. | Popover opens instantly. The calendar can also surface a subtle "completed" visual signal on the cell itself (green dot, opacity hint) without an extra query. | Pulls set_logs the EP may not view (e.g., a client with 80 completed sessions and an EP just glancing at one day). |
| **(b)** | **Lazy.** `getSessionSummaryAction(programDayId)` server action fires when the popover opens. | Minimum data fetched per page render. | Loading state in popover. No cell-level "completed" signal possible without a second eager pass. |
| **(c)** | **Eager-light.** Page eager-fetches `sessions` summary rows (id, started_at, completed_at, session_rpe, feedback, duration_minutes, and the aggregate counts) — but defers the per-set rpe array. Aggregate `set_count` + `avg_rpe` via a SQL `count()` / `avg()` over the embed. | Cell-level signal possible. Avoids pulling individual set_logs. | PostgREST's aggregate-via-embed support is limited; would likely require an RPC or a view to do the aggregation server-side, partially backing out the "no new RPC" stance from Q1. |

**Recommendation: (a) Eager.** Reasons:
1. Cell-level "completed" signal is a nice-to-have the EP will want anyway — surfacing it now costs nothing.
2. The data size for a typical active block (8-12 weeks × 3 sessions/week ≈ 30 sessions, each ≤ 30 set_logs) is < 1000 rows. The page already loads program_exercises at the same order of magnitude.
3. Popover-open latency is zero.

If telemetry later shows real load issues for clients with very long histories, escalate to (b). Defer until evidence.

### Q4 — UI pattern (where the completion section lives)

| | Option | Pros | Cons |
|---|---|---|---|
| **(a)** | **Append a "Completed" section to `DaySummaryPopover`** below the exercise sequence. Section header "Last completion · Sat 10 May 2026", then a 2-column row of metric chips (Duration, Sets, Avg RPE, Session RPE), then feedback text. Popover **widens** when this section is present (min 280px instead of cell-width) so feedback wraps comfortably. | All info for one day in one anchored surface. No new affordances. The existing prescribed-vs-actual story is right there. Reuses ESC + outside-click. | Popover overflow logic gets slightly more complex — it needs to know when to widen vs stay cell-anchored. Anchor-right behaviour still works (it just overflows further into the prior week's cells, which is what already happens). |
| **(b)** | **Segmented toggle inside the popover** — `Prescribed | Completed` tabs at top. Only one panel shown at a time. | Cleanest separation. Works even at cell-width. | Adds a new affordance pattern that doesn't exist anywhere else in the staff app. EP has to click a tab to see the comparison they're most likely to want. |
| **(c)** | **Link out** — add a fifth icon button to the popover header that navigates to a new staff route `/clients/[id]/sessions/[sessionId]` (or `/clients/[id]/program/days/[dayId]/completion`) showing the full completion view. Popover stays lean. | Most room for content. Keeps the popover small. | Costs the EP a navigation away from the calendar. Wrong primitive — completion data is "in context" with the day's prescription, not "drill-down" content. Also: requires a new route, doubling the file footprint of the phase. |

**Recommendation: (a).** Same-popover, widen-when-needed. Reasons:
1. EP's mental loop is "did Scott complete what I gave him?" — they want prescribed and actual side-by-side. Tabs (b) hide one when reading the other.
2. The popover already grows vertically with long exercise lists (`maxHeight: 280, overflowY: 'auto'` on the `<ol>`). Adding horizontal flexibility is the same shape.
3. Single component to touch. No new route, no new component.
4. Cell-width-anchored positioning is preserved when there's no completion (the existing case keeps the existing width). Widening only kicks in when content warrants it.

---

## 4. Implementation plan (post-sign-off)

Assumes (a), (a), (a), (a). If any decision changes, the plan re-cuts.

| Step | Scope | Files |
|---|---|---|
| **1** | Verify Scott Browning's completed session row exists with the expected fields. SQL probe + record output in §5.4. | Bash → `psql`/SQL Editor |
| **2** | Add the completion loader to the staff program page. New SELECT against `sessions` filtered by `client_id` + `program_day_id IN <list>` + `completed_at IS NOT NULL` + `deleted_at IS NULL`, with embed `exercise_logs!inner(sets:set_logs(rpe))`. Reduce in JS to `{id, started_at, completed_at, session_rpe, feedback, set_count, avg_rpe, program_day_id}`. Build `completionsByDayId: Map<string, CompletionSummary>`. Order by `completed_at DESC` and take first-per-day. | [`src/app/(staff)/clients/[id]/program/page.tsx`](../../src/app/(staff)/clients/[id]/program/page.tsx) |
| **3** | Thread `completionsByDayId` prop through `MonthCalendar` → `MonthGrid` → `DateCell` → `DaySummaryPopover`. Add `completion: CompletionSummary | null` to `DaySummaryPopoverProps`. | [`MonthCalendar.tsx`](../../src/app/(staff)/clients/[id]/program/_components/MonthCalendar.tsx) |
| **4** | Render the "Completed" section in `DaySummaryPopover`. New sub-component `CompletionSection` below the exercise sequence. Header line "Last completion · {formattedDate}". Four small metric chips (Duration / Sets / Avg RPE / Session RPE). Below the chips, the feedback text in a muted block; "—" when NULL. Popover widens (`width: clamp(100%, 320px, 92vw)`) when `completion !== null`. | [`MonthCalendar.tsx`](../../src/app/(staff)/clients/[id]/program/_components/MonthCalendar.tsx) |
| **5** | Empty state. When `completion === null` AND `day.scheduled_date <= todayIso`, render a quiet single-line "Not yet completed" below the exercise sequence. No widening, no chips, no feedback block. When `scheduled_date > todayIso`, render nothing extra. | Same file |
| **6** | (Optional, but cheap if eager loader is in place) — add a 5px green dot on the `DateCell` for any cell where `completionsByDayId.has(day.id)`. Mirrors the portal's `.has-session::after` pattern but signals "completed" rather than "programmed". | Same file |
| **7** | `npm run build` from inside the worktree. Verify no new typecheck errors. | — |
| **8** | Mark Phase D closed in [`client-portal.md`](./client-portal.md) §4 row D and link this gap doc from the closure note. | [`client-portal.md`](./client-portal.md) |

**No migration.** No type regen. The schema is sufficient as-is.

**Visual fidelity** — chip primitives: prefer `.tag` (staff side) for the metric chips. Sentence case. Australian English. RPE rendered as "RPE 7" not "7/10". Duration as "42m" or "1h 7m". The §6 acceptance grep applies — don't add new hex literals or raw radii in style props; use tokens.

---

## 5. Acceptance bar

1. Open `/clients/0ff9c22b-57d1-4d13-afa2-73dc78986746/program` in the staff view. The active "Scott Official Test Block" is visible.
2. Click the cell for the "Testing" day on 2026-05-10 (the one Scott completed in Phase C). The popover opens and shows below the exercise sequence: "Last completion · Sun 10 May 2026" header, chips for Duration / Sets / Avg RPE / Session RPE, and the feedback text Scott captured.
3. Click a programmed day that hasn't been completed yet but is in the past or today → popover shows "Not yet completed" below the exercise list.
4. Click a future programmed day → popover shows exercises only, no completion row.
5. Click the same day cell twice → popover toggles closed → open → closed (unchanged behaviour).
6. (If §4 step 6 done) — the 2026-05-10 cell shows a green dot indicating completion.
7. `npm run build` passes from inside the worktree (NOT main repo per the worktree-temp memory note).
8. SQL verify: the row(s) displayed match this query exactly —
   ```sql
   SELECT id, completed_at, session_rpe, feedback
     FROM sessions
    WHERE client_id = '0ff9c22b-57d1-4d13-afa2-73dc78986746'
      AND completed_at IS NOT NULL
      AND deleted_at IS NULL
    ORDER BY completed_at DESC;
   ```
9. No new violations beyond pre-existing ones in `grep -nE "'#[0-9a-fA-F]{3,8}'|borderRadius: [0-9]+|boxShadow:" 'src/app/(staff)/clients/[id]/program/'`.

### 5.4 Pre-implementation SQL probe — will run on sign-off

To confirm the fixture data:

```sql
SELECT
  s.id, s.program_day_id, s.completed_at, s.session_rpe, s.feedback,
  s.duration_minutes,
  (SELECT count(*) FROM set_logs sl
     JOIN exercise_logs el ON el.id = sl.exercise_log_id
    WHERE el.session_id = s.id AND sl.deleted_at IS NULL) AS set_count,
  (SELECT avg(sl.rpe) FROM set_logs sl
     JOIN exercise_logs el ON el.id = sl.exercise_log_id
    WHERE el.session_id = s.id AND sl.rpe IS NOT NULL AND sl.deleted_at IS NULL) AS avg_set_rpe
  FROM sessions s
 WHERE s.client_id = '0ff9c22b-57d1-4d13-afa2-73dc78986746'
   AND s.completed_at IS NOT NULL
   AND s.deleted_at IS NULL
 ORDER BY s.completed_at DESC;
```

---

## 6. What NOT to touch

- **Session builder right panel** (Library + Notes + Reports) at [`src/app/(staff)/clients/[id]/session/...`](../../src/app/(staff)/clients/[id]/session/) — protected per project memory `feedback_protect_session_builder_notes_adjacency`.
- **Portal-side CompletePrompt** in [`Logger.tsx:593`](../../src/app/portal/session/[dayId]/_components/Logger.tsx) — Phase C is shipped and stable.
- **`client_complete_session` RPC** — feeding from Phase C and working. No change.
- **`DaySummaryPopover`'s four action icons** — Open / Copy / Repeat / Delete are stable.
- **MonthCalendar's mode state machine** (copy-pick / repeat-pick / confirm-delete / etc.) — Phase D's new section is purely additive read-only data; it doesn't intersect with any mode flow.
- **Cell-level interactions** (click to open popover, ESC + outside-click dismiss) — unchanged.
- **`sessions_completed_ordering` CHECK** (still active) — completed_at >= started_at. Phase D respects this implicitly by reading both.

---

## 7. Sign-off questions

Four answers unblock the work. Defaults reflect §3 recommendations.

| Q | Question | Default |
|---|---|---|
| **1** | Query path — (a) direct PostgREST embed in the page loader, (b) new SECURITY DEFINER RPC, or (c) lazy per-cell server action | (a) |
| **2** | Multiple completions per day — (a) show only the most recent, (b) list all newest-first, or (c) "+ N earlier" affordance | (a) |
| **3** | Eager vs lazy loading — (a) eager in page loader, (b) lazy in popover, or (c) eager-light | (a) |
| **4** | UI pattern — (a) extend `DaySummaryPopover` with a Completed section + widen, (b) segmented Prescribed/Completed tabs inside the popover, or (c) link out to a new completion route | (a) |

Bonus: include the green "completed" dot on the cell (§4 step 6)? Default: yes (cheap given eager loader; useful at-a-glance signal).

Reply "(a), (a), (a), (a), yes" or any deviation and I'll proceed.

---

## 7. Sign-off + resolution log (2026-05-11)

**Choices locked:** (a), (a), (a), (a), yes. Implemented in dependency order per §4.

### 7.1 Fixture data — pre-implementation REST probe

Service-role REST probe against the live remote (no Docker per project memory `project_no_docker_local_supabase`). Returned three completed sessions for Scott Browning's `program_day_id = a4c4a2c8-4f99-483c-b1fa-fe91af1a438f`:

| Session id | completed_at | session_rpe | feedback | exercise_logs |
|---|---|---|---|---|
| `b1d9d9c3` | 2026-05-11T05:59:38Z | 8 | "Fantastic for a test run" | empty array |
| `b7ba80d4` | 2026-05-10T06:27:54Z | NULL | NULL | empty array |
| `91f2c09f` | 2026-05-10T06:24:01Z | NULL | NULL | empty array |

All three are skip-to-complete test runs (no actual sets logged). The most-recent rule means only `b1d9d9c3` displays for this program day. The other two are hidden but stay in the DB — a future "View previous completions" affordance could surface them. set_count = 0 + avg_rpe NULL exercises the "—" / "0 sets" rendering paths.

### 7.2 Files changed

| File | Summary |
|---|---|
| [`src/app/(staff)/clients/[id]/program/page.tsx`](../../src/app/(staff)/clients/[id]/program/page.tsx) | Imported `CompletionSummary` type. Declared `completionsByDayId: Map<string, CompletionSummary>` at the outer scope. Added a SELECT against `sessions` filtered by `client_id` + `program_day_id IN dayIds` + `completed_at IS NOT NULL` + `deleted_at IS NULL`, ORDER BY `completed_at DESC`, embedding `exercise_logs(set_logs(rpe))`. Reduces to most-recent-per-day in JS. Passes the map to `MonthCalendar`. |
| [`src/app/(staff)/clients/[id]/program/_components/MonthCalendar.tsx`](../../src/app/(staff)/clients/[id]/program/_components/MonthCalendar.tsx) | Exported new `CompletionSummary` type. Added `completionsByDayId` prop to `MonthCalendarProps`, `MonthGridProps`, and `DateCellProps` (as resolved `completion`). Added `todayIso` to `DateCellProps` + `DaySummaryPopoverProps` for the empty-state branch. Rendered a 6px accent-green dot in completed cells via absolutely-positioned span (pointer-events: none, aria-hidden). `DaySummaryPopover` gained a `minWidth: 'min(320px, 92vw)'` when completion is present. New `CompletionSection` sub-component rendering eyebrow + 2x2 metric chip grid + italicised feedback block; muted "Not yet completed" empty state for past/today programmed days without a completion; renders nothing for future days. New `CompletionMetric` chip primitive (uses `var(--radius-input)` for radius, `var(--color-surface)` for background, Barlow Condensed for the value). New `formatDuration(minutes)` helper handling `null`, `<=0` ("<1m"), `<60` ("42m"), and `>=60` ("1h" or "1h 7m"). |
| [`docs/polish/client-portal.md`](./client-portal.md) §4 Phase D row | Marked closed; flagged the calendar-vs-list pre-flight finding; pointed at this doc for full sign-off log. |
| [`docs/polish/staff-program-session-display.md`](./staff-program-session-display.md) (this file) | §7 close-out log. |

### 7.3 Migrations

None. Phase D was query + UI only; the schema already had every column needed.

### 7.4 Build

```
> next build --turbopack

✓ Compiled successfully in 9.6s
✓ Generating static pages using 13 workers (12/12) in 351ms
```

Routes listed include `ƒ /clients/[id]/program` (no change to dynamic-rendering posture). One Next.js workspace-root warning is pre-existing (lockfile-related, unrelated to Phase D).

### 7.5 §6 grep — no new violations

```
MASTER COUNT:    84
WORKTREE COUNT:  84
```

All new code uses `var(--color-*)` and `var(--radius-*)` tokens. The 6px completion dot uses `width/height: 6` (raw integers, but not flagged by the grep) and `borderRadius: '50%'` (string literal — also not flagged).

### 7.6 What the EP will see when verifying

1. Open `/clients/0ff9c22b-57d1-4d13-afa2-73dc78986746/program`. The current month should show a green dot on the cell for 11 May 2026 (Scott's most recent completion).
2. Click that cell. The DaySummaryPopover opens, ~320px wide, showing:
   - Day-label header + four action icons (unchanged).
   - Exercise list (unchanged).
   - **New section** with a hairline divider above it:
     - Eyebrow: "Last completion · Mon 11 May 2026"
     - 2x2 metric grid:
       - Duration: `<1m` (Scott's latest was a 20-second skip-to-complete)
       - Sets: `0`
       - Avg per-set RPE: `—`
       - Session RPE: `8`
     - Italic feedback block: "Fantastic for a test run"
3. Click a past programmed day that has no completion → popover shows exercises + "Not yet completed" muted line, no widening.
4. Click a future programmed day → popover shows exercises only, no completion row.
5. Click the same cell twice — popover toggles. No regression in copy/repeat/delete modes; Phase D is additive read-only.

### 7.7 What still needs the user

- **Visual verification on `:3000`** per project memory `feedback_dev_server_3000_only` — I do not spin up new previews from worktrees. Fast-forward master to `claude/phase-d-staff-session-display` and refresh the existing dev server.
- **No DB push, no type regen** — Phase D didn't touch the schema or RPCs.

### 7.8 Deferred / follow-ups

- **Multi-completion view.** Scott already has three completions for the same program_day_id in the DB (one with full data + two with both fields NULL). Only the most recent renders today. A "View previous completions" affordance is a candidate next step if the EP wants to compare resume attempts or repeated days. Adds a per-popover expand affordance, possibly a `(staff)/clients/[id]/sessions/[sessionId]` route. Not in Phase D scope.
- **Telemetry on eager-load cost.** For clients with very long histories the eager fetch of all set_logs.rpe could become noticeable. No measurement yet; revisit if the program page becomes sluggish post-launch (per CLAUDE.md "Open gates" — load testing is part of pre-prod hardening).
- **Old test data clean-up.** Scott's two NULL/NULL completions on 2026-05-10 are skip-to-complete test runs and don't reflect intended state. Pre-launch this is fine; cleaning up the seed data is a separate housekeeping task before the first real client lands.

### 7.9 Suggested next polish phase

Per [`client-portal.md`](./client-portal.md) §4: Phase **E** (PWA manifest icons) and Phase **G** (legacy reports clickable file_url) are the remaining client-portal items. Phase E is the smallest unit of work — two PNG icons + a manifest JSON edit. Phase G needs a schema column check then a clickable wrap. Phase **I** is the manual session-resume test pass that gates the whole client-portal section's close-out.

If you'd rather move sections, the **CLAUDE.md** polish-pass order suggests the next module-level pass is auth & onboarding. Phase E + G + I close out the portal first if you want to lock that surface before touching auth.

---

## 8. Redirect log — 2026-05-11

**What happened.** Phase D first landed (commit `4e4fe1a`) with the completion display inside the program calendar's `DaySummaryPopover` — per the recommendation chosen at §3 Q4 (a). When the EP verified, the answer was **"I do not want it in the calendar section, that is wrong and throws out how it should look on that screen. It should be on the right hand side in that empty space in the programs section of the client ID."**

The first design call had read the brief's "program day list" wording too narrowly and assumed *somewhere on the program-calendar surface* was the right place. Wrong assumption. The right place is the **client profile** at `/clients/[id]?tab=program` — the existing Program tab there is currently a single full-width Panel with no right column. That empty space is where the completion feed belongs. The calendar should stay pristine — strictly prescribed-data + scheduling actions, no actual-data overlay.

**Why the calendar was wrong, in retrospect.**

1. The calendar's job is "what is *programmed*". Mixing in "what was *completed*" muddied two concerns on one surface.
2. The popover was already a controlled-state singleton — only one cell open at a time. Adding completion data to it meant the EP had to click each cell to see *any* completion data. The feed on the profile tab shows the last 10 in one glance.
3. The cell-width-vs-widened popover dance was an aesthetic compromise, not a design.
4. The green dot was a cheap signal but still added accent-green to a surface the design system reserves for primary CTAs + completion-state checkmarks. Calendar accent-green for "client did this" diluted the signal.

**Re-implementation (2026-05-11, same chat).**

| File | Change |
|---|---|
| [`src/app/(staff)/clients/[id]/program/_components/MonthCalendar.tsx`](../../src/app/(staff)/clients/[id]/program/_components/MonthCalendar.tsx) | Reverted entirely. No more `CompletionSummary` export, no green dot, no popover widening, no CompletionSection. Calendar is back to its original shape. |
| [`src/app/(staff)/clients/[id]/program/page.tsx`](../../src/app/(staff)/clients/[id]/program/page.tsx) | Reverted the sessions loader. Calendar page now only fetches programs + days + exercises, same as pre-Phase-D. |
| [`src/app/(staff)/clients/[id]/page.tsx`](../../src/app/(staff)/clients/[id]/page.tsx) | New sessions loader added to the existing `Promise.all`. Embeds `program_day(day_label, scheduled_date)` + `exercise_logs(set_logs(rpe))` for set_count + avg-rpe math. Limited to 10 newest-first per Q1+Q2 of the redirect sign-off. Builds `ProfileCompletion[]` and passes to `ClientProfile`. |
| [`src/app/(staff)/clients/[id]/_components/ClientProfile.tsx`](../../src/app/(staff)/clients/[id]/_components/ClientProfile.tsx) | New `ProfileCompletion` type exported. `ClientProfileProps.completions` added. `ProgramTab` rewritten to render as a `2fr 1fr` grid (mirrors Invoices tab pattern) — program summary on the left, `CompletionsPanel` on the right. `CompletionsPanel` + `CompletionRow` + `formatCompletionDate` + `formatCompletionDuration` added inline. Empty state ("No sessions completed yet") renders when the list is empty; layout stays stable. |

**Redirect sign-off** (2026-05-11 chat):

| Q | Question | Answer |
|---|---|---|
| 1 | How many completions on the right panel? | 10 with internal scroll if more |
| 2 | Sort order | Newest first |
| 3 | Keep or remove the calendar's green completion dot? | Remove — keep the calendar pristine |

**Acceptance bar — re-cut.**

1. Open `/clients/0ff9c22b-57d1-4d13-afa2-73dc78986746?tab=program`.
2. Left panel: existing program summary for "Scott Official Test Block" — unchanged.
3. Right panel: **"Recent completions"** with up to 10 entries newest-first. Scott has three completions on the live DB (`b1d9d9c3` from 11 May with feedback "Fantastic for a test run" + RPE 8, plus two from 10 May with NULL feedback/RPE). All three should render.
4. The 11 May entry shows the feedback in italics; the 10 May entries show only the metric line. Each row reads "Testing · Sun 10 May" (or similar) on top, "<1m · 0 sets · RPE 8" beneath (for the populated row), feedback below.
5. Open `/clients/0ff9c22b-57d1-4d13-afa2-73dc78986746/program` (the calendar). No green dots. No completion section in any popover. Looks exactly like it did before Phase D.
6. `npm run build` passes from inside the worktree. Master and worktree both report 216 token violations under `(staff)/clients/` — zero net new.

**Cost of the wrong call.** ~2-3 hours of code that got reverted. Net of the redirect: the new shape is simpler (fewer props threaded through MonthCalendar, no green-dot styling, no popover-widening logic) and reads better on the page (10 sessions at a glance vs one per click). Lesson saved to a memory note (see §8.1).

### 8.1 Memory note

A feedback memory captures the rule the EP set: completion-state data lives on the client profile, not the program calendar. The calendar is for prescription + scheduling only.
