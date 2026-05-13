# Phase H handoff — Today week stats wire-up + Files→Reports rename

Copy everything between the `---` rules below (including the fenced code block) into the first message of a new chat.

The prompt is self-contained — a fresh Claude instance with no prior context can act on it cold.

---

You're picking up the Odyssey project's client-portal polish pass at Phase H: wire "completed this week" to real session data, and rename the portal Reports sub-tab "Files" → "Reports". Phase G (legacy reports clickable) closed at commit `2de2948` on master. Phase H closes gap item C2 in `docs/polish/client-portal.md` and adds the Files→Reports rename agreed with the EP in chat 2026-05-12.

Project root: C:\Users\scott\Desktop\Client Software Platform (Windows; bash via Bash tool, PowerShell native).

Read first, in this order:

1. `CLAUDE.md` — project working agreement, design rules, code standards. Especially the polish-pass protocol, mobile-first PWA rules, "configuration read at runtime" rule, and the Australian English / sentence case / quiet-clinician voice rules.
2. `docs/polish/client-portal.md` — gap-analysis contract. §0.1 sign-off log row C2 (locked: "Keep — wire to sessions table"); §2.C row C2; §4 row H (this phase); §4.3 Phase G section for the rename-discussion context.
3. `src/app/portal/page.tsx` — the server component for `/portal`. Specifically:
   - Lines ~99-110: `programmedByWeekday` map where `done: false` is hardcoded.
   - Line ~147: `weekStats.completed: 0, // wires to sessions table`.
   - Line ~148: `remaining: weekDays.length - 0` — uses the same hardcoded zero.
   - Lines ~78-93: existing `client_get_week_overview` RPC call returns the program_day_ids for the week — the input to the sessions query.
4. `src/app/portal/_components/TodayScreen.tsx` — consumer of `weekStats` and `weekDots`. Confirm the shape `done` boolean flows through correctly.
5. `src/app/portal/reports/_components/ReportsTabs.tsx` — the tab switcher. Currently `label: 'Files'`, `href: '/portal/reports?tab=files'`. This is the rename target.
6. `src/app/portal/reports/page.tsx` — parses `?tab` query param to decide which view to render. The active discriminator is `sp.tab === 'files'`. If you change the URL param (Q4 below), this needs an update too.
7. `docs/schema.md` — `sessions` table definition. Confirm columns: `id`, `client_id`, `program_day_id`, `started_at`, `completed_at`, `deleted_at`. The RLS policy on `sessions` allows clients to SELECT their own rows.
8. The current `sessions` table in the live DB — confirm column names match docs via `src/types/database.ts` (search for `sessions: {`).

Phase H scope (two related changes — one functional, one cosmetic):

**Part 1 — Wire weekStats.completed + per-day done flag (gap C2):**

1. Add a SELECT on the `sessions` table in `portal/page.tsx` after `weekDays` is populated.
2. Filter: `program_day_id IN (weekDays' program_day_ids)`, `completed_at IS NOT NULL`, `is('deleted_at', null)`. RLS scopes to caller's own sessions.
3. Build a Set of completed `program_day_id`s.
4. Set `programmedByWeekday[dow].done = true` for any day in the set.
5. Set `weekStats.completed` to the set size.
6. Update `weekStats.remaining` to `weekDays.length - completed` (or use a clearer derivation).

**Part 2 — Rename portal Reports sub-tab "Files" → "Reports" (EP request 2026-05-12):**

Surfaced during Phase G sign-off — the portal Reports surface has a "Files" sub-tab that pulls from the `reports` table. Naming clashes with the staff client profile's "Files" tab (which is unrelated — it's `client_files`). Decision: rename portal sub-tab to "Reports" so the surface reads as Reports (top) → Your data / Reports (sub).

Decisions to make BEFORE writing code (surface in the gap doc and wait for sign-off):

**Q1 — Where to query the sessions count from?**

* **(a)** Direct RLS-scoped SELECT on `sessions` in `portal/page.tsx`. One extra round-trip; `.in('program_day_id', ids).not('completed_at', 'is', null).is('deleted_at', null)`.
* **(b)** New SECURITY DEFINER RPC `client_get_week_completion_summary(p_week_start date)` joined to the existing week-overview pattern. Cleaner contract; adds a migration.

Recommend (a) — Phase H is meant to be zero-migration per the gap-doc dependency column. The existing pattern in `portal/page.tsx` already uses direct RLS-scoped SELECTs (for `clients`, `programs`); a `sessions` SELECT fits the same posture. Promote to an RPC only if perf becomes an issue.

**Q2 — What counts as "completed"?**

* **(a)** `completed_at IS NOT NULL` (and not soft-deleted). Schema-level definition.
* **(b)** Stricter: `completed_at IS NOT NULL AND EXISTS (set_log for this session)`. Filters out "started, ended without data" sessions.

Recommend (a) — matches how the staff side counts completion (per `MonthCalendar` / `DaySummaryPopover` work in Phase D). If "completed with no sets" sessions slip through, that's a Logger bug, not a count bug.

**Q3 — Per-day `done` semantics**

Current shape:
```ts
{ dayLabel: string | null; done: boolean; dayId: string | null }
```

* **(a)** Keep `done: boolean`. Set `true` if a completed session exists for that program_day_id.
* **(b)** Expand to tri-state: `state: 'programmed' | 'done' | 'upcoming'`. More expressive but breaks `buildWeekDots` and any other consumer.

Recommend (a) — `buildWeekDots` (in `portal/_lib/portal-helpers.ts`) and `TodayScreen` already treat `done` as a boolean. Don't grow the shape for this phase.

**Q4 — Tab rename: UI label only, or URL param too?**

Current state: `label: 'Files'`, `href: '/portal/reports?tab=files'`, parse logic `sp.tab === 'files'`.

* **(a)** UI label only — change `label: 'Files'` → `label: 'Reports'`. URL stays `?tab=files`. Smallest change; URL deep-links from any old chats / bookmarks continue to work.
* **(b)** Both — change UI label AND the search param to `tab=reports`. Requires:
  - `ReportsTabs.tsx`: update `key` enum, `label`, `href`.
  - `page.tsx`: update the `ActiveTab` type + the `sp.tab === 'files'` check.
  - Audit `grep -r "tab=files"` for any other references (the Phase G route handler at `/portal/reports/file/[id]` doesn't read it, so it's unaffected).

Recommend (b) — pre-launch, the URL is rewritable without cost. Consistent naming reduces future confusion. Cost is ~3 small edits + a grep.

**Q5 — Label for the OTHER sub-tab ("Your data")**

Currently `label: 'Your data'`. After rename, the pair is `Your data` + `Reports`. Options:

* **(a)** Keep `Your data` — pairs nicely with `Reports`, voice match (Australian, sentence case, client-friendly).
* **(b)** Change to `Data` for symmetry with `Reports`. Shorter but loses voice.
* **(c)** Change to `Latest` (since it shows latest test results). Different framing.

Recommend (a) — `Your data` is the client-friendly framing already established. Don't break voice for symmetry.

Implementation requirements:

A. **RLS unchanged.** `sessions` already has a SELECT-own policy. Don't bypass; don't add a SECURITY DEFINER unless Q1=(b).
B. **No new design-token violations.** Verify via:
   ```
   grep -nE "'#[0-9a-fA-F]{3,8}'|borderRadius: [0-9]+|boxShadow:" src/app/portal/
   ```
   Should be zero new matches after Phase H.
C. **Empty-program edge case.** If a client has no active program (the `program` lookup in `page.tsx` returns null), `weekDays` is `[]`. The sessions SELECT should not error on an empty `.in()` list — either skip the query entirely, or pass `['']` (Supabase tolerates) — but verify behaviour. The completed count should be 0, not crash.
D. **No schema migration.** Phase H is zero-migration. If you find yourself drafting one, stop and re-read the gap doc — promote to an RPC only if Q1=(b) is signed off.
E. **No service worker changes.** B3 stays v1 no-op.
F. **Voice & copy.** For any new strings (e.g. if you add a "no sessions completed" hint), sentence case, Australian English, factual not dramatised.
G. **Don't touch BottomNav.** Phase F (booking) is in a parallel chat and owns BottomNav inline-style refactors.
H. **Don't overlay completion state on the calendar** — per project memory: completions live on `/clients/[id]?tab=program` right panel, not on `/clients/[id]/program`. The portal `/portal/page.tsx` Today screen and `/portal/program` calendar are the SAME constraint — the per-day `done` flag on the week strip is fine (already in the shape), but don't bleed completion state into the program calendar view in Phase H. That's a separate decision.

Acceptance bar:

1. From `localhost:3000/portal`, the "completed this week" stat shows the actual count of completed sessions for the current week (not 0).
2. The per-day week-strip dots reflect completed days correctly (done=true for any program_day_id that has a completed, non-soft-deleted session).
3. With no completed sessions this week, the count is 0 and no day is marked done (graceful zero, not crash).
4. `localhost:3000/portal/reports?tab=files` (or `?tab=reports` if Q4=(b)) renders the legacy reports list, sub-tab labelled "Reports".
5. `npm run build` passes.
6. The grep above returns zero new violations.
7. Polish doc `docs/polish/client-portal.md` §4.4 Phase H section added with the five decision answers and a one-line summary of what shipped.

Working norms (non-negotiable, inherited from project memory):

* **Polish-pass protocol** — gap doc is the contract. Write a §4.4 Phase H section (similar to §4.3 Phase G) with the five decision answers BEFORE writing code. Wait for EP sign-off.
* **No guessing.** For each decision above, present 2-3 options with a recommendation and wait.
* User is an Exercise Physiologist in Australia, not a developer. Plain language, Australian English. Walk through verification steps in plain English — they don't know browser dev terminology.
* Prefix any user-facing PowerShell with `cd "C:\Users\scott\Desktop\Client Software Platform"`. Use `;` not `&&` (Windows PowerShell 5.1 doesn't have `&&`).
* No local Docker. Don't try `supabase db reset` or `supabase test db`. Audit live DB via the SQL editor or `supabase gen types` against remote.
* Use port-3000 dev server only — never spin up new previews from worktrees. EP verifies on their existing `localhost:3000`.
* If `preview_start` would be blocked by the EP's running `next dev`, proactively offer `taskkill /PID <X> /F` so verification can proceed.
* Prefer Edit over Write for existing files.
* The Library + Notes + Reports adjacency in the session-builder right panel is protected — don't touch.
* Calendar stays pristine — completions live on the client profile, not the calendar. Per-day `done` on the week strip is fine; bleeding completion state into the `/portal/program` calendar view is not Phase H scope.

Coordination notes:

* Phase H is independent. Phase G (commit `2de2948`) just landed on master. Pull/fast-forward before starting.
* Phase F (booking) runs in a parallel chat — don't touch BottomNav, `/portal/book`, or booking surfaces.
* Phase I (manual resume test) runs last per the gap doc table.
* Phase J (Data-tab redesign — `?tab=data` collapsible battery/test/metric view with baseline/previous toggle) was opened as gap §2.E and phase row J in Phase G. Phase H does not touch Phase J's surface; just don't break it.
* The EP will wire up the legacy Cowork-skill report render flow later (their option (a) from Phase G sign-off). The `reports` Storage bucket is still missing from migration history — out of scope for Phase H but worth flagging in deferred items.

End-of-phase output: When the work is done:

* Files changed (paths + 1-line summary each).
* Verification recipe the EP can run on their `:3000` (plain English, no DevTools assumed).
* Updated polish doc with Phase H decisions locked and items closed.
* Any deferred items.
* Suggested next polish phase + handoff text (probably Phase I — manual resume test, since J is its own gap doc effort).

Wait for explicit user sign-off before committing or stopping.

Confirm you've read the documents above and present the five decisions (Q1 query source / Q2 completion definition / Q3 per-day shape / Q4 URL-param scope / Q5 other-tab label) before writing any code.
