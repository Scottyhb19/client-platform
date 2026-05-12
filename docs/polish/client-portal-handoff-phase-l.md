# Phase L handoff — Completed-session exercise-summary expander

You're picking up the Odyssey project's polish pass at Phase L: build a shared collapsible expander that surfaces per-exercise session details (sets / reps / load / RPE) alongside the existing session feedback + session-RPE row. The expander lands on two surfaces:

1. **Staff client profile's "Program" tab.** Phase D (closed 2026-05-11) added a per-session display inside the `DaySummaryPopover` on the `MonthCalendar`. That display currently shows session-level data (feedback, session_rpe) only. Phase L extends it with an expander revealing `exercise_logs` + `set_logs` data.
2. **Staff dashboard's "Recent Activity" section.** Currently a placeholder view ported from prototype HTML — no real data wiring. Phase L builds the section from scratch using the same expander.

Phase I closed 2026-05-13. Phase K (portal per-day card view) closes before Phase L. Phase L runs in the signed-off order K → L → J.

Project root: `C:\Users\scott\Desktop\Client Software Platform` (Windows; bash via Bash tool, PowerShell native).

## Read first, in this order

1. **CLAUDE.md** — project working agreement, design rules, code standards. The session builder + clinical notes adjacency is protected; Phase L does not touch that. Staff-side design system (`.card`, `.btn.primary`, `.eyebrow`, etc.) applies.
2. **`docs/polish/staff-program-session-display.md`** — Phase D gap doc. Documents the existing `DaySummaryPopover` shape Phase L extends. Crucial for understanding the eager-load pattern and the popover-width decisions.
3. **`docs/polish/client-portal.md`** — project state context. §5 follow-ups don't directly touch Phase L but the broader audit trail is useful background.
4. **`src/app/(staff)/clients/[id]/program/_components/MonthCalendar.tsx`** (or equivalent) — Phase D's month-view calendar with the per-day popover.
5. **`src/app/(staff)/clients/[id]/program/_components/DaySummaryPopover.tsx`** (or equivalent) — the existing popover that Phase L extends with the exercise expander.
6. **`src/app/dashboard/page.tsx`** — the staff dashboard route. Find the Recent Activity placeholder during audit.
7. **`dashboard.html`** (root prototype) — the design-intent reference for the dashboard layout. Phase L's Recent Activity should follow the prototype's positioning unless the EP signs off on a different placement.
8. **`src/app/portal/session/[dayId]/complete/page.tsx`** — the existing portal-side "session summary" page. Renders volume / avg RPE / duration from `exercise_logs` + `set_logs`. Phase L's expander renders the same data at finer per-exercise granularity. Useful reference for the data-fetch shape.
9. **`supabase/migrations/*`** — search for `set_logs` and `exercise_logs` to confirm column shapes. Already in use by the completion page.

## Phase L scope

Build a reusable component (working name `SessionExpander` or similar) that:

- Accepts a `session_id` (or a pre-loaded session payload from the parent).
- Shows the existing feedback + session_rpe row (already implemented in Phase D's popover — leave that alone, add the expander beneath it).
- Has a collapsible expander revealing, per completed exercise:
  - Exercise name
  - Set rows: setNumber, reps, load (weight_value + weight_metric, or optional_value), RPE
  - Optional metric (time, distance, e/s) where present
- Toggles via a chevron + click; defaults to collapsed.

Lands in:

- The staff `DaySummaryPopover` (extends Phase D's per-session row, no replacement).
- The dashboard "Recent Activity" section (built from scratch — the existing placeholder gets replaced).

## Decisions to surface BEFORE writing code (gap-doc protocol)

Write a gap doc at `/docs/polish/staff-session-expander.md` before any code change. Surface these questions, get EP sign-off in writing, then implement.

**Q-L1 — Component location.** Where does the shared expander live?
- (a) `src/app/_components/SessionExpander.tsx` (top-level shared between staff routes)
- (b) `src/components/SessionExpander.tsx` (or wherever the project's existing shared components live — audit during gap doc)
- (c) Two separate components — one for popover (compact), one for dashboard (more spacious) — sharing internal sub-components

*Recommend (a) or (b)* depending on the existing shared-component convention in the repo. Audit during gap doc. (c) only if the visual constraints diverge significantly between the two surfaces.

**Q-L2 — Data fetch timing.** Eager (loaded with the parent) or lazy (on expand click)?
- (a) Eager — pre-load with the popover open / Recent Activity item render. Faster expand, more bytes upfront.
- (b) Lazy — fetch on click. Less upfront cost, slower first expand.

*Recommend (a).* Phase D already uses eager loading for the popover (per its gap doc). Consistency wins; per-session data volume is small (one exercise_log + set_logs per exercise; a typical session is 5-7 exercises × 3-5 sets each).

**Q-L3 — Detail level per exercise.**
- (a) Sets / reps / load only — the "what got done" core
- (b) Plus RPE per set
- (c) Plus optional_metric / optional_value (for non-load metrics like time, distance, e/s)
- (d) All of the above

*Recommend (d).* Same data the portal completion page already renders. The expander is the "what did the client log" surface — show all of it.

**Q-L4 — Recent Activity sort + filter.**
- (a) Last 5 completed sessions across all of the EP's clients, sorted by `completed_at DESC`
- (b) Last 7 days of completed sessions
- (c) Last completed session per client (one row per client, deduped to most recent)
- (d) Other

*Recommend (a).* Bounded by count, not time, so the dashboard isn't empty during low-activity stretches. (c) is interesting for the "who's been active lately" framing but harder to scan when one client is hyperactive.

**Q-L5 — Recent Activity row shape.** Each row shows:
- Client name (clickable → client profile)
- Day label (e.g. "Testing", "Day C — Full Body")
- Completion timestamp (relative: "2h ago", "Yesterday", "12 Apr" beyond a week)
- Session RPE + feedback preview (if present)
- Expander revealing per-exercise details

Confirm the surface area during gap doc.

**Q-L6 — Recent Activity placement on the dashboard.** The existing placeholder sits somewhere on the dashboard. Does its current position match where it should live, or does Phase L reposition?

Audit and present options in gap doc.

**Q-L7 — Empty state.** When the EP has no recent completed sessions (new install, holiday stretch, no clients yet):
- (a) Hide the Recent Activity section entirely
- (b) Show the section with an empty-state card ("No recent activity. Sessions completed by your clients will show here.")
- (c) Show with a CTA to the client list or program calendar

*Recommend (b).* The dashboard's layout shouldn't shift based on data presence; the empty state is informative.

**Q-L8 — Performance bound.** With (a) "last 5 completed sessions" eager-loading per row including set_logs, the dashboard makes a fan-out query. Acceptable now (pre-launch, low data volume); plan a SECURITY DEFINER RPC if it grows.

Audit query plan during gap doc.

## Working norms (non-negotiable, inherited from project memory)

- Polish-pass protocol — gap doc at `/docs/polish/staff-session-expander.md` before any code. EP signs off on gap analysis.
- Staff-side design system primitives (`.card`, `.btn.primary`, `.eyebrow`, `.tag`, `.chip`) — staff is desktop-first. Don't reach for portal-side `.portal-*` primitives.
- User is an EP in Australia, not a developer. Plain language, Australian English.
- Prefix any user-facing PowerShell with `cd "C:\Users\scott\Desktop\Client Software Platform"`. Use `;` not `&&` (Windows PowerShell 5.1).
- No local Docker. Audit live DB via SQL Editor or `supabase gen types` against remote.
- Use port-3000 dev server only — never spin up new previews from worktrees.
- Schema/migration push correctness if Phase L lands an RPC (Q-L8).
- The session builder + clinical notes adjacency is protected. Phase L touches the `MonthCalendar` / `DaySummaryPopover` and the dashboard — not the session builder.
- Calendar stays pristine — completions live on the client profile. The DaySummaryPopover already exists from Phase D as the right surface for completion data; Phase L extends it, doesn't relocate.
- Use `Edit` over `Write` for existing files. Never commit without explicit EP sign-off.

## Coordination notes

- Phase L runs after Phase K closes (signed-off order K → L → J, 2026-05-13).
- Phase F (booking) runs in parallel chat. Phase L doesn't touch booking surfaces.
- Phase D's `DaySummaryPopover` is the existing surface to extend. **Don't replace it wholesale** — augment with the expander beneath the existing feedback + session_rpe row.
- The dashboard "Recent Activity" is currently placeholder HTML — Phase L replaces, doesn't extend. Audit what's there before designing the replacement.

## Acceptance bar

- The staff `DaySummaryPopover` for a completed session shows the existing feedback + session_rpe row PLUS an expandable per-exercise summary (collapsed by default).
- Expanding reveals each exercise with its sets (setNumber, reps, load, RPE, optional metric).
- The dashboard Recent Activity section renders real data: the agreed sort/filter (per Q-L4), each row showing client + day + completion time + the same expander.
- Empty-state behaviour matches Q-L7 sign-off.
- `npm run build` passes clean.
- Gap doc `/docs/polish/staff-session-expander.md` captures EP sign-off on Q-L1..Q-L8.
- Phase L row added to `/docs/polish/client-portal.md` §4 table marked ✓ with closure date.

## End-of-phase output

When the work is done:

- Phase L row in §4 marked ✓ with closure date.
- Files changed list with 1-line summary each.
- Screenshots of both expander surfaces (DaySummaryPopover + dashboard Recent Activity, collapsed + expanded each).
- Any deferred items surfaced during implementation tracked in §5.
- Suggested next polish phase. Per signed-off order, that's Phase J (Data-tab redesign per existing §4 row).

Wait for explicit EP sign-off on Q-L1..Q-L8 before writing code. Wait for explicit EP sign-off on any commit.
