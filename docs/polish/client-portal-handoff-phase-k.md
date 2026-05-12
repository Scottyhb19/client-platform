# Phase K handoff — Portal per-day card view

You're picking up the Odyssey project's client-portal polish pass at Phase K: unify the per-day card UI across every day in the portal's week strip. Currently only "today" gets the rich card view (exercise list + state-appropriate CTA at the bottom). Tapping any other day's strip cell sends the client straight to a Logger URL — jarring and inconsistent. Phase K makes the card the canonical surface for every day with a programmed session.

Phase I closed 2026-05-13 with the polish doc §4.5 + §4.5.1 capturing the I-R1..R5 regression fixes that surfaced during pre-flight verification (week-strip indexing fix, completed-day CTA, v3 RPC backstop, page-level completion guard). Phase K is the next sequential polish phase, signed off as K → L → J on 2026-05-13.

Project root: `C:\Users\scott\Desktop\Client Software Platform` (Windows; bash via Bash tool, PowerShell native).

## Read first, in this order

1. **CLAUDE.md** — project working agreement, design rules, code standards. Especially the polish-pass protocol and the "core differentiator — protect it" note (Phase K doesn't touch the session builder, but the design system rules apply throughout).
2. **`docs/polish/client-portal.md`** — gap-analysis contract. §4 table for the phase plan; §4.5 + §4.5.1 for the just-closed Phase I context (the week-strip indexing fix + completed-day CTA + RPC backstop directly inform Phase K's URL design). §5 for the still-open strip-cell routing follow-up on future + skipped-past days — these are exactly the cases Phase K must handle.
3. **`src/app/portal/page.tsx`** — server-side Today page. Builds the week strip from `client_get_week_overview` RPC + `completedDayIds` Set; renders `TodayScreen`. Phase K extends this to render a *selected* day (today by default, navigable via query param to other days).
4. **`src/app/portal/_components/TodayScreen.tsx`** — client component. Strip cells are currently `<Link>`s to `/portal/session/[dayId]` — that's what Phase K changes. Includes the conditional CTA from I-R3.
5. **`src/app/portal/_lib/portal-helpers.ts`** — `buildWeekDots` + the canonical `weekdayIndex` helper. Phase K may extend `buildWeekDots` to encode the new states (skipped-past distinct from done; future-scheduled distinct from upcoming).
6. **`src/app/portal/session/[dayId]/page.tsx`** — the Logger entry. Has the I-R5 completion guard. Phase K should NOT remove it — it stays as a defence-in-depth fallback for any URL that bypasses the new card surface.
7. **`src/app/portal/session/[dayId]/actions.ts`** — `startOrResumeSessionAction`. Phase K reuses this from a "Begin session" / "Resume session" CTA on the card.
8. **`supabase/migrations/20260510140000_client_get_week_overview.sql`** — the RPC that fetches a week's data. May need extension if the new card view wants richer per-day data than the current RPC populates.
9. **`supabase/migrations/20260510130000_client_start_session_v2.sql`** + **`20260513120000_client_start_session_v3.sql`** — start-session RPC + v3 defence-in-depth refusal.

## Phase K scope

Make every strip cell with a programmed session route to a card view (**not** the Logger URL). The card shows:

- Day header (date + day_label)
- Full exercise list (same format as today's card today)
- A state-appropriate CTA at the bottom

CTA states (locked decisions, 2026-05-13):

| State | Card CTA | Action |
|---|---|---|
| Today, not started | "Begin session" | → `/portal/session/[dayId]` |
| Today, in progress | "Resume session" | → `/portal/session/[dayId]` (Logger hydrates from existing logs) |
| Today, completed | "Session complete · view summary" | → `/portal/session/[dayId]/complete` |
| Past, completed | "View summary" | → `/portal/session/[dayId]/complete` |
| Past, skipped (programmed, not completed) | inert "Past — not completed" | no button |
| Future, scheduled | "Scheduled for [day name, date]" + "Begin session early" button | soft confirm → reschedule + start |

Future-day "Begin session early" soft confirmation copy (EP-locked verbatim, 2026-05-13):

> "Are you sure you want to move this session to today, it will no longer be available to complete on this day?"

On confirm: the program_day's `scheduled_date` moves to today, the future date no longer holds this session, the session starts. The implementation mechanics for this move need a design call — see Q-K3 below.

## Decisions to surface BEFORE writing code (gap-doc protocol)

Write a gap doc at `/docs/polish/client-portal-day-card.md` before any code change. Surface these questions, get EP sign-off in writing, then implement.

**Q-K1 — URL structure for the selected day.**
- (a) Same `/portal` route with a `?d=YYYY-MM-DD` query param. Today is default; strip cell sets the param.
- (b) New `/portal/day/[dayId]` route. `/portal` stays "today."
- (c) Other.

*Recommend (a).* Cleanest — same hero, week strip, "this week" stats stay visible. Just the card swaps. Single source of truth for "the day card."

**Q-K2 — Component naming.** `TodayScreen` will represent "selected day," which is often not today.
- (a) Rename to `DayScreen`. Update all references.
- (b) Keep `TodayScreen` (the URL is still `/portal` which is conceptually "today's page").
- (c) Other.

*Recommend (a).* Component name should match what it renders.

**Q-K3 — Future-day "Begin session early" mechanics.** The soft confirmation copy says "it will no longer be available to complete on this day" — that semantic implies the future date disappears. Three implementations:
- (α) Add a new RPC (e.g. `client_reschedule_program_day_to_today`) that moves `program_days.scheduled_date` to today, then starts a session. Future date disappears. Simple but destructive to EP scheduling.
- (β) Create a new program_day with `scheduled_date = today`, cloned from the future one (exercises, day_label). Future day stays put. More schema activity (new row, possibly linked via `source_program_day_id` for audit) but preserves EP's plan.
- (γ) Keep the future program_day where it is, start a session with `started_at = now()`. Schema-trivial; potentially confusing on the staff calendar where "completed today" doesn't match "scheduled Thursday."

*Recommend (α)* given the EP's confirmation copy explicitly says the future date will no longer hold the session. But surface the trade-off and let the EP confirm in the gap doc.

**Q-K4 — Past-skipped visual treatment.** The card for "Past — not completed":
- (a) Muted/grey card + plain message
- (b) Clinical-flag banner pattern (red 3px left border + alert background)
- (c) New dedicated `state: 'skipped'` in `buildWeekDots` + a `.portal-card.is-skipped` variant

*Recommend (a).* The clinical-flag banner is reserved for clinical flags (per CLAUDE.md design rules). Skipped sessions are an observation, not clinically alarming.

**Q-K5 — Week strip dot semantics.** Now that `buildWeekDots` has richer states (today/completed/skipped/upcoming/future), should the dot encode more?
- (a) Keep current — single dot = "session here"
- (b) Differentiate by colour/shape — green = completed, accent = today/upcoming, hollow = skipped past
- (c) Other

*Recommend (a).* The card surface carries the state; the strip dot stays at-a-glance "session here." Adding colour to the strip would be visual noise.

**Q-K6 — Data coverage.** `client_get_week_overview` returns exercise summaries for every day in the week. Audit before writing: is the data shape sufficient for the new card view, or does the RPC need extension?

**Q-K7 — Strip cell tap target.** Currently the strip cell is a `<Link>` for programmed days and a `<button>` for rest days (the rest-day button just updates client-side selection). Should rest-day cells also become Links to the rest-day "no session today" view?
- (a) Yes — every cell tap navigates somewhere
- (b) No — rest-day cells stay client-side inert (current behaviour)

*Recommend (b).* Rest days have nothing to show.

## Working norms (non-negotiable, inherited from project memory)

- Polish-pass protocol — gap doc at `/docs/polish/client-portal-day-card.md` before any code. EP signs off on gap analysis before implementation begins.
- The session builder + clinical notes adjacency is protected. Phase K does **not** touch `/clients/[id]/program` (staff side) or any session-builder surface. Portal-side only.
- User is an Exercise Physiologist in Australia, not a developer. Plain language, Australian English. Walk through decisions clearly.
- Prefix any user-facing PowerShell with `cd "C:\Users\scott\Desktop\Client Software Platform"`. Use `;` not `&&` (Windows PowerShell 5.1 doesn't have `&&`).
- No local Docker. Don't try `supabase db reset` / `supabase test db`. Audit live DB via SQL Editor or `supabase gen types` against remote.
- Use port-3000 dev server only — never spin up new previews from worktrees. EP runs their own dev server.
- Schema/migration push correctness — if Q-K3 lands on (α) or (β), the migration → `supabase db push` → type regen → verify chain applies.
- Calendar stays pristine — completions live on the client profile. (Stated for safety; Phase K is portal-side only.)
- The Library + Notes + Reports adjacency in the session-builder right panel is protected. (Stated for safety.)
- Use `Edit` over `Write` for existing files. Never commit without explicit EP sign-off.

## Coordination notes

- Phase K is the next sequential polish phase after Phase I. Phase L (staff-side + dashboard completed-session expander) is queued after Phase K per the EP's signed-off order (K → L → J).
- Phase F (booking) runs in a parallel chat. Phase K must **not** touch `BottomNav`, `/portal/book`, or any booking surfaces.
- The I-R5 page-level completion guard in `/portal/session/[dayId]/page.tsx` + the v3 `client_start_session` RPC backstop both stay in place. Phase K's card view is the friendly path; both backstops remain for any URL that bypasses the card.
- If Q-K3 lands on (α), the new `client_reschedule_program_day_to_today` RPC needs SECURITY DEFINER + auth.uid() pinning + an audit-log register entry (per the `audit_register_new_tables` project memory).

## Acceptance bar

- Tapping any strip cell with a programmed session lands on the per-day card view (**not** the Logger directly).
- All six CTA states render correctly per the table above.
- Future-day "Begin session early" soft confirmation copy matches the EP-locked wording verbatim.
- `npm run build` passes clean.
- The gap doc `/docs/polish/client-portal-day-card.md` captures EP sign-off on Q-K1..Q-K7 before any code change.
- Phase K row added to `/docs/polish/client-portal.md` §4 table marked ✓ with closure date.

## End-of-phase output

When the work is done:

- Phase K row in §4 marked ✓ with closure date.
- Files changed list with 1-line summary each.
- Test result for each of the six CTA states (ideally with screenshots).
- Any deferred items surfaced during implementation tracked in §5.
- Suggested next polish phase + handoff text. Per signed-off order, that's Phase L (handoff in `client-portal-handoff-phase-l.md`).

Wait for explicit EP sign-off on Q-K1..Q-K7 before writing code. Wait for explicit EP sign-off on any commit.
