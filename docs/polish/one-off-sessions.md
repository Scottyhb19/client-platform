# Polish doc — block-less / one-off sessions (item 3)

**Status: IMPLEMENTED 2026-06-25 — awaiting section sign-off.** Gap list approved
by the owner 2026-06-25 (auto loose container; Q-A = `is_loose` column, Q-B =
"Your sessions", Q-C = fix the general multi-active bug). **G3-1..G3-8 all
closed** (G3-7 — copy/repeat fallback — closed 2026-06-25 in the review
walkthrough, migration `20260625130000`). See the **Closing commit** at the
bottom — paste it into the claude.ai review chat for the sign-off.

Capture (2026-06-25): *"Within the programs tab of the client profile you should
be able to go to the calendar without needing a block. A block should not be
necessary to opening the calendar and you should be able to create one-off
sessions."*

Triage: **structural** (touches the data model + a new portal-visibility path) →
re-enters the seven-step polish protocol per CLAUDE.md "Current operating mode".
Owner approach decision (2026-06-25): **auto loose container** — one-off sessions
attach to a per-client hidden container "program" when no dated block covers the
date; the calendar renders with no block; behaviour is unchanged when a dated
block *does* cover the date.

---

## §1 — Brief alignment

- §6.2 (program calendar) is "prescription + scheduling". Nothing in the brief
  *requires* a block to exist before a day can be scheduled — the block is the
  current implementation's container, not a brief mandate.
- The "60-second adjustment" design-philosophy line is the motivator: forcing a
  4–8 week block-creation wizard before a single ad-hoc session can be programmed
  fails it.
- Constraint that does *not* move: a one-off session published to the portal is
  still real client-visible health-adjacent data. It rides the same RLS/audit
  perimeter as any other program_day. The container must be a first-class,
  org-scoped `programs` row — **not** a NULL-`program_id` escape hatch.

## §2 — Audit (what exists today)

| Surface | Current state | Relevance |
|---|---|---|
| `program_days.program_id` | **NOT NULL** direct FK → `programs`, CASCADE. RLS + cross-org triggers + audit resolver all walk this single hop (`schema.md` 143/521). | A truly block-less day is a security-surface change — **rejected** in favour of the container. |
| `create_program_day(p_client_id, p_target_date)` RPC | Resolves the program via `_program_for_date`; returns `{status:'no_program'}` when no dated block covers the date (migration `20260504100000`). | The exact gate that blocks one-off creation. Needs a container fallback. |
| Calendar loader `program/page.tsx` | Fetches active programs **filtered to `start_date !== null && duration_weeks !== null`**; renders `EmptyProgram` (block-creation wall) when `programs.length === 0`. | A null-date container is filtered out today; the empty-state wall is item 3's visible symptom. |
| `resolveCurrentBlock` / `findCoveringProgram` | Key off `start_date` + `duration_weeks`. | Must treat the container as "no covering block" (it has no date range). |
| Portal `portal/page.tsx` | `program` via **`.maybeSingle()`** on `status='active'` (throws on ≥2 active rows); the week overview runs **only `if (program)`**. | **Primary hazard.** A container as a 2nd active program breaks `.maybeSingle()` when a real block also exists. (This is already a latent D-PROG-002 bug — multiple active blocks would trip it too.) |
| `client_get_week_overview(week_start)` RPC | **Client-scoped** (`c.user_id = auth.uid()`, joins through `programs`, `p.status='active'`, `published_at IS NOT NULL`). Does **not** filter by a single program_id. | Good news: container published days surface here automatically — *if* the portal page actually calls it (see hazard above) and the container is `status='active'`. |
| Audit resolver / RLS on `programs` | `programs` already registered + RLS'd. | A container is a normal `programs` row → **no new RLS/audit surface**. |

**Net:** the container is viable with **no change to the RLS/audit security
boundary**, but it is not "free" — it touches the create RPC, the calendar
loader + empty state, and (critically) the portal's single-active-program
assumption.

## §3 — Premortem (ranked by likelihood × blast radius)

1. **FM-1 — portal `.maybeSingle()` throws.** Client has a real active block **and**
   a loose container (both `status='active'`) → `portal/page.tsx` line ~58 throws,
   white-screening the client's home. *High likelihood the moment a programmed
   client also logs one ad-hoc session.* **P0.**
2. **FM-2 — loose days invisible in the portal.** Even after FM-1, the week
   overview only runs `if (program)`. If the container resolution leaves `program`
   null, published loose days never render for the client. **P0.**
3. **FM-3 — container leaks into the UI as a "block."** "Active" tag, block-count
   eyebrow, current-block descriptor, "N blocks total" all start counting the
   container → the EP sees a phantom block. **P1.**
4. **FM-4 — duplicate containers.** Two tabs / races create two containers per
   client → days scatter across them. Needs a single-container guarantee
   (unique partial index or get-or-create in one statement). **P1.**
5. **FM-5 — calendar can't render a container's days.** Loader filters null-date
   programs out, so even created loose days wouldn't paint on the grid. **P1.**
6. **FM-6 — month range / week ops on a date-less container.** Copy/repeat/week
   ops + the visible-month computation assume dated blocks; a container has no
   range. Low harm (ops are date-keyed, not program-keyed) but needs a pass. **P2.**
7. **FM-7 — empty calendar with zero programs has no "add" affordance.** With the
   `EmptyProgram` wall replaced, a no-block client needs the month grid + a clear
   way to click a date and create. **P1.**

## §4 — Gap list (the contract)

### P0 — architectural (must close first)
- **G3-1 — container model + single-container guarantee.** Decide the
  distinguishing mechanism (see §5 Q-A) and add a get-or-create that cannot
  duplicate (unique partial index on the loose flag per `client_id`). Migration.
  Closes FM-4.
- **G3-2 — `create_program_day` container fallback.** `CREATE OR REPLACE` (no DROP
  — the deployed master still calls it; memory `feedback_no_drop_deployed_in_use_function`)
  so that a `no_program` resolution falls back to the get-or-create container.
  Returns `created` instead of `no_program`. pgTAP. Closes the core ask.
- **G3-3 — portal multi-active-program fix.** Replace `.maybeSingle()` with an
  ordered `limit(1)` for header context **and** decouple the week-overview call
  from `if (program)` so the client-scoped RPC always runs. Closes FM-1 + FM-2,
  and the latent D-PROG-002 bug. pgTAP/scenario for "block + loose coexist".

### P1 — functional
- **G3-4 — calendar renders with no dated block.** Replace the `EmptyProgram` wall:
  show the month grid (anchored on today) whenever the client has *any* program
  including the container, or even none. Closes FM-7.
- **G3-5 — include container days in the loader without treating it as a block.**
  Surface container days on the grid; exclude the container from `resolveCurrentBlock`,
  the "Active" tag, block-count, and the current-block eyebrow. Closes FM-3 + FM-5.
- **G3-6 — empty-cell "Add session" works with no block.** `EmptyCellPopover`
  currently says "No active training block covers this date"; with the fallback it
  offers "Add one-off session" on any in-month date.

### P2 — polish
- **G3-7 — copy/repeat/week-op pass over container days** (FM-6): confirm date-keyed
  ops behave; a container day copied onto a dated-block date should attach to the
  block (existing `_program_for_date` precedence), and onto a bare date should stay
  loose.
- **G3-8 — voice/label** for the loose surface (what the portal header shows when a
  client has only one-off sessions and no named block).

## §5 — Open design decisions (need answers before I write G3-1)

- **Q-A — how to distinguish the container.** (i) **A new `programs.is_loose boolean
  NOT NULL DEFAULT false` column** — explicit, unambiguous, keeps the special-casing
  greppable (recommended); or (ii) a NULL-`start_date` sentinel + reserved name —
  no schema column but fragile and collides with user-made open-ended blocks.
- **Q-B — portal header when only loose sessions exist.** The header currently shows
  `program.name`. For a loose-only client, show what? (e.g. the client's name / "Your
  sessions" / nothing). Affects G3-8.
- **Q-C — scope of the portal multi-active fix (G3-3).** Fix it narrowly for the
  container case, or fix the general latent D-PROG-002 `.maybeSingle()` bug at the
  same time (recommended — same code, closes a real pre-existing hazard)?

## §6 — Out of scope (refused / deferred)
- NULL-able `program_id` (security-surface change; rejected per §2).
- Any change to the RLS policies or audit resolver (container is a normal program).
- Migrating the existing 40–50 Cliniko clients (unchanged — f&f beta only).

## §7 — Test plan (maintenance rule)
- pgTAP: `create_program_day` returns `created` (not `no_program`) on a bare date;
  exactly one container per client under concurrent calls; container days are
  org-scoped under RLS.
- `test_scenarios_template.md`: (a) no-block client opens calendar → month grid,
  not the wall; (b) click bare date → one-off created → opens session builder;
  (c) publish loose day → appears in portal week strip alongside a real block;
  (d) portal does not throw when a real block + loose sessions coexist.

---

## Closing commit (2026-06-25)

**What changed (gap items closed)**
- **G3-1 / G3-2 — migration `20260625120000_loose_one_off_sessions.sql`.** Adds
  `programs.is_loose boolean NOT NULL DEFAULT false` + the partial unique index
  `programs_one_loose_per_client_idx` (one live container per client). Rewrites
  `create_program_day` (CREATE OR REPLACE, no DROP, signature unchanged) so a
  date no dated block covers falls back to a get-or-created loose container
  (inlined, race-safe via `ON CONFLICT`; **no new public function → no new
  anon-EXECUTE surface**). A dated block still wins on covered dates. Pushed to
  the linked DB; types regenerated.
- **G3-3 — `src/app/portal/page.tsx`.** Replaced the `.maybeSingle()` (which
  **throws on ≥2 active programs** — the FM-1 white-screen) with fetch-all +
  resolve: the dated block covering today, else the first dated block, else the
  loose container. Also closes the latent D-PROG-002 multi-block bug. Header
  reads "Your sessions" for a loose-only client (Q-B).
- **G3-4 / G3-5 — `src/app/(staff)/clients/[id]/program/page.tsx`.** Loader selects
  `is_loose`; the dated-blocks array excludes the container (so it never reads as
  a block — current-block, "Active" tag, block count all ignore it); days load
  for ALL active programs so one-offs render on the grid. The `EmptyProgram` wall
  is replaced by a slim `NoBlockHint` — the calendar always renders; block
  creation stays available via the always-present toolbar "New training block".
- **G3-6 / G3-8 — `MonthCalendar.tsx`.** The empty-cell popover offers "Add
  one-off session" on any date (no covering block required); copy reads "A one-off
  session, not part of a training block".

**Acceptance tests**
- `npm run type-check` — clean.
- `eslint` on touched files — zero new findings (3 pre-existing `set-state-in-effect`
  + 1 pre-existing unused-param warning, none introduced here).
- **pgTAP `44_loose_one_off_sessions.sql` — 5/5 PASS on the live DB** (A1 created
  on a bare date; A2 exactly one container; A3 one-off attaches to container; A4
  second one-off reuses it, no duplicate; A5 a covered date attaches to the block).
- Verified by reading: the portal session page (`session/[dayId]`) loads a day by
  id under RLS + a client-pinned exercises RPC — a published one-off opens and
  logs with no change; `weekNumberFor` already null-guards `start_date`.

**Premortem failure modes**
- Mitigated: FM-1 (portal `.maybeSingle()` throw → fetch-all+resolve), FM-2 (loose
  days invisible → client-scoped week-overview already returns them; portal now
  always resolves a program when one exists), FM-3 (container-as-block → excluded
  from every block surface), FM-4 (duplicate containers → unique index +
  get-or-create, A2/A4), FM-5 (container days unrenderable → days load for all
  active programs), FM-7 (no empty-calendar add path → NoBlockHint + empty-cell CTA).
- Accepted / deferred: FM-6 (date-less container in date-keyed ops) folds into G3-7.

**G3-7 — CLOSED (migration `20260625130000`, review walkthrough 2026-06-25).**
Originally deferred P2; the owner hit it (copy/repeat onto a block-less date said
"needs to be within a block"). The loose-container fallback now spans **every**
copy/repeat path — `copy_program_day`, `repeat_program_day_weekly`,
`copy_program_week`, `repeat_program_week` (and `duplicate_program_day`). The
get-or-create logic was lifted into one internal helper
`_get_or_create_loose_program` (REVOKE anon+authenticated; called only by the
guarded SECURITY DEFINER RPCs) that `create_program_day` now also routes through.
Resolution everywhere: a dated block covering the date wins, else the loose
container — so `no_program` / `no_program_dates` are now unreachable. Repeat/week
ops use the EXISTING container in the conflict-scan pass (no create on a
cancelled confirm) and get-or-create in the apply pass. No frontend change: the
RPCs return `created` instead of `no_program`, so the calendar's copy/repeat
flows just work and the old "no active block" dialog paths are dead. Verified by
**pgTAP `45_loose_copy_repeat.sql` — 6/6 on the live DB** (all four paths land on
the container on block-less dates; repeat reports zero skipped), and pgTAP `44`
re-run 5/5 (the `create_program_day` refactor is regression-free).

**Revision (review walkthrough, 2026-06-25 — within the approved gap list):**
- **Copy:** the owner asked that the UI never say "one-off session" — it now reads
  plain **"Add session"** everywhere (the empty-cell popover button + the no-block
  hint). The `is_loose` container is an implementation detail; no user-facing text
  names it. (Internal DB name stays `One-off sessions`; never surfaced.)
- **Two container-name leaks closed (completes G3-5's "never reads as a block"):**
  (a) the **client-profile Programs tab** fell back to `(activeProgramRows)[0]`,
  which for a loose-only client was the container → it showed "One-off sessions"
  as the active program; now excludes `is_loose` (shows the no-block empty state
  instead). (b) the **portal "You" page** still used `.maybeSingle()` on active
  programs — the same FM-1 throw missed in the first G3-3 pass, and it rendered
  `program.name` → fixed to fetch-all + show the dated block's name, "Your
  sessions" if loose-only, else "None yet".

**Not done here:** the section sign-off itself (operator pastes this into the
claude.ai review chat; decision recorded under a Sign-off heading).

---

## Sign-off

- **Date signed off:** 2026-06-25
- **Reviewer:** claude.ai project chat (challenger role)
- **Decision:** Closed (G3-7 approved to close → item 3 fully closed, G3-1..G3-8)

Reviewer response, verbatim:

> SIGN-OFF — Polish item 3 (block-less / one-off sessions), G3-7 — 2026-06-25
> G3-7 approved to close, completing item 3 (G3-1..G3-8 all closed). Verified at source: _get_or_create_loose_program ON CONFLICT predicate matches programs_one_loose_per_client_idx; helper REVOKEd from anon+authenticated with no GRANT (internal-only); all four copy/repeat RPCs plus duplicate_program_day resolve the target program from the TARGET date (dated block wins, else loose container), confirmed not carried from the source program_id; scan-uses-existing / apply-get-or-creates asymmetry is logically sound. pgTAP 45_loose_copy_repeat.sql 6/6 and 44 re-run 5/5 on the live DB; regression-free. Owner confirmed UI end-to-end.
> Recorded follow-up (does not block): pgTAP 45 exercises only the bare→loose path; add an A7 asserting copy-onto-a-block-covered-date attaches to the block (is_loose = false) to lock target-date precedence against future refactor.
> Carry to go-live-checklist: deploy-ordering — item-3 frontend must ship with migrations 20260625120000 + 20260625130000 so the deployed calendar can render is_loose days.
> This supersedes-by-append the partial sign-off recorded earlier for item 3 (which closed G3-1..G3-6, G3-8 with G3-7 deferred). Item 3 is now fully closed.

**Follow-up actioned 2026-06-25:** the reviewer's A7 was added to
`45_loose_copy_repeat.sql` (copy onto a block-covered date → `is_loose = false`,
locking target-date precedence). Suite now **7/7 on the live DB**. The
deploy-ordering note was carried to `docs/go-live-checklist.md`.
